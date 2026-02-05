/**
 * 调试会话持久化存储
 * 用于在扩展重启后恢复会话信息
 */

import * as vscode from 'vscode';

const STORAGE_KEY = 'mcdev-tools.ptvsd.sessions';

export interface PersistedSession {
    /** 调试端口 */
    port: number;
    /** 调试 IP */
    ip: string;
    /** 工作区路径 */
    workspacePath: string;
    /** 保存时间 */
    savedAt: number;
}

let globalState: vscode.Memento | undefined;

/**
 * 初始化存储（在扩展激活时调用）
 */
export function initStorage(context: vscode.ExtensionContext): void {
    globalState = context.globalState;
}

/**
 * 保存会话信息（添加到列表）
 */
export async function saveSession(session: PersistedSession): Promise<void> {
    if (!globalState) {
        console.warn('Storage not initialized');
        return;
    }
    const sessions = globalState.get<PersistedSession[]>(STORAGE_KEY, []);
    // 避免重复（同端口覆盖）
    const filtered = sessions.filter(s => s.port !== session.port);
    filtered.push(session);
    await globalState.update(STORAGE_KEY, filtered);
}

/**
 * 获取所有保存的会话信息
 */
export function getAllPersistedSessions(): PersistedSession[] {
    if (!globalState) {
        return [];
    }
    return globalState.get<PersistedSession[]>(STORAGE_KEY, []);
}

/**
 * 获取最近保存的会话信息
 */
export function getLastSession(): PersistedSession | undefined {
    const sessions = getAllPersistedSessions();
    if (sessions.length === 0) {
        return undefined;
    }
    // 返回最近保存的
    return sessions.sort((a, b) => b.savedAt - a.savedAt)[0];
}

/**
 * 移除指定端口的会话
 */
export async function removePersistedSession(port: number): Promise<void> {
    if (!globalState) {
        return;
    }
    const sessions = globalState.get<PersistedSession[]>(STORAGE_KEY, []);
    const filtered = sessions.filter(s => s.port !== port);
    await globalState.update(STORAGE_KEY, filtered);
}

/**
 * 清除所有保存的会话信息
 */
export async function clearSession(): Promise<void> {
    if (!globalState) {
        return;
    }
    await globalState.update(STORAGE_KEY, []);
}
