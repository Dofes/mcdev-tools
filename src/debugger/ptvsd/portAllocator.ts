/**
 * 端口分配器
 * 管理调试端口的分配和回收
 */

import * as net from 'net';

/** 已分配的端口集合 */
const allocatedPorts = new Set<number>();

/**
 * 获取一个系统分配的随机可用端口
 */
async function getRandomAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (address && typeof address === 'object') {
                const port = address.port;
                server.close(() => resolve(port));
            } else {
                server.close(() => reject(new Error('无法获取端口')));
            }
        });
        server.on('error', reject);
    });
}

/**
 * 检查端口是否可用
 */
export async function isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => {
            resolve(false);
        });
        server.once('listening', () => {
            server.close();
            resolve(true);
        });
        server.listen(port, '127.0.0.1');
    });
}

/**
 * 分配一个可用的调试端口
 * @param preferredPort 首选端口（可选，如果可用则使用）
 * @returns 分配的端口和是否使用首选端口
 */
export async function allocatePort(
    preferredPort?: number
): Promise<{ port: number; isPreferred: boolean }> {
    // 如果指定了首选端口且可用，使用它
    if (preferredPort && !allocatedPorts.has(preferredPort)) {
        const available = await isPortAvailable(preferredPort);
        if (available) {
            allocatedPorts.add(preferredPort);
            return { port: preferredPort, isPreferred: true };
        }
    }

    // 让系统分配一个随机可用端口
    const port = await getRandomAvailablePort();
    allocatedPorts.add(port);
    return { port, isPreferred: false };
}

/**
 * 释放已分配的端口
 */
export function releasePort(port: number): void {
    allocatedPorts.delete(port);
}

/**
 * 获取所有已分配的端口
 */
export function getAllocatedPorts(): Set<number> {
    return new Set(allocatedPorts);
}

/**
 * 释放所有已分配的端口
 */
export function releaseAllPorts(): void {
    allocatedPorts.clear();
}
