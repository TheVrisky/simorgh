/* ============================================================
 *  AI Assistant - Secret Scrubber (P0 Security)
 *  Masks common secret patterns before sending text to any AI provider.
 *  Used by: chat prompt builder, developer tools, snippet runner.
 * ============================================================ */

/**
 * Patterns that look like common secret tokens / API keys.
 * Each pattern replaces the matched token with a redaction marker,
 * preserving a short hint of the original (first 4 chars) for debugging.
 */
const PATTERNS: Array<{ name: string; regex: RegExp }> = [
    // OpenAI / DeepSeek / generic sk- keys
    { name: 'sk-key', regex: /\bsk-[A-Za-z0-9_\-]{16,}\b/g },
    // Anthropic keys
    { name: 'anthropic', regex: /\bsk-ant-[A-Za-z0-9_\-]{16,}\b/g },
    // Google / Gemini API keys
    { name: 'google', regex: /\bAIza[0-9A-Za-z_\-]{20,}\b/g },
    // Groq keys
    { name: 'groq', regex: /\bgsk_[A-Za-z0-9]{20,}\b/g },
    // GitHub PATs
    { name: 'github-pat', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
    // GitLab PATs
    { name: 'gitlab-pat', regex: /\bglpat-[A-Za-z0-9_\-]{16,}\b/g },
    // AWS access keys
    { name: 'aws-access', regex: /\bAKIA[0-9A-Z]{16}\b/g },
    // Bearer tokens in headers/strings
    { name: 'bearer', regex: /Bearer\s+[A-Za-z0-9._\-]{20,}/g },
    // Generic "password=..." / "api_key=..." assignments
    { name: 'assignment', regex: /\b(?:api[_-]?key|password|passwd|secret|token)\s*[:=]\s*['"]?[A-Za-z0-9._\-]{8,}['"]?/gi }
];

/**
 * Replaces every detected secret with a stable redaction marker.
 * The returned object includes a log-friendly summary of what was redacted.
 */
export interface ScrubResult {
    text: string;
    redactedCount: number;
    redactedKinds: string[];
}

export function scrubSecrets(input: string): ScrubResult {
    if (!input) {
        return { text: '', redactedCount: 0, redactedKinds: [] };
    }
    let text = input;
    let redactedCount = 0;
    const redactedKinds: string[] = [];

    for (const { name, regex } of PATTERNS) {
        text = text.replace(regex, (match) => {
            redactedCount += 1;
            if (!redactedKinds.includes(name)) { redactedKinds.push(name); }
            const head = match.slice(0, 4);
            return `${head}…[REDACTED:${name}]`;
        });
    }

    return { text, redactedCount, redactedKinds };
}

/** Convenience overload that returns only the scrubbed text. */
export function scrub(input: string): string {
    return scrubSecrets(input).text;
}
