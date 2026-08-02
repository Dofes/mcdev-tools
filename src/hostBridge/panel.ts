import * as vscode from 'vscode';
import * as path from 'path';
import {
    buildDebugFunctionInvocation,
    DebugFunctionService,
    validateSavedFunction
} from '../debugFunctions';
import { getNonce } from '../utils';
import { HostBridgeManager } from './manager';
import { HostBridgeRpcError } from './server';
import { DisposableLike } from './types';

export class GameDebuggerPanel implements vscode.Disposable {
    private panel?: vscode.WebviewPanel;
    private bridgeSubscription?: DisposableLike;
    private messageSubscription?: vscode.Disposable;
    private panelDisposeSubscription?: vscode.Disposable;
    private debugFunctionService?: DebugFunctionService;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly hostBridgeManager: HostBridgeManager
    ) {}

    public show(): void {
        if (this.panel) {
            this.panel.reveal(this.panel.viewColumn, false);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'mcdev-tools.gameDebugger',
            'MC Dev Tools - 游戏调试',
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                enableFindWidget: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this.extensionUri]
            }
        );
        this.panel = panel;
        panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'images', 'icon.png');
        panel.webview.html = this.getHtml(panel.webview);

        this.messageSubscription = panel.webview.onDidReceiveMessage(message => {
            void this.handleMessage(panel.webview, message);
        });
        this.bridgeSubscription = this.hostBridgeManager.onDidChange(snapshot => {
            void panel.webview.postMessage({ type: 'hostBridgeState', snapshot });
        });
        this.panelDisposeSubscription = panel.onDidDispose(() => this.releasePanel());
    }

    public dispose(): void {
        const panel = this.panel;
        this.releasePanel();
        panel?.dispose();
    }

    private releasePanel(): void {
        this.messageSubscription?.dispose();
        this.messageSubscription = undefined;
        this.bridgeSubscription?.dispose();
        this.bridgeSubscription = undefined;
        this.panelDisposeSubscription?.dispose();
        this.panelDisposeSubscription = undefined;
        this.debugFunctionService?.dispose();
        this.debugFunctionService = undefined;
        this.panel = undefined;
    }

    private async handleMessage(webview: vscode.Webview, message: any): Promise<void> {
        if (message?.type === 'ready') {
            await this.postState(webview);
            return;
        }
        if (message?.type === 'hostBridgeRefresh') {
            await this.hostBridgeManager.refreshSessions();
            await this.postState(webview);
            return;
        }
        if (typeof message?.type === 'string' && message.type.startsWith('debugFunction')) {
            await this.handleDebugFunctionMessage(webview, message);
            return;
        }
        if (message?.type !== 'hostBridgeExecute') {
            return;
        }

        const requestId = typeof message.requestId === 'string' && message.requestId.length <= 128
            ? message.requestId
            : '';
        const sessionId = typeof message.sessionId === 'string' && message.sessionId.length <= 128
            ? message.sessionId
            : '';
        const code = typeof message.code === 'string' ? message.code : '';
        const isClient = message.isClient !== false;
        if (!requestId || !sessionId) {
            return;
        }

        try {
            const result = await this.hostBridgeManager.executeCode(sessionId, code, isClient);
            await webview.postMessage({
                type: 'hostBridgeExecutionResult',
                requestId,
                sessionId,
                isClient,
                ok: true,
                result
            });
        } catch (error) {
            const rpcError = error instanceof HostBridgeRpcError ? error : undefined;
            await webview.postMessage({
                type: 'hostBridgeExecutionResult',
                requestId,
                sessionId,
                isClient,
                ok: false,
                error: {
                    code: rpcError?.symbolicCode,
                    rpcCode: rpcError?.rpcCode,
                    message: error instanceof Error ? error.message : String(error)
                }
            });
        }
    }

    private async handleDebugFunctionMessage(webview: vscode.Webview, message: any): Promise<void> {
        const requestId = typeof message.requestId === 'string' && message.requestId.length <= 128
            ? message.requestId
            : '';
        const sessionId = typeof message.sessionId === 'string' && message.sessionId.length <= 128
            ? message.sessionId
            : '';
        if (!requestId) {
            return;
        }
        const workspacePath = this.resolveWorkspacePath(sessionId);
        if (!workspacePath) {
            await this.postDebugFunctionError(webview, requestId, message.type, 'No project is available');
            return;
        }
        const service = this.debugFunctionService ??= new DebugFunctionService();

        try {
            switch (message.type) {
                case 'debugFunctionsLoad': {
                    const functions = await service.load(workspacePath);
                    await webview.postMessage({
                        type: 'debugFunctionsState', requestId, workspacePath, functions
                    });
                    return;
                }
                case 'debugFunctionsDiscover': {
                    const functions = await service.discover(workspacePath, message.force === true);
                    await webview.postMessage({
                        type: 'debugFunctionsDiscovered', requestId, workspacePath, functions
                    });
                    return;
                }
                case 'debugFunctionSave': {
                    const functions = await service.save(workspacePath, message.function);
                    await webview.postMessage({
                        type: 'debugFunctionsState', requestId, workspacePath, functions, saved: true
                    });
                    return;
                }
                case 'debugFunctionDelete': {
                    const id = typeof message.id === 'string' ? message.id : '';
                    const functions = await service.delete(workspacePath, id);
                    await webview.postMessage({
                        type: 'debugFunctionsState', requestId, workspacePath, functions, deletedId: id
                    });
                    return;
                }
                case 'debugFunctionExecute': {
                    if (!sessionId) {
                        throw new Error('Select a game session before running the function');
                    }
                    const saved = validateSavedFunction(message.function);
                    const runtimeArguments = isStringRecord(message.runtimeArguments)
                        ? message.runtimeArguments
                        : {};
                    const code = buildDebugFunctionInvocation(saved, runtimeArguments);
                    const result = await this.hostBridgeManager.executeCode(
                        sessionId,
                        code,
                        saved.target === 'client'
                    );
                    await webview.postMessage({
                        type: 'debugFunctionExecutionResult',
                        requestId,
                        sessionId,
                        functionId: saved.id,
                        ok: true,
                        result
                    });
                    return;
                }
                case 'debugFunctionOpenSource': {
                    await this.openDebugFunctionSource(
                        workspacePath,
                        typeof message.relativeFilePath === 'string' ? message.relativeFilePath : '',
                        Number.isInteger(message.line) ? Number(message.line) : 1
                    );
                    await webview.postMessage({ type: 'debugFunctionSourceOpened', requestId });
                    return;
                }
            }
        } catch (error) {
            if (message.type === 'debugFunctionExecute') {
                const rpcError = error instanceof HostBridgeRpcError ? error : undefined;
                await webview.postMessage({
                    type: 'debugFunctionExecutionResult',
                    requestId,
                    sessionId,
                    functionId: typeof message.function?.id === 'string' ? message.function.id : '',
                    ok: false,
                    error: {
                        code: rpcError?.symbolicCode,
                        rpcCode: rpcError?.rpcCode,
                        message: error instanceof Error ? error.message : String(error)
                    }
                });
                return;
            }
            await this.postDebugFunctionError(
                webview,
                requestId,
                message.type,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    private resolveWorkspacePath(sessionId: string): string | undefined {
        if (sessionId) {
            const session = this.hostBridgeManager.getSnapshot().sessions.find(item => item.id === sessionId);
            if (session?.projectRoot) {
                return path.resolve(session.projectRoot);
            }
        }
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    private async openDebugFunctionSource(
        workspacePath: string,
        relativeFilePath: string,
        line: number
    ): Promise<void> {
        const root = path.resolve(workspacePath);
        const target = path.resolve(root, relativeFilePath);
        const relative = path.relative(root, target);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error('Source file is outside the project');
        }
        const document = await vscode.workspace.openTextDocument(target);
        const editor = await vscode.window.showTextDocument(document, { preview: true });
        const position = new vscode.Position(Math.max(0, line - 1), 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    private async postDebugFunctionError(
        webview: vscode.Webview,
        requestId: string,
        action: string,
        message: string
    ): Promise<void> {
        await webview.postMessage({
            type: 'debugFunctionsError', requestId, action, message
        });
    }

    private async postState(webview: vscode.Webview): Promise<void> {
        await webview.postMessage({
            type: 'hostBridgeState',
            snapshot: this.hostBridgeManager.getSnapshot()
        });
    }

    private getHtml(webview: vscode.Webview): string {
        const nonce = getNonce();
        const language = vscode.env.language.startsWith('zh') ? 'zh' : 'en';
        const webviewPath = vscode.Uri.joinPath(this.extensionUri, 'out', 'webview');
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewPath, 'sidebar.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewPath, 'sidebar.css'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewPath, 'codicons', 'codicon.css'));

        return `<!doctype html>
<html lang="${language}">
<head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MC Dev Tools - Game Debugger</title>
    <link href="${codiconsUri}" rel="stylesheet" />
    <link href="${styleUri}" rel="stylesheet" />
</head>
<body data-view="game-debugger">
    <div id="root"></div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function isStringRecord(value: unknown): value is Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    return Object.values(value).every(item => typeof item === 'string' && item.length <= 64 * 1024);
}
