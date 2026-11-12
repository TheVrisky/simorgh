import * as vscode from 'vscode';
import { AiClient } from '../core/aiClient';
import { scrubSecrets } from '../core/secretScrubber';
import { Logger } from '../core/logger';

const DEBOUNCE_MS = 350;
const MAX_PREFIX_CHARS = 4000;
const MAX_SUFFIX_CHARS = 1000;
const ENABLED_SETTING = 'aiassistant.inlineCompletion.enabled';
const FENCE = String.fromCharCode(96, 96, 96);

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable {
    private timer: NodeJS.Timeout | null = null;
    private lastRequestId = 0;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly ai: AiClient,
        private readonly logger: Logger
    ) {}

    public register(): vscode.Disposable {
        const provider = vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, this);
        this.disposables.push(provider);
        return provider;
    }

    public async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[]> {
        const cfg = vscode.workspace.getConfiguration();
        if (!cfg.get<boolean>(ENABLED_SETTING, false)) { return []; }
        if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic && context.selectedCompletionInfo) { return []; }

        const apiKey = await this.ai.requireApiKey().catch(() => null);
        if (!apiKey) { return []; }

        if (this.timer) { clearTimeout(this.timer); }
        const requestId = ++this.lastRequestId;
        await new Promise<void>((resolve) => {
            this.timer = setTimeout(resolve, DEBOUNCE_MS);
            token.onCancellationRequested(() => {
                if (this.timer) { clearTimeout(this.timer); }
                resolve();
            });
        });
        if (requestId !== this.lastRequestId || token.isCancellationRequested) { return []; }

        const offset = document.offsetAt(position);
        const prefix = document.getText(new vscode.Range(document.positionAt(Math.max(0, offset - MAX_PREFIX_CHARS)), position));
        const suffix = document.getText(new vscode.Range(position, document.positionAt(Math.min(document.getText().length, offset + MAX_SUFFIX_CHARS))));
        if (!prefix.trim()) { return []; }

        const scrubbedPrefix = scrubSecrets(prefix).text;
        const prompt = [
            'You are an inline code completion engine for ' + document.languageId + '.',
            'Continue the code at the CURSOR position. Return ONLY the code to insert.',
            'No explanation, no markdown fences, no repetition of existing text.',
            '',
            'PREFIX:' + FENCE + document.languageId,
            scrubbedPrefix,
            FENCE,
            'SUFFIX:' + FENCE + document.languageId,
            suffix,
            FENCE
        ].join('\n');

        const model = this.ai.getModel();
        try {
            const result = await this.ai.generateContent(prompt, model, undefined, 'You are a code completion engine. Reply with raw code only.');
            if (!result || token.isCancellationRequested) { return []; }
            const fenceStart = new RegExp('^' + FENCE + '[a-zA-Z]*\\n');
            const fenceEnd = new RegExp('\\n' + FENCE + '$');
            const clean = result.replace(fenceStart, '').replace(fenceEnd, '').trimEnd();
            if (!clean) { return []; }
            return [new vscode.InlineCompletionItem(clean, new vscode.Range(position, position))];
        } catch (err) {
            this.logger.error('inlineCompletion', err);
            return [];
        }
    }

    public dispose(): void {
        if (this.timer) { clearTimeout(this.timer); }
        this.disposables.forEach(d => d.dispose());
    }
}
