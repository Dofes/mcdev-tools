/**
 * ptvsd 调试会话管理器
 * 管理多个 Minecraft 调试会话的生命周期
 * 注意：使用端口号作为主键，因为我们无法获取真实的游戏 PID
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { PtvsdDebugSession, DebugClientStatus, PathMapping, PtvsdDebugConfig, PtvsdDebugOptions } from './types';
import { allocatePort, releasePort, releaseAllPorts } from './portAllocator';

/**
 * 生成唯一会话 ID
 */
function generateSessionId(): string {
    return crypto.randomBytes(16).toString('hex');
}

/** 活动会话注册表 (Port -> Session) */
const activeSessions = new Map<number, PtvsdDebugSession>();

/** 会话 ID 到端口的映射 */
const sessionIdToPort = new Map<string, number>();

/**
 * 创建新的调试会话
 */
export async function createSession(
    workspacePath: string,
    config: PtvsdDebugConfig
): Promise<PtvsdDebugSession> {
    // 分配端口
    const { port, isPreferred } = await allocatePort(config.preferredPort);
    
    // 检查是否已存在该端口的会话
    if (activeSessions.has(port)) {
        throw new Error(`端口 ${port} 已有活动的调试会话`);
    }
    
    if (!isPreferred) {
        vscode.window.showInformationMessage(
            `端口 ${config.preferredPort} 已被占用，使用端口 ${port}`
        );
    }

    // 构建路径映射
    const pathMappings: PathMapping[] = [
        {
            localRoot: workspacePath,
            remoteRoot: workspacePath
        },
        ...(config.additionalPathMappings ?? [])
    ];

    // 创建会话（使用端口作为临时 PID）
    const session: PtvsdDebugSession = {
        id: generateSessionId(),
        pid: port, // 用端口作为标识符
        debugIp: config.ip,
        debugPort: port,
        status: 'pending',
        createdAt: new Date(),
        pathMappings,
        workspacePath
    };

    // 注册会话
    activeSessions.set(port, session);
    sessionIdToPort.set(session.id, port);

    return session;
}

/**
 * 获取指定端口的会话
 */
export function getSessionByPort(port: number): PtvsdDebugSession | undefined {
    return activeSessions.get(port);
}

/**
 * 获取指定会话 ID 的会话
 */
export function getSessionById(sessionId: string): PtvsdDebugSession | undefined {
    const port = sessionIdToPort.get(sessionId);
    if (port === undefined) {
        return undefined;
    }
    return activeSessions.get(port);
}

/**
 * 更新会话状态
 */
export function updateSessionStatus(
    port: number, 
    status: DebugClientStatus, 
    vscodeSessionId?: string
): boolean {
    const session = activeSessions.get(port);
    if (!session) {
        return false;
    }
    
    session.status = status;
    if (vscodeSessionId) {
        session.vscodeSessionId = vscodeSessionId;
    }
    
    return true;
}

/**
 * 移除会话并释放资源（通过端口）
 */
export function removeSession(port: number): boolean {
    const session = activeSessions.get(port);
    if (!session) {
        return false;
    }

    // 释放端口
    releasePort(session.debugPort);
    
    // 从注册表中移除
    sessionIdToPort.delete(session.id);
    activeSessions.delete(port);

    return true;
}

/**
 * 获取所有活动会话
 */
export function getAllSessions(): PtvsdDebugSession[] {
    return Array.from(activeSessions.values());
}

/**
 * 获取所有活动会话的 PID 列表
 */
export function getActiveSessionPids(): number[] {
    return Array.from(activeSessions.keys());
}

/**
 * 检查指定 PID 是否有活动会话
 */
export function hasActiveSession(pid: number): boolean {
    return activeSessions.has(pid);
}

/**
 * 清理所有会话
 */
export function cleanupAllSessions(): void {
    releaseAllPorts();
    sessionIdToPort.clear();
    activeSessions.clear();
}

/**
 * 生成 VS Code 调试配置
 */
export function generateDebugConfiguration(
    session: PtvsdDebugSession,
    justMyCode: boolean = false,
    debugOptions?: PtvsdDebugOptions
): vscode.DebugConfiguration {
    // 构建 debugOptions 数组
    const debugOptionsArray: string[] = [];
    
    if (debugOptions) {
        // ptvsd 通过 debugOptions 标志控制变量过滤
        // ShowXxxMembers 标志会被转换为 VAR_FILTER_XXX=False
        if (debugOptions.showPrivateMembers) {
            debugOptionsArray.push('ShowPrivateMembers');
        }
        if (debugOptions.showSpecialMembers) {
            debugOptionsArray.push('ShowSpecialMembers');
        }
        if (debugOptions.showFunctionMembers) {
            debugOptionsArray.push('ShowFunctionMembers');
        }
        if (debugOptions.showBuiltinMembers) {
            debugOptionsArray.push('ShowBuiltinMembers');
        }
    }
    
    return {
        name: `Minecraft Debug (Port: ${session.debugPort})`,
        type: 'python',
        request: 'attach',
        connect: {
            host: session.debugIp,
            port: session.debugPort
        },
        pathMappings: session.pathMappings.map(m => ({
            localRoot: m.localRoot,
            remoteRoot: m.remoteRoot
        })),
        justMyCode,
        // 输出重定向配置
        redirectOutput: true,
        // 让调试器捕获子进程
        subProcess: true,
        // 传递 debugOptions 给 ptvsd
        debugOptions: debugOptionsArray.length > 0 ? debugOptionsArray : undefined
    };
}

/**
 * 从用户配置/全局配置获取调试配置
 */
export function getDebugConfigFromSettings(
    launchConfig?: vscode.DebugConfiguration
): PtvsdDebugConfig {
    const globalConfig = vscode.workspace.getConfiguration('mcdev-tools');
    
    // 获取 debugOptions
    const debugOptions = {
        showPrivateMembers: launchConfig?.dapConfig?.debugOptions?.showPrivateMembers 
            ?? globalConfig.get<boolean>('ptvsd.debugOptions.showPrivateMembers', false),
        showSpecialMembers: launchConfig?.dapConfig?.debugOptions?.showSpecialMembers 
            ?? globalConfig.get<boolean>('ptvsd.debugOptions.showSpecialMembers', false),
        showFunctionMembers: launchConfig?.dapConfig?.debugOptions?.showFunctionMembers 
            ?? globalConfig.get<boolean>('ptvsd.debugOptions.showFunctionMembers', false),
        showBuiltinMembers: launchConfig?.dapConfig?.debugOptions?.showBuiltinMembers 
            ?? globalConfig.get<boolean>('ptvsd.debugOptions.showBuiltinMembers', false),
    };
    
    return {
        enabled: launchConfig?.ptvsd?.enabled ?? globalConfig.get<boolean>('ptvsd.enabled', true),
        ip: launchConfig?.ptvsd?.ip ?? globalConfig.get<string>('ptvsd.ip', 'localhost'),
        preferredPort: launchConfig?.ptvsd?.port ?? globalConfig.get<number>('ptvsd.port', 56788),
        justMyCode: launchConfig?.dapConfig?.justMyCode ?? globalConfig.get<boolean>('ptvsd.justMyCode', false),
        additionalPathMappings: launchConfig?.dapConfig?.pathMappings,
        debugOptions
    };
}
