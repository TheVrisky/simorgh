/* ============================================================
 *  AI Assistant (Multi-Provider) - Modern Chat Webview Provider
 *  A1 Multi-turn chat, A2 Markdown rendering, A3 Copy buttons,
 *  A4 Streaming (SSE), A5 Conversation history, A6 Switch convs,
 *  A7 Export (command), A8 Welcome screen, A9 Typing indicator,
 *  A10 Animations, A11 Markdown preview, A12 Open in editor tab.
 *  C8/C9: image input (attach button, drag&drop, paste).
 *  v0.5: Multi-provider — Gemini / OpenAI / Claude / DeepSeek /
 *        OpenRouter / Groq / Ollama / custom OpenAI-compatible.
 * ============================================================ */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    DEFAULT_SPEED, MIN_SPEED, MAX_SPEED, OUTPUT_CHANNEL_NAME, STATE_TYPING_SPEED
} from '../core/constants';
import { ChatMessage, GeminiContent, GeminiPart, GeminiUsage, WebviewImage, WebviewMessage } from '../core/types';
import { clampSpeed, errorToString, getCspNonce, truncate } from '../core/helpers';
import { scrubSecrets } from '../core/secretScrubber';
import { Logger } from '../core/logger';
import { AiClient } from '../core/aiClient';
import { SnippetManager, QUICK_ACTIONS } from '../core/snippetManager';
import { SnippetRunner } from '../core/snippetRunner';
import { ChatStore } from '../core/chatStore';
import { StatusBarService } from '../core/statusBarService';
import { EditApplier, ApplyMode } from '../core/editApplier';
import { MentionResolver } from '../core/mentionResolver';

const MAX_CONTEXT_CHARS = 16000;
const MAX_SELECTION_CHARS = 12000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_IMAGES_PER_MSG = 2;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB (base64 in storage)
const IMAGE_CONTEXT_WINDOW = 4; // include images only from last N history messages

type PostFn = (msg: Record<string, unknown>) => void;

export class GeminiChatProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    private abortController: AbortController | null = null;
    private currentOperation: Promise<void> | null = null;
    private webviews: Set<vscode.Webview> = new Set();

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext,
        private readonly _logger: Logger,
        private readonly _ai: AiClient,
        private readonly _snippets: SnippetManager,
        private readonly _runner: SnippetRunner,
        private readonly _chatStore: ChatStore,
        private readonly _statusBar: StatusBarService,
        private readonly _editApplier: EditApplier,
        private readonly _mentions: MentionResolver
    ) {}

    public dispose(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }

    // ===== Public triggers (used by commands) =====
    public async triggerSnippet(snippetId: string): Promise<void> {
        await vscode.commands.executeCommand('workbench.view.extension.geminiAssistantContainer');
        setTimeout(() => {
            this.postToAll({ command: 'snippetChosen', snippetId });
        }, 300);
    }

    public async newConversation(): Promise<void> {
        await this._chatStore.create();
        this.postToAll({
            command: 'conversationLoaded',
            conversation: await this._chatStore.getActive(),
            conversations: await this._chatStore.listSummaries()
        });
        vscode.commands.executeCommand('workbench.view.extension.geminiAssistantContainer');
    }

    /** A12: open the chat inside a full editor tab. */
    public createEditorPanel(): void {
        const panel = vscode.window.createWebviewPanel(
            'geminiAssistantChatTab',
            'Gemini Chat',
            vscode.ViewColumn.Active,
            { enableScripts: true, localResourceRoots: [this._extensionUri] }
        );
        panel.iconPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'icon.svg');
        this.setupWebview(panel.webview);
        panel.onDidDispose(() => {
            this.webviews.delete(panel.webview);
        }, null, this._context.subscriptions);
    }

    // ===== Provider =====
    public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        this.setupWebview(webviewView.webview);
    }

    private setupWebview(webview: vscode.Webview): void {
        const nonce = getCspNonce();
        webview.html = this.getHtml(webview, nonce);
        this.webviews.add(webview);

        this.postInitState(webview);

        webview.onDidReceiveMessage(async (data: WebviewMessage) => {
            const post: PostFn = (msg) => {
                void webview.postMessage(msg);
            };
            try {
                await this.handleMessage(data, post);
            } catch (err) {
                this._logger.error('webview message', err);
                vscode.window.showErrorMessage(`خطای داخلی: ${errorToString(err)}`);
                post({ command: 'finished' });
            }
        });
    }

    private postToAll(msg: Record<string, unknown>): void {
        for (const w of this.webviews) {
            void w.postMessage(msg);
        }
    }

    /** Public helper for other services (e.g., IntegrationCommands) to push messages into chat webviews. */
    public postMessageToWebviews(msg: Record<string, unknown>): void {
        this.postToAll(msg);
    }

    private postInitState(webview: vscode.Webview): void {
        void (async () => {
            const snapshot = await this._ai.getSnapshot();
            await webview.postMessage({
                command: 'initState',
                snapshot,
                providers: this._ai.listProviders().map(p => ({ id: p.id, label: p.label })),
                typingSpeed: clampSpeed(this._context.globalState.get<number>(STATE_TYPING_SPEED, DEFAULT_SPEED)),
                quickActions: QUICK_ACTIONS,
                favorites: this._snippets.getFavoriteSnippets().map(s => ({ id: s.id, name: s.name })),
                conversation: await this._chatStore.ensureActive(),
                conversations: await this._chatStore.listSummaries()
            });
        })();
    }

    /** Pushes the current provider state so the settings tab stays in sync. */
    private async postProviderSnapshot(post: PostFn): Promise<void> {
        post({ command: 'providerSwitched', snapshot: await this._ai.getSnapshot() });
    }

    // ===== Message handling =====
    private async handleMessage(data: WebviewMessage, post: PostFn): Promise<void> {
        this._logger.log(`Received command: ${data.command}`);

        switch (data.command) {
            case 'setApiKey': {
                await this._ai.setApiKey();
                await this.postProviderSnapshot(post);
                break;
            }
            case 'clearApiKey': {
                await this._ai.clearApiKey();
                await this.postProviderSnapshot(post);
                break;
            }
            case 'switchProvider': {
                // v0.5: switch the active AI provider from the settings tab
                if (data.providerId) {
                    try {
                        await this._ai.setProvider(data.providerId);
                        await this.postProviderSnapshot(post);
                        this._statusBar.refresh();
                    } catch (err) {
                        vscode.window.showErrorMessage(errorToString(err));
                    }
                }
                break;
            }
            case 'saveSettings': {
                const model = (data.selectedModel ?? '').trim();
                const speed = clampSpeed(data.speed);
                if (model) {
                    await this._ai.setModel(model);
                }
                if (typeof data.baseUrl === 'string') {
                    await this._ai.setBaseUrl(data.baseUrl);
                }
                await this._context.globalState.update(STATE_TYPING_SPEED, speed);
                this._statusBar.refresh();
                vscode.window.showInformationMessage('تنظیمات با موفقیت ذخیره شد.');
                break;
            }
            case 'fetchModels': {
                const models = await this._ai.fetchModels();
                if (models && models.length > 0) {
                    post({ command: 'modelsFetched', models, selectedModel: this._ai.getModel() });
                    vscode.window.showInformationMessage(`تعداد ${models.length} مدل از «${this._ai.getProviderLabel()}» دریافت شد.`);
                }
                break;
            }
            case 'stopProcess':
                if (this.abortController) {
                    this.abortController.abort();
                    this.abortController = null;
                }
                post({ command: 'streamEnded', cancelled: true });
                post({ command: 'finished' });
                break;
            case 'writeCode':
                await this.runExclusive(() => this.handleWriteCodeRequest(data), post);
                break;
            case 'sendChat': {
                const text = (data.text ?? '').trim();
                const images = (data.images ?? []).filter(i => i.base64);
                if (!text && images.length === 0) { return; }
                await this.runExclusive(() => this.runChatTurn(text, images, post), post);
                break;
            }
            case 'runSnippet': {
                const snippetId = data.snippetId;
                if (!snippetId) { return; }
                const snippet = this._snippets.getById(snippetId);
                if (!snippet) { return; }
                await this.runExclusive(async () => {
                    const prompt = await this._runner.resolveSnippetPrompt(snippet);
                    if (prompt !== null) {
                        await this.runChatTurn(prompt, [], post);
                    }
                }, post);
                break;
            }
            case 'toggleFavorite': {
                if (data.snippetId) {
                    await this._snippets.toggleFavorite(data.snippetId);
                    post({
                        command: 'favoritesUpdated',
                        favorites: this._snippets.getFavoriteSnippets().map(s => ({ id: s.id, name: s.name }))
                    });
                }
                break;
            }
            case 'openSnippetPicker': {
                const all = this._snippets.getAll();
                const picked = await vscode.window.showQuickPick(
                    all.map(s => ({
                        label: s.name,
                        description: this._snippets.getCategoryLabel(s.category),
                        detail: s.description,
                        id: s.id
                    })),
                    { placeHolder: 'یک دستور را انتخاب کنید' }
                );
                if (picked) {
                    post({ command: 'snippetChosen', snippetId: picked.id });
                }
                break;
            }
            case 'pickImage': {
                // C8: pick image via dialog
                const uris = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    openLabel: 'انتخاب تصویر',
                    filters: { 'تصاویر': ['png', 'jpg', 'jpeg', 'gif', 'webp'] }
                });
                if (uris && uris[0]) {
                    try {
                        const uri = uris[0];
                        const stat = await vscode.workspace.fs.stat(uri);
                        if (stat.size > MAX_IMAGE_BYTES) {
                            vscode.window.showWarningMessage('حجم تصویر باید کمتر از ۴ مگابایت باشد.');
                            break;
                        }
                        const buf = await vscode.workspace.fs.readFile(uri);
                        const base64 = Buffer.from(buf).toString('base64');
                        const ext = (uri.path.split('.').pop() || 'png').toLowerCase();
                        const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext === 'jpeg' ? 'jpeg' : ext}`;
                        post({ command: 'imageAttached', base64, mimeType: mime, name: uri.path.split('/').pop() });
                    } catch (err) {
                        vscode.window.showErrorMessage(`خطا در خواندن تصویر: ${errorToString(err)}`);
                    }
                }
                break;
            }
            case 'copyToClipboard': {
                // A3: reliable clipboard via extension host
                if (typeof data.text === 'string') {
                    await vscode.env.clipboard.writeText(data.text);
                }
                break;
            }
            case 'newChat': {
                await this._chatStore.create();
                post({
                    command: 'conversationLoaded',
                    conversation: await this._chatStore.getActive(),
                    conversations: await this._chatStore.listSummaries()
                });
                break;
            }
            case 'loadConversation': {
                if (data.conversationId) {
                    this._chatStore.setActive(data.conversationId);
                    post({
                        command: 'conversationLoaded',
                        conversation: await this._chatStore.get(data.conversationId),
                        conversations: await this._chatStore.listSummaries()
                    });
                }
                break;
            }
            case 'deleteConversation': {
                if (data.conversationId) {
                    await this._chatStore.delete(data.conversationId);
                    await this._chatStore.ensureActive();
                    post({
                        command: 'conversationLoaded',
                        conversation: await this._chatStore.getActive(),
                        conversations: await this._chatStore.listSummaries()
                    });
                }
                break;
            }
            case 'resetUsage': {
                await this._chatStore.resetUsage();
                this._statusBar.refresh();
                vscode.window.showInformationMessage('آمار مصرف توکن صفر شد.');
                break;
            }
            case 'exportChat': {
                await this.exportActiveChat();
                break;
            }
            case 'applyCode': {
                const code = typeof data.text === 'string' ? data.text : '';
                if (!code.trim()) { break; }
                const mode = await vscode.window.showQuickPick(
                    [
                        { label: '$(replace) جایگزینی کل فایل فعال', value: 'replaceFile' },
                        { label: '$(selection) جایگزینی انتخاب فعلی', value: 'replaceSelection' },
                        { label: '$(insert) درج در محل نشانگر', value: 'insertAtCursor' },
                        { label: '$(new-file) ساخت فایل جدید', value: 'newFile' }
                    ],
                    { placeHolder: 'نحوه اعمال کد تولیدشده را انتخاب کنید' }
                );
                if (mode) {
                    await this._editApplier.apply(code, mode.value as ApplyMode, data.name);
                }
                break;
            }
            default:
                this._logger.log(`Unknown command: ${data.command}`);
        }
    }

    private async runExclusive(task: () => Promise<void>, post: PostFn): Promise<void> {
        if (this.currentOperation) {
            vscode.window.showWarningMessage('یک عملیات در حال اجرا است. لطفاً ابتدا آن را متوقف کنید.');
            post({ command: 'finished' });
            return;
        }
        this.abortController = new AbortController();
        try {
            this.currentOperation = task();
            await this.currentOperation;
        } finally {
            this.currentOperation = null;
            this.abortController = null;
            post({ command: 'finished' });
        }
    }

    // ===== Chat turn (streaming, A1 + A4) =====
    private async runChatTurn(userText: string, images: WebviewImage[], post: PostFn): Promise<void> {
        const conv = await this._chatStore.ensureActive();

        // 5-B: expand @-mentions before persisting
        const resolved = await this._mentions.resolve(userText);
        if (resolved.expanded.length > 0) {
            this._logger.log(`Expanded mentions: ${resolved.expanded.join(', ')}`);
        }
        const effectiveText = resolved.text;

        // 1. Save + show the user message
        const userMsg: ChatMessage = { role: 'user', text: userText || '(تصویر)', ts: Date.now(), images };
        await this._chatStore.appendMessage(conv.id, userMsg);
        post({
            command: 'userMessageAdded',
            message: userMsg,
            conversationId: conv.id,
            title: conv.title
        });

        // 2. Build contents from history (multi-turn memory)
        // Use the mention-expanded text for the current turn only
        const historyForTurn = (await this._chatStore.get(conv.id)) ?? conv;
        const patchedConv = {
            ...historyForTurn,
            messages: historyForTurn.messages.map((m, idx) =>
                (idx === historyForTurn.messages.length - 1 && m.role === 'user') ? { ...m, text: effectiveText } : m
            )
        };
        const contents = this.buildContents(patchedConv);
        const model = this._ai.getModel();
        const systemInstruction = this.buildSystemInstruction();

        // 3. Stream the answer
        let acc = '';
        let usage: GeminiUsage | undefined;
        const result = await this._ai.streamGenerateContent({
            contents,
            model,
            systemInstruction,
            signal: this.abortController?.signal,
            onChunk: (t) => {
                acc += t;
                post({ command: 'streamChunk', text: t });
            },
            onUsage: (u) => { usage = u; }
        });

        // 4. Persist the model answer
        if (result === null) {
            if (acc) {
                // aborted mid-stream — keep partial answer
                await this._chatStore.appendMessage(conv.id, { role: 'model', text: acc, ts: Date.now() });
            }
            post({ command: 'streamEnded', cancelled: true });
            return;
        }

        const finalText = acc || 'پاسخی دریافت نشد. لطفاً کلید API و نام مدل را بررسی کنید.';
        await this._chatStore.appendMessage(conv.id, { role: 'model', text: finalText, ts: Date.now() });
        if (usage) {
            await this._chatStore.addUsage(usage);
            this._statusBar.refresh();
        }
        post({ command: 'streamEnded', usage });
    }

    private buildContents(conv: { messages: ChatMessage[] }): GeminiContent[] {
        const history = conv.messages.slice(-MAX_HISTORY_MESSAGES);
        // ensure history starts with a user message
        while (history.length > 0 && history[0].role !== 'user') {
            history.shift();
        }
        return history.map((m, idx) => {
            const parts: GeminiPart[] = [{ text: m.text }];
            // Include images only for recent user messages to limit payload size
            const isRecent = idx >= history.length - IMAGE_CONTEXT_WINDOW;
            if (m.role === 'user' && isRecent && m.images?.length) {
                for (const img of m.images.slice(0, MAX_IMAGES_PER_MSG)) {
                    parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
                }
            }
            return { role: m.role, parts } as GeminiContent;
        });
    }

    private buildSystemInstruction(): string {
        let ctx = 'You are "AI Assistant", a Persian-speaking coding assistant embedded in VS Code.' +
            ' Always answer in Persian (فارسی) unless the user asks otherwise or the answer is pure code.' +
            ' Use Markdown with fenced code blocks (with language tags). Be concise and practical.';
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const doc = editor.document;
            const fileName = doc.uri.path.split('/').pop();
            const selection = doc.getText(editor.selection);
            ctx += `\n\nActive file: ${fileName} (${doc.languageId})`;
            if (selection) {
                const scrubbed = scrubSecrets(truncate(selection, MAX_SELECTION_CHARS));
                if (scrubbed.redactedCount > 0) {
                    this._logger.log(`Scrubbed ${scrubbed.redactedCount} secret(s) from selection (${scrubbed.redactedKinds.join(', ')}).`);
                }
                ctx += `\nSelected code:\n\`\`\`\n${scrubbed.text}\n\`\`\``;
            } else {
                const scrubbed = scrubSecrets(truncate(doc.getText(), MAX_CONTEXT_CHARS));
                if (scrubbed.redactedCount > 0) {
                    this._logger.log(`Scrubbed ${scrubbed.redactedCount} secret(s) from file content (${scrubbed.redactedKinds.join(', ')}).`);
                }
                ctx += `\nFile content:\n\`\`\`\n${scrubbed.text}\n\`\`\``;
            }
        }
        return ctx;
    }

    // ===== Write code (destructive replace — kept from stage1) =====
    private async handleWriteCodeRequest(data: WebviewMessage): Promise<void> {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showErrorMessage('لطفاً ابتدا یک فایل را در ادیتور باز کنید!');
            return;
        }
        const apiKey = await this._ai.requireApiKey();
        if (!apiKey) { return; }

        const prompt = (data.prompt ?? '').trim();
        if (!prompt) {
            vscode.window.showWarningMessage('دستور خالی است.');
            return;
        }

        const selectedModel = this._ai.getModel();
        const document = activeEditor.document;
        const currentFileCode = document.getText();
        const fileExtension = document.fileName.split('.').pop() || 'txt';

        const choice = await vscode.window.showWarningMessage(
            'این عملیات کل محتوای فایل فعلی را با کد تولیدشده جایگزین می‌کند. ادامه می‌دهید؟',
            { modal: true },
            'بله، جایگزین کن',
            'انصراف'
        );
        if (choice !== 'بله، جایگزین کن') { return; }

        const fullPrompt = `You are an expert code generator.
File extension: .${fileExtension}
Current file content:
\`\`\`
${currentFileCode}
\`\`\`

User instructions: ${prompt}

CRITICAL REQUIREMENT: Return ONLY the pure raw executable code. Do NOT wrap the response in markdown backticks, do NOT include explanations. Just raw output code.`;

        const responseText = await this._ai.generateContent(fullPrompt, selectedModel, this.abortController?.signal);
        if (responseText && responseText.trim()) {
            const cleanCode = responseText
                .replace(/^```[a-zA-Z]*\n/, '')
                .replace(/\n```$/, '')
                .trim();
            await this.typeIntoActiveEditor(cleanCode, clampSpeed(data.speed));
        } else {
            vscode.window.showWarningMessage('پاسخی دریافت نشد.');
        }
    }

    private async typeIntoActiveEditor(newText: string, speed: number): Promise<void> {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) { return; }
        const document = activeEditor.document;
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        await activeEditor.edit(b => b.delete(fullRange));

        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
        const CHUNK = 4;
        for (let i = 0; i < newText.length; i += CHUNK) {
            const chunk = newText.slice(i, i + CHUNK);
            const lastLine = activeEditor.document.lineCount - 1;
            const lastChar = activeEditor.document.lineAt(lastLine).range.end;
            await activeEditor.edit(b => b.insert(lastChar, chunk));
            const newLastLine = activeEditor.document.lineCount - 1;
            const newLastPos = activeEditor.document.lineAt(newLastLine).range.end;
            activeEditor.revealRange(new vscode.Range(newLastPos, newLastPos), vscode.TextEditorRevealType.Default);
            await sleep(speed);
        }
        vscode.window.showInformationMessage('تولید و درج کد با موفقیت به پایان رسید!');
    }

    // ===== Export chat (A7) =====
    public async exportActiveChat(): Promise<void> {
        const active = await this._chatStore.getActive();
        if (!active || active.messages.length === 0) {
            vscode.window.showWarningMessage('گفتگویی برای خروجی گرفتن وجود ندارد.');
            return;
        }
        const md = await this._chatStore.exportMarkdown(active.id);
        if (!md) { return; }
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`${active.title.replace(/[\\/:*?"<>|]/g, '_') || 'chat'}.md`),
            filters: { 'Markdown': ['md'] },
            saveLabel: 'ذخیره خروجی'
        });
        if (!uri) { return; }
        await vscode.workspace.fs.writeFile(uri, Buffer.from(md, 'utf8'));
        vscode.window.showInformationMessage('خروجی گفتگو ذخیره شد.');
    }

    // ===== HTML (loaded from media/ files — Phase 2 refactor) =====
    private getHtml(webview: vscode.Webview, nonce: string): string {
        const mediaRoot = vscode.Uri.joinPath(this._extensionUri, 'media');
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'chat.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'chat.js'));
        const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'chat.html');
        let html: string;
        try {
            html = fs.readFileSync(htmlPath, 'utf8');
        } catch (err) {
            this._logger.error('Failed to read media/chat.html', err);
            return `<html><body style="font-family:sans-serif;padding:20px;color:var(--vscode-foreground);">
                <h3>خطا در بارگذاری رابط کاربری</h3>
                <p>فایل <code>media/chat.html</code> پیدا نشد.</p>
                <pre>${errorToString(err)}</pre>
            </body></html>`;
        }
        return html
            .replace(/{{nonce}}/g, nonce)
            .replace(/{{cspSource}}/g, webview.cspSource)
            .replace(/{{styleUri}}/g, styleUri.toString())
            .replace(/{{scriptUri}}/g, scriptUri.toString());
    }

    private getHtmlLegacy_UNUSED(nonce: string, cspSource: string): string {
        return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: ${cspSource}; script-src 'nonce-${nonce}';">
    <style>
        * { box-sizing: border-box; }
        body {
            margin: 0; padding: 0;
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            display: flex; flex-direction: column;
            height: 100vh; overflow: hidden;
        }

        /* ===== Tabs ===== */
        .tab-header {
            display: flex; border-bottom: 1px solid var(--vscode-panel-border);
            gap: 2px; padding: 4px 6px 0; flex-shrink: 0;
        }
        .tab-btn {
            padding: 6px 14px; background: transparent; color: var(--vscode-foreground);
            border: none; border-bottom: 2px solid transparent; cursor: pointer; font-family: inherit; font-size: 12px;
        }
        .tab-btn.active {
            border-bottom-color: var(--vscode-panelTitle-activeBorder);
            color: var(--vscode-panelTitle-activeForeground); font-weight: bold;
        }
        .tab-content { display: none; flex-direction: column; flex: 1; min-height: 0; }
        .tab-content.active { display: flex; }

        /* ===== Chat area ===== */
        .chat-area {
            flex: 1; overflow-y: auto; padding: 10px;
            display: flex; flex-direction: column; gap: 10px;
        }

        .welcome { text-align: center; margin-top: 24px; }
        .welcome h2 { font-size: 15px; margin-bottom: 4px; }
        .welcome p { font-size: 12px; opacity: 0.7; margin: 0 0 16px; }
        .welcome-cards { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
        .welcome-card {
            background: var(--vscode-editorWidget-background, rgba(127,127,127,0.12));
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px; padding: 10px 12px; cursor: pointer;
            font-size: 12px; transition: all 0.15s ease; min-width: 130px; text-align: right;
        }
        .welcome-card:hover { border-color: var(--vscode-focusBorder); transform: translateY(-1px); }
        .welcome-card .wc-icon { font-size: 15px; display: block; margin-bottom: 4px; }

        .msg {
            max-width: 96%; border-radius: 8px; padding: 8px 12px;
            font-size: 12.5px; line-height: 1.7; animation: fadeIn 0.2s ease;
            word-break: break-word;
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        .msg.user {
            align-self: flex-start;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
        }
        .msg.model {
            align-self: stretch;
            background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.12));
            border-right: 3px solid #4285f4;
        }
        .msg-header {
            display: flex; align-items: center; gap: 8px;
            font-size: 10.5px; opacity: 0.65; margin-bottom: 4px;
        }
        .msg-header .msg-role { font-weight: bold; }
        .msg-header .msg-copy {
            background: transparent; border: none; color: var(--vscode-foreground);
            cursor: pointer; font-size: 10px; opacity: 0.7; padding: 1px 4px;
        }
        .msg-header .msg-copy:hover { opacity: 1; text-decoration: underline; }
        .msg-images { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
        .msg-images img { max-width: 120px; max-height: 90px; border-radius: 4px; border: 1px solid var(--vscode-panel-border); }

        /* Markdown content */
        .md p { margin: 4px 0; }
        .md h1, .md h2, .md h3 { margin: 8px 0 4px; font-size: 13px; }
        .md ul, .md ol { margin: 4px 0; padding-right: 20px; }
        .md blockquote { margin: 4px 0; padding: 2px 10px; border-right: 3px solid var(--vscode-panel-border); opacity: 0.85; }
        .md a { color: var(--vscode-textLink-foreground); }
        .md hr { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 8px 0; }
        .md .inline-code {
            background: rgba(127,127,127,0.18); padding: 1px 5px; border-radius: 3px;
            font-family: var(--vscode-editor-font-family); font-size: 11.5px; direction: ltr; display: inline-block;
        }
        .code-block {
            margin: 8px 0; border: 1px solid var(--vscode-panel-border);
            border-radius: 6px; overflow: hidden; direction: ltr; text-align: left;
        }
        .code-header {
            display: flex; justify-content: space-between; align-items: center;
            background: rgba(127,127,127,0.15); padding: 4px 10px; font-size: 10.5px;
        }
        .code-header .code-lang { opacity: 0.7; font-family: var(--vscode-editor-font-family); }
        .code-header .copy-btn {
            background: transparent; border: 1px solid transparent; color: var(--vscode-foreground);
            cursor: pointer; font-size: 10.5px; padding: 2px 8px; border-radius: 3px;
        }
        .code-header .copy-btn:hover { background: rgba(127,127,127,0.2); }
        .code-block pre {
            margin: 0; padding: 10px; overflow-x: auto;
            background: var(--vscode-editor-background);
            font-family: var(--vscode-editor-font-family); font-size: 11.5px; line-height: 1.5;
        }

        /* Typing indicator (A9) */
        .typing-dots { display: inline-flex; gap: 4px; padding: 4px 0; }
        .typing-dots span {
            width: 6px; height: 6px; border-radius: 50%;
            background: var(--vscode-foreground); opacity: 0.4;
            animation: dotPulse 1.2s infinite ease-in-out;
        }
        .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
        .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes dotPulse { 0%, 70%, 100% { transform: scale(1); opacity: 0.35; } 35% { transform: scale(1.25); opacity: 0.9; } }

        /* ===== Composer ===== */
        .composer { flex-shrink: 0; padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 8px; }
        .quick-actions { display: flex; gap: 4px; flex-wrap: wrap; }
        .qa-btn {
            padding: 4px 10px; border: none; cursor: pointer; font-size: 11px;
            border-radius: 10px; color: #fff; transition: transform 0.1s; font-family: inherit;
        }
        .qa-btn:hover { transform: translateY(-1px); opacity: 0.9; }
        .qa-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .favorites-row { display: flex; gap: 4px; flex-wrap: wrap; font-size: 11px; }
        .fav-chip {
            padding: 2px 9px; background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground); border-radius: 10px; cursor: pointer; border: none;
            font-family: inherit; font-size: 11px;
        }
        .fav-chip:hover { opacity: 0.85; }

        .image-chips { display: flex; gap: 6px; flex-wrap: wrap; }
        .img-chip {
            position: relative; display: inline-flex; align-items: center; gap: 4px;
            background: rgba(127,127,127,0.18); border-radius: 4px; padding: 3px 8px; font-size: 11px;
        }
        .img-chip .remove-img {
            background: transparent; border: none; color: var(--vscode-foreground);
            cursor: pointer; font-size: 11px; padding: 0 2px;
        }
        .img-chip img { width: 22px; height: 16px; object-fit: cover; border-radius: 2px; }

        .input-row { display: flex; gap: 6px; align-items: flex-end; }
        .input-row textarea {
            flex: 1; min-height: 52px; max-height: 140px; resize: vertical;
            padding: 7px 9px; background: var(--vscode-input-background);
            color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
            border-radius: 6px; outline: none; font-family: inherit; font-size: 12.5px;
        }
        .icon-btn {
            background: var(--vscode-button-secondaryBackground, rgba(127,127,127,0.25));
            color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
            border: none; border-radius: 6px; cursor: pointer; padding: 0 10px; height: 34px; font-size: 14px;
        }
        .icon-btn:hover { opacity: 0.85; }
        .send-btn {
            background: var(--vscode-button-background); color: var(--vscode-button-foreground);
            border: none; border-radius: 6px; cursor: pointer; padding: 0 14px; height: 34px;
            font-weight: bold; font-family: inherit; font-size: 12px;
        }
        .send-btn:hover { opacity: 0.9; }
        .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .stop-btn {
            background: #dc3545; color: #fff; border: none; border-radius: 6px;
            cursor: pointer; padding: 0 12px; height: 34px; font-family: inherit; font-size: 12px;
            display: none;
        }

        .composer-actions { display: flex; gap: 6px; flex-wrap: wrap; }
        .mini-btn {
            background: var(--vscode-button-secondaryBackground, rgba(127,127,127,0.25));
            color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
            border: none; border-radius: 4px; cursor: pointer; font-size: 11px;
            padding: 3px 10px; font-family: inherit;
        }
        .mini-btn:hover { opacity: 0.85; }

        .preview-pane {
            border: 1px solid var(--vscode-panel-border); border-radius: 6px;
            padding: 8px; max-height: 160px; overflow-y: auto; font-size: 12px;
            background: var(--vscode-editor-background);
        }
        .preview-pane .preview-title { font-size: 10px; opacity: 0.6; margin-bottom: 6px; }

        /* ===== History view (A5) ===== */
        .history-area { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
        .history-search {
            width: 100%; padding: 6px 9px; background: var(--vscode-input-background);
            color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
            border-radius: 4px; outline: none; font-family: inherit; font-size: 12px;
        }
        .conv-item {
            display: flex; align-items: center; gap: 8px;
            border: 1px solid var(--vscode-panel-border); border-radius: 6px;
            padding: 8px 10px; cursor: pointer; transition: all 0.15s;
        }
        .conv-item:hover { border-color: var(--vscode-focusBorder); }
        .conv-item.active { border-color: var(--vscode-focusBorder); background: rgba(66,133,244,0.08); }
        .conv-item .conv-info { flex: 1; min-width: 0; }
        .conv-item .conv-title { font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .conv-item .conv-meta { font-size: 10.5px; opacity: 0.6; margin-top: 2px; }
        .conv-item .conv-del {
            background: transparent; border: none; color: var(--vscode-foreground);
            opacity: 0.5; cursor: pointer; font-size: 13px; padding: 2px 6px;
        }
        .conv-item .conv-del:hover { opacity: 1; color: #dc3545; }

        /* ===== Settings ===== */
        .settings-area { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
        .field-group { display: flex; flex-direction: column; gap: 4px; }
        label { font-size: 12px; opacity: 0.9; }
        textarea, input[type="number"], select {
            width: 100%; padding: 6px 8px;
            background: var(--vscode-input-background); color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border); border-radius: 4px; outline: none; font-family: inherit;
        }
        .api-key-row { display: flex; align-items: center; gap: 6px; }
        .api-key-row .status { flex: 1; font-size: 12px; }
        .api-key-row .status.set { color: #28a745; }
        .api-key-row .status.unset { color: #d4733a; }
        .btn-small {
            padding: 4px 10px; background: var(--vscode-button-secondaryBackground, #6c757d);
            color: var(--vscode-button-secondaryForeground, #fff); border: none; border-radius: 4px;
            cursor: pointer; font-size: 11px; font-family: inherit;
        }
        .btn-small:hover { opacity: 0.85; }
        .usage-box { font-size: 11.5px; opacity: 0.85; line-height: 1.8; }
        .hint { font-size: 10.5px; opacity: 0.6; line-height: 1.6; }
        .provider-badge {
            display: inline-block; font-size: 10px; padding: 1px 8px;
            background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
            border-radius: 8px; margin-inline-start: 6px;
        }
    </style>
</head>
<body>
    <!-- Tabs -->
    <div class="tab-header">
        <button class="tab-btn active" id="tabChat">گفتگو</button>
        <button class="tab-btn" id="tabHistory">تاریخچه</button>
        <button class="tab-btn" id="tabSettings">تنظیمات</button>
    </div>

    <!-- ===== CHAT ===== -->
    <div id="viewChat" class="tab-content active">
        <div class="chat-area" id="chatArea">
            <div class="welcome" id="welcome">
                <h2>سلام! من دستیار هوش مصنوعی شما هستم <span class="provider-badge" id="welcomeProvider"></span></h2>
                <p>سوال بپرسید، کد بفرستید یا حتی تصویر بچسبانید (Ctrl+V)</p>
                <div class="welcome-cards" id="welcomeCards"></div>
            </div>
            <div id="messages"></div>
        </div>
        <div class="composer">
            <div class="quick-actions" id="quickActions"></div>
            <div class="favorites-row" id="favoritesRow"></div>
            <div class="image-chips" id="imageChips"></div>
            <div class="input-row">
                <button class="icon-btn" id="attachBtn" title="افزودن تصویر">+</button>
                <textarea id="userPrompt" placeholder="پیام خود را بنویسید... (Enter = ارسال، Shift+Enter = خط جدید)"></textarea>
                <button class="send-btn" id="sendBtn">ارسال</button>
                <button class="stop-btn" id="stopBtn">توقف</button>
            </div>
            <div class="composer-actions">
                <button class="mini-btn" id="previewBtn">پیش‌نمایش Markdown</button>
                <button class="mini-btn" id="snippetPickerBtn">دستورات (Snippets)</button>
                <button class="mini-btn" id="writeCodeBtn">کد بنویس (جایگزینی فایل)</button>
                <button class="mini-btn" id="exportBtn">خروجی Markdown</button>
                <button class="mini-btn" id="newChatBtn">گفتگوی جدید</button>
            </div>
            <div class="preview-pane" id="previewPane" style="display:none;">
                <div class="preview-title">پیش‌نمایش زنده:</div>
                <div class="md" id="previewContent"></div>
            </div>
        </div>
    </div>

    <!-- ===== HISTORY ===== -->
    <div id="viewHistory" class="tab-content">
        <div class="history-area">
            <input type="text" class="history-search" id="historySearch" placeholder="جستجو در تاریخچه گفتگوها...">
            <div id="convList"></div>
        </div>
    </div>

    <!-- ===== SETTINGS ===== -->
    <div id="viewSettings" class="tab-content">
        <div class="settings-area">
            <div class="field-group">
                <label for="providerSelect">ارائه‌دهنده هوش مصنوعی:</label>
                <select id="providerSelect"></select>
                <div class="hint">کلید API هر سرویس جداگانه و امن (SecretStorage) ذخیره می‌شود؛ با تغییر ارائه‌دهنده، مدل و کلید مخصوص همان سرویس بارگذاری می‌شود.</div>
            </div>
            <div class="field-group" id="baseUrlGroup">
                <label for="baseUrlInput">آدرس پایه API (Base URL):</label>
                <input type="text" id="baseUrlInput" dir="ltr" placeholder="https://api.example.com/v1">
                <div class="hint">برای سرویس‌های سفارشی یا Ollama محلی این آدرس را تغییر دهید (مثال: http://localhost:11434/v1)</div>
            </div>
            <div class="field-group">
                <label id="apiKeyLabel">API Key:</label>
                <div class="api-key-row">
                    <span id="apiKeyStatus" class="status unset">بارگذاری...</span>
                    <button class="btn-small" id="setApiKeyBtn">تنظیم کلید</button>
                    <button class="btn-small" id="clearApiKeyBtn">حذف کلید</button>
                </div>
            </div>
            <div class="field-group">
                <label for="modelSelect">انتخاب مدل:</label>
                <div style="display:flex; gap:4px;">
                    <select id="modelSelect" style="flex:1;"></select>
                    <button class="btn-small" id="fetchModelsBtn">دریافت مدل‌ها</button>
                </div>
            </div>
            <div class="field-group">
                <label for="speed">سرعت تایپ «کد بنویس» (میلی‌ثانیه):</label>
                <input type="number" id="speed" value="${DEFAULT_SPEED}" min="${MIN_SPEED}" max="${MAX_SPEED}">
            </div>
            <div class="field-group">
                <label>آمار مصرف توکن (این پروژه):</label>
                <div class="usage-box" id="usageBox">بارگذاری...</div>
                <button class="btn-small" id="resetUsageBtn">صفر کردن آمار</button>
            </div>
            <button class="send-btn" id="saveSettingsBtn" style="height:32px;">ذخیره تنظیمات</button>
        </div>
    </div>

    <script nonce="${nonce}">
        var vscode = acquireVsCodeApi();
        function $(id) { return document.getElementById(id); }

        // ==================== Markdown renderer (A2) ====================
        var FENCE = String.fromCharCode(96, 96, 96);
        function escapeHtml(s) {
            return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        function renderMarkdown(md) {
            var codeBlocks = [];
            var fenceRe = new RegExp(FENCE + '(\\\\w*)\\\\n([\\\\s\\\\S]*?)' + FENCE, 'g');
            var text = String(md).replace(fenceRe, function(m, lang, code) {
                codeBlocks.push({ lang: lang, code: code.replace(/\\\\n$/, '') });
                return '\\u0000CB' + (codeBlocks.length - 1) + '\\u0000';
            });
            var html = escapeHtml(text);

            html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>')
                       .replace(/^## (.*)$/gm, '<h2>$1</h2>')
                       .replace(/^# (.+)$/gm, '<h2>$1</h2>');
            html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
            html = html.replace(/\`([^\`]+)\`/g, '<code class="inline-code">$1</code>');
            html = html.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)]+)\\)/g, '<a href="$2" title="$2">$1</a>');
            html = html.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>');
            html = html.replace(/^---+$/gm, '<hr>');

            // lists
            html = html.replace(/(^|\\n)((?:[-*] .*(?:\\n|$))+)/g, function(m, p, list) {
                var items = list.trim().split('\\n').map(function(l) {
                    return '<li>' + l.replace(/^[-*] /, '') + '</li>';
                }).join('');
                return p + '<ul>' + items + '</ul>';
            });
            html = html.replace(/(^|\\n)((?:\\d+\\. .*(?:\\n|$))+)/g, function(m, p, list) {
                var items = list.trim().split('\\n').map(function(l) {
                    return '<li>' + l.replace(/^\\d+\\. /, '') + '</li>';
                }).join('');
                return p + '<ol>' + items + '</ol>';
            });

            // paragraphs
            html = html.split(/\\n{2,}/).map(function(block) {
                var b = block.trim();
                if (!b) return '';
                if (/^<(h\\d|ul|ol|blockquote|hr)/.test(b) || /^\\u0000CB\\d+\\u0000$/.test(b)) return b;
                return '<p>' + b.replace(/\\n/g, '<br>') + '</p>';
            }).join('\\n');

            // restore code blocks (A3: copy button)
            html = html.replace(/\\u0000CB(\\d+)\\u0000/g, function(m, i) {
                var cb = codeBlocks[+i];
                return '<div class="code-block">' +
                    '<div class="code-header"><span class="code-lang">' + escapeHtml(cb.lang || 'code') + '</span>' +
                    '<button class="copy-btn" data-cb="' + (+i) + '">کپی</button></div>' +
                    '<pre><code>' + escapeHtml(cb.code) + '</code></pre></div>';
            });
            return html;
        }

        // copy buttons (event delegation)
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.copy-btn');
            if (btn) {
                var idx = btn.getAttribute('data-cb');
                var pre = btn.closest('.code-block').querySelector('code');
                var codeEl = pre || btn.closest('.code-block');
                vscode.postMessage({ command: 'copyToClipboard', text: codeEl.textContent });
                btn.textContent = 'کپی شد ✓';
                setTimeout(function() { btn.textContent = 'کپی'; }, 1500);
            }
        });

        // ==================== State ====================
        var state = {
            currentConversation: null,
            conversations: [],
            pendingImages: [],
            isStreaming: false,
            streamingEl: null,
            streamingText: '',
            providerLabel: 'دستیار'
        };

        // ==================== Tabs ====================
        function switchTab(name) {
            var tabs = ['tabChat', 'tabHistory', 'tabSettings'];
            var views = ['viewChat', 'viewHistory', 'viewSettings'];
            for (var i = 0; i < tabs.length; i++) {
                $(tabs[i]).classList.toggle('active', tabs[i] === 'tab' + name);
                $(views[i]).classList.toggle('active', views[i] === 'view' + name);
            }
        }
        $('tabChat').addEventListener('click', function() { switchTab('Chat'); });
        $('tabHistory').addEventListener('click', function() { switchTab('History'); });
        $('tabSettings').addEventListener('click', function() { switchTab('Settings'); });

        // ==================== Welcome cards (A8) ====================
        var WELCOME_CARDS = [
            { icon: '📄', label: 'توضیح کد انتخاب‌شده', snippetId: 'builtin.explainSelection' },
            { icon: '🐞', label: 'باگ‌یابی کد', snippetId: 'builtin.findBugs' },
            { icon: '✨', label: 'ریفکتور کد', snippetId: 'builtin.refactor' },
            { icon: '🧪', label: 'تولید تست', snippetId: 'builtin.generateTests' },
            { icon: '💬', label: 'کامنت‌گذاری', snippetId: 'builtin.addComments' },
            { icon: '🔍', label: 'ریویو کد', snippetId: 'builtin.reviewSelection' }
        ];
        function renderWelcome() {
            var el = $('welcomeCards');
            el.innerHTML = '';
            WELCOME_CARDS.forEach(function(c) {
                var card = document.createElement('button');
                card.className = 'welcome-card';
                card.innerHTML = '<span class="wc-icon">' + c.icon + '</span>' + escapeHtml(c.label);
                card.addEventListener('click', function() {
                    vscode.postMessage({ command: 'runSnippet', snippetId: c.snippetId });
                });
                el.appendChild(card);
            });
        }
        renderWelcome();

        // ==================== Quick Actions (G1) ====================
        function renderQuickActions(actions) {
            var el = $('quickActions');
            el.innerHTML = '';
            (actions || []).forEach(function(qa) {
                var btn = document.createElement('button');
                btn.className = 'qa-btn';
                btn.style.background = qa.color || '#4285f4';
                btn.textContent = qa.label;
                btn.title = qa.label;
                btn.addEventListener('click', function() {
                    if (state.isStreaming) return;
                    vscode.postMessage({ command: 'runSnippet', snippetId: qa.snippetId });
                });
                el.appendChild(btn);
            });
        }

        function renderFavorites(favorites) {
            var el = $('favoritesRow');
            el.innerHTML = '';
            (favorites || []).forEach(function(f) {
                var chip = document.createElement('button');
                chip.className = 'fav-chip';
                chip.textContent = '★ ' + f.name;
                chip.addEventListener('click', function() {
                    if (state.isStreaming) return;
                    vscode.postMessage({ command: 'runSnippet', snippetId: f.id });
                });
                el.appendChild(chip);
            });
        }

        // ==================== Messages rendering ====================
        function addMessageEl(msg, isStreaming) {
            var welcome = $('welcome');
            if (welcome) welcome.style.display = 'none';

            var el = document.createElement('div');
            el.className = 'msg ' + (msg.role === 'user' ? 'user' : 'model');
            var roleLabel = msg.role === 'user' ? 'شما' : state.providerLabel;
            var inner = '<div class="msg-header"><span class="msg-role">' + roleLabel + '</span>';
            if (!isStreaming) {
                inner += '<button class="msg-copy" title="کپی کل پیام">کپی</button>';
            }
            inner += '</div><div class="md msg-body">' + (isStreaming ? '<span class="typing-dots"><span></span><span></span><span></span></span>' : renderMarkdown(msg.text)) + '</div>';

            if (msg.images && msg.images.length) {
                inner += '<div class="msg-images">';
                msg.images.forEach(function(img) {
                    inner += '<img src="data:' + img.mimeType + ';base64,' + img.base64 + '" title="' + escapeHtml(img.name || '') + '">';
                });
                inner += '</div>';
            }
            el.innerHTML = inner;

            var copyBtn = el.querySelector('.msg-copy');
            if (copyBtn) {
                copyBtn.addEventListener('click', function() {
                    vscode.postMessage({ command: 'copyToClipboard', text: msg.text });
                    copyBtn.textContent = 'کپی شد ✓';
                    setTimeout(function() { copyBtn.textContent = 'کپی'; }, 1500);
                });
            }

            $('messages').appendChild(el);
            scrollBottom();
            return el;
        }

        function scrollBottom() {
            var area = $('chatArea');
            area.scrollTop = area.scrollHeight;
        }

        function renderConversation(conv) {
            state.currentConversation = conv;
            $('messages').innerHTML = '';
            var hasMsgs = conv && conv.messages && conv.messages.length > 0;
            $('welcome').style.display = hasMsgs ? 'none' : '';
            if (hasMsgs) {
                conv.messages.forEach(function(m) { addMessageEl(m, false); });
            }
            scrollBottom();
        }

        // ==================== Streaming (A4) ====================
        function startStreamingBubble() {
            state.isStreaming = true;
            state.streamingText = '';
            var welcome = $('welcome');
            if (welcome) welcome.style.display = 'none';
            var el = document.createElement('div');
            el.className = 'msg model';
            el.innerHTML = '<div class="msg-header"><span class="msg-role">' + state.providerLabel + '</span></div>' +
                '<div class="md msg-body"><span class="typing-dots"><span></span><span></span><span></span></span></div>';
            $('messages').appendChild(el);
            state.streamingEl = el;
            scrollBottom();
            setStreamingUI(true);
        }

        var rafPending = false;
        function appendStreamChunk(text) {
            state.streamingText += text;
            if (!rafPending && state.streamingEl) {
                rafPending = true;
                requestAnimationFrame(function() {
                    rafPending = false;
                    var body = state.streamingEl.querySelector('.msg-body');
                    if (body) {
                        body.innerHTML = renderMarkdown(state.streamingText);
                        scrollBottom();
                    }
                });
            }
        }

        function endStreamingBubble(cancelled, finalText) {
            if (state.streamingEl) {
                var body = state.streamingEl.querySelector('.msg-body');
                if (body) {
                    var text = finalText !== undefined ? finalText : state.streamingText;
                    body.innerHTML = text ? renderMarkdown(text) : '<em>' + (cancelled ? 'متوقف شد.' : 'پاسخی دریافت نشد.') + '</em>';
                }
                // add copy button now that it's final
                var header = state.streamingEl.querySelector('.msg-header');
                if (header && !header.querySelector('.msg-copy')) {
                    var btn = document.createElement('button');
                    btn.className = 'msg-copy';
                    btn.textContent = 'کپی';
                    btn.addEventListener('click', function() {
                        vscode.postMessage({ command: 'copyToClipboard', text: state.streamingText });
                        btn.textContent = 'کپی شد ✓';
                        setTimeout(function() { btn.textContent = 'کپی'; }, 1500);
                    });
                    header.appendChild(btn);
                }
            }
            state.isStreaming = false;
            state.streamingEl = null;
            state.streamingText = '';
            setStreamingUI(false);
            scrollBottom();
        }

        function setStreamingUI(streaming) {
            $('sendBtn').style.display = streaming ? 'none' : '';
            $('stopBtn').style.display = streaming ? '' : 'none';
            $('sendBtn').disabled = streaming;
            var qas = document.querySelectorAll('.qa-btn, .fav-chip, .welcome-card');
            qas.forEach(function(b) { b.disabled = streaming; });
        }

        // ==================== Composer ====================
        function sendMessage() {
            if (state.isStreaming) return;
            var text = $('userPrompt').value.trim();
            if (!text && state.pendingImages.length === 0) return;
            var images = state.pendingImages.slice();
            state.pendingImages = [];
            renderImageChips();
            $('userPrompt').value = '';
            hidePreview();
            vscode.postMessage({ command: 'sendChat', text: text, images: images });
        }

        $('sendBtn').addEventListener('click', sendMessage);
        $('stopBtn').addEventListener('click', function() {
            vscode.postMessage({ command: 'stopProcess' });
        });

        var promptEl = $('userPrompt');
        promptEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // A11: markdown live preview
        $('previewBtn').addEventListener('click', function() {
            var pane = $('previewPane');
            if (pane.style.display === 'none') {
                pane.style.display = '';
                $('previewContent').innerHTML = renderMarkdown(promptEl.value || '_چیزی برای پیش‌نمایش نیست_');
                $('previewBtn').textContent = 'بستن پیش‌نمایش';
            } else {
                hidePreview();
            }
        });
        promptEl.addEventListener('input', function() {
            if ($('previewPane').style.display !== 'none') {
                $('previewContent').innerHTML = renderMarkdown(promptEl.value);
            }
        });
        function hidePreview() {
            $('previewPane').style.display = 'none';
            $('previewBtn').textContent = 'پیش‌نمایش Markdown';
        }

        // ==================== Images (C8/C9) ====================
        $('attachBtn').addEventListener('click', function() {
            vscode.postMessage({ command: 'pickImage' });
        });

        function addPendingImage(img) {
            if (state.pendingImages.length >= 3) {
                alert('حداکثر ۳ تصویر در هر پیام مجاز است.');
                return;
            }
            state.pendingImages.push(img);
            renderImageChips();
        }

        function renderImageChips() {
            var el = $('imageChips');
            el.innerHTML = '';
            state.pendingImages.forEach(function(img, i) {
                var chip = document.createElement('div');
                chip.className = 'img-chip';
                chip.innerHTML = '<img src="data:' + img.mimeType + ';base64,' + img.base64 + '">' +
                    '<span>' + escapeHtml(img.name || 'تصویر') + '</span>' +
                    '<button class="remove-img" data-i="' + i + '" title="حذف">✕</button>';
                chip.querySelector('.remove-img').addEventListener('click', function() {
                    state.pendingImages.splice(+this.getAttribute('data-i'), 1);
                    renderImageChips();
                });
                el.appendChild(chip);
            });
        }

        // C9: paste image
        document.addEventListener('paste', function(e) {
            var items = e.clipboardData && e.clipboardData.files;
            if (items && items.length) {
                for (var i = 0; i < items.length; i++) {
                    var f = items[i];
                    if (f.type && f.type.startsWith('image/')) {
                        e.preventDefault();
                        var reader = new FileReader();
                        reader.onload = function(ev) {
                            var dataUrl = ev.target.result;
                            var base64 = dataUrl.split(',')[1];
                            addPendingImage({ base64: base64, mimeType: f.type, name: 'clipboard' });
                        };
                        reader.readAsDataURL(f);
                    }
                }
            }
        });

        // C8: drag & drop image
        var chatArea = $('chatArea');
        document.addEventListener('dragover', function(e) { e.preventDefault(); });
        document.addEventListener('drop', function(e) {
            e.preventDefault();
            var files = e.dataTransfer && e.dataTransfer.files;
            if (!files) return;
            for (var i = 0; i < files.length; i++) {
                var f = files[i];
                if (f.type && f.type.startsWith('image/')) {
                    (function(file) {
                        var reader = new FileReader();
                        reader.onload = function(ev) {
                            addPendingImage({ base64: ev.target.result.split(',')[1], mimeType: file.type, name: file.name });
                        };
                        reader.readAsDataURL(file);
                    })(f);
                }
            }
        });

        // ==================== History (A5/A6) ====================
        function renderConversations(convs) {
            state.conversations = convs || [];
            renderConvList();
        }
        function renderConvList() {
            var el = $('convList');
            el.innerHTML = '';
            var query = ($('historySearch').value || '').trim().toLowerCase();
            var list = state.conversations.filter(function(c) {
                return !query || (c.title || '').toLowerCase().indexOf(query) >= 0;
            });
            if (list.length === 0) {
                el.innerHTML = '<p style="opacity:0.6; font-size:12px;">گفتگویی یافت نشد.</p>';
                return;
            }
            list.forEach(function(c) {
                var item = document.createElement('div');
                item.className = 'conv-item' + (state.currentConversation && c.id === state.currentConversation.id ? ' active' : '');
                var date = new Date(c.updatedAt).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' });
                item.innerHTML = '<div class="conv-info"><div class="conv-title">' + escapeHtml(c.title) + '</div>' +
                    '<div class="conv-meta">' + date + ' — ' + c.messageCount + ' پیام</div></div>' +
                    '<button class="conv-del" title="حذف">✕</button>';
                item.addEventListener('click', function() {
                    vscode.postMessage({ command: 'loadConversation', conversationId: c.id });
                });
                item.querySelector('.conv-del').addEventListener('click', function(e) {
                    e.stopPropagation();
                    vscode.postMessage({ command: 'deleteConversation', conversationId: c.id });
                });
                el.appendChild(item);
            });
        }
        $('historySearch').addEventListener('input', renderConvList);

        // ==================== Toolbar buttons ====================
        $('newChatBtn').addEventListener('click', function() { vscode.postMessage({ command: 'newChat' }); });
        $('exportBtn').addEventListener('click', function() { vscode.postMessage({ command: 'exportChat' }); });
        $('snippetPickerBtn').addEventListener('click', function() { vscode.postMessage({ command: 'openSnippetPicker' }); });
        $('writeCodeBtn').addEventListener('click', function() {
            if (state.isStreaming) return;
            if (!promptEl.value.trim()) { alert('لطفاً دستور خود را وارد کنید.'); return; }
            vscode.postMessage({ command: 'writeCode', prompt: promptEl.value, speed: parseInt($('speed').value) || ${DEFAULT_SPEED} });
        });

        // ==================== Settings ====================
        $('setApiKeyBtn').addEventListener('click', function() { vscode.postMessage({ command: 'setApiKey' }); });
        $('clearApiKeyBtn').addEventListener('click', function() { vscode.postMessage({ command: 'clearApiKey' }); });
        $('providerSelect').addEventListener('change', function() {
            vscode.postMessage({ command: 'switchProvider', providerId: this.value });
        });
        $('saveSettingsBtn').addEventListener('click', function() {
            vscode.postMessage({ command: 'saveSettings', selectedModel: $('modelSelect').value, speed: parseInt($('speed').value) || ${DEFAULT_SPEED}, baseUrl: $('baseUrlInput').value.trim() });
        });
        $('fetchModelsBtn').addEventListener('click', function() {
            $('fetchModelsBtn').textContent = 'در حال دریافت...';
            vscode.postMessage({ command: 'fetchModels' });
        });
        $('resetUsageBtn').addEventListener('click', function() { vscode.postMessage({ command: 'resetUsage' }); });

        function renderProviders(providers, activeId) {
            var sel = $('providerSelect');
            sel.innerHTML = '';
            (providers || []).forEach(function(p) {
                var opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.label;
                if (p.id === activeId) opt.selected = true;
                sel.appendChild(opt);
            });
        }
        function renderModels(models, selectedModel) {
            var sel = $('modelSelect');
            sel.innerHTML = '';
            (models || []).forEach(function(name) {
                var opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                if (name === selectedModel) opt.selected = true;
                sel.appendChild(opt);
            });
        }
        function setApiKeyStatus(status) {
            var el = $('apiKeyStatus');
            if (status === 'set') {
                el.textContent = 'کلید API ذخیره شده است';
                el.className = 'status set';
            } else if (status === 'none') {
                el.textContent = 'این سرویس به کلید نیاز ندارد';
                el.className = 'status set';
            } else {
                el.textContent = 'کلید API تنظیم نشده است';
                el.className = 'status unset';
            }
        }
        function applySnapshot(s) {
            if (!s) return;
            state.providerLabel = s.providerLabel;
            $('welcomeProvider').textContent = s.providerLabel;
            $('providerSelect').value = s.providerId;
            $('baseUrlInput').value = s.baseUrl || '';
            $('apiKeyLabel').textContent = 'API Key (' + s.providerLabel + '):';
            $('setApiKeyBtn').style.display = s.needsApiKey ? '' : 'none';
            $('clearApiKeyBtn').style.display = s.needsApiKey ? '' : 'none';
            setApiKeyStatus(s.needsApiKey ? (s.apiKeyIsSet ? 'set' : 'unset') : 'none');
            renderModels(s.models, s.selectedModel);
        }
        function renderUsage(usage) {
            var el = $('usageBox');
            if (!usage || !usage.totalTokenCount) {
                el.textContent = 'هنوز توکنی مصرف نشده است.';
                return;
            }
            el.textContent = 'ورودی: ' + (usage.promptTokenCount || 0).toLocaleString('fa-IR') +
                ' | خروجی: ' + (usage.candidatesTokenCount || 0).toLocaleString('fa-IR') +
                ' | مجموع: ' + (usage.totalTokenCount || 0).toLocaleString('fa-IR');
        }

        // ==================== Host messages ====================
        window.addEventListener('message', function(event) {
            var m = event.data;
            switch (m.command) {
                case 'initState':
                    renderProviders(m.providers, m.snapshot ? m.snapshot.providerId : null);
                    applySnapshot(m.snapshot);
                    if (typeof m.typingSpeed === 'number') $('speed').value = m.typingSpeed;
                    renderQuickActions(m.quickActions);
                    renderFavorites(m.favorites);
                    renderConversation(m.conversation);
                    renderConversations(m.conversations);
                    break;
                case 'providerSwitched':
                    applySnapshot(m.snapshot);
                    break;
                case 'conversationLoaded':
                    renderConversation(m.conversation);
                    renderConversations(m.conversations);
                    switchTab('Chat');
                    break;
                case 'userMessageAdded':
                    addMessageEl(m.message, false);
                    startStreamingBubble();
                    break;
                case 'streamChunk':
                    appendStreamChunk(m.text);
                    break;
                case 'streamEnded':
                    endStreamingBubble(m.cancelled, m.cancelled ? state.streamingText : undefined);
                    if (m.usage) renderUsage(m.usage);
                    break;
                case 'finished':
                    setStreamingUI(false);
                    $('fetchModelsBtn').textContent = 'دریافت مدل‌ها';
                    break;
                case 'apiKeyStatus':
                    setApiKeyStatus(m.isSet ? 'set' : 'unset');
                    break;
                case 'modelsFetched':
                    $('fetchModelsBtn').textContent = 'دریافت مدل‌ها';
                    renderModels(m.models, m.selectedModel);
                    break;
                case 'favoritesUpdated':
                    renderFavorites(m.favorites);
                    break;
                case 'snippetChosen':
                    if (m.snippetId) vscode.postMessage({ command: 'runSnippet', snippetId: m.snippetId });
                    break;
                case 'imageAttached':
                    addPendingImage({ base64: m.base64, mimeType: m.mimeType, name: m.name });
                    break;
                case 'insertToComposer':
                    promptEl.value = (promptEl.value ? promptEl.value + '\\n\\n' : '') + (m.text || '');
                    promptEl.focus();
                    break;
            }
        });

        // initial UI state
        setStreamingUI(false);
    </script>
</body>
</html>`;
    }
}
