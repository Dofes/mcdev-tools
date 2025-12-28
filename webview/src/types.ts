export interface ModDir {
  path: string;
  hot_reload: boolean;
}

export interface McdevData {
  world_name?: string;
  world_folder_name?: string;
  world_seed?: number | null;
  world_type?: number;
  game_mode?: number;
  reset_world?: boolean;
  auto_join_game?: boolean;
  include_debug_mod?: boolean;
  enable_cheats?: boolean;
  keep_inventory?: boolean;
  auto_hot_reload_mods?: boolean;
  do_daylight_cycle?: boolean;
  do_weather_cycle?: boolean;
  user_name?: string;
  included_mod_dirs?: (string | ModDir)[];
  window_style?: {
    always_on_top?: boolean;
    hide_title_bar?: boolean;
    title_bar_color?: number[] | null;
    fixed_size?: number[] | null;
    fixed_position?: number[] | null;
    lock_corner?: number | null;
  };
  debug_options?: {
    reload_key?: string;
    reload_world_key?: string;
    reload_addon_key?: string;
    reload_shaders_key?: string;
    reload_key_global?: boolean;
  };
  experiment_options?: {
    data_driven_biomes?: boolean;
    data_driven_items?: boolean;
    experimental_molang_features?: boolean;
  };
}
