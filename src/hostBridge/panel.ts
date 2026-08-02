import * as vscode from 'vscode';
import { getNonce } from '../utils';
import { HostBridgeManager } from './manager';
import { HostBridgeRpcError } from './server';
import { DisposableLike } from './types';

export class GameDebuggerPanel implements vscode.Disposable {
    private panel?: vscode.WebviewPanel;
    private bridgeSubscription?: DisposableLike;
    private messageSubscription?: vscode.Disposable;
    private panelDisposeSubscription?: vscode.Disposable;

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

