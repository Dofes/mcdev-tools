export { McDevToolsDebugConfigurationProvider } from './provider';
export { McdbgDebugConfigurationProvider } from './mcdbgProvider';

// 保留旧的导出以备兼容（可选）
export { 
    getActiveDebugSessions, 
    getUsedPorts, 
    cleanupAllSessions,
    getMcdbgPath,
    listMinecraftProcesses,
    selectMinecraftProcess,
    startDebugSessionAndGetConfig
} from './session';

// ptvsd 调试模块（新的调试模式）
export * as ptvsd from './ptvsd';
