export interface ModDir {
  path: string;
  hot_reload: boolean;
  enabled: boolean;
}

export interface McdevData {
  game_executable_path?: string;
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
  auto_hot_reload_ui?: boolean;
  auto_hot_reload_shaders?: boolean;
  auto_hot_reload_materials?: boolean;
  auto_hot_reload_particles?: boolean;
  do_daylight_cycle?: boolean;
  do_weather_cycle?: boolean;
  user_name?: string;
  skin_info?: {
    slim: boolean;
    skin: string;
  };
  included_mod_dirs?: (string | ModDir)[];
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
  };
  mcp_server_config?: {
    enabled?: boolean;
    server_ip?: string;
    server_port?: number;
  };
  mcdev_tools?: {
    game_debugger?: {
      enabled?: boolean;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  experiment_options?: {
    data_driven_biomes?: boolean;
    upcoming_creator_features?: boolean;
    experimental_creator_cameras?: boolean;
    gametest?: boolean;
    deferred_technical_preview?: boolean;
  };
}

export interface HostBridgeMethodDescriptor {
  name: string;
  modes: string[];
  gameAvailability: string;
}

export interface HostBridgeSessionSummary {
  id: string;
  registrationId: string;
  connected: boolean;
  state: 'starting' | 'process_started' | 'game_ready' | 'game_unavailable' | 'exiting' | 'exited';
  stateSequence: number;
  connectionGeneration: number;
  startedAt?: string;
  mcdkPid?: number;
  minecraftPid?: number;
  projectRoot: string;
  worldName?: string;
  worldFolderName?: string;
  gameIpcConnected: boolean;
  debugCapabilityEnabled: boolean;
  methods?: HostBridgeMethodDescriptor[];
}

export interface HostBridgeSnapshot {
  status: 'idle' | 'listening' | 'error';
  port?: number;
  error?: string;
  sessions: HostBridgeSessionSummary[];
}

export type PythonProfilerTarget = 'client' | 'server' | 'all';
export type PythonProfilerClock = 'CPU' | 'WALL';

export interface PythonProfilerFunction {
  id: number;
  module: string;
  line: number;
  name: string;
  calls: number;
  actualCalls: number;
  selfTime: number;
  totalTime: number;
  contextId: number;
  contextName: string;
}

export interface PythonProfilerCall {
  callerId: number;
  calleeId: number;
  calls: number;
  selfTime: number;
  totalTime: number;
}

export interface PythonProfilerResult {
  clock: PythonProfilerClock;
  elapsedSeconds: number;
  totalFunctions: number;
  truncated: boolean;
  functions: PythonProfilerFunction[];
  calls: PythonProfilerCall[];
}

export interface PythonProfilerCompletedState {
  target: PythonProfilerTarget;
  clock: PythonProfilerClock;
  capturedAt: string;
  result: PythonProfilerResult;
  report?: {
    markdownPath: string;
    svgPath: string;
  };
  reportError?: string;
}

export interface PythonProfilerTargetState {
  target: PythonProfilerTarget;
  status: 'idle' | 'running' | 'collecting';
  clock: PythonProfilerClock;
  durationSeconds?: number;
  startedAt?: string;
  completed?: PythonProfilerCompletedState;
}

export interface NativeProfilerEndpoint {
  pid: number;
  port: number;
}

export interface NativeProfilerZone {
  id: number;
  name: string;
  sourceFile: string;
  sourceLine: number;
  calls: number;
  totalNanoseconds: number;
  selfNanoseconds: number;
  meanNanoseconds: number;
  maximumNanoseconds: number;
}

export interface NativeProfilerResult {
  capturedSeconds: number;
  totalZones: number;
  truncated: boolean;
  zones: NativeProfilerZone[];
}

export interface NativeProfilerCompletedState {
  pid: number;
  port: number;
  capturedAt: string;
  result: NativeProfilerResult;
  report?: {
    tracePath: string;
    markdownPath: string;
  };
  reportError?: string;
}

export interface NativeProfilerState {
  endpoint?: NativeProfilerEndpoint;
  status: 'idle' | 'capturing' | 'analyzing';
  maximumSeconds?: number;
  startedAt?: string;
  completed?: NativeProfilerCompletedState;
}

export type DebugFunctionTarget = 'client' | 'server';
export type DebugFunctionParameterKind = 'value' | 'varargs' | 'kwargs';
export type DebugFunctionArgumentMode = 'fixed' | 'optional' | 'required';

export interface DebugFunctionParameter {
  name: string;
  kind: DebugFunctionParameterKind;
  required: boolean;
  defaultValue?: string;
}

export interface DebugFunctionArgumentConfig {
  mode: DebugFunctionArgumentMode;
  value: string;
}

export interface DiscoveredDebugFunction {
  key: string;
  modulePath: string;
  functionName: string;
  relativeFilePath: string;
  line: number;
  parameters: DebugFunctionParameter[];
}

export interface SavedDebugFunction extends DiscoveredDebugFunction {
  id: string;
  label: string;
  target: DebugFunctionTarget;
  argumentConfigs: Record<string, DebugFunctionArgumentConfig>;
}
