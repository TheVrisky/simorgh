/* ============================================================
 *  AI Assistant - @-mention Context Resolver (Phase 5-B)
 *  Parses @file:, @selection, @problems, @git, @clipboard tokens
 *  from the user prompt and expands them into real content.
 * ============================================================ */

import * as vscode from 'vscode';
import { ContextService } from './contextService';
import { scrubSecrets } from './secretScrubber';
import { truncate } from './helpers';
import { Logger } from './logger';

const MAX_FILE_CHARS = 20000;
const MAX_SELECTION_CHARS = 12000;

/**
 * Resolves @-mentions in a user prompt into inline context blocks.
 * Supported tokens:
 *   @selection         – current editor selection
 *   @activeFile        – full active editor content
 *   @problems          – diagnostics of the active file
 *   @git               – staged + unstaged diff
 *   @gitBranch         – current branch name
 *   @clipboard         – clipboard text
 *   @file:path/to.ts   – a specific workspace file
 */
export class MentionResolver {
    constructor(
        private readonly contextService: ContextService,
        private readonly logger: Logger
    ) {}

    /** Expands @-mentions. Returns the enriched prompt plus a debug summary. */
    public async resolve(prompt: string): Promise<{ text: string; expanded: string[] }> {
        const expanded: string[] = [];
        let out = prompt;

        // @file:path
        const fileRegex = /@file:([^\s]+)/g;
        const fileMatches = Array.from(prompt.matchAll(fileRegex));
        for (const match of fileMatches) {
            const relPath = match[1];
            const block = await this.readWorkspaceFile(relPath);
            if (block) {
                const scrubbed = scrubSecrets(block);
                out = out.replace(match[0], `\n\n### فایل: ${relPath}\n\`\`\`\n${truncate(scrubbed.text, MAX_FILE_CHARS)}\n\`\`\`\n`);
                expanded.push(`@file:${relPath}`);
            }
        }

        // @selection
        if (/@selection\b/.test(out)) {
            const sel = this.contextService.getSelection();
            if (sel) {
                const scrubbed = scrubSecrets(truncate(sel, MAX_SELECTION_CHARS));
                out = out.replace(/@selection\b/g, `\n\n### کد انتخاب‌شده\n\`\`\`\n${scrubbed.text}\n\`\`\`\n`);
                expanded.push('@selection');
            }
        }

        // @activeFile
        if (/@activeFile\b/.test(out)) {
            const doc = this.contextService.getActiveDocument();
            if (doc) {
                const scrubbed = scrubSecrets(truncate(doc.getText(), MAX_FILE_CHARS));
                out = out.replace(/@activeFile\b/g, `\n\n### فایل فعال: ${doc.fileName}\n\`\`\`\n${scrubbed.text}\n\`\`\`\n`);
                expanded.push('@activeFile');
            }
        }

        // @problems
        if (/@problems\b/.test(out)) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const diags = vscode.languages.getDiagnostics(editor.document.uri);
                const list = diags.map(d => `- line ${d.range.start.line + 1}: ${d.message}`).join('\n');
                out = out.replace(/@problems\b/g, `\n\n### مشکلات فایل فعال\n${list || '(بدون مشکل)'}\n`);
                expanded.push('@problems');
            }
        }

        // @gitBranch
        if (/@gitBranch\b/.test(out)) {
            const branch = await this.contextService.getGitBranch();
            out = out.replace(/@gitBranch\b/g, `\n\n### شاخه Git\n\`${branch || '(نامشخص)'}\`\n`);
            expanded.push('@gitBranch');
        }

        // @git
        if (/@git\b/.test(out)) {
            const diff = await this.contextService.getGitDiff(true);
            if (diff.trim()) {
                out = out.replace(/@git\b/g, `\n\n### Git Diff\n\`\`\`diff\n${truncate(diff, 30000)}\n\`\`\`\n`);
                expanded.push('@git');
            }
        }

        // @clipboard
        if (/@clipboard\b/.test(out)) {
            try {
                const clip = await vscode.env.clipboard.readText();
                if (clip) {
                    const scrubbed = scrubSecrets(truncate(clip, 20000));
                    out = out.replace(/@clipboard\b/g, `\n\n### محتوای کلیپ‌بورد\n\`\`\`\n${scrubbed.text}\n\`\`\`\n`);
                    expanded.push('@clipboard');
                }
            } catch (err) {
                this.logger.error('mentionResolver @clipboard', err);
            }
        }

        return { text: out, expanded };
    }

    private async readWorkspaceFile(relPath: string): Promise<string | null> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) { return null; }
        const uri = vscode.Uri.joinPath(folders[0].uri, relPath);
        try {
            const data = await vscode.workspace.fs.readFile(uri);
            return Buffer.from(data).toString('utf8');
        } catch (err) {
            this.logger.error(`mentionResolver readWorkspaceFile(${relPath})`, err);
            return null;
        }
    }
}
