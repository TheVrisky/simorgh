/* ============================================================
 *  Gemini Assistant - Logger (OutputChannel)
 * ============================================================ */

import * as vscode from 'vscode';

export class Logger {
    private channel: vscode.OutputChannel;

    constructor(name: string) {
        this.channel = vscode.window.createOutputChannel(name);
    }

    public log(message: string): void {
        const line = `[${new Date().toISOString()}] ${message}`;
        this.channel.appendLine(line);
    }

    public error(message: string, err?: unknown): void {
        const errStr = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? '');
        this.channel.appendLine(`[${new Date().toISOString()}] ERROR: ${message}${errStr ? ' | ' + errStr : ''}`);
    }

    public show(): void {
        this.channel.show(true);
    }

    public dispose(): void {
        this.channel.dispose();
    }
}
