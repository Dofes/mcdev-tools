import * as vscode from 'vscode';
import { startDebugSessionAndGetConfig } from './session';

/**
 * mcdbg 调试配置提供者 - 处理 mcdev-tools-inject 类型
 * 使用 mcdbg 注入模式
 */
export class McdbgDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    
    constructor(private readonly extensionPath: string) {}
    
    async resolveDebugConfiguration(
        _folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        _token?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration | null | undefined> {
        
        // 如果是空配置，返回默认配置
        if (!config.type && !config.request && !config.name) {
            return {
                type: 'mcdev-tools-inject',
                request: 'launch',
                name: 'Minecraft Debug (Inject)',
                port: 5678,
                dapConfig: {
                    justMyCode: false
                }
            };
        }
        
        // 不是我们的类型，交给其他处理
        if (config.type !== 'mcdev-tools-inject') {
            return config;
        }

        return config;
    }

    async resolveDebugConfigurationWithSubstitutedVariables(
        _folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        _token?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration | null | undefined> {
        
        // 只处理我们的类型
        if (config.type !== 'mcdev-tools-inject') {
            return config;
        }

        // 使用 mcdbg 注入模式启动调试
        const result = await startDebugSessionAndGetConfig(
            config,
            this.extensionPath
        );
        
        if (result === undefined) {
            return null;
        }
        
        return result;
    }
}
