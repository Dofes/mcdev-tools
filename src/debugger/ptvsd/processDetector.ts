/**
 * Minecraft 进程检测
 * 检测系统中是否有 Minecraft 进程在运行
 */

import * as cp from 'child_process';

export interface MinecraftProcess {
    pid: number;
    name: string;
}

/**
 * 检测系统中是否有 Minecraft 进程在运行
 * 使用 PowerShell 查询进程
 */
export async function findMinecraftProcesses(): Promise<MinecraftProcess[]> {
    return new Promise((resolve) => {
        const cmd = 'Get-Process -Name "Minecraft.Windows" -ErrorAction SilentlyContinue | Select-Object Id, ProcessName | ConvertTo-Json';
        
        cp.exec(`powershell -Command "${cmd}"`, { encoding: 'utf8' }, (error, stdout) => {
            if (error || !stdout.trim()) {
                resolve([]);
                return;
            }
            
            try {
                const result = JSON.parse(stdout);
                // PowerShell 返回单个对象或数组
                const processes = Array.isArray(result) ? result : [result];
                resolve(processes.map(p => ({
                    pid: p.Id,
                    name: p.ProcessName
                })));
            } catch {
                resolve([]);
            }
        });
    });
}

/**
 * 检查是否有 Minecraft 进程在运行
 */
export async function isMinecraftRunning(): Promise<boolean> {
    const processes = await findMinecraftProcesses();
    return processes.length > 0;
}
