# Change Log

All notable changes to the "gemini-assistant" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.6.0] - Simorgh 🦅 — Stability, Security & New Superpowers

> Renamed the project to **Simorgh** (سیمرغ) — the legendary wise bird of Shahnameh, symbolizing multi-power, speed and awareness. Publisher: Mehdi Ghobadi · GitHub: TheVrisky.

Major quality + feature pass: hardened security, refactored webview, disk-backed history, inline completion, chat participant, apply-diff, and @-mentions.

### 🛡️ Security & Stability (Phase 1)
- Fixed `child_process` import in `contextService` (bundler-safe).
- Added 90-second request timeout (`withTimeout`) to every provider fetch.
- New `secretScrubber` module — masks `sk-*`, `sk-ant-*`, `AIza*`, `gsk_*`, `ghp_*`, `glpat-*`, `AKIA*`, `Bearer`, and `password=/api_key=` patterns before sending to any AI. Applied in chat prompt builder and mention resolver; logs redaction count.
- Corrected CSP `img-src` in the chat webview to include `webview.cspSource`.

### 🧹 Webview Refactor (Phase 2)
- Extracted all inline HTML/CSS/JS into `media/chat.html`, `media/chat.css`, `media/chat.js`.
- `getHtml()` now loads the template and substitutes `{{nonce}}`, `{{cspSource}}`, `{{styleUri}}`, `{{scriptUri}}`.
- Tighter CSP: styles and scripts served via `asWebviewUri` (no `unsafe-inline`).

### 💾 Persistent Chat History (Phase 3)
- `ChatStore` migrated from `workspaceState` to `globalStorageUri` on disk (`chat/{id}.json`).
- Only index, active id, and usage counters stay in `globalState` — no more `Memento` size limits with large histories/images.
- Automatic one-time migration from legacy `workspaceState` data.
- `ChatStore` is now fully async; all callers updated.

### 🧪 Tests (Phase 4)
- Added `secretScrubber.test.ts` (10 cases) and `helpers.test.ts` (10 cases).
- `compile`/`watch` npm scripts now use the direct `tsc` path (Windows-safe).

### ⚡ Apply Diff Inline (Phase 5-A)
- New `EditApplier` service with 4 modes: replace file, replace selection, insert at cursor, new file.
- Always shows a **Diff preview** (via `vscode.diff`) before applying.
- New "اعمال" (Apply) button on every code block in chat.
- New command `AI: اعمال کد تولیدشده در فایل` (`gemini-assistant.applyCode`).

### 🔤 @-mention Context (Phase 5-B)
- New `MentionResolver` supporting `@selection`, `@activeFile`, `@file:path`, `@problems`, `@git`, `@gitBranch`, `@clipboard`.
- Mentions expand inline in the current turn and are secret-scrubbed.

### ✍️ Inline Completion (Phase 5-E)
- New `InlineCompletionProvider` (ghost text) using the active provider/model.
- Debounced (default 350 ms), toggle via setting `aiassistant.inlineCompletion.enabled` or command `AI: فعال/غیرفعال کردن تکمیل خودکار کد`.

### 💬 Chat Participant API (Phase 5-F)
- Registered `@aiassistant` chat participant in the VS Code Chat panel with streaming + multi-turn history.

### 📦 Publishing
- `package.json`: `publisher`, `author`, `license`, `homepage`, `bugs`, `galleryBanner`, `configuration` and `chatParticipants` contributions added.
- New `LICENSE` (MIT) and a rewritten professional `README.md`.
- Version bumped to **0.6.0**.

## [0.5.0] - Stage 5 (Multi-Provider AI Backend)

The extension is **no longer Gemini-only**. Any AI service can now be used with its own API key.

### New Architecture

- New unified client `AiClient` (`src/core/aiClient.ts`) replaces `GeminiClient`:
  - One facade, three transport adapters: `gemini` (native REST), `openai` (OpenAI-compatible Chat Completions), `anthropic` (Messages API).
  - All downstream modules (chat, snippets, developer tools, integrations, status bar) keep the same API surface.
- Provider catalog in `constants.ts`: 8 preconfigured providers —
  Google Gemini, OpenAI (GPT), Anthropic (Claude), DeepSeek, OpenRouter, Groq, Ollama (local, no key), and a custom OpenAI-compatible endpoint (LM Studio, vLLM, proxies, ...).
- Per-provider isolation:
  - API keys stored separately under `ai.apiKey.<providerId>` in `SecretStorage`.
  - Selected model, cached model list and base URL persisted per provider in `globalState`.
- Base URL is editable per provider (settings tab or new `AI: تنظیم آدرس پایه API` command) — required for the custom provider, useful for Ollama/proxies.

### Settings UI (webview)

- New provider `<select>` in the settings tab; switching providers instantly reloads that provider's key status, base URL, model list and selected model.
- New Base URL field with hints for local services.
- API key row now shows the provider name, hides set/clear buttons for key-less providers (Ollama) and shows "این سرویس به کلید نیاز ندارد".
- Model list is fetched from the *active* provider's `/models` endpoint (each provider format parsed accordingly).
- Chat bubbles now show the active provider's name instead of a hardcoded "Gemini".

### Streaming & Multi-Turn

- SSE streaming implemented for all three adapter kinds:
  - Gemini: `:streamGenerateContent?alt=sse` (unchanged behavior).
  - OpenAI-compatible: `chat/completions` with `stream: true`, `stream_options.include_usage` (auto-retry without it for servers that reject it), `[DONE]` sentinel handling.
  - Anthropic: `messages` with `stream: true`, parsing `content_block_delta`, `message_start` and `message_delta` usage events.
- Multi-turn history is stored in a provider-neutral format (`GeminiContent`) and converted automatically:
  - OpenAI: `system` + `user`/`assistant` messages, images as `image_url` data URIs.
  - Anthropic: `system` param + messages with `image` base64 sources.
  - Gemini: unchanged `inlineData` parts.
- Token usage is normalized (`prompt_tokens/completion_tokens` and Anthropic usage → `GeminiUsage`) so the status-bar counter works for every provider.

### Commands

- New: `AI: تغییر ارائه‌دهنده هوش مصنوعی` (`gemini-assistant.selectProvider`) — QuickPick over all providers with an "✔ فعال" marker.
- New: `AI: تنظیم آدرس پایه API (Base URL)` (`gemini-assistant.setBaseUrl`).
- `AI: تنظیم کلید API` is now provider-aware: it asks which service first, with the right key placeholder per service.
- All palette titles rebranded from `Gemini:` to `AI:`.

### Migration & Compatibility

- Legacy `gemini.apiKey` secret and legacy `selectedModel` / `cachedModels` state are transparently migrated for the Gemini provider — existing users keep their key and model after updating.
- Model lists, defaults and descriptions updated in `package.json` (v0.5.0, multi-model keywords, new display name "AI Assistant (Multi-Model)").

### Docs

- README rewritten around multi-provider: provider table, new quick-start, updated architecture map and security notes.
- This CHANGELOG entry.

## [0.4.0] - Stage 4 (Modern Chat UI + VS Code Integration)

### A-series: Modern Chat UI

#### A1 — Multi-turn Chat
- Complete redesign of the webview panel: chat bubbles (user / Gemini) with message history.
- Conversation memory: last 12 messages sent as multi-turn contents to the model.
- System instruction includes active file context (selection if present, otherwise full file, truncated).
- Answer language enforced as Persian via system instruction.

#### A2 — Markdown Rendering
- Custom lightweight Markdown renderer in webview: headings, bold/italic, inline code, links, blockquotes, lists (ul/ol), horizontal rules, fenced code blocks styled with editor font.

#### A3 — Copy Buttons
- Copy button on every code block (clipboard via extension host `env.clipboard`).
- Copy button on every message bubble.

#### A4 — Streaming (SSE)
- New `GeminiClient.streamGenerateContent()` using `:streamGenerateContent?alt=sse`.
- Chunks are rendered live into the streaming bubble (rAF-throttled re-render).
- Aborting mid-stream keeps the partial answer in conversation history.

#### A5/A6 — Conversation History
- New `ChatStore` persisted in `workspaceState` (per project): 20 conversations max, 100 messages each.
- History tab with live search, conversation switch (click to load), delete, active highlight.
- Auto-titles from the first user message.

#### A7 — Export
- `Gemini: خروجی Markdown از گفتگو` — saves the active conversation as a Markdown file (save dialog).

#### A8 — Welcome Screen
- Suggestion cards (توضیح / باگ‌یابی / ریفکتور / تست / کامنت / ریویو) shown when the conversation is empty.

#### A9/A10 — Polish
- Animated typing indicator (three dots) until the first stream chunk arrives.
- Fade-in animation for messages, hover effects on interactive elements.

#### A11 — Markdown Live Preview
- Toggleable preview pane rendering the composer content as Markdown while typing.

#### A12 — Open Chat in Editor Tab
- `Gemini: باز کردن چت در تب` opens the same chat UI in a full-size editor tab (WebviewPanel).
- Both the sidebar view and the tab panel stay in sync through the shared provider.

### C-series: VS Code Integration

#### C1 — Editor Context Menu
- Right-click menu on selected code: توضیح / ریفکتور / رفع باگ / تولید تست + افزودن Git Diff به چت.

#### C2 — Keyboard Shortcuts
- `Alt+G` open chat, `Alt+N` new conversation, `Alt+Shift+E/R/B/T` code actions, `Alt+Shift+M` commit message, `Alt+Shift+V` code review.
- `Enter` sends the message in the chat composer (`Shift+Enter` = newline).

#### C3 — Status Bar
- Status bar item showing the active model (`$(sparkle) model`).
- Tooltip shows cumulative token usage of the project (input/output/total), persisted per workspace.
- Usage resettable from settings tab (`resetUsage`).
- Usage data captured from `usageMetadata` of streamed responses.

#### C5 — Terminal Error Explanation
- `Gemini: توضیح خطای ترمینال` reads the terminal selection and produces a Persian explanation doc (cause / fix / corrective command).
- Available in the terminal context menu.

#### C6 — Git Diff into Chat
- `Gemini: افزودن Git Diff به چت` inserts the staged (or unstaged) diff into the chat composer, ready to send for review.

#### C7 — Active File Problems
- `Gemini: توضیح مشکلات فایل فعال` collects all diagnostics of the active file and generates one Persian explanation document.

#### C8/C9 — Image Input (Gemini Vision)
- Attach button (+) opens an image picker (png/jpg/jpeg/gif/webp, max 2MB, max 2 per message).
- Paste images directly with `Ctrl+V`.
- Drag & drop images onto the chat panel.
- Images are stored with the message, rendered as thumbnails, and sent as `inlineData` parts (only for recent history messages to limit payload).

### Improvements
- Chat provider now supports multiple simultaneous webviews (sidebar + editor tab) with synchronized messages.
- Composer redesigned: quick actions + favorites + image chips + send/stop buttons.
- `stopProcess` keeps partial streamed answers.

## [0.3.0] - Stage 3 (Quick Templates + Developer Tools)

### Architecture
- **Refactored** entire codebase into a modular structure: `core/`, `providers/`, `commands/`.
- 14 source files, ~2,700 LOC total (was a single 660-line file).
- New modules: `geminiClient`, `contextService`, `snippetManager`, `snippetRunner`, `logger`, `helpers`, `types`, `constants`.

### G-series: Quick Templates

#### G1 — Quick Action Bar
- Row of 6 colorful buttons above the chat textarea: توضیح، ریفکتور، باگ‌یابی، تست، کامنت، ریویو.
- Each maps to a built-in snippet; click triggers `runSnippet` immediately.

#### G2 — Custom Snippets
- New command `Gemini: ذخیره Snippet سفارشی` opens a 4-step wizard (name → category → description → body).
- Snippets support `{variable}` placeholders.
- Custom snippets persisted in `globalState` and shown alongside built-ins in the tree view.

#### G3 — Prompt Marketplace
- QuickPick-based browser for all built-in snippets.
- "Add to favorites" with one click.

#### G4 — Favorites
- `★` toggle on every snippet (in tree view, command palette, and quick pick).
- Favorites shown as chips at the top of the chat panel.
- Stored in `globalState`.

#### G5 — Automatic Variables
- 7 auto-resolved context variables:
  - `{activeFile}` — full content of the active editor
  - `{activeFileName}` — basename of active file
  - `{selection}` — selected text in editor
  - `{language}` — languageId of active editor
  - `{gitBranch}` — current branch via `vscode.git` extension API
  - `{gitRepo}` — workspace folder name
  - `{workspaceName}` — workspace folder name
- Missing variables prompt user via InputBox.

#### G6 — Snippets Tree View
- New view `geminiAssistantSnippets` in the sidebar.
- Hierarchical: category → snippet, with collapsible categories.
- Built-in icons per snippet type (book, bug, beaker, comment, eye, ...).
- Click on a snippet runs it directly in the chat webview.
- Refresh button in view title.
- Inline ★ toggle per snippet.
- "Save Custom Snippet" button in view title.

### F-series: Developer Tools

#### F1 — Generate Commit Message
- Reads staged `git diff --cached`.
- Generates Conventional Commits message.
- Opens in a new Markdown document for review.

#### F2 — Generate PR Description
- Reads staged diff.
- Generates structured Markdown PR description (Summary, Changes, Type, Testing).
- Respects repo name and branch.

#### F3 — Code Review (pre-commit)
- Reads staged diff.
- Senior-engineer-style review with severity-tagged findings (Critical/Major/Minor/Nit).
- Approve/Request Changes verdict.

#### F4 — Generate Changelog
- Prompts for commit range (default `HEAD~30..HEAD`).
- Reads git log of the range.
- Generates CHANGELOG.md entry grouped by Added/Changed/Fixed/Removed/Security.

#### F5 — Daily Standup
- Reads git activity from the last 24 hours.
- Generates Persian standup report (work done, changed files, plan for tomorrow).
- Reads file change list.

#### F6 — Generate README from code
- Uses the active editor's content.
- Generates a Persian README.md with 7 sections (Title, Install, Usage, Functions, Config, Contributing, License).

#### F7 — Explain Problem from Problems panel
- Lists all diagnostics across the workspace.
- QuickPick to choose which problem to explain.
- Includes surrounding code (±5 lines).
- Generates Persian explanation with cause, fix, sample code.

#### F8 — Migration Helper
- Two-step InputBox: fromFramework → toFramework (e.g., Vue 2 → Vue 3).
- Generates migrated code with summary and gotchas.

#### F9 — Deprecation Detector
- Scans active file for deprecated APIs/patterns.
- Outputs a markdown table: line, item, version, modern replacement.
- Provides upgrade recommendations.

#### F10 — Security Audit
- Scans active file for security vulnerabilities.
- Checks: Injection (SQLi/XSS/Command), AuthN/AuthZ, data exposure, insecure crypto, path traversal, SSRF, CSRF, hardcoded secrets.
- Outputs markdown table with severity, type, line, fix.

### UX Improvements
- All F-series tools:
  - Show progress notification with cancellation.
  - Open result in a new Markdown document (not the chat panel) for easy copy/share.
  - Truncate large inputs (50K diff chars, 60K file chars) to avoid API token limits.

### Menus & Commands
- 13 new commands in Command Palette.
- Editor context menu: "توضیح کد انتخاب‌شده" when text is selected.
- Tree view title bar: Refresh + Add custom snippet.
- Tree item context menu: ★ toggle favorite.

### Documentation
- README fully rewritten in Persian with feature tables, architecture diagram, and quick-start guide.
- CHANGELOG expanded with all changes.

## [0.1.0] - Stage 1 (Hardening)

### Security
- API Key migrated from `globalState` (plaintext) to `SecretStorage` (encrypted).
- API Key sent via `x-goog-api-key` header instead of URL query parameter.
- API Key no longer embedded in webview HTML.
- CSP hardened with per-request nonce.
- Model names HTML-escaped when rendered as `<option>`.

### UX / Safety
- Confirmation dialog before destructive "Write Code" replaces the active file content.
- New commands in Command Palette: `setApiKey`, `clearApiKey`.
- API key field replaced with status indicator + set/clear buttons.

### Performance / Stability
- Editor typing changed from 1 char/edit to 4 chars/edit (chunked) — ~4x faster.
- Concurrency guard prevents parallel requests.
- `dispose()` aborts in-flight requests on extension deactivation.

### Code Quality
- Replaced `any` types with proper TypeScript interfaces.
- `errorToString()` helper for safe `unknown` catch handling.
- Output channel `Gemini Assistant` for diagnostic logging.

## [0.0.1] - Initial release

- Initial scaffolding (Yeoman template).
