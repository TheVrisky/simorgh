/* ============================================================
 *  AI Assistant (Multi-Provider) - Unified AI Client  (v0.5)
 *  A single facade that talks to every supported provider:
 *    - Google Gemini            (native REST)
 *    - OpenAI-compatible APIs   (OpenAI, DeepSeek, OpenRouter,
 *                                Groq, Ollama, custom endpoints)
 *    - Anthropic (Claude)       (native Messages API)
 *
 *  All downstream code keeps calling the same methods:
 *    requireApiKey / setApiKey / clearApiKey / fetchModels /
 *    getModel / setModel / generateContent / streamGenerateContent
 * ============================================================ */

import * as vscode from 'vscode';
import {
    AI_PROVIDERS, SECRET_KEY_PREFIX, STATE_SELECTED_PROVIDER,
    STATE_MODEL_PREFIX, STATE_MODELS_CACHE_PREFIX, STATE_BASE_URL_PREFIX,
    LEGACY_GEMINI_SECRET, LEGACY_SELECTED_MODEL, LEGACY_CACHED_MODELS,
    DEFAULT_PROVIDER_ID
} from './constants';
import {
    ApiErrorBody, GeminiContent, GeminiUsage, ModelListResponse,
    ProviderDef, ProviderSnapshot
} from './types';
import { errorToString } from './helpers';
import { Logger } from './logger';

const DUMMY_KEY = 'no-key-required';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_MAX_TOKENS = 8192;
const REQUEST_TIMEOUT_MS = 90_000;

/**
 * Combines a user-supplied AbortSignal with a global timeout so that a
 * hung API endpoint never blocks the extension forever.
 */
function withTimeout(signal?: AbortSignal, timeoutMs = REQUEST_TIMEOUT_MS): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs);
    if (!signal) { return timeout; }
    if (typeof AbortSignal.any === 'function') {
        return AbortSignal.any([signal, timeout]);
    }
    // Fallback for older Node versions
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal.reason);
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    controller.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
    }, { once: true });
    return controller.signal;
}

// ---- Provider-specific response shapes ----
interface OpenAiChatResponse {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}
interface OpenAiStreamChunk {
    choices?: Array<{ delta?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
}
interface AnthropicMessagesResponse {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
}
interface OpenAiModelList { data?: Array<{ id?: string }> }
interface AnthropicModelList { data?: Array<{ id?: string; display_name?: string }> }

export interface StreamOptions {
    contents: GeminiContent[];
    model: string;
    systemInstruction?: string;
    signal?: AbortSignal;
    onChunk: (text: string) => void;
    onUsage?: (usage: GeminiUsage) => void;
}

export class AiClient {
    constructor(
        private readonly secrets: vscode.SecretStorage,
        private readonly globalState: vscode.Memento,
        private readonly logger: Logger
    ) {}

    // ==================== Provider management ====================

    public listProviders(): ProviderDef[] {
        return AI_PROVIDERS;
    }

    public getProviderId(): string {
        return this.globalState.get<string>(STATE_SELECTED_PROVIDER, DEFAULT_PROVIDER_ID);
    }

    public getProvider(providerId?: string): ProviderDef {
        const id = providerId ?? this.getProviderId();
        return AI_PROVIDERS.find(p => p.id === id) ?? AI_PROVIDERS[0];
    }

    public getProviderLabel(providerId?: string): string {
        return this.getProvider(providerId).label;
    }

    public async setProvider(id: string): Promise<void> {
        if (!AI_PROVIDERS.some(p => p.id === id)) {
            throw new Error(`ارائه‌دهنده ناشناخته: ${id}`);
        }
        await this.globalState.update(STATE_SELECTED_PROVIDER, id);
        this.logger.log(`Active provider switched to: ${id}`);
    }

    /** Full snapshot of the active provider — used to initialize the webview UI. */
    public async getSnapshot(): Promise<ProviderSnapshot> {
        const provider = this.getProvider();
        return {
            providerId: provider.id,
            providerLabel: provider.label,
            baseUrl: this.getBaseUrl(),
            models: this.getCachedModels(),
            selectedModel: this.getModel(),
            apiKeyIsSet: await this.isApiKeySet(),
            keyPlaceholder: provider.keyPlaceholder ?? 'sk-...',
            needsApiKey: provider.needsApiKey,
            customBaseUrl: !!provider.customBaseUrl
        };
    }

    // ==================== Base URL ====================

    public getBaseUrl(providerId?: string): string {
        const provider = this.getProvider(providerId);
        const saved = this.globalState.get<string>(STATE_BASE_URL_PREFIX + provider.id, '');
        return saved || provider.defaultBaseUrl;
    }

    public async setBaseUrl(url: string): Promise<void> {
        const id = this.getProviderId();
        const trimmed = url.trim().replace(/\/+$/, '');
        await this.globalState.update(STATE_BASE_URL_PREFIX + id, trimmed);
        this.logger.log(`Base URL for ${id} set to: ${trimmed}`);
    }

    // ==================== API keys (per provider) ====================

    private secretKeyFor(providerId: string): string {
        return SECRET_KEY_PREFIX + providerId;
    }

    public async isApiKeySet(providerId?: string): Promise<boolean> {
        const id = providerId ?? this.getProviderId();
        const provider = this.getProvider(id);
        if (!provider.needsApiKey) { return true; } // e.g. local Ollama
        const key = await this.secrets.get(this.secretKeyFor(id));
        if (key) { return true; }
        // v0.4 migration: the old Gemini key lives under the legacy name
        if (id === DEFAULT_PROVIDER_ID) {
            const legacy = await this.secrets.get(LEGACY_GEMINI_SECRET);
            return !!legacy;
        }
        return false;
    }

    public async getApiKey(providerId?: string): Promise<string | null> {
        const id = providerId ?? this.getProviderId();
        const provider = this.getProvider(id);
        if (!provider.needsApiKey) { return DUMMY_KEY; }
        const key = await this.secrets.get(this.secretKeyFor(id));
        if (key) { return key; }
        // v0.4 migration: fall back to the legacy Gemini secret
        if (id === DEFAULT_PROVIDER_ID) {
            const legacy = await this.secrets.get(LEGACY_GEMINI_SECRET);
            if (legacy) {
                this.logger.log('Migrating legacy Gemini API key to new storage key.');
                await this.secrets.store(this.secretKeyFor(id), legacy);
                return legacy;
            }
        }
        return null;
    }

    /** Returns the API key, or prompts the user to set one (provider-aware). */
    public async requireApiKey(): Promise<string | null> {
        const provider = this.getProvider();
        const existing = await this.getApiKey();
        if (existing) { return existing; }

        const action = await vscode.window.showErrorMessage(
            `کلید API برای «${provider.label}» تنظیم نشده است. آیا می‌خواهید آن را وارد کنید؟`,
            'بله، وارد می‌کنم',
            'انصراف'
        );
        if (action === 'بله، وارد می‌کنم') {
            const ok = await this.setApiKey();
            if (ok) { return this.getApiKey(); }
        }
        return null;
    }

    /** Prompts for a key. If no providerId given, uses the active provider. */
    public async setApiKey(providerId?: string): Promise<boolean> {
        let id = providerId;
        if (!id) {
            const picked = await this.pickProvider('برای کدام سرویس کلید API را تنظیم می‌کنید؟');
            if (!picked) { return false; }
            id = picked;
        }
        const provider = this.getProvider(id);
        if (!provider.needsApiKey) {
            vscode.window.showInformationMessage(`«${provider.label}» به کلید API نیاز ندارد.`);
            return true;
        }
        const newKey = await vscode.window.showInputBox({
            prompt: `کلید API سرویس «${provider.label}» را وارد کنید`,
            password: true,
            ignoreFocusOut: true,
            placeHolder: provider.keyPlaceholder ?? 'sk-...'
        });
        if (newKey !== undefined && newKey.trim()) {
            await this.secrets.store(this.secretKeyFor(id), newKey.trim());
            vscode.window.showInformationMessage(`کلید API «${provider.label}» با موفقیت ذخیره شد.`);
            return true;
        }
        return false;
    }

    /** Clears the key of the active provider (or the given one). */
    public async clearApiKey(providerId?: string): Promise<void> {
        const id = providerId ?? this.getProviderId();
        await this.secrets.delete(this.secretKeyFor(id));
        if (id === DEFAULT_PROVIDER_ID) {
            await this.secrets.delete(LEGACY_GEMINI_SECRET);
        }
        vscode.window.showInformationMessage(`کلید API «${this.getProviderLabel(id)}» حذف شد.`);
    }

    private async pickProvider(placeHolder: string): Promise<string | undefined> {
        const picked = await vscode.window.showQuickPick(
            AI_PROVIDERS.map(p => ({ label: p.label, description: p.id, id: p.id })),
            { placeHolder }
        );
        return picked?.id;
    }

    // ==================== Models (per provider) ====================

    public getCachedModels(providerId?: string): string[] {
        const provider = this.getProvider(providerId);
        const cached = this.globalState.get<string[]>(STATE_MODELS_CACHE_PREFIX + provider.id, []);
        if (cached.length > 0) { return cached; }
        // v0.4 migration: old Gemini cache
        if (provider.id === DEFAULT_PROVIDER_ID) {
            const legacy = this.globalState.get<string[]>(LEGACY_CACHED_MODELS, []);
            if (legacy.length > 0) { return legacy; }
        }
        return provider.defaultModels;
    }

    public getModel(providerId?: string): string {
        const provider = this.getProvider(providerId);
        const saved = this.globalState.get<string>(STATE_MODEL_PREFIX + provider.id, '');
        if (saved) { return saved; }
        // v0.4 migration: old single "selectedModel" belongs to Gemini
        if (provider.id === DEFAULT_PROVIDER_ID) {
            return this.globalState.get<string>(LEGACY_SELECTED_MODEL, provider.defaultModels[0] ?? '');
        }
        return provider.defaultModels[0] ?? '';
    }

    public async setModel(model: string): Promise<void> {
        await this.globalState.update(STATE_MODEL_PREFIX + this.getProviderId(), model);
    }

    public async fetchModels(providerId?: string): Promise<string[] | null> {
        const provider = this.getProvider(providerId);
        const baseUrl = this.getBaseUrl(provider.id);
        if (!baseUrl) {
            vscode.window.showErrorMessage(
                `برای «${provider.label}» ابتدا آدرس پایه API (Base URL) را در تنظیمات وارد کنید.`
            );
            return null;
        }
        const apiKey = await this.getApiKey(provider.id);
        if (provider.needsApiKey && !apiKey) {
            vscode.window.showErrorMessage(
                `برای «${provider.label}» ابتدا کلید API را تنظیم کنید (دستور: AI: تنظیم کلید API).`
            );
            return null;
        }

        try {
            switch (provider.kind) {
                case 'gemini':
                    return await this.fetchModelsGemini(baseUrl, apiKey ?? '');
                case 'openai':
                    return await this.fetchModelsOpenAi(baseUrl, apiKey ?? '');
                case 'anthropic':
                    return await this.fetchModelsAnthropic(baseUrl, apiKey ?? '');
                default:
                    return null;
            }
        } catch (err) {
            this.logger.error('fetchModels', err);
            vscode.window.showErrorMessage(`خطا در ارتباط با API: ${errorToString(err)}`);
            return null;
        }
    }

    private async fetchModelsGemini(baseUrl: string, apiKey: string): Promise<string[] | null> {
        const response = await fetch(`${baseUrl}/models`, {
            headers: { 'x-goog-api-key': apiKey }
        });
        if (!response.ok) {
            await this.showApiError(response, 'دریافت مدل‌ها');
            return null;
        }
        const data = (await response.json()) as ModelListResponse;
        if (!data.models || !Array.isArray(data.models)) { return null; }
        const models = data.models
            .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
            .map(m => m.name.replace('models/', ''));
        return this.cacheAndReturn(models);
    }

    private async fetchModelsOpenAi(baseUrl: string, apiKey: string): Promise<string[] | null> {
        const headers: Record<string, string> = {};
        if (apiKey) { headers['Authorization'] = `Bearer ${apiKey}`; }
        const response = await fetch(`${baseUrl}/models`, { headers });
        if (!response.ok) {
            await this.showApiError(response, 'دریافت مدل‌ها');
            return null;
        }
        const data = (await response.json()) as OpenAiModelList;
        const models = (data.data ?? [])
            .map(m => m.id ?? '')
            .filter(id => id)
            .sort((a, b) => a.localeCompare(b));
        return this.cacheAndReturn(models);
    }

    private async fetchModelsAnthropic(baseUrl: string, apiKey: string): Promise<string[] | null> {
        const response = await fetch(`${baseUrl}/models?limit=100`, {
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': ANTHROPIC_VERSION
            }
        });
        if (!response.ok) {
            await this.showApiError(response, 'دریافت مدل‌ها');
            return null;
        }
        const data = (await response.json()) as AnthropicModelList;
        const models = (data.data ?? []).map(m => m.id ?? '').filter(id => id);
        return this.cacheAndReturn(models);
    }

    private cacheAndReturn(models: string[]): string[] {
        if (models.length > 0) {
            void this.globalState.update(STATE_MODELS_CACHE_PREFIX + this.getProviderId(), models);
        }
        return models;
    }

    // ==================== Generation (single-turn) ====================

    public async generateContent(
        prompt: string,
        model: string,
        signal?: AbortSignal,
        systemInstruction?: string
    ): Promise<string | null> {
        const provider = this.getProvider();
        const baseUrl = this.getBaseUrl();
        const apiKey = await this.requireApiKey();
        if (!apiKey) { return null; }

        this.logger.log(`POST (${provider.kind}) model=${model}, promptLen=${prompt.length}`);

        try {
            switch (provider.kind) {
                case 'gemini':
                    return await this.generateGemini(baseUrl, apiKey, model, prompt, systemInstruction, signal);
                case 'openai':
                    return await this.generateOpenAi(baseUrl, apiKey, model, prompt, systemInstruction, signal);
                case 'anthropic':
                    return await this.generateAnthropic(baseUrl, apiKey, model, prompt, systemInstruction, signal);
                default:
                    return null;
            }
        } catch (err) {
            return this.handleGenError(err, 'generateContent');
        }
    }

    private async generateGemini(
        baseUrl: string, apiKey: string, model: string,
        prompt: string, systemInstruction?: string, signal?: AbortSignal
    ): Promise<string | null> {
        const endpoint = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
        const body: { contents: GeminiContent[]; systemInstruction?: GeminiContent } = {
            contents: [{ parts: [{ text: prompt }] }]
        };
        if (systemInstruction) {
            body.systemInstruction = { parts: [{ text: systemInstruction }] };
        }
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(body),
            signal: withTimeout(signal)
        });
        if (!response.ok) {
            await this.showApiError(response, 'Gemini API');
            return null;
        }
        const resData = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        const parts = resData.candidates?.[0]?.content?.parts;
        return parts && parts.length > 0 ? parts.map(p => p.text || '').join('') : null;
    }

    private async generateOpenAi(
        baseUrl: string, apiKey: string, model: string,
        prompt: string, systemInstruction?: string, signal?: AbortSignal
    ): Promise<string | null> {
        const messages: Array<Record<string, unknown>> = [];
        if (systemInstruction) { messages.push({ role: 'system', content: systemInstruction }); }
        messages.push({ role: 'user', content: prompt });

        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: this.openAiHeaders(apiKey),
            body: JSON.stringify({ model, messages, stream: false }),
            signal: withTimeout(signal)
        });
        if (!response.ok) {
            await this.showApiError(response, 'OpenAI API');
            return null;
        }
        const data = (await response.json()) as OpenAiChatResponse;
        const content = data.choices?.[0]?.message?.content;
        if (typeof content === 'string') { return content; }
        if (Array.isArray(content)) {
            return content.map(c => c.text ?? '').join('');
        }
        return null;
    }

    private async generateAnthropic(
        baseUrl: string, apiKey: string, model: string,
        prompt: string, systemInstruction?: string, signal?: AbortSignal
    ): Promise<string | null> {
        const body: Record<string, unknown> = {
            model,
            max_tokens: ANTHROPIC_MAX_TOKENS,
            messages: [{ role: 'user', content: prompt }]
        };
        if (systemInstruction) { body.system = systemInstruction; }

        const response = await fetch(`${baseUrl}/messages`, {
            method: 'POST',
            headers: this.anthropicHeaders(apiKey),
            body: JSON.stringify(body),
            signal: withTimeout(signal)
        });
        if (!response.ok) {
            await this.showApiError(response, 'Anthropic API');
            return null;
        }
        const data = (await response.json()) as AnthropicMessagesResponse;
        const text = (data.content ?? [])
            .filter(c => c.type === 'text')
            .map(c => c.text ?? '')
            .join('');
        return text || null;
    }

    // ==================== Streaming (multi-turn) ====================

    public async streamGenerateContent(opts: StreamOptions): Promise<{ text: string; usage?: GeminiUsage } | null> {
        const provider = this.getProvider();
        const baseUrl = this.getBaseUrl();
        const apiKey = await this.requireApiKey();
        if (!apiKey) { return null; }

        this.logger.log(`POST (${provider.kind}, SSE) model=${opts.model}, contents=${opts.contents.length}`);

        try {
            switch (provider.kind) {
                case 'gemini':
                    return await this.streamGemini(baseUrl, apiKey, opts);
                case 'openai':
                    return await this.streamOpenAi(baseUrl, apiKey, opts);
                case 'anthropic':
                    return await this.streamAnthropic(baseUrl, apiKey, opts);
                default:
                    return null;
            }
        } catch (err) {
            return this.handleGenError(err, 'streamGenerateContent');
        }
    }

    private async streamGemini(baseUrl: string, apiKey: string, opts: StreamOptions): Promise<{ text: string; usage?: GeminiUsage } | null> {
        const endpoint = `${baseUrl}/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse`;
        const body: { contents: GeminiContent[]; systemInstruction?: GeminiContent } = {
            contents: opts.contents
        };
        if (opts.systemInstruction) {
            body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
        }
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(body),
            signal: withTimeout(opts.signal)
        });
        if (!response.ok || !response.body) {
            await this.showApiError(response, 'Gemini API');
            return null;
        }

        let full = '';
        let usage: GeminiUsage | undefined;
        const processEvent = (evt: string): void => {
            for (const line of evt.split('\n')) {
                if (!line.startsWith('data:')) { continue; }
                const payload = line.slice(5).trim();
                if (!payload || payload === '[DONE]') { continue; }
                try {
                    const data = JSON.parse(payload) as {
                        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
                        usageMetadata?: GeminiUsage;
                    };
                    const t = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') ?? '';
                    if (t) {
                        full += t;
                        opts.onChunk(t);
                    }
                    if (data.usageMetadata) {
                        usage = data.usageMetadata;
                        opts.onUsage?.(usage);
                    }
                } catch {
                    // ignore malformed chunk
                }
            }
        };
        await this.readSse(response.body, processEvent);
        return { text: full, usage };
    }

    private async streamOpenAi(baseUrl: string, apiKey: string, opts: StreamOptions, includeUsage = true): Promise<{ text: string; usage?: GeminiUsage } | null> {
        const messages = this.toOpenAiMessages(opts.contents, opts.systemInstruction);
        const bodyObj: Record<string, unknown> = {
            model: opts.model,
            messages,
            stream: true
        };
        if (includeUsage) { bodyObj.stream_options = { include_usage: true }; }

        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: this.openAiHeaders(apiKey),
            body: JSON.stringify(bodyObj),
            signal: withTimeout(opts.signal)
        });
        // Some OpenAI-compatible servers reject stream_options — retry once without it
        if (response.status === 400 && includeUsage) {
            this.logger.log('Server rejected stream_options; retrying without usage tracking.');
            return this.streamOpenAi(baseUrl, apiKey, opts, false);
        }
        if (!response.ok || !response.body) {
            await this.showApiError(response, 'OpenAI API');
            return null;
        }

        let full = '';
        let usage: GeminiUsage | undefined;
        const processEvent = (evt: string): void => {
            for (const line of evt.split('\n')) {
                if (!line.startsWith('data:')) { continue; }
                const payload = line.slice(5).trim();
                if (!payload || payload === '[DONE]') { continue; }
                try {
                    const data = JSON.parse(payload) as OpenAiStreamChunk;
                    const t = data.choices?.[0]?.delta?.content ?? '';
                    if (t) {
                        full += t;
                        opts.onChunk(t);
                    }
                    if (data.usage) {
                        usage = {
                            promptTokenCount: data.usage.prompt_tokens,
                            candidatesTokenCount: data.usage.completion_tokens,
                            totalTokenCount: data.usage.total_tokens
                        };
                        opts.onUsage?.(usage);
                    }
                } catch {
                    // ignore malformed chunk
                }
            }
        };
        await this.readSse(response.body, processEvent);
        return { text: full, usage };
    }

    private async streamAnthropic(baseUrl: string, apiKey: string, opts: StreamOptions): Promise<{ text: string; usage?: GeminiUsage } | null> {
        const { system, messages } = this.toAnthropicMessages(opts.contents, opts.systemInstruction);
        const body: Record<string, unknown> = {
            model: opts.model,
            max_tokens: ANTHROPIC_MAX_TOKENS,
            messages,
            stream: true
        };
        if (system) { body.system = system; }

        const response = await fetch(`${baseUrl}/messages`, {
            method: 'POST',
            headers: this.anthropicHeaders(apiKey),
            body: JSON.stringify(body),
            signal: withTimeout(opts.signal)
        });
        if (!response.ok || !response.body) {
            await this.showApiError(response, 'Anthropic API');
            return null;
        }

        let full = '';
        let usage: GeminiUsage | undefined;
        const processEvent = (evt: string): void => {
            for (const line of evt.split('\n')) {
                if (!line.startsWith('data:')) { continue; }
                const payload = line.slice(5).trim();
                if (!payload) { continue; }
                try {
                    const data = JSON.parse(payload) as {
                        type?: string;
                        delta?: { type?: string; text?: string };
                        message?: { usage?: { input_tokens?: number } };
                        usage?: { output_tokens?: number };
                    };
                    if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta' && data.delta.text) {
                        full += data.delta.text;
                        opts.onChunk(data.delta.text);
                    }
                    if (data.type === 'message_start' && data.message?.usage?.input_tokens !== undefined) {
                        usage = usage ?? {};
                        usage.promptTokenCount = data.message.usage.input_tokens;
                        opts.onUsage?.(usage);
                    }
                    if (data.type === 'message_delta' && data.usage?.output_tokens !== undefined) {
                        usage = usage ?? {};
                        usage.candidatesTokenCount = data.usage.output_tokens;
                        usage.totalTokenCount = (usage.promptTokenCount ?? 0) + data.usage.output_tokens;
                        opts.onUsage?.(usage);
                    }
                } catch {
                    // ignore malformed chunk
                }
            }
        };
        await this.readSse(response.body, processEvent);
        return { text: full, usage };
    }

    // ==================== Format adapters ====================

    private toOpenAiMessages(
        contents: GeminiContent[],
        systemInstruction?: string
    ): Array<Record<string, unknown>> {
        const messages: Array<Record<string, unknown>> = [];
        if (systemInstruction) { messages.push({ role: 'system', content: systemInstruction }); }
        for (const c of contents) {
            const role = c.role === 'model' ? 'assistant' : 'user';
            const hasImages = c.parts.some(p => p.inlineData);
            if (!hasImages) {
                messages.push({ role, content: c.parts.map(p => p.text || '').join('') });
            } else {
                const parts = c.parts.map(p => p.inlineData
                    ? { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } }
                    : { type: 'text', text: p.text || '' });
                messages.push({ role, content: parts });
            }
        }
        return messages;
    }

    private toAnthropicMessages(
        contents: GeminiContent[],
        systemInstruction?: string
    ): { system?: string; messages: Array<{ role: string; content: unknown }> } {
        const messages: Array<{ role: string; content: unknown }> = [];
        for (const c of contents) {
            const role = c.role === 'model' ? 'assistant' : 'user';
            const parts = c.parts.map(p => p.inlineData
                ? { type: 'image', source: { type: 'base64', media_type: p.inlineData.mimeType, data: p.inlineData.data } }
                : { type: 'text', text: p.text || '' });
            messages.push({ role, content: parts });
        }
        return { system: systemInstruction, messages };
    }

    // ==================== Low-level helpers ====================

    private openAiHeaders(apiKey: string): Record<string, string> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey && apiKey !== DUMMY_KEY) { headers['Authorization'] = `Bearer ${apiKey}`; }
        return headers;
    }

    private anthropicHeaders(apiKey: string): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION
        };
    }

    /** Reads an SSE body and feeds every `data:` event block to the handler. */
    private async readSse(body: ReadableStream<Uint8Array>, processEvent: (evt: string) => void): Promise<void> {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) { break; }
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop() ?? '';
            for (const evt of events) { processEvent(evt); }
        }
        if (buffer.trim()) { processEvent(buffer); }
    }

    private async showApiError(response: Response, context: string): Promise<void> {
        const errData = await response.json().catch(() => ({} as ApiErrorBody)) as ApiErrorBody;
        const errMsg = errData?.error?.message || `خطای سرور: ${response.status}`;
        vscode.window.showErrorMessage(`${context}: ${errMsg}`);
    }

    private handleGenError(err: unknown, where: string): null {
        if (err instanceof Error && err.name === 'AbortError') {
            this.logger.log('Request aborted by user.');
            return null;
        }
        this.logger.error(where, err);
        vscode.window.showErrorMessage(`خطا در ارتباط با API: ${errorToString(err)}`);
        return null;
    }
}
