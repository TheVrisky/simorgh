/* ============================================================
 *  Gemini Assistant - Snippet Runner
 *  Resolves snippet variables (auto + user input) and runs the snippet.
 * ============================================================ */

import * as vscode from 'vscode';
import { AiClient } from './aiClient';
import { ContextService } from './contextService';
import { Snippet, SnippetVariable, WebviewMessage } from './types';
import { extractTemplateVariables, formatTemplate, errorToString } from './helpers';
import { Logger } from './logger';

export interface SnippetRunResult {
    prompt: string;
    response: string | null;
}

export class SnippetRunner {
    constructor(
        private readonly gemini: AiClient,
        private readonly context: ContextService,
        private readonly logger: Logger
    ) {}

    /**
     * Fills auto variables from the live editor/workspace,
     * then asks the user for any remaining variables.
     * Returns the formatted prompt, or null if cancelled.
     */
    public async resolveSnippetPrompt(snippet: Snippet): Promise<string | null> {
        const autoCtx = await this.context.resolveAutoContext();
        const vars: Record<string, string> = {};

        // 1. Auto variables
        if (snippet.variables) {
            for (const v of snippet.variables) {
                if (v.auto && autoCtx[v.auto] !== undefined && autoCtx[v.auto] !== '') {
                    vars[v.key] = autoCtx[v.auto];
                } else if (v.default !== undefined) {
                    vars[v.key] = v.default;
                }
            }
        }

        // 2. Any variable referenced in body but not filled yet → ask user
        const referenced = extractTemplateVariables(snippet.body);
        const missing = referenced.filter(k => !vars[k]);

        for (const key of missing) {
            // Check if there's a declared variable with this key
            const declared = snippet.variables?.find(v => v.key === key);
            const label = declared?.label || key;
            const placeholder = declared?.default || `مقدار برای ${key}`;
            const value = await vscode.window.showInputBox({
                prompt: `متغیر «${label}» را وارد کنید`,
                placeHolder: placeholder,
                ignoreFocusOut: true
            });
            if (value === undefined) { return null; } // user cancelled
            vars[key] = value;
        }

        return formatTemplate(snippet.body, vars);
    }

    /**
     * Runs a snippet and returns the prompt + response.
     */
    public async runSnippet(
        snippet: Snippet,
        signal?: AbortSignal
    ): Promise<SnippetRunResult | null> {
        const prompt = await this.resolveSnippetPrompt(snippet);
        if (prompt === null) {
            return null;
        }

        const model = this.gemini.getModel();
        const response = await this.gemini.generateContent(prompt, model, signal);

        return { prompt, response };
    }

    /**
     * Same as runSnippet, but routes the result to a webview (for chat mode).
     * Sends `typeAnswerText` message back to the webview.
     */
    public async runSnippetToWebview(
        snippet: Snippet,
        webview: vscode.Webview,
        speed: number,
        signal?: AbortSignal
    ): Promise<void> {
        const prompt = await this.resolveSnippetPrompt(snippet);
        if (prompt === null) { return; }

        const model = this.gemini.getModel();
        const response = await this.gemini.generateContent(prompt, model, signal);

        const text = response || 'پاسخی دریافت نشد. لطفاً کلید API و نام مدل را بررسی کنید.';
        webview.postMessage({
            command: 'typeAnswerText',
            text,
            speed
        });
    }

    /**
     * Returns the editor's selection text. Used by chat to pre-fill selection.
     */
    public getEditorSelection(): string {
        return this.context.getSelection();
    }

    /**
     * Inserts text at the active cursor position (used by 'insert' mode snippets).
     */
    public async insertIntoEditor(text: string): Promise<boolean> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('هیچ ادیتوری فعال نیست.');
            return false;
        }
        const position = editor.selection.active;
        await editor.edit(b => b.insert(position, text));
        return true;
    }

    /**
     * Replaces the current selection with text (used by 'replace' mode snippets).
     */
    public async replaceSelection(text: string): Promise<boolean> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('هیچ ادیتوری فعال نیست.');
            return false;
        }
        const selection = editor.selection;
        await editor.edit(b => b.replace(selection, text));
        return true;
    }
}
