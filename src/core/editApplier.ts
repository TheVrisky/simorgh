/* ============================================================
 *  AI Assistant - Edit Applier (Phase 5-A: Apply Diff Inline)
 *  Applies AI-generated code to files with a diff-preview + confirm.
 *  Supports: append to active file, replace selection, new file.
 * ============================================================ */

import * as vscode from 'vscode';
import { errorToString } from './helpers';
import { Logger } from './logger';

export type ApplyMode = 'replaceFile' | 'replaceSelection' | 'insertAtCursor' | 'newFile';

export class EditApplier {
    constructor(private readonly logger: Logger) {}

    /**
     * Applies the given code according to `mode`, showing a diff preview first.
     * Returns true if applied.
     */
    public async apply(code: string, mode: ApplyMode, fileNameHint?: string): Promise<boolean> {
        if (!code || !code.trim()) {
            vscode.window.showWarningMessage('کدی برای اعمال وجود ندارد.');
            return false;
        }

        switch (mode) {
            case 'replaceFile':
                return this.replaceWholeFile(code);
            case 'replaceSelection':
                return this.replaceSelection(code);
            case 'insertAtCursor':
                return this.insertAtCursor(code);
            case 'newFile':
                return this.createNewFile(code, fileNameHint);
            default:
                return false;
        }
    }

    private async replaceWholeFile(code: string): Promise<boolean> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('فایلی در ادیتور باز نیست.');
            return false;
        }
        const doc = editor.document;
        const original = doc.getText();
        const preview = await this.showPreview(doc.uri, original, code, 'جایگزینی کل فایل');
        if (!preview) { return false; }

        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(original.length));
        const edit = new vscode.WorkspaceEdit();
        edit.replace(doc.uri, fullRange, code);
        const ok = await vscode.workspace.applyEdit(edit);
        if (ok) { vscode.window.showInformationMessage('کد با موفقیت جایگزین شد.'); }
        return ok;
    }

    private async replaceSelection(code: string): Promise<boolean> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) {
            vscode.window.showErrorMessage('هیچ متنی انتخاب نشده است.');
            return false;
        }
        const doc = editor.document;
        const selected = doc.getText(editor.selection);
        const preview = await this.showPreview(doc.uri, selected, code, 'جایگزینی انتخاب');
        if (!preview) { return false; }

        const edit = new vscode.WorkspaceEdit();
        edit.replace(doc.uri, editor.selection, code);
        const ok = await vscode.workspace.applyEdit(edit);
        if (ok) { vscode.window.showInformationMessage('انتخاب با موفقیت جایگزین شد.'); }
        return ok;
    }

    private async insertAtCursor(code: string): Promise<boolean> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('فایلی در ادیتور باز نیست.');
            return false;
        }
        const doc = editor.document;
        const position = editor.selection.active;
        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, position, code);
        const ok = await vscode.workspace.applyEdit(edit);
        if (ok) { vscode.window.showInformationMessage('کد در محل نشانگر درج شد.'); }
        return ok;
    }

    private async createNewFile(code: string, fileNameHint?: string): Promise<boolean> {
        const name = await vscode.window.showInputBox({
            prompt: 'نام و مسیر فایل جدید را وارد کنید',
            value: fileNameHint || 'ai-generated.txt',
            ignoreFocusOut: true
        });
        if (!name) { return false; }

        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            vscode.window.showErrorMessage('ورک‌اسپیس باز نیست.');
            return false;
        }
        const uri = vscode.Uri.joinPath(folders[0].uri, name);
        try {
            const exists = await vscode.workspace.fs.stat(uri).then(() => true, () => false);
            if (exists) {
                const overwrite = await vscode.window.showWarningMessage(
                    'فایل از قبل وجود دارد. بازنویسی شود؟', { modal: true }, 'بله', 'انصراف'
                );
                if (overwrite !== 'بله') { return false; }
            }
            await vscode.workspace.fs.writeFile(uri, Buffer.from(code, 'utf8'));
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: false });
            vscode.window.showInformationMessage(`فایل ${name} ساخته شد.`);
            return true;
        } catch (err) {
            this.logger.error('createNewFile', err);
            vscode.window.showErrorMessage(`خطا در ساخت فایل: ${errorToString(err)}`);
            return false;
        }
    }

    /** Shows a diff between the original and new content in a modal-ish editor, then asks for confirmation. */
    private async showPreview(uri: vscode.Uri, original: string, updated: string, title: string): Promise<boolean> {
        const scheme = 'ai-assistant-preview';
        const previewUri = uri.with({ scheme, path: uri.path + '.preview' });
        const provider: vscode.TextDocumentContentProvider = {
            provideTextDocumentContent: () => updated
        };
        const reg = vscode.workspace.registerTextDocumentContentProvider(scheme, provider);
        try {
            await vscode.commands.executeCommand(
                'vscode.diff',
                uri,
                previewUri,
                `${title} — پیش‌نمایش تغییرات`
            );
            const choice = await vscode.window.showInformationMessage(
                `آیا تغییرات «${title}» اعمال شود؟`,
                { modal: true },
                'اعمال کن',
                'انصراف'
            );
            return choice === 'اعمال کن';
        } catch (err) {
            this.logger.error('showPreview', err);
            return false;
        } finally {
            reg.dispose();
        }
    }
}
