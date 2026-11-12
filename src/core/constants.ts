/* ============================================================
 *  AI Assistant (Multi-Provider) - Core Constants
 *  Centralized constants used across modules.
 *  v0.5.0: Multi-provider support (Gemini, OpenAI, Claude,
 *  DeepSeek, OpenRouter, Groq, Ollama, custom OpenAI-compatible).
 * ============================================================ */

import { ProviderDef } from './types';

// ---- Legacy keys (v0.4 and earlier, kept for migration) ----
export const LEGACY_GEMINI_SECRET = 'gemini.apiKey';
export const LEGACY_SELECTED_MODEL = 'selectedModel';
export const LEGACY_CACHED_MODELS = 'cachedModels';

// Secret & state storage keys (per-provider, suffixed with provider id)
export const SECRET_KEY_PREFIX = 'ai.apiKey.';
export const STATE_SELECTED_PROVIDER = 'selectedProvider';
export const STATE_MODEL_PREFIX = 'selectedModel.';      // + providerId
export const STATE_MODELS_CACHE_PREFIX = 'cachedModels.'; // + providerId
export const STATE_BASE_URL_PREFIX = 'baseUrl.';          // + providerId
export const STATE_TYPING_SPEED = 'typingSpeed';
export const STATE_FAVORITES = 'promptFavorites';
export const STATE_CUSTOM_SNIPPETS = 'customSnippets';

// API
export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_PROVIDER_ID = 'gemini';

// ---- Provider catalog (v0.5: multi-provider) ----
export const AI_PROVIDERS: ProviderDef[] = [
    {
        id: 'gemini',
        label: 'Google Gemini',
        kind: 'gemini',
        defaultBaseUrl: GEMINI_BASE,
        defaultModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
        needsApiKey: true,
        keyPlaceholder: 'AIza...'
    },
    {
        id: 'openai',
        label: 'OpenAI (GPT)',
        kind: 'openai',
        defaultBaseUrl: 'https://api.openai.com/v1',
        defaultModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
        needsApiKey: true,
        keyPlaceholder: 'sk-...'
    },
    {
        id: 'anthropic',
        label: 'Anthropic (Claude)',
        kind: 'anthropic',
        defaultBaseUrl: 'https://api.anthropic.com/v1',
        defaultModels: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-3-5-haiku-latest'],
        needsApiKey: true,
        keyPlaceholder: 'sk-ant-...'
    },
    {
        id: 'deepseek',
        label: 'DeepSeek',
        kind: 'openai',
        defaultBaseUrl: 'https://api.deepseek.com/v1',
        defaultModels: ['deepseek-chat', 'deepseek-reasoner'],
        needsApiKey: true,
        keyPlaceholder: 'sk-...'
    },
    {
        id: 'openrouter',
        label: 'OpenRouter (همه مدل‌ها)',
        kind: 'openai',
        defaultBaseUrl: 'https://openrouter.ai/api/v1',
        defaultModels: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash-001'],
        needsApiKey: true,
        keyPlaceholder: 'sk-or-...'
    },
    {
        id: 'groq',
        label: 'Groq (سریع)',
        kind: 'openai',
        defaultBaseUrl: 'https://api.groq.com/openai/v1',
        defaultModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
        needsApiKey: true,
        keyPlaceholder: 'gsk_...'
    },
    {
        id: 'ollama',
        label: 'Ollama (مدل محلی)',
        kind: 'openai',
        defaultBaseUrl: 'http://localhost:11434/v1',
        defaultModels: ['llama3.1', 'qwen2.5-coder'],
        needsApiKey: false
    },
    {
        id: 'custom-openai',
        label: 'سازگار با OpenAI (سفارشی)',
        kind: 'openai',
        defaultBaseUrl: '',
        defaultModels: [],
        needsApiKey: true,
        keyPlaceholder: 'کلید سرویس شما',
        customBaseUrl: true
    }
];

export const DEFAULT_SPEED = 10;
export const MIN_SPEED = 1;
export const MAX_SPEED = 2000;
export const TYPING_CHUNK_SIZE = 4;

// Output channel name
export const OUTPUT_CHANNEL_NAME = 'Gemini Assistant';

// Tree view IDs
export const SNIPPETS_TREE_VIEW_ID = 'geminiAssistantSnippets';

// Command IDs (kept in sync with package.json)
export const CMD = {
    helloWorld: 'gemini-assistant.helloWorld',
    setApiKey: 'gemini-assistant.setApiKey',
    clearApiKey: 'gemini-assistant.clearApiKey',
    selectProvider: 'gemini-assistant.selectProvider',
    setBaseUrl: 'gemini-assistant.setBaseUrl',

    // F-series (Developer Tools)
    generateCommitMessage: 'gemini-assistant.generateCommitMessage',
    generatePRDescription: 'gemini-assistant.generatePRDescription',
    codeReview: 'gemini-assistant.codeReview',
    generateChangelog: 'gemini-assistant.generateChangelog',
    dailyStandup: 'gemini-assistant.dailyStandup',
    generateReadme: 'gemini-assistant.generateReadme',
    explainProblem: 'gemini-assistant.explainProblem',
    migrationHelper: 'gemini-assistant.migrationHelper',
    deprecationDetector: 'gemini-assistant.deprecationDetector',
    securityAudit: 'gemini-assistant.securityAudit',

    // G-series (Quick Templates)
    insertSnippet: 'gemini-assistant.insertSnippet',
    toggleFavorite: 'gemini-assistant.toggleFavorite',
    saveCustomSnippet: 'gemini-assistant.saveCustomSnippet',
    refreshSnippets: 'gemini-assistant.refreshSnippets',
    openSnippetInChat: 'gemini-assistant.openSnippetInChat',

    // Editor context menu - smart action
    explainSelection: 'gemini-assistant.explainSelection',

    // Phase 5-A: Apply AI-generated code
    applyCode: 'gemini-assistant.applyCode',
    toggleInlineCompletion: 'gemini-assistant.toggleInlineCompletion',

    // C-series (Integration)
    refactorSelection: 'gemini-assistant.refactorSelection',
    fixSelection: 'gemini-assistant.fixSelection',
    testSelection: 'gemini-assistant.testSelection',
    explainTerminalError: 'gemini-assistant.explainTerminalError',
    addGitDiffToChat: 'gemini-assistant.addGitDiffToChat',
    explainActiveFileProblems: 'gemini-assistant.explainActiveFileProblems',

    // A-series (Modern UI)
    exportChat: 'gemini-assistant.exportChat',
    openChatInTab: 'gemini-assistant.openChatInTab',
    newChat: 'gemini-assistant.newChat',
} as const;

export type CommandId = typeof CMD[keyof typeof CMD];
