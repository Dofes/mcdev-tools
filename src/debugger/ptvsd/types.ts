/**
 * ptvsd 调试器类型定义
 */

/** 调试客户端状态 */
export type DebugClientStatus = 'pending' | 'connected' | 'disconnected' | 'error';

/** 路径映射配置 */
export interface PathMapping {
    /** 本地开发路径 */
    localRoot: string;
    /** 游戏内运行路径 */
    remoteRoot: string;
}

/** ptvsd 调试会话信息 */
export interface PtvsdDebugSession {
    /** 唯一会话 ID */
    id: string;
    /** Minecraft 进程 PID */
    pid: number;
    /** 调试 IP 地址 */
    debugIp: string;
    /** 调试端口 */
    debugPort: number;
    /** 会话状态 */
    status: DebugClientStatus;
    /** 会话创建时间 */
    createdAt: Date;
    /** 路径映射列表 */
    pathMappings: PathMapping[];
    /** VS Code 调试会话 ID (附加后设置) */
    vscodeSessionId?: string;
    /** 关联的工作区路径 */
    workspacePath: string;
}

/** ptvsd 调试选项（控制变量显示等） */
export interface PtvsdDebugOptions {
    /** 显示私有成员 (_xxx) */
    showPrivateMembers?: boolean;
    /** 显示特殊成员 (__xxx__) */
    showSpecialMembers?: boolean;
    /** 显示函数成员 */
    showFunctionMembers?: boolean;
    /** 显示内置成员 */
    showBuiltinMembers?: boolean;
}

/** 调试配置 (从用户配置或环境变量获取) */
export interface PtvsdDebugConfig {
    /** 是否启用调试 */
    enabled: boolean;
    /** 调试 IP 地址 */
    ip: string;
    /** 首选端口 (如果被占用会自动分配) */
    preferredPort: number;
    /** justMyCode 设置 */
    justMyCode: boolean;
    /** 额外的路径映射 */
    additionalPathMappings?: PathMapping[];
    /** ptvsd 调试选项 */
    debugOptions?: PtvsdDebugOptions;
}

/** 端口分配结果 */
export interface PortAllocationResult {
    /** 分配的端口 */
    port: number;
    /** 是否使用了首选端口 */
    isPreferred: boolean;
}

/** 启动调试的结果 */
export interface LaunchDebugResult {
    /** 是否成功 */
    success: boolean;
    /** 会话信息 (成功时) */
    session?: PtvsdDebugSession;
    /** 错误信息 (失败时) */
    error?: string;
}
