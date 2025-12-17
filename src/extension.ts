import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { isMinecraftAddonWorkspace } from './utils';
import { McDevToolsSidebarProvider } from './sidebar';
import { 
    McDevToolsDebugConfigurationProvider, 
    getActiveDebugSessions, 
    cleanupAllSessions
} from './debugger';

let extensionContext: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext): void {
    console.log('Minecraft ModPC Debug 插件已激活');
    extensionContext = context;

    // 根据用户设置或项目结构决定是否启用插件功能
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const config = vscode.workspace.getConfiguration('mcdev-tools');
    const userEnabled = config.get<boolean>('enable', false);
    const isAddon = workspaceFolder ? isMinecraftAddonWorkspace(workspaceFolder) : false;
    const pluginEnabled = userEnabled || isAddon;

    // 设置上下文
    vscode.commands.executeCommand('setContext', 'mcdev-tools:enabled', pluginEnabled);
    vscode.commands.executeCommand('setContext', 'mcdev-tools:showSidebar', pluginEnabled);

    // 只有启用时才注册侧边栏提供器
    if (pluginEnabled) {
        const sidebarProvider = new McDevToolsSidebarProvider(context.extensionUri);
        const sidebarDisp = vscode.window.registerWebviewViewProvider('mcdev-tools.sidebar', sidebarProvider);
        context.subscriptions.push(sidebarDisp);
        console.log('McDevToolsSidebarProvider 已注册');
    }

    // 注册命令
    registerCommands(context);
    
    // 注册调试配置提供者
    registerDebugProviders(context);
    
    // 监听调试会话结束事件
    registerDebugSessionListener(context);
}

/**
 * 注册所有命令
 */
function registerCommands(context: vscode.ExtensionContext): void {
    // 启动调试命令
    const startDebugCmd = vscode.commands.registerCommand('mcdev-tools.startDebug', async () => {
        await startDebugSession();
    });

    // 侧边栏面板回退命令
    const panelCmd = vscode.commands.registerCommand('mcdev-tools.showSidebarPanel', async () => {
        await showSidebarPanel(context);
    });

    // 运行游戏命令 (Ctrl+F5)
    const runCmd = vscode.commands.registerCommand('mcdev-tools.runGame', async () => {
        await runMcdk();
    });

    context.subscriptions.push(startDebugCmd, panelCmd, runCmd);
}

/**
 * 注册调试配置提供者
 */
function registerDebugProviders(context: vscode.ExtensionContext): void {
    const debugProvider = new McDevToolsDebugConfigurationProvider(context.extensionPath);
    
    const debugProviderDisposable = vscode.debug.registerDebugConfigurationProvider(
        'mcdev-tools',
        debugProvider
    );

    // 注册动态调试配置提供者（用于 F5 无配置启动）
    const dynamicProvider = vscode.debug.registerDebugConfigurationProvider(
        'mcdev-tools',
        {
            provideDebugConfigurations(): vscode.ProviderResult<vscode.DebugConfiguration[]> {
                return [
                    {
                        type: 'mcdev-tools',
                        request: 'launch',
                        name: 'MC Dev Tools Debug',
                        dapConfig: {
                            justMyCode: false
                        }
                    }
                ];
            }
        },
        vscode.DebugConfigurationProviderTriggerKind.Dynamic
    );

    context.subscriptions.push(debugProviderDisposable, dynamicProvider);
}

/**
 * 注册调试会话监听器
 */
function registerDebugSessionListener(context: vscode.ExtensionContext): void {
    const debugEndDisposable = vscode.debug.onDidTerminateDebugSession((session) => {
        const activeDebugSessions = getActiveDebugSessions();
        for (const [pid, info] of activeDebugSessions.entries()) {
            if (session.name === info.sessionName) {
                if (info.mcdbgProcess) {
                    info.mcdbgProcess.kill();
                }
                activeDebugSessions.delete(pid);
                vscode.window.showInformationMessage(`调试会话已结束 (PID: ${pid})`);
                break;
            }
        }
    });

    context.subscriptions.push(debugEndDisposable);
}

/**
 * 启动调试会话
 */
async function startDebugSession(): Promise<void> {
    const config = vscode.workspace.getConfiguration('mcdev-tools');
    const debugConfig: vscode.DebugConfiguration = {
        type: 'mcdev-tools',
        request: 'launch',
        name: 'MC Dev Tools Debug',
        port: config.get<number>('port', 5678),
        timeout: config.get<number>('timeout', 30000),
        mcdbgPath: config.get<string>('mcdbgPath', '')
    };
    
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
        await vscode.debug.startDebugging(workspaceFolder, debugConfig);
    } else {
        vscode.window.showErrorMessage('请先打开工作区');
    }
}

/**
 * 显示侧边栏面板（回退方案）
 */
async function showSidebarPanel(context: vscode.ExtensionContext): Promise<void> {
    const wf = vscode.workspace.workspaceFolders?.[0];
    const panel = vscode.window.createWebviewPanel(
        'mcdevSidebarPanel', 
        'Minecraft (.mcdev.json)', 
        vscode.ViewColumn.One, 
        { enableScripts: true }
    );
    
    const provider = new McDevToolsSidebarProvider(context.extensionUri);
    panel.webview.html = provider.getHtmlForWebview(panel.webview);

    panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg?.type === 'ready') {
            if (!wf) {
                panel.webview.postMessage({ type: 'init', content: '{}' });
                return;
            }
            const mcdevPath = path.join(wf.uri.fsPath, '.mcdev.json');
            try {
                if (fs.existsSync(mcdevPath)) {
                    const content = fs.readFileSync(mcdevPath, 'utf8');
                    panel.webview.postMessage({ type: 'init', content });
                } else {
                    panel.webview.postMessage({ type: 'init', content: '{}' });
                }
            } catch {
                panel.webview.postMessage({ type: 'init', content: '{}' });
            }
        } else if (msg?.type === 'save') {
            if (!wf) {
                vscode.window.showErrorMessage('请先打开工作区以保存 .mcdev.json');
                return;
            }
            const mcdevPath = path.join(wf.uri.fsPath, '.mcdev.json');
            try {
                fs.writeFileSync(mcdevPath, msg.content, 'utf8');
                vscode.window.showInformationMessage('.mcdev.json 已保存');
            } catch (e) {
                vscode.window.showErrorMessage(`保存 .mcdev.json 失败: ${e}`);
            }
        } else if (msg?.type === 'browseFolder') {
            const result = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: '选择 MOD 目录',
                title: '选择 MOD 目录'
            });
            if (result && result.length > 0) {
                panel.webview.postMessage({ 
                    type: 'folderSelected', 
                    index: msg.index,
                    path: result[0].fsPath 
                });
            }
        }
    }, undefined, context.subscriptions);
}

/**
 * 运行 mcdk.exe（无调试模式）
 */
async function runMcdk(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('请先打开工作区');
        return;
    }

    const config = vscode.workspace.getConfiguration('mcdev-tools');
    const mcdkPathConfig = config.get<string>('mcdkPath', '');

    const mcdkPath = mcdkPathConfig
        ? (path.isAbsolute(mcdkPathConfig)
            ? mcdkPathConfig
            : path.join(workspaceFolder.uri.fsPath, mcdkPathConfig))
        : path.join(extensionContext.extensionPath, 'bin', 'mcdk.exe');

    if (!fs.existsSync(mcdkPath)) {
        vscode.window.showErrorMessage(`找不到 mcdk.exe: ${mcdkPath}`);
        return;
    }

    // 创建 VS Code 终端
    const terminal = vscode.window.createTerminal({
        name: 'Minecraft ModPC (mcdk)',
        cwd: workspaceFolder.uri.fsPath
    });

    terminal.show(true);
    terminal.sendText(`cmd /c "${mcdkPath}"`, true);
}

export function deactivate(): void {
    cleanupAllSessions();
    vscode.commands.executeCommand('setContext', 'mcdev-tools:enabled', false);
    vscode.commands.executeCommand('setContext', 'mcdev-tools:showSidebar', false);
}
