/* ============================================================
 *  Gemini Assistant - Integration Commands (C-series)
 *  C1 Editor context menu extras, C5 Terminal error,
 *  C6 Git diff to chat, C7 Active file problems.
 *  Plus entry points for A7 (export) and A12 (open in tab).
 * ============================================================ */

import * as vscode from 'vscode';
import { AiClient } from '../core/aiClient';
import { ContextService } from '../core/contextService';
import { Logger } from '../core/logger';
import { ChatStore } from '../core/chatStore';
import { GeminiChatProvider } from '../providers/geminiChatProvider';
import { errorToString, truncate } from '../core/helpers';

const MAX_DIFF_CHARS = 30000;
const MAX_TERMINAL_CHARS = 8000;

export class IntegrationCommands {
    constructor(
        private readonly gemini: AiClient,
        private readonly context: ContextService,
        private readonly chatStore: ChatStore,
        private readonly chatProvider: GeminiChatProvider,
        private readonly logger: Logger
    ) {}

    // ===== C1: editor context menu snippet triggers =====
    public async refactorSelection(): Promise<void> {
        await this.chatProvider.triggerSnippet('builtin.refactor');
    }

    public async fixSelection(): Promise<void> {
        await this.chatProvider.triggerSnippet('builtin.findBugs');
    }

    public async testSelection(): Promise<void> {
        await this.chatProvider.triggerSnippet('builtin.generateTests');
    }

    // ===== C5: explain terminal error =====
    public async explainTerminalError(): Promise<void> {
        const terminal = vscode.window.activeTerminal;
        if (!terminal) {
            vscode.window.showWarningMessage('هیچ ترمینال فعالی یافت نشد.');
            return;
        }
        // Terminal.selection is available on recent VS Code versions
        const selection = (terminal as unknown as { selection?: string }).selection ?? '';
        if (!selection.trim()) {
            vscode.window.showWarningMessage(
                'ابتدا متن خطا را در ترمینال انتخاب (highlight) کنید، سپس این دستور را اجرا کنید.'
            );
            return;
        }
        await this.runToDoc(
            'توضیح خطای ترمینال',
            () => `You are an expert debugger for terminal/CLI errors.
Explain the following terminal output/error in Persian (فارسی):

## علت خطا
(توضیح کوتاه و واضح)

## راه‌حل
(مراحل رفع به‌صورت لیست)

## دستور اصلاحی
(در صورت لزوم، دستور پیشنهادی)

Terminal output:
\`\`\`
${truncate(selection, MAX_TERMINAL_CHARS)}
\`\`\``,
            'terminal-error.md'
        );
    }

    // ===== C6: insert git diff into chat composer =====
    public async addGitDiffToChat(): Promise<void> {
        const diff = await this.context.getGitDiff(true);
        if (!diff.trim()) {
            vscode.window.showWarningMessage('هیچ تغییری (staged یا unstaged) یافت نشد.');
            return;
        }
        await vscode.commands.executeCommand('workbench.view.extension.geminiAssistantContainer');
        setTimeout(() => {
            this.chatProvider.postMessageToWebviews({
                command: 'insertToComposer',
                text: `این تغییرات Git را بررسی و ریویو کن:\n\n\`\`\`diff\n${truncate(diff, MAX_DIFF_CHARS)}\n\`\`\``
            });
        }, 300);
    }

    // ===== C7: explain all problems of the active file =====
    public async explainActiveFileProblems(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('فایلی در ادیتور باز نیست.');
            return;
        }
        const diags = vscode.languages.getDiagnostics(editor.document.uri);
        if (diags.length === 0) {
            vscode.window.showInformationMessage('این فایل هیچ خطا یا هشداری ندارد.');
            return;
        }

        const problems = diags.map(d => {
            const sev = vscode.DiagnosticSeverity[d.severity];
            const line = d.range.start.line + 1;
            return `- [${sev}] line ${line} (${d.source || 'unknown'}): ${d.message}`;
        }).join('\n');

        const doc = editor.document;
        const fileName = doc.uri.path.split('/').pop();
        const code = doc.getText();

        await this.runToDoc(
            'توضیح مشکلات فایل',
            () => `You are an expert debugger.
Explain all the diagnostics (errors/warnings) of the following file in Persian (فارسی).
For each problem: cause, fix steps, and a short corrected code snippet.

File: ${fileName} (${doc.languageId})
Problems:
${problems}

Full code:
\`\`\`${doc.languageId}
${truncate(code, 50000)}
\`\`\``,
            'file-problems.md'
        );
    }

    // ===== helpers =====
    private async runToDoc(title: string, promptBuilder: () => string, fileName: string): Promise<void> {
        try {
            const prompt = promptBuilder();
            if (!prompt) { return; }
            const model = this.gemini.getModel();
            const response = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title, cancellable: true },
                async (progress, token) => {
                    progress.report({ message: 'در حال پردازش با Gemini...' });
                    return await this.gemini.generateContent(prompt, model);
                }
            );
            if (!response) {
                vscode.window.showWarningMessage('پاسخی دریافت نشد.');
                return;
            }
            const doc = await vscode.workspace.openTextDocument({ content: response, language: 'markdown' });
            await vscode.window.showTextDocument(doc, { preview: false });
        } catch (err) {
            this.logger.error(title, err);
            vscode.window.showErrorMessage(`خطا: ${errorToString(err)}`);
        }
    }

    public dispose(): void {
        // nothing persistent
    }
}
