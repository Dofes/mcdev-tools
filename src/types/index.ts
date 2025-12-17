import * as cp from 'child_process';

/** 调试会话信息 */
export interface DebugSessionInfo {
    pid: number;
    port: number;
    mcdbgProcess: cp.ChildProcess;
    sessionName: string;
}

/** Minecraft 进程信息 */
export interface MinecraftProcess {
    pid: number;
    name: string;
    title: string;
    elevated: boolean;  // 是否是管理员进程
}

/** mcdbg --list 返回的数据结构 */
export interface McdbgListResult {
    processes: MinecraftProcess[];
    error?: string;
}

/** MOD 目录配置 */
export interface ModDirConfig {
    path: string;
    hot_reload: boolean;
}

/** .mcdev.json 配置结构 */
export interface McdevConfig {
    included_mod_dirs?: (string | ModDirConfig)[];
    world_name?: string;
    world_folder_name?: string;
    world_seed?: number | null;
    world_type?: number;
    game_mode?: number;
    reset_world?: boolean;
    auto_join_game?: boolean;
    include_debug_mod?: boolean;
    auto_hot_reload_mods?: boolean;
    enable_cheats?: boolean;
    keep_inventory?: boolean;
    user_name?: string;
    debug_options?: {
        reload_key?: string;
        reload_world_key?: string;
        reload_addon_key?: string;
        reload_shaders_key?: string;
        reload_key_global?: boolean;
        modpc_debugger?: unknown;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
