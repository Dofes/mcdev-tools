import * as vscode from 'vscode';
import { startDebugSessionAndGetConfig } from './session';

/**
 * 调试配置提供者 - 处理 F5 启动
 */
export class McDevToolsDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    
    constructor(private readonly extensionPath: string) {}
    
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

        // 启动 mcdbg 并获取实际配置
        const result = await startDebugSessionAndGetConfig(config, this.extensionPath);
        
        // 返回 null 表示用户取消，VS Code 不会显示错误
        if (result === undefined) {
            return null;
        }
        
        return result;
    }
}
