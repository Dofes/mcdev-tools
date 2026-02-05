/**
 * ptvsd 调试启动器
 * 
 * 设计说明：
 * - ptvsd 必须在游戏启动时通过命令行参数配置，不能后期注入
 * - F5 启动调试：
 *   1. 检查是否有 Minecraft 进程在运行且有活跃调试端口 → 重新附加
 *   2. 否则启动 MCDK + 游戏（带调试参数）+ 附加调试
 * - Ctrl+F5 仅运行：启动 MCDK + 游戏（无调试参数）
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as net from 'net';
import {
    PtvsdDebugSession,
    PtvsdDebugConfig,
    createSession,
    removeSession,
    getAllSessions,
    generateDebugConfiguration,
    getDebugConfigFromSettings
} from './index';
import { saveSession, getLastSession, clearSession } from './storage';
import { isMinecraftRunning } from './processDetector';

/**
 * 获取 mcdk.exe 路径
 */
export function getMcdkPath(
    workspaceFolder: vscode.WorkspaceFolder,
    mcdkPathConfig: string,
    extensionPath: string
): string {
    if (mcdkPathConfig) {
        return path.isAbsolute(mcdkPathConfig)
            ? mcdkPathConfig
            : path.join(workspaceFolder.uri.fsPath, mcdkPathConfig);
    }
    return path.join(extensionPath, 'bin', 'mcdk.exe');
}

/**
 * 检查端口是否有调试器在监听
 */
async function isDebugPortActive(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(1000);

        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });

        socket.on('error', () => {
            socket.destroy();
            resolve(false);
        });

        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });

        socket.connect(port, host);
    });
}

/**
 * 尝试重新附加到已存在的会话
 * 1. 检查内存中的活动会话
 * 2. 检查持久化存储的上次会话
 * 3. 验证端口是否仍然活跃
 */
async function tryReattachExistingSession(
    ptvsdConfig: PtvsdDebugConfig
): Promise<vscode.DebugConfiguration | undefined> {
    // 首先检查是否有 Minecraft 进程在运行
    const mcRunning = await isMinecraftRunning();
    if (!mcRunning) {
        // 没有 Minecraft 进程，清理所有会话
        await clearSession();
        return undefined;
    }

    // 检查内存中的活动会话
    const sessions = getAllSessions();
    for (const session of sessions) {
        const isActive = await isDebugPortActive(session.debugIp, session.debugPort);
        if (isActive) {
            vscode.window.showInformationMessage(
                `检测到活动的调试会话 (端口: ${session.debugPort})，正在重新附加...`
            );
            return generateDebugConfiguration(session, ptvsdConfig.justMyCode, ptvsdConfig.debugOptions);
        } else {
            removeSession(session.debugPort);
        }
    }

    // 检查持久化存储的上次会话
    const lastSession = getLastSession();
    if (lastSession) {
        const isActive = await isDebugPortActive(lastSession.ip, lastSession.port);
        if (isActive) {
            vscode.window.showInformationMessage(
                `检测到之前的调试会话 (端口: ${lastSession.port})，正在重新附加...`
            );
            // 构造一个临时会话用于生成配置
            const tempSession: PtvsdDebugSession = {
                id: 'restored',
                pid: 0,
                debugIp: lastSession.ip,
                debugPort: lastSession.port,
                status: 'connected',
                createdAt: new Date(lastSession.savedAt),
                pathMappings: [{
                    localRoot: lastSession.workspacePath,
                    remoteRoot: lastSession.workspacePath
                }],
                workspacePath: lastSession.workspacePath
            };
            return generateDebugConfiguration(tempSession, ptvsdConfig.justMyCode, ptvsdConfig.debugOptions);
        } else {
            // 端口不活跃，清理
            await clearSession();
        }
    }

    return undefined;
}

/**
 * 等待调试端口就绪
 */
async function waitForDebugPort(
    host: string,
    port: number,
    timeout: number,
    token?: vscode.CancellationToken
): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 500;

    while (Date.now() - startTime < timeout) {
        if (token?.isCancellationRequested) {
            return false;
        }

        const connected = await new Promise<boolean>((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(1000);

            socket.on('connect', () => {
                socket.destroy();
                resolve(true);
            });

            socket.on('error', () => {
                socket.destroy();
                resolve(false);
            });

            socket.on('timeout', () => {
                socket.destroy();
                resolve(false);
            });

            socket.connect(port, host);
        });

        if (connected) {
            return true;
        }

        await new Promise(r => setTimeout(r, checkInterval));
    }

    return false;
}

/**
 * 使用 ptvsd 模式启动调试会话
 * 
 * 流程：
 * 1. 检查是否有活动会话可以重新附加
 * 2. 如果没有，分配调试端口并启动 MCDK
 * 3. 等待 ptvsd 端口就绪
 * 4. 返回 debugpy attach 配置，VS Code 自动附加
 */
export async function launchPtvsdDebugSession(
    launchConfig: vscode.DebugConfiguration,
    extensionPath: string
): Promise<vscode.DebugConfiguration | undefined> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('请先打开工作区');
        return undefined;
    }

    // 获取调试配置
    const ptvsdConfig = getDebugConfigFromSettings(launchConfig);

    // 获取配置
    const globalConfig = vscode.workspace.getConfiguration('mcdev-tools');
    const timeout = launchConfig.timeout ?? globalConfig.get<number>('timeout', 60000);
    const mcdkPathConfig = launchConfig.mcdkPath ?? globalConfig.get<string>('mcdkPath', '');
    const mcdkPath = getMcdkPath(workspaceFolder, mcdkPathConfig, extensionPath);

    // 检查是否有活动会话可以重新附加
    const existingSession = await tryReattachExistingSession(ptvsdConfig);
    if (existingSession) {
        return existingSession;
    }

    // 创建会话（分配端口）
    let session: PtvsdDebugSession;
    try {
        session = await createSession(
            workspaceFolder.uri.fsPath,
            ptvsdConfig
        );
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(msg);
        return undefined;
    }

    // 检查是否已有 Minecraft 进程在运行（sub 模式）
    const mcRunning = await isMinecraftRunning();

    // 设置环境变量，MCDK 会读取这些变量来配置 ptvsd
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        MCDEV_PTVSD_IP: ptvsdConfig.ip,
        MCDEV_PTVSD_PORT: session.debugPort.toString(),
        MCDEV_IS_PLUGIN_ENV: '1',
        MCDEV_OUTPUT_MODE: '1'
    };

    // 如果已有 Minecraft 进程，启用子进程模式
    if (mcRunning) {
        console.log('检测到已存在的 Minecraft 进程，启用子进程模式');
        env['MCDEV_IS_SUBPROCESS_MODE'] = '1';
    }

    // 使用 Terminal 启动 MCDK（保留颜色和实时输出）
    const terminal = vscode.window.createTerminal({
        name: `Minecraft Debug (Port: ${session.debugPort})`,
        shellPath: mcdkPath,
        cwd: workspaceFolder.uri.fsPath,
        env: env
    });
    terminal.show(true);

    // 等待调试端口就绪
    const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Minecraft Python Debug',
        cancellable: true
    }, async (progress, token): Promise<vscode.DebugConfiguration | undefined> => {
        
        progress.report({ message: `等待游戏启动并初始化调试器 (端口: ${session.debugPort})...` });

        const portReady = await waitForDebugPort(
            ptvsdConfig.ip,
            session.debugPort,
            timeout,
            token
        );

        if (token.isCancellationRequested) {
            terminal.dispose();
            removeSession(session.debugPort);
            vscode.window.showWarningMessage('调试已取消');
            return undefined;
        }

        if (!portReady) {
            vscode.window.showErrorMessage(
                `等待调试器超时 (${timeout / 1000}秒)。\n` +
                '可能的原因：\n' +
                '1. 游戏启动较慢，请尝试增加 timeout 配置\n' +
                '2. 游戏版本不支持 ptvsd 调试'
            );
            // 不关闭终端，用户可能需要查看输出
            removeSession(session.debugPort);
            return undefined;
        }

        progress.report({ message: '调试器就绪，正在附加...' });

        // 保存会话信息到持久化存储
        await saveSession({
            port: session.debugPort,
            ip: ptvsdConfig.ip,
            workspacePath: workspaceFolder.uri.fsPath,
            savedAt: Date.now()
        });

        // 生成 debugpy attach 配置
        return generateDebugConfiguration(session, ptvsdConfig.justMyCode, ptvsdConfig.debugOptions);
    });

    return result;
}

/**
 * 从 GUI 按钮启动新的调试实例
 * 不检查重新附加，总是启动新实例
 * 如果已有 Minecraft 运行，这将启动 sub 客户端（使用新端口）
 */
export async function launchNewInstance(
    extensionPath: string
): Promise<vscode.DebugConfiguration | undefined> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('请先打开工作区');
        return undefined;
    }

    // 获取调试配置
    const ptvsdConfig = getDebugConfigFromSettings();

    // 获取配置
    const globalConfig = vscode.workspace.getConfiguration('mcdev-tools');
    const timeout = globalConfig.get<number>('timeout', 60000);
    const mcdkPathConfig = globalConfig.get<string>('mcdkPath', '');
    const mcdkPath = getMcdkPath(workspaceFolder, mcdkPathConfig, extensionPath);

    // 检查是否已有 Minecraft 进程在运行（sub 模式）
    const mcRunning = await isMinecraftRunning();

    // 创建会话（分配新端口）
    let session: PtvsdDebugSession;
    try {
        session = await createSession(
            workspaceFolder.uri.fsPath,
            ptvsdConfig
        );
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(msg);
        return undefined;
    }

    // 设置环境变量
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        MCDEV_PTVSD_IP: ptvsdConfig.ip,
        MCDEV_PTVSD_PORT: session.debugPort.toString(),
        MCDEV_IS_PLUGIN_ENV: '1',
        MCDEV_OUTPUT_MODE: '1'
    };

    // 如果已有 Minecraft 进程，启用子客户端模式
    if (mcRunning) {
        console.log('检测到已存在的 Minecraft 进程，启用 sub 客户端模式');
        env['MCDEV_IS_SUBPROCESS_MODE'] = '1';
        vscode.window.showInformationMessage(`启动 Sub 客户端 (端口: ${session.debugPort})`);
    }

    // 使用 Terminal 启动 MCDK
    const terminalName = mcRunning 
        ? `Minecraft Sub (Port: ${session.debugPort})`
        : `Minecraft Debug (Port: ${session.debugPort})`;
    
    const terminal = vscode.window.createTerminal({
        name: terminalName,
        shellPath: mcdkPath,
        cwd: workspaceFolder.uri.fsPath,
        env: env
    });
    terminal.show(true);

    // 等待调试端口就绪
    const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: mcRunning ? 'Minecraft Sub Client Debug' : 'Minecraft Python Debug',
        cancellable: true
    }, async (progress, token): Promise<vscode.DebugConfiguration | undefined> => {
        
        progress.report({ message: `等待游戏启动并初始化调试器 (端口: ${session.debugPort})...` });

        const portReady = await waitForDebugPort(
            ptvsdConfig.ip,
            session.debugPort,
            timeout,
            token
        );

        if (token.isCancellationRequested) {
            terminal.dispose();
            removeSession(session.debugPort);
            vscode.window.showWarningMessage('调试已取消');
            return undefined;
        }

        if (!portReady) {
            vscode.window.showErrorMessage(
                `等待调试器超时 (${timeout / 1000}秒)。\n` +
                '可能的原因：\n' +
                '1. 游戏启动较慢，请尝试增加 timeout 配置\n' +
                '2. 游戏版本不支持 ptvsd 调试'
            );
            removeSession(session.debugPort);
            return undefined;
        }

        progress.report({ message: '调试器就绪，正在附加...' });

        // 保存会话信息到持久化存储
        await saveSession({
            port: session.debugPort,
            ip: ptvsdConfig.ip,
            workspacePath: workspaceFolder.uri.fsPath,
            savedAt: Date.now()
        });

        return generateDebugConfiguration(session, ptvsdConfig.justMyCode, ptvsdConfig.debugOptions);
    });

    return result;
}
