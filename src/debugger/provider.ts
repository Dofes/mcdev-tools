import * as vscode from 'vscode';
import { launchPtvsdDebugSession } from './ptvsd';
import { HostBridgeManager } from '../hostBridge';

/**
 * 调试配置提供者 - 处理 F5 启动
 * 使用 ptvsd 模式（官方调试器接口）
 */
export class McDevToolsDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    
    constructor(
        private readonly extensionPath: string,
        private readonly hostBridgeManager: HostBridgeManager
    ) {}
    
    async resolveDebugConfiguration(
        _folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        _token?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration | null | undefined> {
        
        // 如果是空配置（用户直接按 F5 没有 launch.json）
        if (!config.type && !config.request && !config.name) {
            return {
                type: 'mcdev-tools',
                request: 'launch',
                name: 'MC Dev Tools Debug',
                dapConfig: {
                    justMyCode: false
                }
            };
        }
        
        // 不是我们的类型，交给其他处理
        if (config.type !== 'mcdev-tools') {
            return config;
        }

        // 是我们的类型，在下一阶段处理
        return config;
    }

    async resolveDebugConfigurationWithSubstitutedVariables(
        _folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        _token?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration | null | undefined> {
        
        // 只处理我们的类型
        if (config.type !== 'mcdev-tools') {
            return config;
        }

        // 使用 ptvsd 模式启动调试
        const result = await launchPtvsdDebugSession(config, this.extensionPath, this.hostBridgeManager);
        
        // 返回 null 表示用户取消，VS Code 不会显示错误
        if (result === undefined) {
            return null;
        }
        
        return result;
    }
}
