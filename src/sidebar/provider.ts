import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as jsonc from 'jsonc-parser';
import { getNonce } from '../utils';

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

            const roots: vscode.Uri[] = [this._extensionUri];
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                roots.push(workspaceFolder.uri);

                // 允许预览与工作区同一磁盘根目录下的本地图片
                try {
                    const parsed = path.parse(workspaceFolder.uri.fsPath);
                    if (parsed.root) {
                        roots.push(vscode.Uri.file(parsed.root));
                    }
                } catch {
                    // ignore
                }
            }

            webview.options = {
                enableScripts: true,
                localResourceRoots: roots
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
            } else if (msg?.type === 'browseSkin') {
                await this.handleBrowseSkin(webview);
            } else if (msg?.type === 'updateSkinPreview') {
                await this.handleUpdateSkinPreview(webview, msg.path);
            } else if (msg?.type === 'runGame') {
                await vscode.commands.executeCommand('mcdev-tools.runGame');
            } else if (msg?.type === 'startDebug') {
                await vscode.commands.executeCommand('mcdev-tools.startDebug');
            } else if (msg?.type === 'browseGameExecutable') {
                await this.handleBrowseGameExecutable(webview, msg.currentPath);
            } else if (msg?.type === 'log') {
                const prefix = `[Webview ${msg.level || 'log'}]`;
                if (msg.level === 'error') {
                    console.error(prefix, ...msg.args);
                } else if (msg.level === 'warn') {
                    console.warn(prefix, ...msg.args);
                } else {
                    console.log(prefix, ...msg.args);
                }
            }
        });
    }

    /**
     * 处理 ready 消息
     */
    private async handleReady(webview: vscode.Webview): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const language = vscode.env.language; // 获取 VS Code 语言设置
        
        if (!workspaceFolder) {
            webview.postMessage({ type: 'init', content: '{}', language });
            return;
        }

        const mcdevPath = path.join(workspaceFolder.uri.fsPath, '.mcdev.json');
        try {
            if (fs.existsSync(mcdevPath)) {
                const content = fs.readFileSync(mcdevPath, 'utf8');
                const parsed = jsonc.parse(content) || {};
                const jsonContent = JSON.stringify(parsed);

                let skinPreviewUri: string | undefined;
                const skinPath = parsed?.skin_info?.skin as string | undefined;
                if (skinPath && skinPath.trim()) {
                    let filePath = skinPath;
                    if (!path.isAbsolute(filePath)) {
                        filePath = path.join(workspaceFolder.uri.fsPath, filePath);
                    }
                    const fileUri = vscode.Uri.file(filePath);
                    skinPreviewUri = webview.asWebviewUri(fileUri).toString();
                }

                webview.postMessage({ type: 'init', content: jsonContent, language, skinPreviewUri });
            } else {
                // 文件不存在时，发送空配置并标记需要初始化
                webview.postMessage({ type: 'init', content: '{}', needsInitialSave: true, language });
            }
        } catch (e) {
            webview.postMessage({ type: 'init', content: '{}', error: String(e), language });
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
     * 处理皮肤文件选择
     */
    private async handleBrowseSkin(webview: vscode.Webview): Promise<void> {
        const result = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: '选择皮肤 PNG 文件',
            title: '选择皮肤 PNG 文件',
            filters: {
                'PNG Images': ['png'],
                'All Files': ['*']
            }
        });

        if (result && result.length > 0) {
            const fileUri = result[0];
            const webviewUri = webview.asWebviewUri(fileUri);

            webview.postMessage({
                type: 'skinSelected',
                path: fileUri.fsPath,
                previewUri: webviewUri.toString()
            });
        }
    }

    /**
     * 根据给定路径更新皮肤预览（不修改配置文件）
     */
    private async handleUpdateSkinPreview(webview: vscode.Webview, skinPath: string | undefined): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        if (!skinPath || !skinPath.trim()) {
            webview.postMessage({ type: 'skinPreview', previewUri: undefined });
            return;
        }

        try {
            let filePath = skinPath;
            if (!path.isAbsolute(filePath)) {
                filePath = path.join(workspaceFolder.uri.fsPath, filePath);
            }
            const fileUri = vscode.Uri.file(filePath);
            const webviewUri = webview.asWebviewUri(fileUri);
            webview.postMessage({ type: 'skinPreview', previewUri: webviewUri.toString() });
        } catch (e) {
            console.error('Failed to build skin preview URI:', e);
            webview.postMessage({ type: 'skinPreview', previewUri: undefined });
        }
    }

    /**
     * 处理浏览游戏可执行文件路径
     */
    private async handleBrowseGameExecutable(webview: vscode.Webview, currentPath?: string): Promise<void> {
        let defaultUri: vscode.Uri | undefined;
        if (currentPath && currentPath.trim()) {
            try {
                const parentDir = path.dirname(currentPath.trim());
                if (parentDir && fs.existsSync(parentDir)) {
                    defaultUri = vscode.Uri.file(parentDir);
                }
            } catch {
                // ignore invalid path
            }
        }

        const result = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri,
            openLabel: '选择 Minecraft 可执行文件',
            title: '选择 Minecraft.Windows.exe',
            filters: {
                'Executable': ['exe'],
                'All Files': ['*']
            }
        });

        if (result && result.length > 0) {
            webview.postMessage({
                type: 'gameExecutableSelected',
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
                    const parsed = jsonc.parse(content) || {};
                    const jsonContent = JSON.stringify(parsed);

                    let skinPreviewUri: string | undefined;
                    const skinPath = parsed?.skin_info?.skin as string | undefined;
                    if (skinPath && skinPath.trim()) {
                        let filePath = skinPath;
                        if (!path.isAbsolute(filePath)) {
                            filePath = path.join(workspaceFolder.uri.fsPath, filePath);
                        }
                        const fileUri = vscode.Uri.file(filePath);
                        skinPreviewUri = webview.asWebviewUri(fileUri).toString();
                    }

                    webview.postMessage({ type: 'init', content: jsonContent, skinPreviewUri });
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
                    const parsed = jsonc.parse(content) || {};
                    const jsonContent = JSON.stringify(parsed);

                    let skinPreviewUri: string | undefined;
                    const skinPath = parsed?.skin_info?.skin as string | undefined;
                    if (skinPath && skinPath.trim()) {
                        let filePath = skinPath;
                        if (!path.isAbsolute(filePath)) {
                            filePath = path.join(workspaceFolder.uri.fsPath, filePath);
                        }
                        const fileUri = vscode.Uri.file(filePath);
                        skinPreviewUri = webview.asWebviewUri(fileUri).toString();
                    }

                    webview.postMessage({ type: 'init', content: jsonContent, skinPreviewUri });
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
    public getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = getNonce();
        const vscodeLanguage = vscode.env.language;
        const lang = (vscodeLanguage && vscodeLanguage.startsWith('zh')) ? 'zh' : 'en';

        // Get URIs for built webview assets
        const webviewPath = vscode.Uri.joinPath(this._extensionUri, 'out', 'webview');
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewPath, 'sidebar.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewPath, 'sidebar.css'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewPath, 'codicons', 'codicon.css'));

        return `<!doctype html>
<html lang="${lang}">
<head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MC Dev Tools</title>
    <link href="${codiconsUri}" rel="stylesheet" />
    <link href="${styleUri}" rel="stylesheet" />
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
