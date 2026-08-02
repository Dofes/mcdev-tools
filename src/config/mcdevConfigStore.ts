import * as path from 'path';
import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';
import { McdevConfig } from '../types';

export interface McdevConfigSnapshot {
    readonly exists: boolean;
    readonly config: McdevConfig;
}

export class McdevConfigStore implements vscode.Disposable {
    private readonly cache = new Map<string, Promise<McdevConfigSnapshot>>();
    private readonly selfWrites = new Set<string>();
    private readonly selfWriteExpiryTimers = new Map<string, NodeJS.Timeout>();
    private readonly changeEmitter = new vscode.EventEmitter<string>();
    private readonly watcher: vscode.FileSystemWatcher;
    private disposed = false;

    constructor() {
        this.watcher = vscode.workspace.createFileSystemWatcher('**/.mcdev.json');
        this.watcher.onDidChange(uri => this.handleFileEvent(uri));
        this.watcher.onDidCreate(uri => this.handleFileEvent(uri));
        this.watcher.onDidDelete(uri => this.handleFileEvent(uri));
    }

    public readonly onDidChange = this.changeEmitter.event;

    public getSnapshot(workspacePath: string): Promise<McdevConfigSnapshot> {
        this.assertNotDisposed();
        const key = workspaceKey(workspacePath);
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }

        const pending = this.readSnapshot(workspacePath).catch(error => {
            this.cache.delete(key);
            throw error;
        });
        this.cache.set(key, pending);
        return pending;
    }

    public async isGameDebuggerEnabled(workspacePath: string): Promise<boolean> {
        const snapshot = await this.getSnapshot(workspacePath);
        return isGameDebuggerEnabled(snapshot.config);
    }

    public async write(workspacePath: string, content: string): Promise<void> {
        this.assertNotDisposed();
        const config = parseConfig(content);
        const key = workspaceKey(workspacePath);
        const configUri = configUriFor(workspacePath);
        const previousExpiry = this.selfWriteExpiryTimers.get(key);
        if (previousExpiry) {
            clearTimeout(previousExpiry);
            this.selfWriteExpiryTimers.delete(key);
        }
        this.selfWrites.add(key);
        try {
            await vscode.workspace.fs.writeFile(configUri, Buffer.from(content, 'utf8'));
            this.cache.set(key, Promise.resolve({ exists: true, config }));
            this.changeEmitter.fire(workspacePath);
            if (this.selfWrites.has(key)) {
                const selfWriteExpiry = setTimeout(() => {
                    this.selfWrites.delete(key);
                    this.selfWriteExpiryTimers.delete(key);
                }, 1_000);
                selfWriteExpiry.unref?.();
                this.selfWriteExpiryTimers.set(key, selfWriteExpiry);
            }
        } catch (error) {
            this.selfWrites.delete(key);
            this.cache.delete(key);
            throw error;
        }
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.watcher.dispose();
        this.changeEmitter.dispose();
        for (const timer of this.selfWriteExpiryTimers.values()) {
            clearTimeout(timer);
        }
        this.cache.clear();
        this.selfWrites.clear();
        this.selfWriteExpiryTimers.clear();
    }

    private async readSnapshot(workspacePath: string): Promise<McdevConfigSnapshot> {
        try {
            const bytes = await vscode.workspace.fs.readFile(configUriFor(workspacePath));
            return {
                exists: true,
                config: parseConfig(Buffer.from(bytes).toString('utf8'))
            };
        } catch (error) {
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                return { exists: false, config: {} };
            }
            throw error;
        }
    }

    private handleFileEvent(uri: vscode.Uri): void {
        const workspacePath = workspacePathForConfigUri(uri);
        if (!workspacePath) {
            return;
        }
        const key = workspaceKey(workspacePath);
        if (this.selfWrites.delete(key)) {
            const timer = this.selfWriteExpiryTimers.get(key);
            if (timer) {
                clearTimeout(timer);
                this.selfWriteExpiryTimers.delete(key);
            }
            return;
        }
        this.cache.delete(key);
        this.changeEmitter.fire(workspacePath);
    }

    private assertNotDisposed(): void {
        if (this.disposed) {
            throw new Error('.mcdev.json configuration store has been disposed');
        }
    }
}

export function isGameDebuggerEnabled(config: McdevConfig): boolean {
    return config.mcdev_tools?.game_debugger?.enabled === true;
}

function parseConfig(content: string): McdevConfig {
    const parsed: unknown = jsonc.parse(content) ?? {};
    return isObject(parsed) ? parsed as McdevConfig : {};
}

function configUriFor(workspacePath: string): vscode.Uri {
    return vscode.Uri.file(path.join(workspacePath, '.mcdev.json'));
}

function workspacePathForConfigUri(uri: vscode.Uri): string | undefined {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        if (workspaceKey(folder.uri.fsPath) === workspaceKey(path.dirname(uri.fsPath))) {
            return folder.uri.fsPath;
        }
    }
    return undefined;
}

function workspaceKey(workspacePath: string): string {
    const normalized = path.normalize(workspacePath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
