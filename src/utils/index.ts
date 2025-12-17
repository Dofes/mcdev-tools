import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * 生成随机 nonce 字符串
 */
export function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

/**
 * 休眠指定毫秒数
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 检查端口是否被占用
 */
export function isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();
        
        server.once('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                resolve(true);
            } else {
                resolve(false);
            }
        });

        server.once('listening', () => {
            server.close();
            resolve(false);
        });

        server.listen(port, '127.0.0.1');
    });
}

/**
 * 检查端口是否可连接
 */
export function checkPort(port: number): Promise<boolean> {
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

/**
 * 等待端口可用
 */
export async function waitForPort(
    port: number, 
    timeout: number, 
    token: vscode.CancellationToken
): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 500;

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
 * 查找可用端口
 */
export async function findAvailablePort(
    startPort: number, 
    usedPorts: Set<number>,
    maxAttempts: number = 100
): Promise<number> {
    for (let i = 0; i < maxAttempts; i++) {
        const port = startPort + i;
        
        if (usedPorts.has(port)) {
            continue;
        }
        
        const inUse = await isPortInUse(port);
        if (!inUse) {
            return port;
        }
    }
    throw new Error(`无法在 ${startPort}-${startPort + maxAttempts - 1} 范围内找到可用端口`);
}

/**
 * 简单检测工作区是否为 Minecraft addon/包 的常见结构
 */
export function isMinecraftAddonWorkspace(folder: vscode.WorkspaceFolder): boolean {
    try {
        const root = folder.uri.fsPath;

        // 0) 根目录有 .mcdev.json 文件（MCDK 项目标志）
        const mcdevJson = path.join(root, '.mcdev.json');
        if (fs.existsSync(mcdevJson)) {
            return true;
        }

        // 1) 根目录本身就是包根：manifest.json 与 entities/textures 同级
        const rootManifest = path.join(root, 'manifest.json');
        if (fs.existsSync(rootManifest) && (
            fs.existsSync(path.join(root, 'entities')) || 
            fs.existsSync(path.join(root, 'textures'))
        )) {
            return true;
        }

        // 2) 检查一级子目录
        let children: fs.Dirent[];
        try {
            children = fs.readdirSync(root, { withFileTypes: true });
        } catch {
            return false;
        }

        for (const child of children) {
            if (!child.isDirectory()) continue;
            const childPath = path.join(root, child.name);

            const manifestPath = path.join(childPath, 'manifest.json');
            const hasEntities = fs.existsSync(path.join(childPath, 'entities')) && 
                fs.statSync(path.join(childPath, 'entities')).isDirectory();
            const hasTextures = fs.existsSync(path.join(childPath, 'textures')) && 
                fs.statSync(path.join(childPath, 'textures')).isDirectory();

            if (fs.existsSync(manifestPath) && (hasEntities || hasTextures)) {
                return true;
            }

            // 3) 检查容器目录下的子目录
            let subEntries: fs.Dirent[];
            try {
                subEntries = fs.readdirSync(childPath, { withFileTypes: true });
            } catch {
                continue;
            }

            for (const sub of subEntries) {
                if (!sub.isDirectory()) continue;
                const packDir = path.join(childPath, sub.name);
                const packManifest = path.join(packDir, 'manifest.json');
                const packHasEntities = fs.existsSync(path.join(packDir, 'entities')) && 
                    fs.statSync(path.join(packDir, 'entities')).isDirectory();
                const packHasTextures = fs.existsSync(path.join(packDir, 'textures')) && 
                    fs.statSync(path.join(packDir, 'textures')).isDirectory();
                if (fs.existsSync(packManifest) && (packHasEntities || packHasTextures)) {
                    return true;
                }
            }
        }
    } catch {
        // ignore
    }
    return false;
}
