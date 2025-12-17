import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getNonce } from '../utils';
import { getSidebarHtml } from './html';

/**
 * 侧边栏 Webview 提供者，用于可视化编辑 .mcdev.json
 */
export class McDevToolsSidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _fileWatcher?: vscode.FileSystemWatcher;
    
    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView, 
        _context: vscode.WebviewViewResolveContext, 
        _token: vscode.CancellationToken
    ): void {
        try {
            console.log('McDevToolsSidebarProvider.resolveWebviewView called');
            this._view = webviewView;
            const webview = webviewView.webview;

            webview.options = {
                enableScripts: true,
                localResourceRoots: [this._extensionUri]
            };

            webviewView.webview.html = this.getHtmlForWebview(webview);

            // 立即通知前端已注册
            try { 
                webview.postMessage({ type: 'providerRegistered' }); 
            } catch (e) { 
                console.error('postMessage(providerRegistered) failed', e); 
            }

            this.setupMessageHandler(webview);
            this.setupFileWatcher(webview);

            // Clean up watcher when view is disposed
            webviewView.onDidDispose(() => {
                if (this._fileWatcher) {
                    this._fileWatcher.dispose();
                }
            });
        } catch (err) {
            console.error('resolveWebviewView top-level error', err);
        }
    }

    /**
     * 设置消息处理器
     */
    private setupMessageHandler(webview: vscode.Webview): void {
        webview.onDidReceiveMessage(async (msg) => {
            if (msg?.type === 'ready') {
                await this.handleReady(webview);
            } else if (msg?.type === 'save') {
                await this.handleSave(msg.content);
            } else if (msg?.type === 'browseFolder') {
                await this.handleBrowseFolder(webview, msg.index);
            } else if (msg?.type === 'runGame') {
                await vscode.commands.executeCommand('mcdev-tools.runGame');
            }
        });
    }

    /**
     * 处理 ready 消息
     */
    private async handleReady(webview: vscode.Webview): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            webview.postMessage({ type: 'init', content: '{}' });
            return;
        }

        const mcdevPath = path.join(workspaceFolder.uri.fsPath, '.mcdev.json');
        try {
            if (fs.existsSync(mcdevPath)) {
                const content = fs.readFileSync(mcdevPath, 'utf8');
                webview.postMessage({ type: 'init', content });
            } else {
                webview.postMessage({ type: 'init', content: '{}' });
            }
        } catch (e) {
            webview.postMessage({ type: 'init', content: '{}', error: String(e) });
        }
    }

    /**
     * 处理 save 消息
     */
    private async handleSave(content: string): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('请先打开工作区以保存 .mcdev.json');
            return;
        }
        const mcdevPath = path.join(workspaceFolder.uri.fsPath, '.mcdev.json');
        try {
            fs.writeFileSync(mcdevPath, content, 'utf8');
            vscode.window.showInformationMessage('.mcdev.json 已保存');
        } catch (e) {
            vscode.window.showErrorMessage(`保存 .mcdev.json 失败: ${e}`);
        }
    }

    /**
     * 处理 browseFolder 消息
     */
    private async handleBrowseFolder(webview: vscode.Webview, index: number): Promise<void> {
        const result = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: '选择 MOD 目录',
            title: '选择 MOD 目录'
        });
        if (result && result.length > 0) {
            webview.postMessage({ 
                type: 'folderSelected', 
                index: index,
                path: result[0].fsPath 
            });
        }
    }

    /**
     * 设置文件监听器，当 .mcdev.json 被外部修改时自动重载
     */
    private setupFileWatcher(webview: vscode.Webview): void {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        const mcdevPath = path.join(workspaceFolder.uri.fsPath, '.mcdev.json');
        const pattern = new vscode.RelativePattern(workspaceFolder, '.mcdev.json');
        
        this._fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        // 监听文件变化
        this._fileWatcher.onDidChange(async () => {
            try {
                if (fs.existsSync(mcdevPath)) {
                    const content = fs.readFileSync(mcdevPath, 'utf8');
                    webview.postMessage({ type: 'init', content });
                }
            } catch (e) {
                console.error('Error reading .mcdev.json after external change:', e);
            }
        });

        // 监听文件创建
        this._fileWatcher.onDidCreate(async () => {
            try {
                if (fs.existsSync(mcdevPath)) {
                    const content = fs.readFileSync(mcdevPath, 'utf8');
                    webview.postMessage({ type: 'init', content });
                }
            } catch (e) {
                console.error('Error reading .mcdev.json after creation:', e);
            }
        });

        // 监听文件删除
        this._fileWatcher.onDidDelete(() => {
            webview.postMessage({ type: 'init', content: '{}' });
        });
    }

    /**
     * 获取 Webview HTML
     */
    public getHtmlForWebview(_webview: vscode.Webview): string {
        const nonce = getNonce();
        // Get VS Code language setting
        const vscodeLanguage = vscode.env.language;
        return getSidebarHtml(nonce, vscodeLanguage);
    }
}
