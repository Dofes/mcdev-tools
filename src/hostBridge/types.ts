export type HostBridgeLifecycleState =
    | 'process_started'
    | 'game_ready'
    | 'game_unavailable'
    | 'exiting'
    | 'exited';

export type HostBridgeVisibleState = HostBridgeLifecycleState | 'starting';

export interface HostBridgeRegistration {
    id: string;
    token: string;
    workspacePath: string;
    createdAt: number;
    lastSeenAt: number;
    sessionId?: string;
    mcdkPid?: number;
    minecraftPid?: number;
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
    state: HostBridgeVisibleState;
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

export interface PreparedHostBridgeLaunch {
    registrationId: string;
    environment: {
        MCDEV_HOST_PORT: string;
        MCDEV_HOST_TOKEN: string;
    };
}

export interface HostBridgeHostInfo {
    name: string;
    version: string;
    instanceId: string;
}

export interface DisposableLike {
    dispose(): void;
}

