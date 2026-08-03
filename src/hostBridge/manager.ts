import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { McdevConfigStore } from '../config';
import { HostBridgeRpcError, HostBridgeServer } from './server';
import {
    DisposableLike,
    HostBridgeSnapshot,
    PreparedHostBridgeLaunch
} from './types';

const INSTANCE_ID_KEY = 'hostBridge.instanceId';
const PORT_KEY = 'hostBridge.port';
const CREDENTIALS_KEY_PREFIX = 'mcdev-tools.hostBridge.credentials';
const PRUNE_INTERVAL_MS = 10 * 60 * 1_000;

export class HostBridgeManager implements vscode.Disposable {
    private readonly server: HostBridgeServer;
    private readonly terminalRegistrations = new Map<vscode.Terminal, string>();
    private readonly terminalSubscription: vscode.Disposable;
    private readonly pruneTimer: NodeJS.Timeout;
    private disposePromise?: Promise<void>;
    private disposed = false;

    private constructor(
        context: vscode.ExtensionContext,
        private readonly configStore: McdevConfigStore,
        instanceId: string
    ) {
        const packageJson = context.extension.packageJSON as { name?: string; version?: string };
        this.server = new HostBridgeServer({
            name: packageJson.name ?? 'mcdev-tools',
            version: packageJson.version ?? '0.0.0',
            instanceId
        });
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
        await Promise.all([
            context.workspaceState.update(PORT_KEY, undefined),
            context.secrets.delete(`${CREDENTIALS_KEY_PREFIX}.${instanceId}`)
        ]);
        return new HostBridgeManager(context, configStore, instanceId);
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
            await this.server.start(0);
        }
        return this.server.registerLaunch(workspacePath);
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
        await this.server.dispose();
    }

    private assertNotDisposed(): void {
        if (this.disposed) {
            throw new Error('Host Bridge manager has been disposed');
        }
    }
}
