/* ============================================================
 *  Gemini Assistant - Developer Tools Commands (F1-F10)
 *  All git/code-analysis commands invoked from Command Palette
 *  or editor context menu.
 * ============================================================ */

import * as vscode from 'vscode';
import { AiClient } from '../core/aiClient';
import { ContextService } from '../core/contextService';
import { Logger } from '../core/logger';
import { errorToString } from '../core/helpers';

const MAX_DIFF_CHARS = 50000;       // Truncate huge diffs before sending to Gemini
const MAX_LOG_CHARS = 30000;
const MAX_FILE_CHARS = 60000;

function truncate(s: string, max: number): string {
    if (s.length <= max) { return s; }
    return s.slice(0, max) + `\n\n[... برش خورد - طول کل: ${s.length} کاراکتر]`;
}

export class DeveloperToolsCommands {
    private abortController: AbortController | null = null;

    constructor(
        private readonly gemini: AiClient,
        private readonly context: ContextService,
        private readonly logger: Logger
    ) {}

    /** Common pattern: call Gemini, show progress, write output to a new doc. */
    private async runToNewDoc(
        title: string,
        promptBuilder: () => Promise<string>,
        suggestedFileName: string
    ): Promise<void> {
        if (this.abortController) {
            vscode.window.showWarningMessage('یک عملیات قبلی در حال اجرا است.');
            return;
        }
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        try {
            const prompt = await promptBuilder();
            if (!prompt) { return; }

            const model = this.gemini.getModel();
            const response = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title, cancellable: true },
                async (progress, token) => {
                    progress.report({ message: 'در حال پردازش با Gemini...' });
                    token.onCancellationRequested(() => this.abortController?.abort());
                    return await this.gemini.generateContent(prompt, model, signal);
                }
            );

            if (!response) {
                vscode.window.showWarningMessage('پاسخی دریافت نشد.');
                return;
            }

            await this.showInNewDocument(response, suggestedFileName);
        } catch (err) {
            this.logger.error(title, err);
            vscode.window.showErrorMessage(`خطا: ${errorToString(err)}`);
        } finally {
            this.abortController = null;
        }
    }

    private async showInNewDocument(content: string, fileName: string): Promise<void> {
        const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: false });
    }

    // ===== F1: Generate Commit Message =====
    public async generateCommitMessage(): Promise<void> {
        await this.runToNewDoc(
            'تولید پیام Commit',
            async () => {
                const diff = await this.context.getGitDiff(true);
                if (!diff.trim()) {
                    vscode.window.showWarningMessage('هیچ تغییر stagedی یافت نشد.');
                    return '';
                }
                const branch = await this.context.getGitBranch();
                return `You are an expert at writing Conventional Commits.
Generate a single, clear, concise commit message for the following staged changes.
Use the format: \`type(scope): subject\` where type is one of: feat, fix, docs, style, refactor, perf, test, chore.
Optionally add a body (max 2 lines) only if needed.
Output ONLY the commit message in plain text, no explanations.

Git branch: ${branch || '(unknown)'}

Diff:
\`\`\`diff
${truncate(diff, MAX_DIFF_CHARS)}
\`\`\``;
            },
            'commit-message.md'
        );
    }

    // ===== F2: Generate PR Description =====
    public async generatePRDescription(): Promise<void> {
        await this.runToNewDoc(
            'تولید توضیح Pull Request',
            async () => {
                const diff = await this.context.getGitDiff(true);
                if (!diff.trim()) {
                    vscode.window.showWarningMessage('هیچ تغییر stagedی یافت نشد.');
                    return '';
                }
                const branch = await this.context.getGitBranch();
                const repo = await this.context.getGitRepoName();
                return `You are an expert at writing Pull Request descriptions.
Write a clear PR description in Markdown format with these sections:

## Summary
(2-3 sentence summary of what this PR does)

## Changes
(bullet list of key changes, each ≤ 1 line)

## Type of Change
(checklist: bug fix / new feature / refactor / docs / test / chore / breaking change)

## Testing
(short note on how to verify)

Repo: ${repo || '(unknown)'}
Branch: ${branch || '(unknown)'}

Diff:
\`\`\`diff
${truncate(diff, MAX_DIFF_CHARS)}
\`\`\``;
            },
            'pr-description.md'
        );
    }

    // ===== F3: Code Review (pre-commit) =====
    public async codeReview(): Promise<void> {
        await this.runToNewDoc(
            'Code Review پیش از Commit',
            async () => {
                const diff = await this.context.getGitDiff(true);
                if (!diff.trim()) {
                    vscode.window.showWarningMessage('هیچ تغییر stagedی یافت نشد.');
                    return '';
                }
                return `You are a senior code reviewer.
Review the following staged changes carefully. Provide:

## Findings
- Severity (Critical / Major / Minor / Nit) - File:Line - Description

## Strengths
- (what was done well)

## Suggestions
- (concrete improvements)

## Verdict
(overall: APPROVE / REQUEST CHANGES, in 1-2 sentences)

Diff:
\`\`\`diff
${truncate(diff, MAX_DIFF_CHARS)}
\`\`\``;
            },
            'code-review.md'
        );
    }

    // ===== F4: Generate Changelog =====
    public async generateChangelog(): Promise<void> {
        await this.runToNewDoc(
            'تولید Changelog',
            async () => {
                const fromTag = await vscode.window.showInputBox({
                    prompt: 'برچسب (tag) یا commit شروع را وارد کنید',
                    placeHolder: 'v1.0.0 یا HEAD~50',
                    value: 'HEAD~30',
                    ignoreFocusOut: true
                });
                if (fromTag === undefined) { return ''; }

                const toRef = await vscode.window.showInputBox({
                    prompt: 'مرجع پایان (پیش‌فرض HEAD)',
                    value: 'HEAD',
                    ignoreFocusOut: true
                });
                if (toRef === undefined) { return ''; }

                const log = await this.context.runGitCommand([
                    'log', `${fromTag}..${toRef || 'HEAD'}`,
                    '--pretty=format:%h|%ad|%an|%s',
                    '--date=short',
                    '--no-color'
                ]);
                if (!log.trim()) {
                    vscode.window.showWarningMessage('هیچ کامیتی در این بازه یافت نشد.');
                    return '';
                }

                return `You are an expert at writing changelogs following Keep a Changelog format.
Generate a CHANGELOG.md entry (in Markdown) for the following commits.
Group by: Added / Changed / Fixed / Removed / Security.
Be concise, no fluff. Output only the markdown content.

Commits (${fromTag}..${toRef}):
\`\`\`
${truncate(log, MAX_LOG_CHARS)}
\`\`\``;
            },
            'changelog.md'
        );
    }

    // ===== F5: Daily Standup =====
    public async dailyStandup(): Promise<void> {
        await this.runToNewDoc(
            'Daily Standup از تاریخچه Git',
            async () => {
                const commits = await this.context.getRecentCommits(1);
                if (!commits.trim()) {
                    vscode.window.showWarningMessage('هیچ کامیتی در ۲۴ ساعت گذشته یافت نشد.');
                    return '';
                }
                const files = await this.context.getChangedFiles(1);
                const branch = await this.context.getGitBranch();

                return `You are an engineering team lead writing a daily standup summary.
Based on the following git activity, write a standup report in Persian (فارسی):

## کارهایی که انجام شد (Yesterday / Today)
- (bullet list of completed work, derived from commit messages)

## فایل‌های تغییر یافته
- (list of changed files, grouped if many)

## برنامه برای فردا
- (one sentence based on patterns in commits)

Branch: ${branch || '(unknown)'}

Commits (last 24h):
\`\`\`
${truncate(commits, MAX_LOG_CHARS)}
\`\`\`

Changed files:
\`\`\`
${truncate(files.join('\n'), 5000)}
\`\`\``;
            },
            'standup.md'
        );
    }

    // ===== F6: Generate README from code =====
    public async generateReadme(): Promise<void> {
        await this.runToNewDoc(
            'تولید README از کد',
            async () => {
                const editor = vscode.window.activeTextEditor;
                const doc = editor?.document;
                if (!doc) {
                    vscode.window.showWarningMessage('فایلی در ادیتور باز نیست.');
                    return '';
                }
                const code = doc.getText();
                if (!code.trim()) {
                    vscode.window.showWarningMessage('فایل خالی است.');
                    return '';
                }
                const fileName = doc.uri.path.split('/').pop() || 'file';
                const language = doc.languageId;

                return `You are an expert technical writer.
Generate a comprehensive README.md (in Persian, فارسی) for the following file.
The README should include:
1. عنوان و توضیح کوتاه (شامل نام فایل و هدف)
2. نصب و پیش‌نیازها
3. نحوه استفاده (با مثال کد)
4. توضیح توابع/کلاس‌های اصلی
5. تنظیمات (در صورت وجود)
6. مشارکت (Contributing)
7. لایسنس

File: ${fileName} (${language})
\`\`\`
${truncate(code, MAX_FILE_CHARS)}
\`\`\``;
            },
            'README.md'
        );
    }

    // ===== F7: Explain Problem from Problems panel =====
    public async explainProblem(): Promise<void> {
        // Try the active editor first, then list problems
        const diagnostics = vscode.languages.getDiagnostics();
        const allProblems: Array<{ file: string; line: number; severity: string; source: string; message: string }> = [];
        for (const [uri, diags] of diagnostics) {
            for (const d of diags) {
                allProblems.push({
                    file: uri.fsPath.split('/').pop() || uri.fsPath,
                    line: d.range.start.line + 1,
                    severity: vscode.DiagnosticSeverity[d.severity],
                    source: d.source || 'unknown',
                    message: d.message
                });
            }
        }

        if (allProblems.length === 0) {
            vscode.window.showInformationMessage('هیچ خطایی در Problems panel یافت نشد.');
            return;
        }

        // Let user pick which problem to explain
        const items = allProblems.slice(0, 50).map(p => ({
            label: `$(${p.severity === 'Error' ? 'error' : p.severity === 'Warning' ? 'warning' : 'info'}) ${p.file}:${p.line}`,
            description: `[${p.source}]`,
            detail: p.message,
            problem: p
        }));

        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: 'خطا را برای توضیح انتخاب کنید',
            ignoreFocusOut: true
        });
        if (!picked) { return; }

        // Try to get surrounding code from the file
        const problem = picked.problem;
        const editor = vscode.window.activeTextEditor;
        let codeSnippet = '';
        if (editor) {
            const doc = editor.document;
            const line = Math.max(0, problem.line - 6);
            const range = new vscode.Range(line, 0, Math.min(doc.lineCount - 1, problem.line + 5), 0);
            codeSnippet = doc.getText(range);
        }

        await this.runToNewDoc(
            'توضیح خطا',
            async () => {
                return `You are an expert debugger.
Explain the following error/warning in Persian (فارسی) and propose a fix.
Format:

## علت خطا
(توضیح کوتاه و واضح)

## راه‌حل
(مراحل رفع به‌صورت لیست)

## نمونه کد اصلاح‌شده
(در صورت لزوم، کد کوتاه)

Error:
- File: ${problem.file}:${problem.line}
- Severity: ${problem.severity}
- Source: ${problem.source}
- Message: ${problem.message}

Surrounding code:
\`\`\`
${codeSnippet}
\`\`\``;
            },
            'error-explanation.md'
        );
    }

    // ===== F8: Migration Helper =====
    public async migrationHelper(): Promise<void> {
        await this.runToNewDoc(
            'Migration Helper',
            async () => {
                const editor = vscode.window.activeTextEditor;
                const doc = editor?.document;
                if (!doc) {
                    vscode.window.showWarningMessage('فایلی در ادیتور باز نیست.');
                    return '';
                }
                const code = doc.getText();
                if (!code.trim()) { return ''; }

                const fromFramework = await vscode.window.showInputBox({
                    prompt: 'از چه فریمورک/نسخه‌ای می‌خواهید مهاجرت کنید؟',
                    placeHolder: 'Vue 2 / React 17 / Express 3 / ...',
                    ignoreFocusOut: true
                });
                if (fromFramework === undefined) { return ''; }

                const toFramework = await vscode.window.showInputBox({
                    prompt: 'به چه فریمورک/نسخه‌ای می‌خواهید مهاجرت کنید؟',
                    placeHolder: 'Vue 3 / React 18 / Express 4 / ...',
                    ignoreFocusOut: true
                });
                if (toFramework === undefined) { return ''; }

                return `You are an expert migration specialist.
Migrate the following code from ${fromFramework} to ${toFramework}.
Output:

## خلاصه تغییرات
(bullet list of key changes)

## کد مهاجرت‌شده
\`\`\`${doc.languageId}
(full migrated code)
\`\`\`

## نکات مهم
(any gotchas)

Original code (${doc.languageId}):
\`\`\`
${truncate(code, MAX_FILE_CHARS)}
\`\`\``;
            },
            'migration-result.md'
        );
    }

    // ===== F9: Deprecation Detector =====
    public async deprecationDetector(): Promise<void> {
        await this.runToNewDoc(
            'Deprecation Detector',
            async () => {
                const editor = vscode.window.activeTextEditor;
                const doc = editor?.document;
                if (!doc) {
                    vscode.window.showWarningMessage('فایلی در ادیتور باز نیست.');
                    return '';
                }
                const code = doc.getText();
                if (!code.trim()) { return ''; }

                return `You are an expert at detecting deprecated APIs and patterns.
Scan the following ${doc.languageId} code and identify:
- Deprecated APIs/functions/syntax (with version if known)
- Modern replacements
- Potential upgrade path

Format (in Persian, فارسی):

## API‌ها/الگوهای deprecate شده
| خط | مورد | نسخه | جایگزین مدرن |
|----|------|-------|--------------|
| ... | ... | ... | ... |

## توصیه‌ها
(bullet list)

Code:
\`\`\`${doc.languageId}
${truncate(code, MAX_FILE_CHARS)}
\`\`\``;
            },
            'deprecation-report.md'
        );
    }

    // ===== F10: Security Audit =====
    public async securityAudit(): Promise<void> {
        await this.runToNewDoc(
            'Security Audit',
            async () => {
                const editor = vscode.window.activeTextEditor;
                const doc = editor?.document;
                if (!doc) {
                    vscode.window.showWarningMessage('فایلی در ادیتور باز نیست.');
                    return '';
                }
                const code = doc.getText();
                if (!code.trim()) { return ''; }

                return `You are a senior application security expert.
Perform a security audit on the following ${doc.languageId} code. Check for:

- Injection vulnerabilities (SQLi, Command, XSS, etc.)
- Authentication/Authorization issues
- Sensitive data exposure
- Insecure dependencies or crypto
- Path traversal / SSRF / CSRF
- Hardcoded secrets

Format (in Persian, فارسی):

## آسیب‌پذیری‌های یافت‌شده
| شدت | نوع | خط | توضیح | راه‌حل |
|------|------|-----|--------|--------|
| Critical/High/Medium/Low | ... | ... | ... | ... |

## نکات امنیتی مثبت
(what was done well)

## توصیه‌های عمومی
(bullet list)

Code:
\`\`\`${doc.languageId}
${truncate(code, MAX_FILE_CHARS)}
\`\`\``;
            },
            'security-audit.md'
        );
    }

    public dispose(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }
}
