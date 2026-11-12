/* Chat Participant API (Phase 5-F) - @aiassistant in VS Code Chat panel. */

import * as vscode from 'vscode';
import { AiClient } from '../core/aiClient';
import { Logger } from '../core/logger';
import { scrubSecrets } from '../core/secretScrubber';
import { errorToString } from '../core/helpers';

export const CHAT_PARTICIPANT_ID = 'aiassistant.chat';

export class AiChatParticipant implements vscode.Disposable {
    private readonly disposable: vscode.Disposable | undefined;

    constructor(
        private readonly ai: AiClient,
        private readonly logger: Logger
    ) {
        const api = (vscode as unknown as { chat?: { createChatParticipant?: (id: string, handler: unknown) => { dispose(): void } } }).chat;
        if (!api || typeof api.createChatParticipant !== 'function') {
            this.logger.log('Chat Participant API not available in this VS Code version.');
            return;
        }
        this.disposable = api.createChatParticipant(CHAT_PARTICIPANT_ID, this.handleRequest.bind(this)) as vscode.Disposable;
    }

    private async handleRequest(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        const apiKey = await this.ai.requireApiKey().catch(() => null);
        if (!apiKey) {
            stream.markdown('⚠️ کلید API تنظیم نشده است. از Command Palette: `AI: تنظیم کلید API` استفاده کنید.');
            return {};
        }

        stream.progress('در حال پردازش...');

        const model = this.ai.getModel();
        const prompt = this.buildPrompt(request, context);

        try {
            let acc = '';
            const contents = [];
            for (const turn of context.history) {
                if (turn instanceof vscode.ChatRequestTurn) {
                    contents.push({ role: 'user' as const, parts: [{ text: turn.prompt }] });
                } else if (turn instanceof vscode.ChatResponseTurn) {
                    const text = turn.response.map(p => p instanceof vscode.ChatResponseMarkdownPart ? p.value.value : '').join('');
                    contents.push({ role: 'model' as const, parts: [{ text }] });
                }
            }
            contents.push({ role: 'user' as const, parts: [{ text: prompt }] });

            const abort = new AbortController();
            token.onCancellationRequested(() => abort.abort());
            const result = await this.ai.streamGenerateContent({
                contents,
                model,
                systemInstruction: 'You are a Persian-speaking coding assistant. Answer in Persian unless asked otherwise. Use Markdown.',
                signal: abort.signal,
                onChunk: (t) => { acc += t; stream.markdown(t); }
            });

            if (result === null) {
                stream.markdown('\n\n_پاسخی دریافت نشد._');
            }
            return { metadata: { usage: result?.usage } };
        } catch (err) {
            this.logger.error('chatParticipant', err);
            stream.markdown(`\n\n❌ خطا: ${errorToString(err)}`);
            return { errorDetails: { message: errorToString(err) } };
        }
    }

    private buildPrompt(request: vscode.ChatRequest, context: vscode.ChatContext): string {
        let prompt = request.prompt;
        // Attach referenced files
        for (const ref of request.references || []) {
            const refValue = ref.value as { uri?: vscode.Uri; range?: vscode.Range };
            if (refValue && refValue.uri) {
                prompt += `\n\n[مرجع: ${refValue.uri.fsPath}]`;
            }
        }
        return scrubSecrets(prompt).text;
    }

    public dispose(): void {
        this.disposable?.dispose();
    }
}
