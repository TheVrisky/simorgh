/* ============================================================
 *  AI Assistant (Multi-Provider) - VS Code Extension Entry Point
 *  Stage 5 (Multi-Provider on top of A + C + G + F):
 *   - v0.5: Multi-provider AI backend (Gemini, OpenAI, Claude,
 *     DeepSeek, OpenRouter, Groq, Ollama, custom OpenAI-compatible)
 *   - A: Modern chat UI (multi-turn, markdown, streaming,
 *        history, welcome, images, export, open-in-tab)
 *   - C: Integrations (context menu, keybindings, status bar,
 *        terminal errors, git diff, problems panel)
 *   - G: Quick Templates (quick actions, snippets, favorites,
 *        auto variables, tree view)
 *   - F: Developer Tools (commit, PR, review, changelog, ...)
 * ============================================================ */

import * as vscode from 'vscode';
import { Logger } from './core/logger';
import { AiClient } from './core/aiClient';
import { ContextService } from './core/contextService';
import { SnippetManager } from './core/snippetManager';
import { SnippetRunner } from './core/snippetRunner';
import { ChatStore } from './core/chatStore';
import { StatusBarService } from './core/statusBarService';
import { OUTPUT_CHANNEL_NAME, SNIPPETS_TREE_VIEW_ID, CMD } from './core/constants';
import { GeminiChatProvider } from './providers/geminiChatProvider';
import { SnippetsTreeProvider } from './providers/snippetsTreeProvider';
import { DeveloperToolsCommands } from './commands/developerTools';
import { SnippetCommands } from './commands/snippetCommands';
import { IntegrationCommands } from './commands/integrationCommands';
import { EditApplier } from './core/editApplier';
import { MentionResolver } from './core/mentionResolver';
import { InlineCompletionProvider } from './providers/inlineCompletionProvider';
import { AiChatParticipant } from './providers/chatParticipant';

export function activate(context: vscode.ExtensionContext) {
    // ---- Core services ----
    const logger = new Logger(OUTPUT_CHANNEL_NAME);
    logger.log(`[activate] AI Assistant (Multi-Provider) extension is now active! (${new Date().toISOString()})`);

    const ai = new AiClient(context.secrets, context.globalState, logger);
    const contextService = new ContextService();
    const snippets = new SnippetManager(context.globalState);
    const runner = new SnippetRunner(ai, contextService, logger);
    const chatStore = new ChatStore(context.globalState, context.globalStorageUri, context.workspaceState);
    void chatStore.migrateFromLegacy();
    const editApplier = new EditApplier(logger);
    const mentionResolver = new MentionResolver(contextService, logger);
    const inlineProvider = new InlineCompletionProvider(ai, logger);
    context.subscriptions.push(inlineProvider.register(), inlineProvider);

    // 5-F: Chat Participant (@aiassistant) — guarded by API availability
    try {
        const participant = new AiChatParticipant(ai, logger);
        context.subscriptions.push(participant);
    } catch (err) {
        logger.log(`Chat participant registration skipped: ${String(err)}`);
    }

    // ---- Status bar (C3) ----
    const statusBar = new StatusBarService(ai, chatStore, logger);

    // ---- Chat provider (A-series UI) ----
    const chatProvider = new GeminiChatProvider(
        context.extensionUri, context, logger, ai, snippets, runner, chatStore, statusBar, editApplier, mentionResolver
    );

    // ---- Snippets tree view (G6) ----
    const treeProvider = new SnippetsTreeProvider(snippets);
    const treeViewer = vscode.window.createTreeView(SNIPPETS_TREE_VIEW_ID, {
        treeDataProvider: treeProvider,
        showCollapseAll: true
    });

    // ---- Command handlers ----
    const devTools = new DeveloperToolsCommands(ai, contextService, logger);
    const snippetCmds = new SnippetCommands(snippets, treeProvider, logger);
    const integration = new IntegrationCommands(ai, contextService, chatStore, chatProvider, logger);

    // ---- Register commands ----
    const register = (id: string, handler: (...args: unknown[]) => unknown) => {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    };

    // Basic
    register(CMD.helloWorld, () => vscode.window.showInformationMessage('AI Assistant is ready to help!'));
    register(CMD.setApiKey, async () => {
        await ai.setApiKey();
        statusBar.refresh();
    });
    register(CMD.clearApiKey, async () => { await ai.clearApiKey(); });

    // Multi-provider (v0.5)
    register(CMD.selectProvider, async () => {
        const picked = await vscode.window.showQuickPick(
            ai.listProviders().map(p => ({
                label: p.label,
                description: p.id === ai.getProviderId() ? '✔ فعال' : p.id,
                detail: p.needsApiKey ? `کلید API مورد نیاز است — مدل‌های نمونه: ${p.defaultModels.slice(0, 2).join(', ')}` : 'بدون نیاز به کلید API',
                id: p.id
            })),
            { placeHolder: 'ارائه‌دهنده هوش مصنوعی را انتخاب کنید' }
        );
        if (picked && picked.id !== ai.getProviderId()) {
            await ai.setProvider(picked.id);
            statusBar.refresh();
            vscode.window.showInformationMessage(`ارائه‌دهنده فعال: ${ai.getProviderLabel()}`);
        }
    });
    register(CMD.setBaseUrl, async () => {
        const current = ai.getBaseUrl();
        const url = await vscode.window.showInputBox({
            prompt: `آدرس پایه API برای «${ai.getProviderLabel()}» را وارد کنید`,
            value: current,
            placeHolder: 'https://api.example.com/v1',
            ignoreFocusOut: true
        });
        if (url !== undefined) { await ai.setBaseUrl(url); }
    });

    // F-series (Developer Tools)
    register(CMD.generateCommitMessage, () => devTools.generateCommitMessage());
    register(CMD.generatePRDescription, () => devTools.generatePRDescription());
    register(CMD.codeReview, () => devTools.codeReview());
    register(CMD.generateChangelog, () => devTools.generateChangelog());
    register(CMD.dailyStandup, () => devTools.dailyStandup());
    register(CMD.generateReadme, () => devTools.generateReadme());
    register(CMD.explainProblem, () => devTools.explainProblem());
    register(CMD.migrationHelper, () => devTools.migrationHelper());
    register(CMD.deprecationDetector, () => devTools.deprecationDetector());
    register(CMD.securityAudit, () => devTools.securityAudit());

    // G-series (Quick Templates)
    register(CMD.insertSnippet, () => snippetCmds.saveCustomSnippet());
    register(CMD.toggleFavorite, (id?: unknown) => {
        void snippetCmds.toggleFavorite(typeof id === 'string' ? id : undefined);
    });
    register(CMD.saveCustomSnippet, () => snippetCmds.saveCustomSnippet());
    register(CMD.refreshSnippets, () => snippetCmds.refreshSnippets());
    register(CMD.openSnippetInChat, (id?: unknown) => {
        if (typeof id === 'string') { void chatProvider.triggerSnippet(id); }
    });
    register(CMD.explainSelection, () => void chatProvider.triggerSnippet('builtin.explainSelection'));
    register(CMD.toggleInlineCompletion, async () => {
        const cfg = vscode.workspace.getConfiguration();
        const current = cfg.get<boolean>('aiassistant.inlineCompletion.enabled', false);
        await cfg.update('aiassistant.inlineCompletion.enabled', !current, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`تکمیل خودکار کد ${!current ? 'فعال' : 'غیرفعال'} شد.`);
    });
    register(CMD.applyCode, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('فایلی در ادیتور باز نیست.');
            return;
        }
        const code = await vscode.env.clipboard.readText();
        if (!code.trim()) {
            vscode.window.showWarningMessage('کلیپ‌بورد خالی است. ابتدا کد را کپی کنید.');
            return;
        }
        const mode = await vscode.window.showQuickPick(
            [
                { label: 'جایگزینی کل فایل', value: 'replaceFile' },
                { label: 'جایگزینی انتخاب فعلی', value: 'replaceSelection' },
                { label: 'درج در محل نشانگر', value: 'insertAtCursor' },
                { label: 'ساخت فایل جدید', value: 'newFile' }
            ],
            { placeHolder: 'نحوه اعمال کد کلیپ‌بورد را انتخاب کنید' }
        );
        if (mode) {
            await editApplier.apply(code, mode.value as 'replaceFile' | 'replaceSelection' | 'insertAtCursor' | 'newFile');
        }
    });

    // C-series (Integration)
    register(CMD.refactorSelection, () => integration.refactorSelection());
    register(CMD.fixSelection, () => integration.fixSelection());
    register(CMD.testSelection, () => integration.testSelection());
    register(CMD.explainTerminalError, () => integration.explainTerminalError());
    register(CMD.addGitDiffToChat, () => integration.addGitDiffToChat());
    register(CMD.explainActiveFileProblems, () => integration.explainActiveFileProblems());

    // A-series (Modern UI)
    register(CMD.exportChat, () => chatProvider.exportActiveChat());
    register(CMD.openChatInTab, () => chatProvider.createEditorPanel());
    register(CMD.newChat, () => chatProvider.newConversation());

    // ---- Register providers & disposables ----
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('geminiAssistantView', chatProvider),
        treeViewer,
        chatProvider,
        devTools,
        statusBar,
        logger
    );

    // Refresh status bar after activation
    statusBar.refresh();

    logger.log('All commands and providers registered.');
}

export function deactivate(): void {
    // Subscriptions dispose automatically.
}
