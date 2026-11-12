<p align="center">
  <b>🇬🇧 English</b> · <a href="README.fa.md">🇮🇷 فارسی</a>
</p>

# 🦅 Simorgh — AI Coding Assistant for VS Code

> **Simorgh** (سیمرغ) is the legendary wise bird of Shahnameh — a symbol of multi-power, speed, and awareness. This extension carries **8 AI brains** under one roof.

<p align="center">
  <img src="https://img.shields.io/badge/version-0.6.0-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/license-MIT-yellow?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/providers-8-success?style=flat-square" alt="8 Providers" />
</p>

<p align="center">
  <b>A Persian-first, multi-model AI coding assistant for VS Code</b><br/>
  <i>Gemini · OpenAI · Claude · DeepSeek · OpenRouter · Groq · Ollama · Custom OpenAI</i>
</p>

---

## ✨ Why Simorgh?

**Simorgh** is a complete, open-source AI coding assistant for VS Code. Unlike single-model extensions, you can switch between providers at any time — from blazing-fast cloud models to private local models via Ollama. It's designed with **Persian (Farsi) developers in mind**, while remaining fully usable in English.

### 🎯 Key Features

- 🤖 **8 providers in one extension** — Gemini, OpenAI, Claude, DeepSeek, OpenRouter, Groq, Ollama, and any OpenAI-compatible endpoint
- 💬 **Real-time streaming chat (SSE)** — answers render as they are generated
- 📎 **Image attachments** — via button, paste, or drag & drop
- 🧠 **Multi-turn memory** — conversation history preserved
- 📚 **Disk-backed history** — no Memento size limits, unlimited conversations
- ⚡ **Apply Diff Inline** — an **Apply** button on every code block with a diff preview
- 🔤 **@-mention Context** — `@file:src/app.ts`, `@selection`, `@git`, `@problems`, `@clipboard`
- ✍️ **Inline Completion (Ghost Text)** — AI-powered autocomplete with any model
- 💬 **Chat Participant** — use `@aiassistant` in the native VS Code chat panel
- 🛡️ **Secret Scrubber** — automatically masks API keys and tokens before sending to any AI
- 🔧 **10 developer tools** — Commit messages, PR descriptions, Code Review, Changelog, Security Audit, and more
- 📝 **Snippet Manager** — built-in prompts + custom snippets with favorites
- 🌍 **Persian (RTL) UI** — first-class support for Persian-speaking developers

---

## 📦 Installation

### From VS Code Marketplace

~~~bash
# In VS Code: Ctrl+P → ext install mehdi-ghobadi.simorgh
~~~

### From Source (Development)

~~~bash
git clone https://github.com/TheVrisky/simorgh.git
cd simorgh
npm install
npm run compile
~~~

Then press `F5` in VS Code to launch the **Extension Development Host**.

---

## 🚀 Quick Start

1. **Set your API key** — `Ctrl+Shift+P` → `AI: Set API Key`
2. **Choose a provider** — `AI: Change AI Provider`
3. **Start chatting** — press `Alt+G` to open the chat panel

---

## 🔑 Supported Providers

| Provider | Needs Key | Sample Models |
|----------|:---:|----------------|
| **Google Gemini** | ✅ | `gemini-2.5-flash`, `gemini-2.5-pro` |
| **OpenAI** | ✅ | `gpt-4o`, `gpt-4o-mini`, `gpt-4.1` |
| **Anthropic Claude** | ✅ | `claude-sonnet-4-5`, `claude-opus-4-1` |
| **DeepSeek** | ✅ | `deepseek-chat`, `deepseek-reasoner` |
| **OpenRouter** | ✅ | Hundreds of models from all providers |
| **Groq** | ✅ | `llama-3.3-70b-versatile` |
| **Ollama (local)** | ❌ | `llama3.1`, `qwen2.5-coder` |
| **Custom OpenAI** | ✅ | Any OpenAI-compatible service |

> 🔐 API keys are **encrypted** in VS Code's `SecretStorage` and are never written to settings.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+G` | Open chat panel |
| `Alt+N` | New conversation |
| `Alt+Shift+E` | Explain selected code |
| `Alt+Shift+R` | Refactor selection |
| `Alt+Shift+T` | Generate tests |
| `Alt+Shift+B` | Fix bugs |
| `Alt+Shift+M` | Generate commit message |
| `Alt+Shift+V` | Code review |

---

## 🧩 @-mention Context

Use these tokens inside the chat to inject live context:

| Token | Description |
|-------|-------------|
| `@selection` | Current editor selection |
| `@activeFile` | Full active file content |
| `@file:path` | A specific workspace file |
| `@problems` | Diagnostics of the active file |
| `@git` | Git diff (staged/unstaged) |
| `@gitBranch` | Current branch name |
| `@clipboard` | Clipboard content |

**Example:**

~~~
Review this file: @file:src/utils.ts
And check problems in this selection: @selection
~~~

---

## ⚙️ Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `aiassistant.inlineCompletion.enabled` | `false` | Enable inline (ghost-text) completion |
| `aiassistant.inlineCompletion.debounceMs` | `350` | Debounce before requesting a completion |
| `aiassistant.rulesFile` | `.aiassistant/rules.md` | Path to custom rules file |

---

## 🏗️ Architecture

~~~
src/
├── extension.ts              # Entry point
├── core/
│   ├── aiClient.ts           # Multi-provider facade
│   ├── chatStore.ts          # Disk-backed chat storage
│   ├── contextService.ts     # Editor & Git access
│   ├── editApplier.ts        # Apply code with diff preview
│   ├── mentionResolver.ts    # @-mention context resolver
│   ├── secretScrubber.ts     # Secret/token masking
│   ├── snippetManager.ts     # Snippet management
│   └── ...
├── providers/
│   ├── geminiChatProvider.ts       # Chat webview
│   ├── inlineCompletionProvider.ts # Ghost text
│   ├── chatParticipant.ts          # @aiassistant
│   └── snippetsTreeProvider.ts
├── commands/                 # Developer Tools, Integration, Snippets
└── test/                     # Unit tests
media/
├── chat.html · chat.css · chat.js
~~~

---

## 🛡️ Security

- ✅ API keys stored in **SecretStorage** (encrypted)
- ✅ **Secret Scrubber** — masks `sk-*`, `AIza*`, `ghp_*`, `AKIA*`, `Bearer` and more before sending
- ✅ **Strict CSP** with per-request nonce for scripts
- ✅ **90-second timeout** on every request
- ✅ **Diff preview** before applying any code change

---

## 🤝 Contributing

Contributions are welcome! 🎉

~~~bash
git checkout -b feature/amazing-feature
npm install
npm run compile
# ... develop ...
git commit -m "feat: add amazing feature"
git push origin feature/amazing-feature
~~~

Then open a Pull Request.

---

## 📄 License

This project is released under the **MIT** License. See [LICENSE](LICENSE).

---

<p align="center">
  Made with ❤️ for Persian-speaking developers<br/>
  <sub>If you find this project useful, please ⭐ it on GitHub!</sub>
</p>
