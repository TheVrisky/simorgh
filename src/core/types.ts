/* ============================================================
 *  AI Assistant (Multi-Provider) - Shared Types
 * ============================================================ */

// ---- Multi-provider (v0.5) ----
export type ProviderKind = 'gemini' | 'openai' | 'anthropic';

export interface ProviderDef {
    id: string;
    label: string;
    kind: ProviderKind;
    defaultBaseUrl: string;
    defaultModels: string[];
    needsApiKey: boolean;
    keyPlaceholder?: string;
    /** true = user can/should edit the base URL (self-hosted or proxy services) */
    customBaseUrl?: boolean;
}

export interface ProviderBrief {
    id: string;
    label: string;
}

export interface ProviderSnapshot {
    providerId: string;
    providerLabel: string;
    baseUrl: string;
    models: string[];
    selectedModel: string;
    apiKeyIsSet: boolean;
    keyPlaceholder: string;
    needsApiKey: boolean;
    customBaseUrl: boolean;
}

// ---- Gemini API types ----
export interface GeminiPart {
    text?: string;
    inlineData?: { mimeType: string; data: string };
}

export interface GeminiContent {
    role?: 'user' | 'model';
    parts: GeminiPart[];
}

export interface GeminiCandidate {
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
}

export interface GeminiResponse {
    candidates?: GeminiCandidate[];
    promptFeedback?: { blockReason?: string };
    error?: { message?: string; code?: number; status?: string };
}

export interface ModelListResponse {
    models?: Array<{
        name: string;
        supportedGenerationMethods?: string[];
    }>;
}

export interface ApiErrorBody {
    error?: { message?: string; code?: number; status?: string };
}

// ---- Webview messaging ----
export interface WebviewImage {
    base64: string;
    mimeType: string;
    name?: string;
}

export interface WebviewMessage {
    command: string;
    prompt?: string;
    selectedModel?: string;
    speed?: number;
    snippetId?: string;
    favoriteId?: string;
    name?: string;
    body?: string;
    category?: string;
    variables?: Record<string, string>;
    // chat
    text?: string;
    images?: WebviewImage[];
    conversationId?: string;
    // multi-provider (v0.5)
    providerId?: string;
    baseUrl?: string;
}

// ---- Snippets (G-series) ----
export type SnippetCategory =
    | 'coding'
    | 'debugging'
    | 'testing'
    | 'documentation'
    | 'review'
    | 'migration'
    | 'git'
    | 'custom';

export interface SnippetVariable {
    key: string;            // placeholder name, e.g. "language"
    label: string;          // human label
    auto?: 'activeFile' | 'selection' | 'language' | 'gitBranch' | 'gitRepo' | 'workspaceName' | 'activeFileName';
    default?: string;
}

export interface Snippet {
    id: string;
    name: string;
    description?: string;
    category: SnippetCategory;
    body: string;                       // template with {variable} placeholders
    variables?: SnippetVariable[];
    builtin?: boolean;                  // true = built-in, false = user-defined
    favorite?: boolean;                 // starred by user
    icon?: string;                      // codicon id
    mode?: 'chat' | 'insert' | 'replace'; // how to apply the snippet
}

// ---- Quick actions (G1) ----
export interface QuickAction {
    id: string;
    label: string;
    icon: string;
    snippetId: string;     // refer to a snippet
    color?: string;
}

// ---- Marketplace (G3) ----
export interface MarketplaceSnippet {
    id: string;
    name: string;
    description?: string;
    category: SnippetCategory;
    body: string;
    variables?: SnippetVariable[];
    author?: string;
    tags?: string[];
}

// ---- Chat conversations (A1/A5) ----
export interface StoredImage {
    mimeType: string;
    base64: string;
    name?: string;
}

export interface ChatMessage {
    role: 'user' | 'model';
    text: string;
    ts: number;
    images?: StoredImage[];
}

export interface Conversation {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: ChatMessage[];
}

export interface ConversationSummary {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
}

// ---- Token usage (C3) ----
export interface GeminiUsage {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
}
