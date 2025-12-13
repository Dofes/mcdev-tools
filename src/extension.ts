import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as net from 'net';

/** 调试会话信息 */
interface DebugSessionInfo {
    pid: number;
    port: number;
    mcdbgProcess: cp.ChildProcess;
    sessionName: string;
}

// 跟踪所有活动的调试会话（键: 进程 PID）
const activeDebugSessions = new Map<number, DebugSessionInfo>();
let extensionContext: vscode.ExtensionContext;

/** Minecraft 进程信息 */
interface MinecraftProcess {
    pid: number;
    name: string;
    title: string;
    elevated: boolean;  // 是否是管理员进程
}

/** mcdbg --list 返回的数据结构 */
interface McdbgListResult {
    processes: MinecraftProcess[];
    error?: string;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Minecraft ModPC Debug 插件已激活');
    extensionContext = context;

    // 注册命令
    const disposable = vscode.commands.registerCommand('minecraft-modpc-debug.startDebug', async () => {
        await startDebugSession();
    });

    // 注册调试配置提供者
    const debugProvider = new MinecraftModPCDebugConfigurationProvider();
    const debugProviderDisposable = vscode.debug.registerDebugConfigurationProvider(
        'minecraft-modpc',
        debugProvider
    );

    // 注册动态调试配置提供者（用于 F5 无配置启动）
    const dynamicProvider = vscode.debug.registerDebugConfigurationProvider(
        'minecraft-modpc',
        {
            provideDebugConfigurations(): vscode.ProviderResult<vscode.DebugConfiguration[]> {
                return [
                    {
                        type: 'minecraft-modpc',
                        request: 'launch',
                        name: 'Minecraft ModPC Debug'
                    }
                ];
            }
        },
        vscode.DebugConfigurationProviderTriggerKind.Dynamic
    );

    // 监听调试会话结束事件
    const debugEndDisposable = vscode.debug.onDidTerminateDebugSession((session) => {
        // 查找对应的调试会话
        for (const [pid, info] of activeDebugSessions.entries()) {
            if (session.name === info.sessionName) {
                // 终止 mcdbg 进程
                if (info.mcdbgProcess) {
                    info.mcdbgProcess.kill();
                }
                activeDebugSessions.delete(pid);
                vscode.window.showInformationMessage(`调试会话已结束 (PID: ${pid})`);
                break;
            }
        }
    });

    context.subscriptions.push(disposable, debugProviderDisposable, dynamicProvider, debugEndDisposable);
}

/**
 * 调试配置提供者 - 处理 F5 启动
 */
class MinecraftModPCDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    
    async resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        _token?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration | null | undefined> {
        
        // 如果是空配置（用户直接按 F5 没有 launch.json）
        if (!config.type && !config.request && !config.name) {
            // 返回我们的默认配置，让 VS Code 继续处理
            return {
                type: 'minecraft-modpc',
                request: 'launch',
                name: 'Minecraft ModPC Debug'
            };
        }
        
        // 不是我们的类型，交给其他处理
        if (config.type !== 'minecraft-modpc') {
            return config;
        }

        // 是我们的类型，在下一阶段处理
        return config;
    }

    async resolveDebugConfigurationWithSubstitutedVariables(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        _token?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration | null | undefined> {
        
        // 只处理我们的类型
        if (config.type !== 'minecraft-modpc') {
            return config;
        }

        // 启动 mcdbg 并获取实际配置
        const result = await startDebugSessionAndGetConfig(config);
        
        // 返回 null 表示用户取消，VS Code 不会显示错误
        // 返回 undefined 表示配置无效，VS Code 会显示错误
        if (result === undefined) {
            return null;  // 静默取消，不显示错误
        }
        
        return result;
    }
}

/**
 * 检查端口是否被占用
 */
function isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();
        
        server.once('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                resolve(true); // 端口被占用
            } else {
                resolve(false);
            }
        });

        server.once('listening', () => {
            server.close();
            resolve(false); // 端口可用
        });

        server.listen(port, '127.0.0.1');
    });
}

/**
 * 获取当前已被调试会话占用的端口
 */
function getUsedPorts(): Set<number> {
    const usedPorts = new Set<number>();
    for (const session of activeDebugSessions.values()) {
        usedPorts.add(session.port);
    }
    return usedPorts;
}

/**
 * 查找可用端口（同时检查系统占用和已分配的调试端口）
 */
async function findAvailablePort(startPort: number, maxAttempts: number = 100): Promise<number> {
    const usedPorts = getUsedPorts();
    
    for (let i = 0; i < maxAttempts; i++) {
        const port = startPort + i;
        
        // 先检查是否已被我们的调试会话占用
        if (usedPorts.has(port)) {
            continue;
        }
        
        // 再检查系统端口是否被占用
        const inUse = await isPortInUse(port);
        if (!inUse) {
            return port;
        }
    }
    throw new Error(`无法在 ${startPort}-${startPort + maxAttempts - 1} 范围内找到可用端口`);
}

/**
 * 获取 mcdbg.exe 路径
 */
function getMcdbgPath(workspaceFolder: vscode.WorkspaceFolder, mcdbgPathConfig: string): string {
    if (mcdbgPathConfig) {
        return path.isAbsolute(mcdbgPathConfig) 
            ? mcdbgPathConfig 
            : path.join(workspaceFolder.uri.fsPath, mcdbgPathConfig);
    }
    return path.join(extensionContext.extensionPath, 'bin', 'mcdbg.exe');
}

/**
 * 调用 mcdbg --list 查询 Minecraft 进程列表
 */
async function listMinecraftProcesses(mcdbgPath: string): Promise<McdbgListResult> {
    return new Promise((resolve) => {
        cp.execFile(mcdbgPath, ['--list'], { timeout: 10000 }, (error, stdout, stderr) => {
            if (error) {
                resolve({ 
                    processes: [], 
                    error: `执行 mcdbg --list 失败: ${error.message}` 
                });
                return;
            }
            
            try {
                const result = JSON.parse(stdout);
                resolve(result);
            } catch (e) {
                resolve({ 
                    processes: [], 
                    error: `解析 mcdbg 输出失败: ${stdout || stderr}` 
                });
            }
        });
    });
}

/**
 * 显示进程选择器，让用户选择要附加的 Minecraft 进程
 */
async function selectMinecraftProcess(mcdbgPath: string): Promise<MinecraftProcess | undefined> {
    // 查询进程列表
    const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: '正在查询目标进程...',
        cancellable: false
    }, async () => {
        return await listMinecraftProcesses(mcdbgPath);
    });

    if (result.error) {
        vscode.window.showErrorMessage(result.error);
        return undefined;
    }

    if (result.processes.length === 0) {
        vscode.window.showWarningMessage('未找到目标进程');
        return undefined;
    }

    // 如果只有一个进程，检查是否已在调试中
    if (result.processes.length === 1) {
        const proc = result.processes[0];
        if (activeDebugSessions.has(proc.pid)) {
            vscode.window.showWarningMessage(`进程 ${proc.pid} 已在调试中`);
            return undefined;
        }
        if (proc.elevated) {
            const choice = await vscode.window.showWarningMessage(
                `目标进程 (PID: ${proc.pid}) 以管理员权限运行，可能需要提权。是否继续？`,
                '继续', '取消'
            );
            if (choice !== '继续') {
                return undefined;
            }
        }
        return proc;
    }

    // 多个进程，显示选择器
    interface ProcessQuickPickItem extends vscode.QuickPickItem {
        process: MinecraftProcess;
    }

    const items: ProcessQuickPickItem[] = result.processes.map(proc => {
        const isBeingDebugged = activeDebugSessions.has(proc.pid);
        let detail = '';
        if (isBeingDebugged) {
            detail = '$(debug) 已在调试中';
        } else if (proc.elevated) {
            detail = '$(shield) 管理员进程 - 可能需要提权';
        }
        return {
            label: `$(window) ${proc.title || proc.name}`,
            description: `PID: ${proc.pid}`,
            detail: detail || undefined,
            process: proc
        };
    });

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: '选择要附加调试的 Minecraft 进程',
        title: 'Minecraft 进程列表'
    });

    if (!selected) {
        return undefined;
    }

    // 警告管理员进程
    if (selected.process.elevated) {
        const choice = await vscode.window.showWarningMessage(
            `目标进程以管理员权限运行，可能需要提权。是否继续？`,
            '继续', '取消'
        );
        if (choice !== '继续') {
            return undefined;
        }
    }

    return selected.process;
}

async function startDebugSession() {
    // 通过命令启动时，使用全局配置
    const config = vscode.workspace.getConfiguration('minecraft-modpc-debug');
    const debugConfig: vscode.DebugConfiguration = {
        type: 'minecraft-modpc',
        request: 'launch',
        name: 'Minecraft ModPC Debug',
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
 * 启动 mcdbg 并返回 debugpy 配置（供 F5 调试使用）
 */
async function startDebugSessionAndGetConfig(
    launchConfig: vscode.DebugConfiguration
): Promise<vscode.DebugConfiguration | undefined> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('请先打开工作区');
        return undefined;
    }

    // 从 launch.json 配置或全局设置获取参数
    const globalConfig = vscode.workspace.getConfiguration('minecraft-modpc-debug');
    const preferredPort = launchConfig.port ?? globalConfig.get<number>('port', 5678);
    const timeout = launchConfig.timeout ?? globalConfig.get<number>('timeout', 30000);
    const mcdbgPathConfig = launchConfig.mcdbgPath ?? globalConfig.get<string>('mcdbgPath', '');

    // 获取 mcdbg.exe 路径
    const mcdbgPath = getMcdbgPath(workspaceFolder, mcdbgPathConfig);

    // 选择 Minecraft 进程
    const selectedProcess = await selectMinecraftProcess(mcdbgPath);
    if (!selectedProcess) {
        return undefined;
    }

    // 检查该进程是否已在调试中
    if (activeDebugSessions.has(selectedProcess.pid)) {
        vscode.window.showWarningMessage(`进程 ${selectedProcess.pid} 已在调试中`);
        return undefined;
    }
    
    // 动态查找可用端口
    let port: number;
    try {
        port = await findAvailablePort(preferredPort);
        if (port !== preferredPort) {
            vscode.window.showInformationMessage(`端口 ${preferredPort} 已占用，使用端口: ${port}`);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(errorMessage);
        return undefined;
    }

    // 生成唯一的会话名称
    const sessionName = `Minecraft Debug (PID: ${selectedProcess.pid})`;

    // 启动 mcdbg 并等待端口就绪
    const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Minecraft ModPC Debug',
        cancellable: true
    }, async (progress, token): Promise<vscode.DebugConfiguration | undefined> => {
        // 启动 mcdbg.exe，使用 --pid 参数
        progress.report({ message: `正在初始化调试器 (PID: ${selectedProcess.pid})...` });
        
        const mcdbgProc = cp.spawn(mcdbgPath, ['--pid', selectedProcess.pid.toString(), '-p', port.toString()], {
            cwd: workspaceFolder.uri.fsPath,
            detached: false
        });

        // 创建输出通道显示 mcdbg 输出
        const outputChannel = vscode.window.createOutputChannel(`mcdbg (PID: ${selectedProcess.pid})`);
        outputChannel.show(true);

        mcdbgProc.stdout?.on('data', (data) => {
            outputChannel.append(data.toString());
        });

        mcdbgProc.stderr?.on('data', (data) => {
            outputChannel.append(`[错误] ${data.toString()}`);
        });

        mcdbgProc.on('error', (err) => {
            vscode.window.showErrorMessage(`启动失败: ${err.message}`);
        });

        mcdbgProc.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                outputChannel.appendLine(`mcdbg.exe 退出，退出码: ${code}`);
            }
            // 从活动会话中移除
            activeDebugSessions.delete(selectedProcess.pid);
        });

        // 等待调试端口可用
        progress.report({ message: `等待调试器就绪，端口: ${port}...` });

        const portReady = await waitForPort(port, timeout, token);

        if (token.isCancellationRequested) {
            mcdbgProc.kill();
            vscode.window.showWarningMessage('调试已取消');
            return undefined;
        }

        if (!portReady) {
            vscode.window.showErrorMessage(`等待调试器超时 (${timeout/1000}秒)`);
            mcdbgProc.kill();
            return undefined;
        }

        // 保存会话信息
        activeDebugSessions.set(selectedProcess.pid, {
            pid: selectedProcess.pid,
            port: port,
            mcdbgProcess: mcdbgProc,
            sessionName: sessionName
        });

        progress.report({ message: '调试器初始化完成' });
        
        return {
            name: sessionName,
            type: 'debugpy',
            request: 'attach',
            connect: {
                host: 'localhost',
                port: port
            },
            pathMappings: [
                {
                    localRoot: '${workspaceFolder}',
                    remoteRoot: '${workspaceFolder}'
                }
            ],
            justMyCode: false
        };
    });

    return result;
}

/**
 * 等待端口可用
 */
async function waitForPort(port: number, timeout: number, token: vscode.CancellationToken): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 500; // 每500ms检查一次

    while (Date.now() - startTime < timeout) {
        if (token.isCancellationRequested) {
            return false;
        }

        const isOpen = await checkPort(port);
        if (isOpen) {
            return true;
        }

        await sleep(checkInterval);
    }

    return false;
}

/**
 * 检查端口是否可连接
 */
function checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        
        socket.setTimeout(1000);
        
        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });

        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });

        socket.on('error', () => {
            socket.destroy();
            resolve(false);
        });

        socket.connect(port, 'localhost');
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function deactivate() {
    // 插件停用时清理所有调试会话
    for (const [pid, info] of activeDebugSessions.entries()) {
        if (info.mcdbgProcess) {
            info.mcdbgProcess.kill();
        }
    }
    activeDebugSessions.clear();
}
