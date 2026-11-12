/* ============================================================
 *  Gemini Assistant - Snippets Tree View Provider (G6)
 *  Hierarchical view: category → snippet
 * ============================================================ */

import * as vscode from 'vscode';
import { Snippet, SnippetCategory } from '../core/types';
import { SnippetManager } from '../core/snippetManager';

export type SnippetTreeNode =
    | { type: 'category'; category: SnippetCategory; label: string; snippetCount: number }
    | { type: 'snippet'; snippet: Snippet };

export class SnippetsTreeProvider implements vscode.TreeDataProvider<SnippetTreeNode> {
    private _onDidChange = new vscode.EventEmitter<void>();
    public readonly onDidChangeTreeData = this._onDidChange.event;

    constructor(private readonly manager: SnippetManager) {}

    public refresh(): void {
        this._onDidChange.fire();
    }

    public getTreeItem(element: SnippetTreeNode): vscode.TreeItem {
        if (element.type === 'category') {
            const item = new vscode.TreeItem(
                `${element.label} (${element.snippetCount})`,
                vscode.TreeItemCollapsibleState.Expanded
            );
            item.contextValue = 'category';
            item.iconPath = new vscode.ThemeIcon('folder');
            return item;
        }
        // snippet node
        const s = element.snippet;
        const item = new vscode.TreeItem(s.name, vscode.TreeItemCollapsibleState.None);
        item.tooltip = s.description || s.name;
        item.iconPath = new vscode.ThemeIcon(s.icon || 'symbol-snippet');
        item.contextValue = s.builtin ? 'builtinSnippet' : 'customSnippet';
        if (s.favorite) { item.description = '★'; }
        item.command = {
            command: 'gemini-assistant.openSnippetInChat',
            title: 'Open in Chat',
            arguments: [s.id]
        };
        return item;
    }

    public getChildren(element?: SnippetTreeNode): SnippetTreeNode[] {
        if (!element) {
            // Top level: list categories with at least one snippet
            const all = this.manager.getAll();
            const categories = this.manager.getAllCategories();
            return categories
                .map(c => ({
                    type: 'category' as const,
                    category: c,
                    label: this.manager.getCategoryLabel(c),
                    snippetCount: all.filter(s => s.category === c).length
                }))
                .filter(node => node.snippetCount > 0);
        }
        if (element.type === 'category') {
            return this.manager
                .getByCategory(element.category)
                .map(s => ({ type: 'snippet' as const, snippet: s }));
        }
        return [];
    }
}
