<p align="center">
  <a href="README.md">🇬🇧 English</a> · <b>🇮🇷 فارسی</b>
</p>

# 🦅 Simorgh — دستیار هوشمند کدنویسی برای VS Code

> **Simorgh** (سیمرغ) — نام پرنده‌ی افسانه‌ای خرد در شاهنامه؛ نمادی از چندتوانی، سرعت و آگاهی. این افزونه هم با ۸ مغز هوش مصنوعی، چندتوان است.

<p align="center">
  <img src="https://img.shields.io/badge/version-0.6.0-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/license-MIT-yellow?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/providers-8-success?style=flat-square" alt="8 Providers" />
</p>

<p align="center">
  <b>دستیار هوشمند کدنویسی فارسی با پشتیبانی از ۸ ارائه‌دهنده هوش مصنوعی</b><br/>
  <i>Gemini · OpenAI · Claude · DeepSeek · OpenRouter · Groq · Ollama · Custom OpenAI</i>
</p>

---

## ✨ چرا این افزونه؟

**Simorgh** یک افزونه‌ی کامل و متن‌باز برای VS Code است که تجربه‌ی کدنویسی با هوش مصنوعی را به زبان فارسی و با پشتیبانی از **چندین مدل و ارائه‌دهنده** فراهم می‌کند. برخلاف افزونه‌های تک‌مدلی، شما می‌توانید در هر لحظه بین سرویس‌های مختلف جابجا شوید — از مدل‌های ابری پرسرعت گرفته تا مدل‌های محلی و خصوصی با Ollama.

### 🎯 ویژگی‌های کلیدی

- 🤖 **۸ ارائه‌دهنده در یک افزونه** — Gemini, OpenAI, Claude, DeepSeek, OpenRouter, Groq, Ollama, Custom OpenAI-compatible
- 💬 **چت تعاملی با استریم زنده (SSE)** — پاسخ‌ها به‌صورت تدریجی نمایش داده می‌شوند
- 📎 **پیوست تصویر** — از طریق دکمه، Paste یا Drag & Drop
- 🧠 **حافظه‌ی چندنوبتی** — تاریخچه‌ی گفتگو حفظ می‌شود
- 📚 **تاریخچه‌ی نامحدود** — ذخیره‌سازی روی دیسک (بدون محدودیت Memento)
- ⚡ **Apply Diff Inline** — دکمه‌ی «اعمال» روی هر بلوک کد با پیش‌نمایش Diff
- 🔤 **@-mention Context** — `@file:src/app.ts`, `@selection`, `@git`, `@problems`, `@clipboard`
- ✍️ **Inline Completion (Ghost Text)** — تکمیل خودکار کد با مدل دلخواه
- 💬 **Chat Participant** — استفاده از `@aiassistant` در پنل چت VS Code
- 🛡️ **Secret Scrubber** — پاکسازی خودکار کلیدها و توکن‌ها قبل از ارسال به API
- 🔧 **۱۰ ابزار توسعه‌دهنده** — Commit, PR, Review, Changelog, Security Audit و...
- 📝 **Snippet Manager** — دستورات آماده + ذخیره‌ی سفارشی
- 🌍 **رابط کاربری فارسی و RTL**

---

## 📦 نصب

### از VS Code Marketplace

~~~bash
# در VS Code: Ctrl+P → ext install mehdi-ghobadi.simorgh
~~~

### از سورس (Development)

~~~bash
git clone https://github.com/TheVrisky/simorgh.git
cd simorgh
npm install
npm run compile
~~~

سپس `F5` بزنید تا **Extension Development Host** اجرا شود.

---

## 🚀 شروع سریع

1. **کلید API را تنظیم کنید** — `Ctrl+Shift+P` → `AI: تنظیم کلید API`
2. **ارائه‌دهنده را انتخاب کنید** — `AI: تغییر ارائه‌دهنده هوش مصنوعی`
3. **شروع کنید** — `Alt+G` برای باز کردن پنل چت

---

## 🔑 ارائه‌دهندگان پشتیبانی‌شده

| ارائه‌دهنده | نیاز به کلید | مدل‌های نمونه |
|-------------|:---:|----------------|
| **Google Gemini** | ✅ | `gemini-2.5-flash`, `gemini-2.5-pro` |
| **OpenAI** | ✅ | `gpt-4o`, `gpt-4o-mini`, `gpt-4.1` |
| **Anthropic Claude** | ✅ | `claude-sonnet-4-5`, `claude-opus-4-1` |
| **DeepSeek** | ✅ | `deepseek-chat`, `deepseek-reasoner` |
| **OpenRouter** | ✅ | صدها مدل از همه‌ی سرویس‌ها |
| **Groq** | ✅ | `llama-3.3-70b-versatile` |
| **Ollama (محلی)** | ❌ | `llama3.1`, `qwen2.5-coder` |
| **Custom OpenAI** | ✅ | هر سرویس سازگار با OpenAI |

> 🔐 کلیدهای API به‌صورت **رمزنگاری‌شده** در `SecretStorage` ذخیره می‌شوند و هرگز در settings نوشته نمی‌شوند.

---

## ⌨️ کلیدهای میان‌بر

| کلید | عملکرد |
|------|--------|
| `Alt+G` | باز کردن پنل چت |
| `Alt+N` | گفتگوی جدید |
| `Alt+Shift+E` | توضیح کد انتخاب‌شده |
| `Alt+Shift+R` | ریفکتور کد |
| `Alt+Shift+T` | تولید تست |
| `Alt+Shift+B` | رفع باگ |
| `Alt+Shift+M` | تولید Commit Message |
| `Alt+Shift+V` | Code Review |

---

## 🧩 @-mention Context

در چت می‌توانید از این توکن‌ها استفاده کنید:

| توکن | توضیح |
|------|-------|
| `@selection` | کد انتخاب‌شده در ادیتور |
| `@activeFile` | محتوای فایل فعال |
| `@file:path` | یک فایل خاص از ورک‌اسپیس |
| `@problems` | خطاها و هشدارهای فایل فعال |
| `@git` | Git Diff (staged/unstaged) |
| `@gitBranch` | نام شاخه |
| `@clipboard` | محتوای کلیپ‌بورد |

**مثال:**

~~~
این فایل را ریویو کن: @file:src/utils.ts
و خطاهای این انتخاب را بررسی کن: @selection
~~~

---

## ⚙️ تنظیمات

| تنظیم | پیش‌فرض | توضیح |
|-------|---------|-------|
| `aiassistant.inlineCompletion.enabled` | `false` | فعال‌سازی تکمیل خودکار |
| `aiassistant.inlineCompletion.debounceMs` | `350` | تاخیر قبل از درخواست |
| `aiassistant.rulesFile` | `.aiassistant/rules.md` | فایل قوانین سفارشی |

---

## 🏗️ معماری پروژه

~~~
src/
├── extension.ts              # نقطه ورود
├── core/
│   ├── aiClient.ts           # facade چندارائه‌دهنده
│   ├── chatStore.ts          # ذخیره‌سازی روی دیسک
│   ├── contextService.ts     # دسترسی به ادیتور و Git
│   ├── editApplier.ts        # اعمال کد با Diff Preview
│   ├── mentionResolver.ts    # @-mention Context
│   ├── secretScrubber.ts     # ماسک کلیدها
│   ├── snippetManager.ts     # مدیریت Snippet
│   └── ...
├── providers/
│   ├── geminiChatProvider.ts       # پنل چت
│   ├── inlineCompletionProvider.ts # Ghost Text
│   ├── chatParticipant.ts          # @aiassistant
│   └── snippetsTreeProvider.ts
├── commands/                 # Developer Tools, Integration, Snippets
└── test/                     # تست‌های واحد
media/
├── chat.html · chat.css · chat.js
~~~

---

## 🛡️ امنیت

- ✅ کلیدها در **SecretStorage** (رمزنگاری‌شده)
- ✅ **Secret Scrubber** — پاکسازی `sk-*`, `AIza*`, `ghp_*`, `AKIA*`, `Bearer` و... قبل از ارسال
- ✅ **CSP سخت‌گیرانه** با nonce برای اسکریپت
- ✅ **Timeout ۹۰ ثانیه** روی همه‌ی درخواست‌ها
- ✅ **Diff Preview** قبل از اعمال هر تغییر کد

---

## 🤝 مشارکت

مشارکت‌ها خوش‌آمدند! 🎉

~~~bash
git checkout -b feature/amazing-feature
npm install
npm run compile
# ... توسعه ...
git commit -m "feat: add amazing feature"
git push origin feature/amazing-feature
~~~

سپس یک Pull Request باز کنید.

---

## 📄 لایسنس

این پروژه تحت لایسنس **MIT** منتشر شده است. فایل [LICENSE](LICENSE) را ببینید.

---

<p align="center">
  ساخته‌شده با ❤️ برای توسعه‌دهندگان فارسی‌زبان<br/>
  <sub>اگر این پروژه برایتان مفید بود، یک ⭐ در GitHub فراموش نشود!</sub>
</p>
