import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { DebugSessionInfo, MinecraftProcess, McdbgListResult } from '../types';
import { findAvailablePort, waitForPort } from '../utils';

// 跟踪所有活动的调试会话（键: 进程 PID）
const activeDebugSessions = new Map<number, DebugSessionInfo>();

/**
 * 获取活动调试会话映射
 */
export function getActiveDebugSessions(): Map<number, DebugSessionInfo> {
    return activeDebugSessions;
}

/**
 * 获取当前已被调试会话占用的端口
 */
export function getUsedPorts(): Set<number> {
    const usedPorts = new Set<number>();
    for (const session of activeDebugSessions.values()) {
        usedPorts.add(session.port);
    }
    return usedPorts;
}

/**
 * 清理所有调试会话
 */
export function cleanupAllSessions(): void {
    for (const [pid, info] of activeDebugSessions.entries()) {
        if (info.mcdbgProcess) {
            info.mcdbgProcess.kill();
        }
    }
    activeDebugSessions.clear();
}

/**
 * 获取 mcdbg.exe 路径
 */
export function getMcdbgPath(
    workspaceFolder: vscode.WorkspaceFolder, 
    mcdbgPathConfig: string,
    extensionPath: string
): string {
    if (mcdbgPathConfig) {
        return path.isAbsolute(mcdbgPathConfig) 
            ? mcdbgPathConfig 
            : path.join(workspaceFolder.uri.fsPath, mcdbgPathConfig);
    }
    return path.join(extensionPath, 'bin', 'mcdbg.exe');
}

/**
 * 调用 mcdbg --list 查询 Minecraft 进程列表
 */
export async function listMinecraftProcesses(mcdbgPath: string): Promise<McdbgListResult> {
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
            } catch {
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
export async function selectMinecraftProcess(mcdbgPath: string): Promise<MinecraftProcess | undefined> {
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

/**
 * 启动 mcdbg 并返回 debugpy 配置
 */
export async function startDebugSessionAndGetConfig(
    launchConfig: vscode.DebugConfiguration,
    extensionPath: string
): Promise<vscode.DebugConfiguration | undefined> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('请先打开工作区');
        return undefined;
    }

    // 从 launch.json 配置或全局设置获取参数
    const globalConfig = vscode.workspace.getConfiguration('mcdev-tools');
    const preferredPort = launchConfig.port ?? globalConfig.get<number>('port', 5678);
    const timeout = launchConfig.timeout ?? globalConfig.get<number>('timeout', 30000);
    const mcdbgPathConfig = launchConfig.mcdbgPath ?? globalConfig.get<string>('mcdbgPath', '');

    // 获取 mcdbg.exe 路径
    const mcdbgPath = getMcdbgPath(workspaceFolder, mcdbgPathConfig, extensionPath);

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
        port = await findAvailablePort(preferredPort, getUsedPorts());
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
        
        // 获取实际的工作区路径
        const workspacePath = workspaceFolder.uri.fsPath;
        
        // 从 launch.json 的 dapConfig 字段获取 DAP 配置
        const dapConfig = launchConfig.dapConfig ?? {};
        
        // 获取 pathMappings，如果未配置则使用默认值
        const pathMappings = dapConfig.pathMappings ?? [
            {
                localRoot: workspacePath,
                remoteRoot: workspacePath
            }
        ];
        
        // 获取 justMyCode，默认为 false
        const justMyCode = dapConfig.justMyCode ?? false;
        
        // 构建最终配置
        const { pathMappings: _, justMyCode: __, ...restDapConfig } = dapConfig;
        
        return {
            ...restDapConfig,
            name: sessionName,
            type: 'debugpy',
            request: 'attach',
            connect: {
                host: 'localhost',
                port: port
            },
            pathMappings: pathMappings,
            justMyCode: justMyCode
        };
    });

    return result;
}
