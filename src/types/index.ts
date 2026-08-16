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
    log_protocol?: 0 | 1;
    world_name?: string;
    world_folder_name?: string;
    world_seed?: number | null;
    world_type?: number;
    game_mode?: number;
    reset_world?: boolean;
    auto_join_game?: boolean;
    include_debug_mod?: boolean;
    auto_hot_reload_mods?: boolean;
    auto_hot_reload_ui?: boolean;
    auto_hot_reload_shaders?: boolean;
    auto_hot_reload_materials?: boolean;
    auto_hot_reload_particles?: boolean;
    enable_cheats?: boolean;
    keep_inventory?: boolean;
    user_name?: string;
    skin_info?: {
        slim?: boolean;
        skin?: string;
    };
    window_style?: {
        always_on_top?: boolean;
        hide_title_bar?: boolean;
        hide_taskbar_icon?: boolean;
        title_bar_color?: number[] | null;
        fixed_size?: number[] | null;
        fixed_position?: number[] | null;
        lock_corner?: number | null;
        opacity?: number | null;
    };
    debug_options?: {
        reload_key?: string;
        reload_world_key?: string;
        reload_addon_key?: string;
        reload_shaders_key?: string;
        reload_key_global?: boolean;
        modpc_debugger?: unknown;
        [key: string]: unknown;
    };
    mcdev_tools?: {
        game_debugger?: {
            enabled?: boolean;
            [key: string]: unknown;
        };
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
