/* ============================================================
 *  Gemini Assistant - Snippet Commands (G-series)
 * ============================================================ */

import * as vscode from 'vscode';
import { SnippetManager, BUILTIN_SNIPPETS, QUICK_ACTIONS } from '../core/snippetManager';
import { Snippet, SnippetCategory } from '../core/types';
import { SnippetsTreeProvider } from '../providers/snippetsTreeProvider';
import { generateId } from '../core/helpers';
import { Logger } from '../core/logger';

export class SnippetCommands {
    constructor(
        private readonly manager: SnippetManager,
        private readonly treeProvider: SnippetsTreeProvider,
        private readonly logger: Logger
    ) {}

    // ===== G2/G6: Insert a custom snippet via a form (QuickPick + InputBox) =====
    public async saveCustomSnippet(): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: 'نام snippet را وارد کنید',
            placeHolder: 'مثال: تولید تابع validate',
            ignoreFocusOut: true
        });
        if (!name) { return; }

        const categories: SnippetCategory[] = ['custom', 'coding', 'debugging', 'testing', 'documentation', 'review', 'migration', 'git'];
        const picked = await vscode.window.showQuickPick(
            categories.map(c => ({ label: this.manager.getCategoryLabel(c), value: c })),
            { placeHolder: 'دسته‌بندی را انتخاب کنید', ignoreFocusOut: true }
        );
        if (!picked) { return; }

        const description = await vscode.window.showInputBox({
            prompt: 'توضیح کوتاه (اختیاری)',
            ignoreFocusOut: true
        });

        const body = await vscode.window.showInputBox({
            prompt: 'قالب دستور (از {متغیر} برای متغیرها استفاده کنید)',
            placeHolder: 'این تابع را بازنویسی کن: {functionName}\n\nکد:\n{selection}',
            ignoreFocusOut: true
        });
        if (!body) { return; }

        const snippet: Snippet = {
            id: generateId('custom'),
            name,
            description: description || undefined,
            category: picked.value,
            body,
            builtin: false,
            icon: 'edit'
        };
        await this.manager.saveCustom(snippet);
        this.treeProvider.refresh();
        vscode.window.showInformationMessage(`Snippet «${name}» ذخیره شد.`);
    }

    // ===== G4: Toggle favorite =====
    public async toggleFavorite(snippetId?: string): Promise<void> {
        if (!snippetId) {
            // Ask user to pick a snippet
            const all = this.manager.getAll();
            const picked = await vscode.window.showQuickPick(
                all.map(s => ({ label: s.name, description: s.builtin ? 'builtin' : 'custom', id: s.id })),
                { placeHolder: 'یک snippet را برای ستاره‌دار کردن انتخاب کنید' }
            );
            if (!picked) { return; }
            snippetId = picked.id;
        }
        const isFav = await this.manager.toggleFavorite(snippetId);
        this.treeProvider.refresh();
        vscode.window.showInformationMessage(
            isFav ? 'به موارد دلخواه اضافه شد ★' : 'از موارد دلخواه حذف شد'
        );
    }

    public async refreshSnippets(): Promise<void> {
        this.treeProvider.refresh();
        vscode.window.showInformationMessage('فهرست snippet‌ها به‌روزرسانی شد.');
    }

    public async deleteCustomSnippet(snippetId?: string): Promise<void> {
        if (!snippetId) { return; }
        const snippet = this.manager.getById(snippetId);
        if (!snippet) { return; }
        if (snippet.builtin) {
            vscode.window.showWarningMessage('امکان حذف snippetهای داخلی وجود ندارد.');
            return;
        }
        const choice = await vscode.window.showWarningMessage(
            `آیا snippet «${snippet.name}» حذف شود؟`,
            { modal: true },
            'بله، حذف کن',
            'انصراف'
        );
        if (choice !== 'بله، حذف کن') { return; }
        await this.manager.deleteCustom(snippetId);
        this.treeProvider.refresh();
        vscode.window.showInformationMessage(`Snippet «${snippet.name}» حذف شد.`);
    }

    // ===== G3: Prompt Marketplace (local - "favorites"/builtin view) =====
    // For now, we provide a quick-pick to browse builtin snippets and add to favorites.
    public async browseMarketplace(): Promise<void> {
        const builtins = this.manager.getBuiltin();
        const items = builtins.map(s => ({
            label: `$(${s.icon || 'symbol-snippet'}) ${s.name}`,
            description: this.manager.getCategoryLabel(s.category),
            detail: s.description,
            snippet: s
        }));
        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: 'مرور snippet‌های داخلی (با انتخاب، به موارد دلخواه اضافه می‌شود)',
            ignoreFocusOut: true
        });
        if (!picked) { return; }
        await this.manager.toggleFavorite(picked.snippet.id);
        this.treeProvider.refresh();
        vscode.window.showInformationMessage(`«${picked.snippet.name}» اضافه شد.`);
    }

    public async listQuickActions(): Promise<void> {
        const items = QUICK_ACTIONS.map(qa => {
            const s = this.manager.getById(qa.snippetId);
            return {
                label: `$(${qa.icon}) ${qa.label}`,
                description: s?.description,
                snippetId: qa.snippetId
            };
        });
        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: 'Quick Action را انتخاب کنید'
        });
        if (picked) {
            // Trigger via command
            vscode.commands.executeCommand('gemini-assistant.openSnippetInChat', picked.snippetId);
        }
    }
}
