/* ============================================================
 *  AI Assistant (Multi-Provider) - Chat Store (A5/A6)
 *  File-system backed multi-conversation storage.
 *  Phase 3: Migrated from workspaceState to globalStorageUri
 *  (fixes Memento size limit issues with large histories/images).
 * ============================================================ */

import * as vscode from 'vscode';
import * as path from 'path';
import { ChatMessage, Conversation, ConversationSummary, GeminiUsage } from './types';
import { generateId, truncate } from './helpers';

// Lightweight index kept in globalState
const KEY_INDEX = 'chat.index';
const KEY_ACTIVE = 'chat.activeId';
const KEY_USAGE = 'chat.usageTotal';

// Legacy workspaceState keys (for migration)
const LEGACY_KEY_CONVS = 'chat.conversations';
const LEGACY_KEY_CONV_PREFIX = 'chat.conversation.';
const LEGACY_KEY_ACTIVE = 'chat.activeId';
const LEGACY_KEY_USAGE = 'chat.usageTotal';

const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES = 200;

interface ChatIndex {
    /** conversation ids, newest first */
    ids: string[];
}

/**
 * ChatStore persists conversations to disk under globalStorageUri/chat/.
 * Only a small index, the active id and usage counters live in globalState.
 * Message bodies (incl. base64 images) are written to JSON files on disk.
 */
export class ChatStore {
    private cache = new Map<string, Conversation>();
    private index: ChatIndex;
    private initialized = false;

    constructor(
        private readonly globalState: vscode.Memento,
        private readonly storageRoot: vscode.Uri,
        private readonly legacyState?: vscode.Memento
    ) {
        this.index = this.globalState.get<ChatIndex>(KEY_INDEX, { ids: [] });
    }

    // ---- Paths ----
    private get chatDir(): string {
        return path.join(this.storageRoot.fsPath, 'chat');
    }

    private convPath(id: string): string {
        return path.join(this.chatDir, `${id}.json`);
    }

    private async ensureDir(): Promise<void> {
        try {
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(this.chatDir));
        } catch {
            // already exists
        }
    }

    // ---- Initialization / migration ----
    /** One-time migration from legacy workspaceState storage. */
    public async migrateFromLegacy(): Promise<void> {
        if (this.initialized) { return; }
        this.initialized = true;
        if (!this.legacyState) { return; }
        const legacyIds = this.legacyState.get<string[]>(LEGACY_KEY_CONVS, []);
        if (legacyIds.length === 0) { return; }
        if (this.index.ids.length > 0) { return; } // already migrated

        await this.ensureDir();
        const migrated: string[] = [];
        for (const id of legacyIds) {
            const conv = this.legacyState.get<Conversation>(LEGACY_KEY_CONV_PREFIX + id);
            if (conv) {
                await this.writeConv(conv);
                migrated.push(id);
            }
        }
        this.index = { ids: migrated };
        await this.persistIndex();
        const legacyActive = this.legacyState.get<string>(LEGACY_KEY_ACTIVE);
        if (legacyActive && migrated.includes(legacyActive)) {
            await this.globalState.update(KEY_ACTIVE, legacyActive);
        }
        const legacyUsage = this.legacyState.get<GeminiUsage>(LEGACY_KEY_USAGE, {});
        if (legacyUsage.totalTokenCount) {
            await this.globalState.update(KEY_USAGE, legacyUsage);
        }
        // Clean up legacy keys
        for (const id of legacyIds) {
            await this.legacyState.update(LEGACY_KEY_CONV_PREFIX + id, undefined);
        }
        await this.legacyState.update(LEGACY_KEY_CONVS, undefined);
    }

    // ---- Disk I/O ----
    private async writeConv(conv: Conversation): Promise<void> {
        await this.ensureDir();
        const data = Buffer.from(JSON.stringify(conv), 'utf8');
        await vscode.workspace.fs.writeFile(vscode.Uri.file(this.convPath(conv.id)), data);
        this.cache.set(conv.id, conv);
    }

    private async readConv(id: string): Promise<Conversation | undefined> {
        const cached = this.cache.get(id);
        if (cached) { return cached; }
        try {
            const data = await vscode.workspace.fs.readFile(vscode.Uri.file(this.convPath(id)));
            const conv = JSON.parse(Buffer.from(data).toString('utf8')) as Conversation;
            this.cache.set(id, conv);
            return conv;
        } catch {
            return undefined;
        }
    }

    private async persistIndex(): Promise<void> {
        await this.globalState.update(KEY_INDEX, this.index);
    }

    // ---- Summaries ----
    public async listSummaries(): Promise<ConversationSummary[]> {
        const summaries: ConversationSummary[] = [];
        for (const id of this.index.ids) {
            const conv = await this.readConv(id);
            if (conv) {
                summaries.push({
                    id: conv.id,
                    title: conv.title,
                    createdAt: conv.createdAt,
                    updatedAt: conv.updatedAt,
                    messageCount: conv.messages.length
                });
            }
        }
        return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    // ---- Get ----
    public async get(id: string): Promise<Conversation | undefined> {
        if (!this.index.ids.includes(id)) { return undefined; }
        return this.readConv(id);
    }

    public getActiveId(): string | undefined {
        return this.globalState.get<string>(KEY_ACTIVE);
    }

    public async getActive(): Promise<Conversation | undefined> {
        const id = this.getActiveId();
        return id ? this.get(id) : undefined;
    }

    // ---- Create / ensure ----
    public async create(): Promise<Conversation> {
        const now = Date.now();
        const conv: Conversation = {
            id: generateId('conv'),
            title: 'گفتگوی جدید',
            createdAt: now,
            updatedAt: now,
            messages: []
        };
        await this.writeConv(conv);
        this.index.ids = [conv.id, ...this.index.ids.filter(i => i !== conv.id)].slice(0, MAX_CONVERSATIONS);
        // Delete trimmed conversations from disk
        for (const removedId of this.index.ids.slice(MAX_CONVERSATIONS)) {
            await this.deleteConvFile(removedId);
        }
        await this.persistIndex();
        await this.globalState.update(KEY_ACTIVE, conv.id);
        return conv;
    }

    public async ensureActive(): Promise<Conversation> {
        const active = await this.getActive();
        if (active) { return active; }
        return this.create();
    }

    public setActive(id: string): void {
        void this.globalState.update(KEY_ACTIVE, id);
    }

    // ---- Mutate ----
    public async appendMessage(id: string, msg: ChatMessage): Promise<Conversation | undefined> {
        const conv = await this.get(id);
        if (!conv) { return undefined; }
        conv.messages.push(msg);
        if (msg.role === 'user' && conv.title === 'گفتگوی جدید') {
            conv.title = truncate(msg.text.replace(/\s+/g, ' ').trim(), 48) || 'گفتگوی جدید';
        }
        conv.updatedAt = Date.now();
        if (conv.messages.length > MAX_MESSAGES) {
            conv.messages = conv.messages.slice(-MAX_MESSAGES);
        }
        await this.writeConv(conv);
        return conv;
    }

    private async deleteConvFile(id: string): Promise<void> {
        this.cache.delete(id);
        try {
            await vscode.workspace.fs.delete(vscode.Uri.file(this.convPath(id)));
        } catch {
            // ignore
        }
    }

    public async delete(id: string): Promise<void> {
        await this.deleteConvFile(id);
        this.index.ids = this.index.ids.filter(i => i !== id);
        await this.persistIndex();
        if (this.getActiveId() === id) {
            await this.globalState.update(KEY_ACTIVE, this.index.ids[0]);
        }
    }

    public async clearAll(): Promise<void> {
        for (const id of this.index.ids) {
            await this.deleteConvFile(id);
        }
        this.index = { ids: [] };
        await this.persistIndex();
        await this.globalState.update(KEY_ACTIVE, undefined);
    }

    // ---- Usage (C3) ----
    public async addUsage(usage: GeminiUsage): Promise<void> {
        const prev = this.globalState.get<GeminiUsage>(KEY_USAGE, {});
        const next: GeminiUsage = {
            promptTokenCount: (prev.promptTokenCount ?? 0) + (usage.promptTokenCount ?? 0),
            candidatesTokenCount: (prev.candidatesTokenCount ?? 0) + (usage.candidatesTokenCount ?? 0),
            totalTokenCount: (prev.totalTokenCount ?? 0) + (usage.totalTokenCount ?? 0)
        };
        await this.globalState.update(KEY_USAGE, next);
    }

    public getUsage(): GeminiUsage {
        return this.globalState.get<GeminiUsage>(KEY_USAGE, {});
    }

    public async resetUsage(): Promise<void> {
        await this.globalState.update(KEY_USAGE, {});
    }

    // ---- Export (A7) ----
    public async exportMarkdown(id: string): Promise<string | undefined> {
        const conv = await this.get(id);
        if (!conv) { return undefined; }
        const lines: string[] = [
            `# ${conv.title}`,
            '',
            `> خروجی AI Assistant (Multi-Provider) — ${new Date(conv.createdAt).toLocaleString('fa-IR')}`,
            ''
        ];
        for (const m of conv.messages) {
            if (m.role === 'user') {
                lines.push('## 🧑 کاربر', '', m.text, '');
                if (m.images?.length) {
                    lines.push(`_(${m.images.length} تصویر پیوست شده)_`, '');
                }
            } else {
                lines.push('## 🤖 دستیار', '', m.text, '');
            }
            lines.push('---', '');
        }
        return lines.join('\n');
    }
}
