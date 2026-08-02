import * as crypto from 'crypto';
import * as net from 'net';
import { EventEmitter } from 'events';
import {
    HOST_BRIDGE_HEARTBEAT_INTERVAL_MS,
    HOST_BRIDGE_MAX_FRAME_BYTES,
    HOST_BRIDGE_MAX_IN_FLIGHT_REQUESTS,
    HOST_BRIDGE_PROTOCOL_VERSION,
    HostBridgeFrameDecoder,
    JsonObject,
    JsonRpcId,
    encodeHostBridgeFrame,
    getInteger,
    getString,
    isJsonObject,
    isJsonRpcId,
    rpcIdKey
} from './protocol';
import {
    DisposableLike,
    HostBridgeHostInfo,
    HostBridgeLifecycleState,
    HostBridgeMethodDescriptor,
    HostBridgeRegistration,
    HostBridgeSessionSummary,
    HostBridgeSnapshot,
    PreparedHostBridgeLaunch
} from './types';

const HANDSHAKE_TIMEOUT_MS = 3_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_WRITE_QUEUE_BYTES = HOST_BRIDGE_MAX_FRAME_BYTES * 2;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_STATES = new Set<HostBridgeLifecycleState>([
    'process_started',
    'game_ready',
    'game_unavailable',
    'exiting',
    'exited'
]);

interface PendingRequest {
    resolve(value: unknown): void;
    reject(reason: Error): void;
    timer: NodeJS.Timeout;
}

interface BridgeConnection {
    socket: net.Socket;
    decoder: HostBridgeFrameDecoder;
    phase: 'handshake' | 'active' | 'closed';
    handshakeTimer: NodeJS.Timeout;
    registration?: HostBridgeRegistration;
    sessionId?: string;
    generation: number;
    maxFrameBytes: number;
    maxInFlightRequests: number;
    pending: Map<string, PendingRequest>;
}

interface SessionRecord {
    summary: HostBridgeSessionSummary;
    connection?: BridgeConnection;
    removalTimer?: NodeJS.Timeout;
}

interface InitializeData {
    registration: HostBridgeRegistration;
    sessionId: string;
    generation: number;
    state: HostBridgeLifecycleState;
    stateSequence: number;
    startedAt?: string;
    mcdkPid: number;
    minecraftPid: number;
    projectRoot: string;
    worldName?: string;
    worldFolderName?: string;
    gameIpcConnected: boolean;
    debugCapabilityEnabled: boolean;
    remoteMaxFrameBytes: number;
    remoteMaxInFlightRequests: number;
}

export class HostBridgeRpcError extends Error {
    constructor(
        public readonly rpcCode: number,
        message: string,
        public readonly data?: JsonObject
    ) {
        super(message);
        this.name = 'HostBridgeRpcError';
    }

    public get symbolicCode(): string | undefined {
        return getString(this.data?.code);
    }
}

export class HostBridgeDisconnectedError extends Error {
    constructor(message = 'MCDK Host Bridge connection closed') {
        super(message);
        this.name = 'HostBridgeDisconnectedError';
    }
}

export class HostBridgeServer {
    private readonly events = new EventEmitter();
    private readonly registrations = new Map<string, HostBridgeRegistration>();
    private readonly connections = new Set<BridgeConnection>();
    private readonly sessions = new Map<string, SessionRecord>();
    private server?: net.Server;
    private startPromise?: Promise<number>;
    private nextRequestId = 1;
    private disposed = false;
    private serverStatus: HostBridgeSnapshot['status'] = 'idle';
    private serverPort?: number;
    private serverError?: string;

    constructor(
        private readonly hostInfo: HostBridgeHostInfo,
        registrations: HostBridgeRegistration[] = []
    ) {
        for (const registration of registrations) {
            if (isValidRegistration(registration)) {
                this.registrations.set(registration.id, { ...registration });
            }
        }
    }

    public onDidChange(listener: (snapshot: HostBridgeSnapshot) => void): DisposableLike {
        this.events.on('change', listener);
        return { dispose: () => this.events.off('change', listener) };
    }

    public onDidChangeRegistrations(listener: () => void): DisposableLike {
        this.events.on('registrationsChanged', listener);
        return { dispose: () => this.events.off('registrationsChanged', listener) };
    }

    public get port(): number | undefined {
        return this.serverPort;
    }

    public get isListening(): boolean {
        return this.serverStatus === 'listening' && this.server !== undefined;
    }

    public exportRegistrations(): HostBridgeRegistration[] {
        return [...this.registrations.values()].map(registration => ({ ...registration }));
    }

    public getSnapshot(): HostBridgeSnapshot {
        const connectedSessions = [...this.sessions.values()].map(record => ({ ...record.summary }));
        const boundIds = new Set(connectedSessions.map(session => session.registrationId));
        const pendingSessions: HostBridgeSessionSummary[] = [];

        for (const registration of this.registrations.values()) {
            if (boundIds.has(registration.id)) {
                continue;
            }
            pendingSessions.push({
                id: `launch:${registration.id}`,
                registrationId: registration.id,
                connected: false,
                state: 'starting',
                stateSequence: 0,
                connectionGeneration: 0,
                projectRoot: registration.workspacePath,
                gameIpcConnected: false,
                debugCapabilityEnabled: false
            });
        }

        const sessions = [...connectedSessions, ...pendingSessions].sort((left, right) => {
            if (left.connected !== right.connected) {
                return left.connected ? -1 : 1;
            }
            return (right.startedAt ?? '').localeCompare(left.startedAt ?? '');
        });
        return {
            status: this.serverStatus,
            port: this.serverPort,
            error: this.serverError,
            sessions
        };
    }

    public async start(preferredPort = 0): Promise<number> {
        if (this.disposed) {
            throw new Error('Host Bridge server has been disposed');
        }
        if (this.isListening && this.serverPort !== undefined) {
            return this.serverPort;
        }
        if (this.startPromise) {
            return this.startPromise;
        }

        this.startPromise = this.listen(preferredPort);
        try {
            return await this.startPromise;
        } finally {
            this.startPromise = undefined;
        }
    }

    public registerLaunch(workspacePath: string): PreparedHostBridgeLaunch {
        if (!this.isListening || this.serverPort === undefined) {
            throw new Error('Host Bridge listener is not running');
        }

        const registration: HostBridgeRegistration = {
            id: crypto.randomUUID(),
            token: crypto.randomBytes(32).toString('hex'),
            workspacePath,
            createdAt: Date.now(),
            lastSeenAt: Date.now()
        };
        this.registrations.set(registration.id, registration);
        this.emitRegistrationsChanged();
        this.emitChange();
        return {
            registrationId: registration.id,
            environment: {
                MCDEV_HOST_PORT: String(this.serverPort),
                MCDEV_HOST_TOKEN: registration.token
            }
        };
    }

    public releaseRegistration(registrationId: string): void {
        const registration = this.registrations.get(registrationId);
        if (!registration) {
            return;
        }
        this.registrations.delete(registrationId);
        if (registration.sessionId) {
            const session = this.sessions.get(registration.sessionId);
            if (session?.connection) {
                session.connection.socket.destroy();
            }
            if (session?.removalTimer) {
                clearTimeout(session.removalTimer);
            }
            this.sessions.delete(registration.sessionId);
        }
        this.emitRegistrationsChanged();
        this.emitChange();
    }

    public pruneRegistrations(now = Date.now()): void {
        const pendingMaxAge = 60 * 60 * 1_000;
        const sessionMaxAge = 7 * 24 * 60 * 60 * 1_000;
        let changed = false;
        for (const registration of [...this.registrations.values()]) {
            const session = registration.sessionId ? this.sessions.get(registration.sessionId) : undefined;
            if (session?.connection) {
                continue;
            }
            const maxAge = registration.sessionId ? sessionMaxAge : pendingMaxAge;
            if (now - registration.lastSeenAt > maxAge) {
                this.registrations.delete(registration.id);
                if (registration.sessionId) {
                    this.sessions.delete(registration.sessionId);
                }
                changed = true;
            }
        }
        if (changed) {
            this.emitRegistrationsChanged();
            this.emitChange();
        }
    }

    public async request(
        sessionId: string,
        method: string,
        params: unknown = {},
        timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
    ): Promise<unknown> {
        const session = this.sessions.get(sessionId);
        const connection = session?.connection;
        if (!connection || connection.phase !== 'active') {
            throw new HostBridgeDisconnectedError();
        }
        if (connection.pending.size >= connection.maxInFlightRequests) {
            throw new HostBridgeRpcError(-32004, 'MCDK request limit reached', {
                code: 'SERVER_BUSY'
            });
        }

        const id = `host:${this.nextRequestId++}`;
        const key = rpcIdKey(id);
        return new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                connection.pending.delete(key);
                this.sendMessage(connection, {
                    jsonrpc: '2.0',
                    method: 'mcdk/cancel',
                    params: { id }
                });
                reject(new HostBridgeRpcError(-32014, `Host Bridge request timed out: ${method}`, {
                    code: 'HANDLER_TIMEOUT'
                }));
            }, Math.max(1, timeoutMs));
            timer.unref?.();
            connection.pending.set(key, { resolve, reject, timer });

            if (!this.sendMessage(connection, {
                jsonrpc: '2.0',
                id,
                method,
                params
            })) {
                clearTimeout(timer);
                connection.pending.delete(key);
                reject(new HostBridgeDisconnectedError());
            }
        });
    }

    public notify(sessionId: string, method: string, params: unknown = {}): void {
        const connection = this.sessions.get(sessionId)?.connection;
        if (!connection || connection.phase !== 'active') {
            throw new HostBridgeDisconnectedError();
        }
        if (!this.sendMessage(connection, { jsonrpc: '2.0', method, params })) {
            throw new HostBridgeDisconnectedError();
        }
    }

    public async refreshSessions(): Promise<void> {
        const sessionIds = [...this.sessions.values()]
            .filter(record => record.connection?.phase === 'active')
            .map(record => record.summary.id);
        await Promise.allSettled(sessionIds.map(async sessionId => {
            const [snapshot, methods] = await Promise.all([
                this.request(sessionId, 'mcdk/session/get', {}, 3_000),
                this.request(sessionId, 'mcdk/methods/list', {}, 3_000)
            ]);
            this.applySessionSnapshot(sessionId, snapshot);
            this.applyMethodList(sessionId, methods);
            this.emitChange();
        }));
    }

    public async dispose(): Promise<void> {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        for (const record of this.sessions.values()) {
            if (record.removalTimer) {
                clearTimeout(record.removalTimer);
            }
        }
        for (const connection of [...this.connections]) {
            this.closeConnection(connection, new HostBridgeDisconnectedError('Host Bridge server stopped'));
        }

        const server = this.server;
        this.server = undefined;
        this.serverPort = undefined;
        this.serverStatus = 'idle';
        this.emitChange();
        if (server) {
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
        this.events.removeAllListeners();
    }

    private async listen(port: number): Promise<number> {
        const server = net.createServer({ allowHalfOpen: false }, socket => this.acceptSocket(socket));
        this.server = server;
        try {
            const boundPort = await new Promise<number>((resolve, reject) => {
                const handleError = (error: Error) => {
                    server.off('listening', handleListening);
                    reject(error);
                };
                const handleListening = () => {
                    server.off('error', handleError);
                    const address = server.address();
                    if (!address || typeof address === 'string') {
                        reject(new Error('Host Bridge listener did not expose a TCP address'));
                        return;
                    }
                    resolve(address.port);
                };
                server.once('error', handleError);
                server.once('listening', handleListening);
                server.listen({ host: '127.0.0.1', port, exclusive: true });
            });
            server.on('error', error => {
                this.serverStatus = 'error';
                this.serverError = error.message;
                this.emitChange();
            });
            server.unref();
            this.serverStatus = 'listening';
            this.serverPort = boundPort;
            this.serverError = undefined;
            this.emitChange();
            return boundPort;
        } catch (error) {
            this.server = undefined;
            this.serverPort = undefined;
            this.serverStatus = 'error';
            this.serverError = error instanceof Error ? error.message : String(error);
            server.close();
            this.emitChange();
            throw error;
        }
    }

    private acceptSocket(socket: net.Socket): void {
        if (this.disposed || !isLoopbackAddress(socket.remoteAddress)) {
            socket.destroy();
            return;
        }
        socket.setNoDelay(true);
        socket.setKeepAlive(true, 30_000);
        const connection: BridgeConnection = {
            socket,
            decoder: new HostBridgeFrameDecoder(),
            phase: 'handshake',
            handshakeTimer: setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT_MS),
            generation: 0,
            maxFrameBytes: HOST_BRIDGE_MAX_FRAME_BYTES,
            maxInFlightRequests: HOST_BRIDGE_MAX_IN_FLIGHT_REQUESTS,
            pending: new Map()
        };
        connection.handshakeTimer.unref?.();
        this.connections.add(connection);

        socket.on('data', chunk => this.receiveData(connection, chunk));
        socket.on('error', () => {
            // The close event performs all cleanup; socket errors are expected during reconnects.
        });
        socket.on('close', () => this.closeConnection(connection));
    }

    private receiveData(connection: BridgeConnection, chunk: Buffer): void {
        if (connection.phase === 'closed') {
            return;
        }
        let messages: JsonObject[];
        try {
            messages = connection.decoder.push(chunk);
        } catch {
            connection.socket.destroy();
            return;
        }
        for (const message of messages) {
            if (connection.phase === 'handshake') {
                this.handleInitialize(connection, message);
            } else if (connection.phase === 'active') {
                this.handleActiveMessage(connection, message);
            }
            if (connection.socket.destroyed) {
                return;
            }
        }
    }

    private handleInitialize(connection: BridgeConnection, message: JsonObject): void {
        const id = message.id;
        if (
            message.jsonrpc !== '2.0'
            || !isJsonRpcId(id)
            || message.method !== 'mcdk/initialize'
            || !isJsonObject(message.params)
        ) {
            this.rejectHandshake(connection, isJsonRpcId(id) ? id : 'mcdk:initialize', -32600, 'Invalid initialize request', 'INVALID_REQUEST');
            return;
        }

        const params = message.params;
        const token = getString(params.authToken);
        const registration = token ? this.findRegistration(token) : undefined;
        if (!registration) {
            this.rejectHandshake(connection, id, -32001, 'Host Bridge authentication failed', 'AUTH_FAILED');
            return;
        }

        const protocol = isJsonObject(params.protocol) ? params.protocol : undefined;
        const minVersion = getInteger(protocol?.minVersion);
        const maxVersion = getInteger(protocol?.maxVersion);
        if (
            minVersion === undefined
            || maxVersion === undefined
            || minVersion > HOST_BRIDGE_PROTOCOL_VERSION
            || maxVersion < HOST_BRIDGE_PROTOCOL_VERSION
        ) {
            this.rejectHandshake(
                connection,
                id,
                -32002,
                'Host Bridge protocol version is not supported',
                'PROTOCOL_VERSION_UNSUPPORTED'
            );
            return;
        }

        const initialize = this.parseInitialize(params, registration);
        if (!initialize) {
            this.rejectHandshake(connection, id, -32600, 'Invalid initialize parameters', 'INVALID_REQUEST');
            return;
        }
        if (registration.sessionId && registration.sessionId !== initialize.sessionId) {
            this.rejectHandshake(connection, id, -32001, 'Host Bridge authentication failed', 'AUTH_FAILED');
            return;
        }

        const existing = this.sessions.get(initialize.sessionId);
        if (existing?.connection && initialize.generation <= existing.summary.connectionGeneration) {
            this.rejectHandshake(connection, id, -32600, 'Stale connection generation', 'INVALID_REQUEST');
            return;
        }

        clearTimeout(connection.handshakeTimer);
        connection.phase = 'active';
        connection.registration = registration;
        connection.sessionId = initialize.sessionId;
        connection.generation = initialize.generation;
        connection.maxFrameBytes = initialize.remoteMaxFrameBytes;
        connection.maxInFlightRequests = initialize.remoteMaxInFlightRequests;

        registration.sessionId = initialize.sessionId;
        registration.mcdkPid = initialize.mcdkPid;
        registration.minecraftPid = initialize.minecraftPid;
        registration.lastSeenAt = Date.now();

        const summary: HostBridgeSessionSummary = {
            id: initialize.sessionId,
            registrationId: registration.id,
            connected: true,
            state: initialize.state,
            stateSequence: initialize.stateSequence,
            connectionGeneration: initialize.generation,
            startedAt: initialize.startedAt,
            mcdkPid: initialize.mcdkPid,
            minecraftPid: initialize.minecraftPid,
            projectRoot: initialize.projectRoot,
            worldName: initialize.worldName,
            worldFolderName: initialize.worldFolderName,
            gameIpcConnected: initialize.gameIpcConnected,
            debugCapabilityEnabled: initialize.debugCapabilityEnabled,
            methods: existing?.summary.methods
        };
        if (existing?.removalTimer) {
            clearTimeout(existing.removalTimer);
        }
        this.sessions.set(initialize.sessionId, { summary, connection });

        const responseSent = this.sendMessage(connection, {
            jsonrpc: '2.0',
            id,
            result: {
                protocolVersion: HOST_BRIDGE_PROTOCOL_VERSION,
                connectionId: crypto.randomUUID(),
                host: this.hostInfo,
                heartbeatIntervalMs: HOST_BRIDGE_HEARTBEAT_INTERVAL_MS,
                limits: {
                    maxFrameBytes: HOST_BRIDGE_MAX_FRAME_BYTES,
                    maxInFlightRequests: HOST_BRIDGE_MAX_IN_FLIGHT_REQUESTS
                }
            }
        }, initialize.remoteMaxFrameBytes);
        if (!responseSent) {
            return;
        }

        if (existing?.connection && existing.connection !== connection) {
            existing.connection.socket.destroy();
        }
        this.emitRegistrationsChanged();
        this.emitChange();

        setImmediate(() => {
            void this.discoverMethods(initialize.sessionId);
        });
    }

    private parseInitialize(params: JsonObject, registration: HostBridgeRegistration): InitializeData | undefined {
        const session = isJsonObject(params.session) ? params.session : undefined;
        const mcdk = isJsonObject(params.mcdk) ? params.mcdk : undefined;
        const minecraft = isJsonObject(params.minecraft) ? params.minecraft : undefined;
        const project = isJsonObject(params.project) ? params.project : undefined;
        const world = isJsonObject(params.world) ? params.world : undefined;
        const gameIpc = isJsonObject(params.gameIpc) ? params.gameIpc : undefined;
        const capabilities = isJsonObject(params.capabilities) ? params.capabilities : undefined;
        const limits = isJsonObject(params.limits) ? params.limits : undefined;

        const sessionId = getString(session?.id);
        const generation = getInteger(session?.connectionGeneration);
        const state = getString(session?.state);
        const stateSequence = getInteger(session?.stateSequence);
        const mcdkPid = getInteger(mcdk?.pid);
        const minecraftPid = getInteger(minecraft?.pid);
        const projectRoot = getString(project?.root) ?? registration.workspacePath;
        const remoteMaxFrameBytes = getInteger(limits?.maxFrameBytes) ?? HOST_BRIDGE_MAX_FRAME_BYTES;
        const remoteMaxInFlightRequests = getInteger(limits?.maxInFlightRequests) ?? HOST_BRIDGE_MAX_IN_FLIGHT_REQUESTS;

        if (
            !sessionId || !UUID_PATTERN.test(sessionId)
            || generation === undefined || generation < 1
            || !state || !VALID_STATES.has(state as HostBridgeLifecycleState)
            || stateSequence === undefined || stateSequence < 0
            || mcdkPid === undefined || mcdkPid < 1
            || minecraftPid === undefined || minecraftPid < 1
            || remoteMaxFrameBytes < 1 || remoteMaxFrameBytes > HOST_BRIDGE_MAX_FRAME_BYTES
            || remoteMaxInFlightRequests < 1
        ) {
            return undefined;
        }

        return {
            registration,
            sessionId,
            generation,
            state: state as HostBridgeLifecycleState,
            stateSequence,
            startedAt: getString(session?.startedAt),
            mcdkPid,
            minecraftPid,
            projectRoot,
            worldName: getString(world?.name),
            worldFolderName: getString(world?.folderName),
            gameIpcConnected: gameIpc?.connected === true,
            debugCapabilityEnabled: capabilities?.debugCapabilityEnabled === true,
            remoteMaxFrameBytes,
            remoteMaxInFlightRequests: Math.min(remoteMaxInFlightRequests, HOST_BRIDGE_MAX_IN_FLIGHT_REQUESTS)
        };
    }

    private handleActiveMessage(connection: BridgeConnection, message: JsonObject): void {
        if (message.jsonrpc !== '2.0') {
            connection.socket.destroy();
            return;
        }
        if (typeof message.method === 'string') {
            if (Object.prototype.hasOwnProperty.call(message, 'id')) {
                this.handleInboundRequest(connection, message);
            } else {
                this.handleNotification(connection, message);
            }
            return;
        }
        this.handleResponse(connection, message);
    }

    private handleInboundRequest(connection: BridgeConnection, message: JsonObject): void {
        const id = message.id;
        if (!isJsonRpcId(id)) {
            connection.socket.destroy();
            return;
        }
        if (message.method === 'mcdk/ping') {
            this.sendMessage(connection, {
                jsonrpc: '2.0',
                id,
                result: { receivedAt: new Date().toISOString() }
            });
            return;
        }
        this.sendMessage(connection, {
            jsonrpc: '2.0',
            id,
            error: {
                code: -32601,
                message: 'Host method not found',
                data: { code: 'METHOD_NOT_FOUND' }
            }
        });
    }

    private handleNotification(connection: BridgeConnection, message: JsonObject): void {
        if (message.method === 'mcdk/cancel') {
            return;
        }
        if (message.method !== 'mcdk/session/stateChanged' || !isJsonObject(message.params)) {
            return;
        }
        const sessionId = getString(message.params.sessionId);
        const sequence = getInteger(message.params.sequence);
        const state = getString(message.params.state);
        if (
            !sessionId
            || sessionId !== connection.sessionId
            || sequence === undefined
            || !state
            || !VALID_STATES.has(state as HostBridgeLifecycleState)
        ) {
            return;
        }
        const record = this.sessions.get(sessionId);
        if (!record || sequence <= record.summary.stateSequence) {
            return;
        }

        record.summary.stateSequence = sequence;
        record.summary.state = state as HostBridgeLifecycleState;
        record.summary.gameIpcConnected = message.params.gameIpcConnected === true;
        const registration = connection.registration;
        if (registration) {
            registration.lastSeenAt = Date.now();
        }
        if (state === 'exited') {
            this.retireExitedSession(record);
        }
        this.emitRegistrationsChanged();
        this.emitChange();
    }

    private handleResponse(connection: BridgeConnection, message: JsonObject): void {
        const id = message.id;
        if (!isJsonRpcId(id)) {
            connection.socket.destroy();
            return;
        }
        const pending = connection.pending.get(rpcIdKey(id));
        if (!pending) {
            return;
        }
        const hasResult = Object.prototype.hasOwnProperty.call(message, 'result');
        const hasError = Object.prototype.hasOwnProperty.call(message, 'error');
        if (hasResult === hasError) {
            connection.socket.destroy();
            return;
        }
        connection.pending.delete(rpcIdKey(id));
        clearTimeout(pending.timer);
        if (hasResult) {
            pending.resolve(message.result);
            return;
        }

        const error = isJsonObject(message.error) ? message.error : {};
        const data = isJsonObject(error.data) ? error.data : undefined;
        pending.reject(new HostBridgeRpcError(
            getInteger(error.code) ?? -32603,
            getString(error.message) ?? 'MCDK request failed',
            data
        ));
    }

    private async discoverMethods(sessionId: string): Promise<void> {
        try {
            const result = await this.request(sessionId, 'mcdk/methods/list', {}, 3_000);
            this.applyMethodList(sessionId, result);
            this.emitChange();
        } catch {
            // Method discovery is a capability hint; the connection remains usable if it fails.
        }
    }

    private applyMethodList(sessionId: string, value: unknown): void {
        if (!isJsonObject(value) || !Array.isArray(value.methods)) {
            return;
        }
        const methods: HostBridgeMethodDescriptor[] = [];
        for (const item of value.methods) {
            if (!isJsonObject(item) || typeof item.name !== 'string') {
                continue;
            }
            methods.push({
                name: item.name,
                modes: Array.isArray(item.modes)
                    ? item.modes.filter((mode): mode is string => typeof mode === 'string')
                    : [],
                gameAvailability: getString(item.gameAvailability) ?? 'none'
            });
        }
        methods.sort((left, right) => left.name.localeCompare(right.name));
        const record = this.sessions.get(sessionId);
        if (record) {
            record.summary.methods = methods;
        }
    }

    private applySessionSnapshot(sessionId: string, value: unknown): void {
        if (!isJsonObject(value)) {
            return;
        }
        const record = this.sessions.get(sessionId);
        if (!record) {
            return;
        }
        const session = isJsonObject(value.session) ? value.session : undefined;
        const mcdk = isJsonObject(value.mcdk) ? value.mcdk : undefined;
        const minecraft = isJsonObject(value.minecraft) ? value.minecraft : undefined;
        const project = isJsonObject(value.project) ? value.project : undefined;
        const world = isJsonObject(value.world) ? value.world : undefined;
        const gameIpc = isJsonObject(value.gameIpc) ? value.gameIpc : undefined;
        const capabilities = isJsonObject(value.capabilities) ? value.capabilities : undefined;
        const state = getString(session?.state);
        const sequence = getInteger(session?.stateSequence);
        if (state && VALID_STATES.has(state as HostBridgeLifecycleState)) {
            record.summary.state = state as HostBridgeLifecycleState;
        }
        if (sequence !== undefined && sequence >= record.summary.stateSequence) {
            record.summary.stateSequence = sequence;
        }
        record.summary.startedAt = getString(session?.startedAt) ?? record.summary.startedAt;
        record.summary.mcdkPid = getInteger(mcdk?.pid) ?? record.summary.mcdkPid;
        record.summary.minecraftPid = getInteger(minecraft?.pid) ?? record.summary.minecraftPid;
        record.summary.projectRoot = getString(project?.root) ?? record.summary.projectRoot;
        record.summary.worldName = getString(world?.name) ?? record.summary.worldName;
        record.summary.worldFolderName = getString(world?.folderName) ?? record.summary.worldFolderName;
        record.summary.gameIpcConnected = gameIpc?.connected === true;
        record.summary.debugCapabilityEnabled = capabilities?.debugCapabilityEnabled === true;
    }

    private retireExitedSession(record: SessionRecord): void {
        const registrationId = record.summary.registrationId;
        if (this.registrations.delete(registrationId)) {
            this.emitRegistrationsChanged();
        }
        if (record.removalTimer) {
            clearTimeout(record.removalTimer);
        }
        record.removalTimer = setTimeout(() => {
            const current = this.sessions.get(record.summary.id);
            if (current === record) {
                this.sessions.delete(record.summary.id);
                this.emitChange();
            }
        }, 5_000);
        record.removalTimer.unref?.();
    }

    private findRegistration(candidate: string): HostBridgeRegistration | undefined {
        if (!/^[0-9a-fA-F]{64}$/.test(candidate)) {
            return undefined;
        }
        const candidateBytes = Buffer.from(candidate, 'hex');
        let match: HostBridgeRegistration | undefined;
        for (const registration of this.registrations.values()) {
            const expectedBytes = Buffer.from(registration.token, 'hex');
            if (expectedBytes.length === candidateBytes.length && crypto.timingSafeEqual(expectedBytes, candidateBytes)) {
                match = registration;
            }
        }
        return match;
    }

    private rejectHandshake(
        connection: BridgeConnection,
        id: JsonRpcId,
        code: number,
        message: string,
        symbolicCode: string
    ): void {
        if (connection.phase === 'closed') {
            return;
        }
        clearTimeout(connection.handshakeTimer);
        connection.phase = 'closed';
        let frame: Buffer;
        try {
            frame = encodeHostBridgeFrame({
                jsonrpc: '2.0',
                id,
                error: { code, message, data: { code: symbolicCode } }
            });
        } catch {
            connection.socket.destroy();
            return;
        }
        connection.socket.end(frame);
    }

    private sendMessage(connection: BridgeConnection, message: JsonObject, maxFrameBytes = connection.maxFrameBytes): boolean {
        if (connection.phase === 'closed' || connection.socket.destroyed || !connection.socket.writable) {
            return false;
        }
        let frame: Buffer;
        try {
            frame = encodeHostBridgeFrame(message, maxFrameBytes);
        } catch {
            connection.socket.destroy();
            return false;
        }
        if (connection.socket.writableLength + frame.length > MAX_WRITE_QUEUE_BYTES) {
            connection.socket.destroy();
            return false;
        }
        try {
            connection.socket.write(frame);
            return true;
        } catch {
            connection.socket.destroy();
            return false;
        }
    }

    private closeConnection(connection: BridgeConnection, reason = new HostBridgeDisconnectedError()): void {
        if (connection.phase === 'closed' && !this.connections.has(connection)) {
            return;
        }
        connection.phase = 'closed';
        clearTimeout(connection.handshakeTimer);
        connection.decoder.reset();
        this.connections.delete(connection);
        for (const pending of connection.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(reason);
        }
        connection.pending.clear();
        if (!connection.socket.destroyed) {
            connection.socket.destroy();
        }

        if (connection.sessionId) {
            const record = this.sessions.get(connection.sessionId);
            if (record?.connection === connection) {
                record.connection = undefined;
                record.summary.connected = false;
                if (connection.registration) {
                    connection.registration.lastSeenAt = Date.now();
                    this.emitRegistrationsChanged();
                }
                this.emitChange();
            }
        }
    }

    private emitChange(): void {
        this.events.emit('change', this.getSnapshot());
    }

    private emitRegistrationsChanged(): void {
        this.events.emit('registrationsChanged');
    }
}

function isLoopbackAddress(address: string | undefined): boolean {
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function isValidRegistration(value: HostBridgeRegistration): boolean {
    return typeof value.id === 'string'
        && value.id.length > 0
        && /^[0-9a-fA-F]{64}$/.test(value.token)
        && typeof value.workspacePath === 'string'
        && Number.isFinite(value.createdAt)
        && Number.isFinite(value.lastSeenAt);
}
