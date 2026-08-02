import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { isMinecraftAddonWorkspace } from './utils';
import { McDevToolsSidebarProvider } from './sidebar';
import { dynamicLibraryManager } from './native/dynamicLibraryManager';
import { GameDebuggerPanel, HostBridgeManager, PreparedHostBridgeLaunch } from './hostBridge';
import { 
    McDevToolsDebugConfigurationProvider,
    McdbgDebugConfigurationProvider,
    ptvsd
} from './debugger';

let extensionContext: vscode.ExtensionContext;
let hostBridgeManager: HostBridgeManager | undefined;
let gameDebuggerPanel: GameDebuggerPanel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('Minecraft ModPC Debug 插件已激活');
    extensionContext = context;

    hostBridgeManager = await HostBridgeManager.create(context);
    context.subscriptions.push(hostBridgeManager);
    gameDebuggerPanel = new GameDebuggerPanel(context.extensionUri, hostBridgeManager);
    context.subscriptions.push(gameDebuggerPanel);

    // 初始化 ptvsd 持久化存储
    ptvsd.initStorage(context);

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
        context.subscriptions.push(sidebarProvider, sidebarDisp);
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

    const openGameDebuggerCmd = vscode.commands.registerCommand('mcdev-tools.openGameDebugger', () => {
        gameDebuggerPanel?.show();
    });

    context.subscriptions.push(startDebugCmd, panelCmd, runCmd, openGameDebuggerCmd);
}

/**
 * 注册调试配置提供者
 */
function registerDebugProviders(context: vscode.ExtensionContext): void {
    // ptvsd 模式 provider（推荐）
    if (!hostBridgeManager) {
        throw new Error('Host Bridge manager is not initialized');
    }
    const ptvsdProvider = new McDevToolsDebugConfigurationProvider(context.extensionPath, hostBridgeManager);
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

    context.subscriptions.push(ptvsdProviderDisposable, mcdbgProviderDisposable, dynamicProvider);
}

/**
 * 注册调试会话监听器
 */
function registerDebugSessionListener(context: vscode.ExtensionContext): void {
    // 监听调试会话结束，清理 ptvsd 会话
    const debugEndDisposable = vscode.debug.onDidTerminateDebugSession((session) => {
        // ptvsd 会话会在进程退出时自动清理
        console.log(`调试会话结束: ${session.name}`);
    });

    context.subscriptions.push(debugEndDisposable);
}

/**
 * 启动调试会话（从 GUI 按钮调用）
 * 总是启动新实例，不检查重新附加
 */
async function startDebugSession(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('请先打开工作区');
        return;
    }

    // 使用 launchNewInstance 直接启动，不走 provider 的重新附加逻辑
    if (!hostBridgeManager) {
        throw new Error('Host Bridge manager is not initialized');
    }
    const config = await ptvsd.launchNewInstance(extensionContext.extensionPath, hostBridgeManager);
    if (config) {
        await vscode.debug.startDebugging(workspaceFolder, config);
    }
}

/**
 * 显示侧边栏面板（回退方案）
 */
async function showSidebarPanel(context: vscode.ExtensionContext): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
        'mcdevSidebarPanel', 
        'Minecraft (.mcdev.json)', 
        vscode.ViewColumn.One, 
        { enableScripts: true }
    );
    
    if (!hostBridgeManager) {
        throw new Error('Host Bridge manager is not initialized');
    }
    const provider = new McDevToolsSidebarProvider(context.extensionUri);
    provider.resolveWebviewPanel(panel);
    context.subscriptions.push(provider);
}

/**
 * 运行 mcdk.exe（无调试模式，Ctrl+F5）
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

    // 检查是否已有 Minecraft 进程在运行（sub 模式）
    const mcRunning = await ptvsd.isMinecraftRunning();

    // 不设置 ptvsd 环境变量，正常启动（无调试）
    const env: NodeJS.ProcessEnv = { 
        ...process.env,
        MCDEV_IS_PLUGIN_ENV: '1',
        MCDEV_OUTPUT_MODE: '1'
    };

    let bridgeLaunch: PreparedHostBridgeLaunch | undefined;
    if (hostBridgeManager) {
        try {
            bridgeLaunch = await hostBridgeManager.prepareLaunch(workspaceFolder.uri.fsPath);
            Object.assign(env, bridgeLaunch.environment);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showWarningMessage(`Host Bridge 启动失败，本次游戏将不启用代码控制台: ${message}`);
        }
    }

    // 如果已有 Minecraft 进程，启用子进程模式
    if (mcRunning) {
        console.log('检测到已存在的 Minecraft 进程，启用子进程模式');
        env['MCDEV_IS_SUBPROCESS_MODE'] = '1';
    }

    // 使用 Terminal 直接执行 exe（支持颜色和实时输出）
    let terminal: vscode.Terminal;
    try {
        terminal = vscode.window.createTerminal({
            name: 'Minecraft ModPC (mcdk)',
            shellPath: mcdkPath,
            cwd: workspaceFolder.uri.fsPath,
            env: env
        });
    } catch (error) {
        if (bridgeLaunch && hostBridgeManager) {
            hostBridgeManager.releaseLaunch(bridgeLaunch.registrationId);
        }
        throw error;
    }
    if (bridgeLaunch && hostBridgeManager) {
        hostBridgeManager.trackTerminal(bridgeLaunch.registrationId, terminal);
    }

    terminal.show(true);
    vscode.window.showInformationMessage('Minecraft ModPC 已启动（无调试）');
}

export async function deactivate(): Promise<void> {
    ptvsd.cleanupAllSessions();
    vscode.commands.executeCommand('setContext', 'mcdev-tools:enabled', false);
    vscode.commands.executeCommand('setContext', 'mcdev-tools:showSidebar', false);
    gameDebuggerPanel?.dispose();
    gameDebuggerPanel = undefined;
    await hostBridgeManager?.disposeAsync();
    hostBridgeManager = undefined;
    await dynamicLibraryManager.unloadAll();
}
