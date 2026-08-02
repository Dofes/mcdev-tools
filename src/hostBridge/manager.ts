import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { McdevConfigStore } from '../config';
import { HostBridgeRpcError, HostBridgeServer } from './server';
import {
    DisposableLike,
    HostBridgeRegistration,
    HostBridgeSnapshot,
    PreparedHostBridgeLaunch
} from './types';

const INSTANCE_ID_KEY = 'hostBridge.instanceId';
const PORT_KEY = 'hostBridge.port';
const CREDENTIALS_KEY_PREFIX = 'mcdev-tools.hostBridge.credentials';
const PRUNE_INTERVAL_MS = 10 * 60 * 1_000;

export class HostBridgeManager implements vscode.Disposable {
    private readonly server: HostBridgeServer;
    private readonly secretKey: string;
    private readonly terminalRegistrations = new Map<vscode.Terminal, string>();
    private readonly serverSubscriptions: DisposableLike[] = [];
    private readonly terminalSubscription: vscode.Disposable;
    private readonly pruneTimer: NodeJS.Timeout;
    private persistenceTail: Promise<void> = Promise.resolve();
    private disposePromise?: Promise<void>;
    private disposed = false;

    private constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly configStore: McdevConfigStore,
        instanceId: string,
        registrations: HostBridgeRegistration[]
    ) {
        const packageJson = context.extension.packageJSON as { name?: string; version?: string };
        this.secretKey = `${CREDENTIALS_KEY_PREFIX}.${instanceId}`;
        this.server = new HostBridgeServer({
            name: packageJson.name ?? 'mcdev-tools',
            version: packageJson.version ?? '0.0.0',
            instanceId
        }, registrations);

        this.serverSubscriptions.push(this.server.onDidChangeRegistrations(() => {
            void this.persistRegistrations().catch(error => {
                console.error('[HostBridge] Failed to persist credentials:', error);
            });
        }));
        this.terminalSubscription = vscode.window.onDidCloseTerminal(terminal => {
            const registrationId = this.terminalRegistrations.get(terminal);
            if (!registrationId) {
                return;
            }
            this.terminalRegistrations.delete(terminal);
            this.server.releaseRegistration(registrationId);
        });

        this.pruneTimer = setInterval(() => this.server.pruneRegistrations(), PRUNE_INTERVAL_MS);
        this.pruneTimer.unref?.();
    }

    public static async create(
        context: vscode.ExtensionContext,
        configStore: McdevConfigStore
    ): Promise<HostBridgeManager> {
        let instanceId = context.workspaceState.get<string>(INSTANCE_ID_KEY);
        if (!instanceId) {
            instanceId = crypto.randomUUID();
            await context.workspaceState.update(INSTANCE_ID_KEY, instanceId);
        }
        const secretKey = `${CREDENTIALS_KEY_PREFIX}.${instanceId}`;
        const serialized = await context.secrets.get(secretKey);
        const storedRegistrations = parseRegistrations(serialized);
        const registrations: HostBridgeRegistration[] = [];
        for (const registration of storedRegistrations) {
            try {
                if (await configStore.isGameDebuggerEnabled(registration.workspacePath)) {
                    registrations.push(registration);
                }
            } catch (error) {
                console.error(`[HostBridge] Could not restore configuration for ${registration.workspacePath}:`, error);
            }
        }
        const manager = new HostBridgeManager(context, configStore, instanceId, registrations);
        await manager.restoreListener();
        if (registrations.length !== storedRegistrations.length) {
            await manager.persistRegistrations();
        }
        return manager;
    }

    public onDidChange(listener: (snapshot: HostBridgeSnapshot) => void): DisposableLike {
        return this.server.onDidChange(listener);
    }

    public getSnapshot(): HostBridgeSnapshot {
        return this.server.getSnapshot();
    }

    public async prepareLaunch(workspacePath: string): Promise<PreparedHostBridgeLaunch | undefined> {
        this.assertNotDisposed();
        if (!await this.configStore.isGameDebuggerEnabled(workspacePath)) {
            return undefined;
        }
        if (!this.server.isListening) {
            // Port 0 delegates collision-free ephemeral port selection to the OS.
            const port = await this.server.start(0);
            await this.context.workspaceState.update(PORT_KEY, port);
        }

        const launch = this.server.registerLaunch(workspacePath);
        try {
            await this.persistRegistrations();
            return launch;
        } catch (error) {
            this.server.releaseRegistration(launch.registrationId);
            throw error;
        }
    }

    public trackTerminal(registrationId: string, terminal: vscode.Terminal): void {
        this.assertNotDisposed();
        this.terminalRegistrations.set(terminal, registrationId);
    }

    public releaseLaunch(registrationId: string): void {
        this.server.releaseRegistration(registrationId);
    }

    public async executeCode(sessionId: string, code: string, isClient: boolean): Promise<unknown> {
        if (!code.trim()) {
            throw new HostBridgeRpcError(-32602, 'Code cannot be empty', { code: 'INVALID_PARAMS' });
        }
        if (Buffer.byteLength(code, 'utf8') > 1024 * 1024) {
            throw new HostBridgeRpcError(-32602, 'Code exceeds the 1 MiB editor limit', { code: 'INVALID_PARAMS' });
        }
        return this.server.request(sessionId, 'game/code/execute', { code, isClient }, 15_000);
    }

    public async refreshSessions(): Promise<void> {
        // Explicit UI refresh only. Session readiness otherwise comes from stateChanged notifications.
        await this.server.refreshSessions();
    }

    public dispose(): void {
        void this.disposeAsync();
    }

    public disposeAsync(): Promise<void> {
        if (!this.disposePromise) {
            this.disposePromise = this.performDispose();
        }
        return this.disposePromise;
    }

    private async performDispose(): Promise<void> {
        this.disposed = true;
        clearInterval(this.pruneTimer);
        this.terminalSubscription.dispose();
        this.terminalRegistrations.clear();
        for (const subscription of this.serverSubscriptions) {
            subscription.dispose();
        }
        this.serverSubscriptions.length = 0;
        await this.server.dispose();
        await this.persistRegistrations().catch(error => {
            console.error('[HostBridge] Failed to persist credentials during shutdown:', error);
        });
    }

    private async restoreListener(): Promise<void> {
        this.server.pruneRegistrations();
        const registrations = this.server.exportRegistrations();
        const port = this.context.workspaceState.get<number>(PORT_KEY);
        if (registrations.length === 0) {
            return;
        }
        if (!Number.isInteger(port) || port === undefined || port < 1 || port > 65_535) {
            for (const registration of registrations) {
                this.server.releaseRegistration(registration.id);
            }
            await this.persistRegistrations();
            return;
        }

        try {
            await this.server.start(port);
        } catch (error) {
            console.error(`[HostBridge] Could not restore listener on 127.0.0.1:${port}:`, error);
            for (const registration of registrations) {
                this.server.releaseRegistration(registration.id);
            }
            await this.context.workspaceState.update(PORT_KEY, undefined);
            await this.persistRegistrations();
        }
    }

    private persistRegistrations(): Promise<void> {
        this.persistenceTail = this.persistenceTail
            .catch(() => undefined)
            .then(async () => {
                const registrations = this.server.exportRegistrations();
                if (registrations.length === 0) {
                    await this.context.secrets.delete(this.secretKey);
                    return;
                }
                await this.context.secrets.store(this.secretKey, JSON.stringify(registrations));
            });
        return this.persistenceTail;
    }

    private assertNotDisposed(): void {
        if (this.disposed) {
            throw new Error('Host Bridge manager has been disposed');
        }
    }
}

function parseRegistrations(serialized: string | undefined): HostBridgeRegistration[] {
    if (!serialized) {
        return [];
    }
    try {
        const parsed: unknown = JSON.parse(serialized);
        return Array.isArray(parsed) ? parsed as HostBridgeRegistration[] : [];
    } catch {
        return [];
    }
}
