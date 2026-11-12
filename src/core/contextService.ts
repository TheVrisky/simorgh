/* ============================================================
 *  Gemini Assistant - Context Service
 *  Resolves {variable} placeholders to live editor/workspace values.
 * ============================================================ */

import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';

export type ContextVars = Record<string, string>;

export class ContextService {
    /** Returns context values commonly used by snippets. */
    public async resolveAutoContext(): Promise<ContextVars> {
        const editor = vscode.window.activeTextEditor;
        const document = editor?.document;

        const activeFile = document ? document.getText() : '';
        const activeFileName = document ? path.basename(document.fileName) : '';
        const language = document ? document.languageId : 'plaintext';
        const selection = editor && !editor.selection.isEmpty
            ? editor.document.getText(editor.selection)
            : '';

        const gitBranch = await this.getGitBranch();
        const gitRepo = await this.getGitRepoName();
        const workspaceName = this.getWorkspaceName();

        return {
            activeFile,
            activeFileName,
            language,
            selection,
            gitBranch,
            gitRepo,
            workspaceName
        };
    }

    public async getGitBranch(): Promise<string> {
        try {
            const ext = vscode.extensions.getExtension('vscode.git');
            if (!ext) { return ''; }
            if (!ext.isActive) { await ext.activate(); }
            const gitApi = ext.exports?.getAPI?.(1);
            if (!gitApi) { return ''; }
            const repo = gitApi.repositories?.[0];
            if (!repo) { return ''; }
            const head = repo.state?.HEAD;
            return head?.name || '';
        } catch {
            return '';
        }
    }

    public async getGitRepoName(): Promise<string> {
        try {
            const folders = vscode.workspace.workspaceFolders;
            if (!folders || folders.length === 0) { return ''; }
            return folders[0].name;
        } catch {
            return '';
        }
    }

    public getWorkspaceName(): string {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) { return ''; }
        return folders[0].name;
    }

    /**
     * Returns the git diff text for staged changes, or unstaged if no staged.
     * Returns empty string if git is unavailable or no changes.
     */
    public async getGitDiff(staged = true): Promise<string> {
        try {
            const ext = vscode.extensions.getExtension('vscode.git');
            if (!ext) { return ''; }
            if (!ext.isActive) { await ext.activate(); }
            const gitApi = ext.exports?.getAPI?.(1);
            if (!gitApi) { return ''; }
            const repo = gitApi.repositories?.[0];
            if (!repo) { return ''; }

            // Use repository API to get diff
            // The git extension exposes a private-ish method but we can use the index
            if (staged) {
                const stagedDiff = await this.runGitCommand(['diff', '--cached', '--no-color']);
                if (stagedDiff.trim()) { return stagedDiff; }
                // Fallback to unstaged if nothing staged
                return await this.runGitCommand(['diff', '--no-color']);
            }
            return await this.runGitCommand(['diff', '--no-color']);
        } catch {
            return '';
        }
    }

    /**
     * Returns the recent commit log entries.
     */
    public async getGitLog(maxCount = 30): Promise<string> {
        return await this.runGitCommand(['log', `-${maxCount}`, '--pretty=format:%h|%ad|%an|%s', '--date=short', '--no-color']);
    }

    /**
     * Returns the diff of recent commits in the given range.
     * Defaults to last 24 hours of activity.
     */
    public async getRecentCommits(days = 1): Promise<string> {
        const since = `${days} day ago`;
        return await this.runGitCommand([
            'log',
            `--since=${since}`,
            '--pretty=format:### %h by %an on %ad%n%s%n%b',
            '--date=short',
            '--no-color'
        ]);
    }

    /**
     * Returns names of files that changed in the given commit range.
     */
    public async getChangedFiles(sinceDays = 1): Promise<string[]> {
        const out = await this.runGitCommand([
            'log',
            `--since=${sinceDays} day ago`,
            '--name-only',
            '--pretty=format:',
            '--no-color'
        ]);
        return out
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0);
    }

    /**
     * Runs a git command in the workspace root and returns stdout.
     */
    public async runGitCommand(args: string[]): Promise<string> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) { return ''; }
        const cwd = folders[0].uri.fsPath;

        const gitExt = vscode.extensions.getExtension('vscode.git');
        if (gitExt) {
            if (!gitExt.isActive) { await gitExt.activate(); }
        }

        return new Promise<string>((resolve) => {
            try {
                execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: 15000 }, (err: unknown, stdout: string) => {
                    if (err) { resolve(''); return; }
                    resolve(stdout || '');
                });
            } catch {
                resolve('');
            }
        });
    }

    /**
     * Returns the active editor's document.
     */
    public getActiveDocument(): vscode.TextDocument | undefined {
        return vscode.window.activeTextEditor?.document;
    }

    /**
     * Returns the active editor's selection text (or empty if none).
     */
    public getSelection(): string {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) { return ''; }
        return editor.document.getText(editor.selection);
    }
}
