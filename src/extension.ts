import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { McDevToolsSidebarProvider } from './sidebar';
import { dynamicLibraryManager } from './native/dynamicLibraryManager';
import { McdevProjectRegistry } from './projectRegistry';
import { PythonFunctionRunner } from './pythonFunctionRunner';
import {
    getGameExecutablePaths,
    isGameExecutableDiscoverySupported
} from './native/gameDiscovery';
import { 
    McDevToolsDebugConfigurationProvider,
    McdbgDebugConfigurationProvider,
    ptvsd
} from './debugger';

let extensionContext: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext): void {
    console.log('Minecraft ModPC Debug 插件已激活');
    extensionContext = context;

    const projects = new McdevProjectRegistry();
    const pythonFunctionRunner = new PythonFunctionRunner(projects);
    context.subscriptions.push(projects, pythonFunctionRunner);

    let sidebarDisposable: vscode.Disposable | undefined;
    let debugFeaturesDisposable: vscode.Disposable | undefined;
    let debugStorageInitialized = false;
    const refreshProjectFeatures = (): void => {
        const pluginEnabled = projects.hasProjects;
        void vscode.commands.executeCommand('setContext', 'mcdev-tools:enabled', pluginEnabled);
        void vscode.commands.executeCommand('setContext', 'mcdev-tools:showSidebar', pluginEnabled);

        if (pluginEnabled && !sidebarDisposable) {
            const sidebarProvider = new McDevToolsSidebarProvider(context.extensionUri);
            sidebarDisposable = vscode.window.registerWebviewViewProvider(
                'mcdev-tools.sidebar',
                sidebarProvider
            );
            console.log('McDevToolsSidebarProvider 已注册');
        } else if (!pluginEnabled && sidebarDisposable) {
            sidebarDisposable.dispose();
            sidebarDisposable = undefined;
        }

        if (pluginEnabled && !debugFeaturesDisposable) {
            if (!debugStorageInitialized) {
                ptvsd.initStorage(context);
                debugStorageInitialized = true;
            }
            debugFeaturesDisposable = vscode.Disposable.from(
                registerDebugProviders(context),
                registerDebugSessionListener()
            );
        } else if (!pluginEnabled && debugFeaturesDisposable) {
            debugFeaturesDisposable.dispose();
            debugFeaturesDisposable = undefined;
        }
    };

    refreshProjectFeatures();
    context.subscriptions.push(
        projects.onDidChange(refreshProjectFeatures),
        {
            dispose: () => {
                sidebarDisposable?.dispose();
                debugFeaturesDisposable?.dispose();
            }
        }
    );

    // 注册命令
    registerCommands(context, projects);
}

/**
 * 注册所有命令
 */
function registerCommands(
    context: vscode.ExtensionContext,
    projects: McdevProjectRegistry
): void {
    // 启动调试命令
    const startDebugCmd = vscode.commands.registerCommand('mcdev-tools.startDebug', async () => {
        await startDebugSession(projects);
    });

    // 侧边栏面板回退命令
    const panelCmd = vscode.commands.registerCommand('mcdev-tools.showSidebarPanel', async () => {
        await showSidebarPanel(context, projects);
    });

    // 运行游戏命令 (Ctrl+F5)
    const runCmd = vscode.commands.registerCommand('mcdev-tools.runGame', async () => {
        await runMcdk(projects);
    });

    context.subscriptions.push(startDebugCmd, panelCmd, runCmd);
}

/**
 * 注册调试配置提供者
 */
function registerDebugProviders(context: vscode.ExtensionContext): vscode.Disposable {
    // ptvsd 模式 provider（推荐）
    const ptvsdProvider = new McDevToolsDebugConfigurationProvider(context.extensionPath);
    const ptvsdProviderDisposable = vscode.debug.registerDebugConfigurationProvider(
        'mcdev-tools',
        ptvsdProvider
    );

    // mcdbg 注入模式 provider
    const mcdbgProvider = new McdbgDebugConfigurationProvider(context.extensionPath);
    const mcdbgProviderDisposable = vscode.debug.registerDebugConfigurationProvider(
        'mcdev-tools-inject',
        mcdbgProvider
    );

    // 注册动态调试配置提供者（用于 F5 无配置启动，默认使用 ptvsd）
    const dynamicProvider = vscode.debug.registerDebugConfigurationProvider(
        'mcdev-tools',
        {
            provideDebugConfigurations(): vscode.ProviderResult<vscode.DebugConfiguration[]> {
                return [
                    {
                        type: 'mcdev-tools',
                        request: 'launch',
                        name: 'Minecraft Python Debug',
                        dapConfig: {
                            justMyCode: false
                        }
                    }
                ];
            }
        },
        vscode.DebugConfigurationProviderTriggerKind.Dynamic
    );

    return vscode.Disposable.from(
        ptvsdProviderDisposable,
        mcdbgProviderDisposable,
        dynamicProvider
    );
}

/**
 * 注册调试会话监听器
 */
function registerDebugSessionListener(): vscode.Disposable {
    // 监听调试会话结束，清理 ptvsd 会话
    const debugEndDisposable = vscode.debug.onDidTerminateDebugSession((session) => {
        // ptvsd 会话会在进程退出时自动清理
        console.log(`调试会话结束: ${session.name}`);
    });

    return debugEndDisposable;
}

/**
 * 启动调试会话（从 GUI 按钮调用）
 * 总是启动新实例，不检查重新附加
 */
async function startDebugSession(projects: McdevProjectRegistry): Promise<void> {
    const workspaceFolder = projects.folders[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('当前工作区根目录没有 .mcdev.json');
        return;
    }

    // 使用 launchNewInstance 直接启动，不走 provider 的重新附加逻辑
    const config = await ptvsd.launchNewInstance(extensionContext.extensionPath);
    if (config) {
        await vscode.debug.startDebugging(workspaceFolder, config);
    }
}

/**
 * 显示侧边栏面板（回退方案）
 */
async function showSidebarPanel(
    context: vscode.ExtensionContext,
    projects: McdevProjectRegistry
): Promise<void> {
    const wf = projects.folders[0];
    if (!wf) {
        vscode.window.showErrorMessage('当前工作区根目录没有 .mcdev.json');
        return;
    }
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
                panel.webview.postMessage({
                    type: 'init',
                    content: '{}',
                    gameExecutableDiscoverySupported: isGameExecutableDiscoverySupported
                });
                return;
            }
            const mcdevPath = path.join(wf.uri.fsPath, '.mcdev.json');
            try {
                if (fs.existsSync(mcdevPath)) {
                    const content = fs.readFileSync(mcdevPath, 'utf8');
                    panel.webview.postMessage({
                        type: 'init',
                        content,
                        gameExecutableDiscoverySupported: isGameExecutableDiscoverySupported
                    });
                } else {
                    panel.webview.postMessage({
                        type: 'init',
                        content: '{}',
                        gameExecutableDiscoverySupported: isGameExecutableDiscoverySupported
                    });
                }
            } catch {
                panel.webview.postMessage({
                    type: 'init',
                    content: '{}',
                    gameExecutableDiscoverySupported: isGameExecutableDiscoverySupported
                });
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
        } else if (msg?.type === 'getGameExecutablePaths') {
            if (isGameExecutableDiscoverySupported) {
                try {
                    const paths = await getGameExecutablePaths(context.extensionPath);
                    await panel.webview.postMessage({ type: 'gameExecutablePaths', paths });
                } catch (error) {
                    console.error('Failed to discover game executable paths:', error);
                    await panel.webview.postMessage({ type: 'gameExecutablePaths', paths: [] });
                }
            }
        } else if (msg?.type === 'openExternal') {
            const url = typeof msg.url === 'string' ? msg.url : '';
            const uri = vscode.Uri.parse(url);
            if (uri.scheme === 'https' || uri.scheme === 'http') {
                await vscode.env.openExternal(uri);
            }
        }
    }, undefined, context.subscriptions);
}

/**
 * 运行 mcdk.exe（无调试模式，Ctrl+F5）
 */
async function runMcdk(projects: McdevProjectRegistry): Promise<void> {
    const workspaceFolder = projects.folders[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('当前工作区根目录没有 .mcdev.json');
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

    // 检查是否已有 Minecraft 进程在运行（sub 模式）
    const mcRunning = await ptvsd.isMinecraftRunning();

    // 不设置 ptvsd 环境变量，正常启动（无调试）
    const env: NodeJS.ProcessEnv = { 
        ...process.env,
        MCDEV_IS_PLUGIN_ENV: '1',
        MCDEV_OUTPUT_MODE: '1'
    };

    // 如果已有 Minecraft 进程，启用子进程模式
    if (mcRunning) {
        console.log('检测到已存在的 Minecraft 进程，启用子进程模式');
        env['MCDEV_IS_SUBPROCESS_MODE'] = '1';
    }

    // 使用 Terminal 直接执行 exe（支持颜色和实时输出）
    const terminal = vscode.window.createTerminal({
        name: 'Minecraft ModPC (mcdk)',
        shellPath: mcdkPath,
        cwd: workspaceFolder.uri.fsPath,
        env: env
    });

    terminal.show(true);
    vscode.window.showInformationMessage('Minecraft ModPC 已启动（无调试）');
}

export async function deactivate(): Promise<void> {
    ptvsd.cleanupAllSessions();
    vscode.commands.executeCommand('setContext', 'mcdev-tools:enabled', false);
    vscode.commands.executeCommand('setContext', 'mcdev-tools:showSidebar', false);
    await dynamicLibraryManager.unloadAll();
}
