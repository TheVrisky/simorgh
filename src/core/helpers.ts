/* ============================================================
 *  Gemini Assistant - Helpers
 * ============================================================ */

export function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function getCspNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}

export function clampSpeed(value: unknown, fallback = 10): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) { return fallback; }
    return Math.max(1, Math.min(2000, Math.round(n)));
}

export function errorToString(err: unknown): string {
    if (err instanceof Error) { return err.message; }
    return String(err);
}

/**
 * Format template string with variables.
 * Supports {name} placeholders.
 * Missing variables are left as-is so the user can see what's missing.
 */
export function formatTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (match, key: string) => {
        return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match;
    });
}

/**
 * Extract variable keys referenced in a template.
 * Returns unique keys in order of first occurrence.
 */
export function extractTemplateVariables(template: string): string[] {
    const re = /\{(\w+)\}/g;
    const keys: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(template)) !== null) {
        if (!keys.includes(m[1])) { keys.push(m[1]); }
    }
    return keys;
}

export function truncate(s: string, max: number): string {
    if (s.length <= max) { return s; }
    return s.slice(0, max - 1) + '…';
}

export function generateId(prefix = 'id'): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
