/* ============================================================
 *  Gemini Assistant - Snippet Manager
 *  Built-in snippets + user favorites + custom snippets.
 * ============================================================ */

import * as vscode from 'vscode';
import { STATE_CUSTOM_SNIPPETS, STATE_FAVORITES } from './constants';
import { Snippet, SnippetCategory } from './types';
import { generateId } from './helpers';

export const BUILTIN_SNIPPETS: Snippet[] = [
    // ---- Coding ----
    {
        id: 'builtin.explainSelection',
        name: 'توضیح کد انتخاب‌شده',
        description: 'کد انتخاب‌شده را به فارسی توضیح می‌دهد',
        category: 'coding',
        mode: 'chat',
        icon: 'book',
        builtin: true,
        body: `کد زیر را به فارسی و به‌صورت خلاصه و واضح توضیح بده. اگر چیز پیچیده‌ای دارد، با مثال نشان بده:

زبان: {language}
\`\`\`
{selection}
\`\`\``,
        variables: [
            { key: 'language', label: 'زبان کد', auto: 'language' },
            { key: 'selection', label: 'کد انتخاب‌شده', auto: 'selection' }
        ]
    },
    {
        id: 'builtin.refactor',
        name: 'ریفکتور کد',
        description: 'کد انتخاب‌شده را خواناتر و تمیزتر می‌کند',
        category: 'coding',
        mode: 'chat',
        icon: 'wand',
        builtin: true,
        body: `کد زیر را ریفکتور کن. اصول تمیزی کد (Clean Code) را رعایت کن و تغییرات اصلی را کوتاه توضیح بده:

زبان: {language}
\`\`\`
{selection}
\`\`\``,
        variables: [
            { key: 'language', label: 'زبان', auto: 'language' },
            { key: 'selection', label: 'کد', auto: 'selection' }
        ]
    },
    {
        id: 'builtin.findBugs',
        name: 'پیدا کردن باگ',
        description: 'خطاهای احتمالی و نقاط ضعف کد را نشان می‌دهد',
        category: 'debugging',
        mode: 'chat',
        icon: 'bug',
        builtin: true,
        body: `کد زیر را برای باگ، خطاهای منطقی، نقاط ضعف امنیتی و موارد edge case بررسی کن. هر مورد را با شماره و خط مربوطه نشان بده:

\`\`\`
{selection}
\`\`\``,
        variables: [
            { key: 'selection', label: 'کد', auto: 'selection' }
        ]
    },
    {
        id: 'builtin.addComments',
        name: 'افزودن کامنت',
        description: 'به تابع انتخاب‌شده JSDoc/Docstring اضافه می‌کند',
        category: 'documentation',
        mode: 'chat',
        icon: 'comment',
        builtin: true,
        body: `برای کد زیر، مطابق قرارداد زبان {language}، کامنت/Docstring مناسب اضافه کن. فقط نسخه نهایی با کامنت را برگردان:

\`\`\`
{selection}
\`\`\``,
        variables: [
            { key: 'language', label: 'زبان', auto: 'language' },
            { key: 'selection', label: 'کد', auto: 'selection' }
        ]
    },

    // ---- Testing ----
    {
        id: 'builtin.generateTests',
        name: 'تولید تست واحد',
        description: 'برای تابع انتخاب‌شده تست می‌نویسد',
        category: 'testing',
        mode: 'chat',
        icon: 'beaker',
        builtin: true,
        body: `برای کد زیر، تست‌های واحد بنویس (UNIT TEST). موارد edge case را پوشش بده. فریمورک مناسب زبان {language} را انتخاب کن:

\`\`\`
{selection}
\`\`\``,
        variables: [
            { key: 'language', label: 'زبان', auto: 'language' },
            { key: 'selection', label: 'کد', auto: 'selection' }
        ]
    },

    // ---- Review ----
    {
        id: 'builtin.reviewSelection',
        name: 'Code Review',
        description: 'کد انتخاب‌شده را از نظر کیفی ریویو می‌کند',
        category: 'review',
        mode: 'chat',
        icon: 'eye',
        builtin: true,
        body: `این کد را مثل یک Senior Engineer ریویو کن. نقاط قوت، نقاط ضعف و پیشنهادهای بهبود را لیست کن:

\`\`\`
{selection}
\`\`\``,
        variables: [
            { key: 'selection', label: 'کد', auto: 'selection' }
        ]
    },

    // ---- Migration (F8) ----
    {
        id: 'builtin.migrateFramework',
        name: 'مهاجرت فریمورک/نسخه',
        description: 'کد را به فریمورک/نسخه جدید مهاجرت می‌دهد',
        category: 'migration',
        mode: 'chat',
        icon: 'sync',
        builtin: true,
        body: `کد زیر را از {fromVersion} به {toVersion} مهاجرت بده. تغییرات اصلی را کوتاه توضیح بده و نسخه نهایی را برگردان:

\`\`\`
{selection}
\`\`\``,
        variables: [
            { key: 'selection', label: 'کد', auto: 'selection' },
            { key: 'fromVersion', label: 'از نسخه/فریمورک', default: 'Vue 2' },
            { key: 'toVersion', label: 'به نسخه/فریمورک', default: 'Vue 3' }
        ]
    },

    // ---- Git (F1, F2, F3, F4, F5) ----
    // (F-series snippets are invoked from commands; included here too for re-use)

    // ---- Documentation ----
    {
        id: 'builtin.explainConcept',
        name: 'توضیح یک مفهوم',
        description: 'یک مفهوم برنامه‌نویسی را به فارسی توضیح می‌دهد',
        category: 'documentation',
        mode: 'chat',
        icon: 'lightbulb',
        builtin: true,
        body: `مفهوم زیر را به فارسی، ساده و واضح توضیح بده. در صورت لزوم یک مثال کوتاه بزن:

{question}`,
        variables: [
            { key: 'question', label: 'سوال شما', default: 'تفاوت let و const چیست؟' }
        ]
    }
];

const CATEGORY_LABELS: Record<SnippetCategory, string> = {
    coding: 'کدنویسی',
    debugging: 'دیباگ',
    testing: 'تست',
    documentation: 'مستندسازی',
    review: 'ریویو',
    migration: 'مهاجرت',
    git: 'Git',
    custom: 'سفارشی'
};

export class SnippetManager {
    constructor(private readonly globalState: vscode.Memento) {}

    /** All snippets: builtin + custom, with favorite flag applied. */
    public getAll(): Snippet[] {
        const favorites = this.getFavorites();
        const customs = this.getCustoms();
        const all = [...BUILTIN_SNIPPETS, ...customs];
        return all.map(s => ({ ...s, favorite: favorites.includes(s.id) }));
    }

    public getBuiltin(): Snippet[] {
        const favorites = this.getFavorites();
        return BUILTIN_SNIPPETS.map(s => ({ ...s, favorite: favorites.includes(s.id) }));
    }

    public getCustoms(): Snippet[] {
        return this.globalState.get<Snippet[]>(STATE_CUSTOM_SNIPPETS, []) as Snippet[];
    }

    public getFavorites(): string[] {
        return this.globalState.get<string[]>(STATE_FAVORITES, []) as string[];
    }

    public getById(id: string): Snippet | undefined {
        return this.getAll().find(s => s.id === id);
    }

    public getByCategory(category: SnippetCategory): Snippet[] {
        return this.getAll().filter(s => s.category === category);
    }

    public getFavoriteSnippets(): Snippet[] {
        const favs = this.getFavorites();
        return this.getAll().filter(s => favs.includes(s.id));
    }

    public async toggleFavorite(id: string): Promise<boolean> {
        const favs = this.getFavorites();
        const idx = favs.indexOf(id);
        let isFav: boolean;
        if (idx >= 0) {
            favs.splice(idx, 1);
            isFav = false;
        } else {
            favs.push(id);
            isFav = true;
        }
        await this.globalState.update(STATE_FAVORITES, favs);
        return isFav;
    }

    public async saveCustom(snippet: Snippet): Promise<void> {
        const customs = this.getCustoms();
        const existing = customs.findIndex(s => s.id === snippet.id);
        if (existing >= 0) {
            customs[existing] = snippet;
        } else {
            snippet.id = snippet.id || generateId('custom');
            snippet.builtin = false;
            snippet.category = snippet.category || 'custom';
            customs.push(snippet);
        }
        await this.globalState.update(STATE_CUSTOM_SNIPPETS, customs);
    }

    public async deleteCustom(id: string): Promise<void> {
        const customs = this.getCustoms().filter(s => s.id !== id);
        await this.globalState.update(STATE_CUSTOM_SNIPPETS, customs);
        // Also remove from favorites if present
        const favs = this.getFavorites().filter(f => f !== id);
        await this.globalState.update(STATE_FAVORITES, favs);
    }

    public getCategoryLabel(category: SnippetCategory): string {
        return CATEGORY_LABELS[category] || category;
    }

    public getAllCategories(): SnippetCategory[] {
        return Object.keys(CATEGORY_LABELS) as SnippetCategory[];
    }
}

/** Quick Action bar (G1) - shown above chat. */
export const QUICK_ACTIONS = [
    { id: 'qa.explain', label: 'توضیح', icon: 'book', snippetId: 'builtin.explainSelection', color: '#007acc' },
    { id: 'qa.refactor', label: 'ریفکتور', icon: 'wand', snippetId: 'builtin.refactor', color: '#6f42c1' },
    { id: 'qa.findBugs', label: 'باگ‌یابی', icon: 'bug', snippetId: 'builtin.findBugs', color: '#dc3545' },
    { id: 'qa.tests', label: 'تست', icon: 'beaker', snippetId: 'builtin.generateTests', color: '#28a745' },
    { id: 'qa.comments', label: 'کامنت', icon: 'comment', snippetId: 'builtin.addComments', color: '#17a2b8' },
    { id: 'qa.review', label: 'ریویو', icon: 'eye', snippetId: 'builtin.reviewSelection', color: '#fd7e14' }
] as const;
