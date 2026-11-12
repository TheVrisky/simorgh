/* ============================================================
 *  AI Assistant (Multi-Provider) - Status Bar Service (C3)
 *  Shows the active provider + model and token usage.
 * ============================================================ */

import * as vscode from 'vscode';
import { GeminiUsage } from './types';
import { AiClient } from './aiClient';
import { ChatStore } from './chatStore';
import { Logger } from './logger';

export class StatusBarService implements vscode.Disposable {
    private item: vscode.StatusBarItem;

    constructor(
        private readonly ai: AiClient,
        private readonly chatStore: ChatStore,
        private readonly logger: Logger
    ) {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
        this.item.name = 'AI Assistant';
        this.item.command = 'workbench.view.extension.geminiAssistantContainer';
    }

    public refresh(): void {
        const providerLabel = this.ai.getProviderLabel();
        const model = this.ai.getModel();
        const usage = this.chatStore.getUsage();

        this.item.text = `$(sparkle) ${model}`;
        const usageLines: string[] = [
            `ارائه‌دهنده فعال: ${providerLabel}`,
            `مدل: ${model}`,
            ''
        ];
        if (usage.totalTokenCount) {
            usageLines.push(`مجموع توکن‌های مصرفی این پروژه: ${usage.totalTokenCount.toLocaleString('fa-IR')}`);
            if (usage.promptTokenCount) {
                usageLines.push(`ورودی: ${usage.promptTokenCount.toLocaleString('fa-IR')}`);
            }
            if (usage.candidatesTokenCount) {
                usageLines.push(`خروجی: ${usage.candidatesTokenCount.toLocaleString('fa-IR')}`);
            }
        } else {
            usageLines.push('هنوز توکنی مصرف نشده است.');
        }
        usageLines.push('', 'برای باز کردن پنل گفتگو کلیک کنید.');
        this.item.tooltip = new vscode.MarkdownString(usageLines.join('\n'));
        this.item.show();
        this.logger.log(`Status bar updated: provider=${this.ai.getProviderId()} model=${model}`);
    }

    public dispose(): void {
        this.item.dispose();
    }
}
