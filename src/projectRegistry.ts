import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const PROJECT_MARKER = '.mcdev.json';

function normalizeFsPath(value: string): string {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Caches workspaces enabled by a root-level .mcdev.json or the explicit setting.
 * Document features use this cache and never touch the file system while editing.
 */
export class McdevProjectRegistry implements vscode.Disposable {
    private readonly workspaceFolders = new Map<string, vscode.WorkspaceFolder>();
    private readonly markerFolders = new Set<string>();
    private readonly markerWatchers = new Map<string, vscode.Disposable>();
    private readonly changeEmitter = new vscode.EventEmitter<void>();
    private readonly disposables: vscode.Disposable[] = [];
    private forceEnabled = vscode.workspace
        .getConfiguration('mcdev-tools')
        .get<boolean>('enable', false);

    public readonly onDidChange = this.changeEmitter.event;

    public constructor() {
        this.addFolders(vscode.workspace.workspaceFolders ?? []);

        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(event => {
                if (!event.affectsConfiguration('mcdev-tools.enable')) {
                    return;
                }

                const nextValue = vscode.workspace
                    .getConfiguration('mcdev-tools')
                    .get<boolean>('enable', false);
                if (nextValue !== this.forceEnabled) {
                    this.forceEnabled = nextValue;
                    this.changeEmitter.fire();
                }
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(event => {
                let changed = false;

                for (const folder of event.removed) {
                    const key = this.folderKey(folder);
                    const wasEnabled = this.forceEnabled || this.markerFolders.has(key);
                    this.markerFolders.delete(key);
                    this.workspaceFolders.delete(key);
                    this.markerWatchers.get(key)?.dispose();
                    this.markerWatchers.delete(key);
                    changed = wasEnabled || changed;
                }

                changed = this.addFolders(event.added) || changed;
                if (changed) {
                    this.changeEmitter.fire();
                }
            })
        );
    }

    public get hasProjects(): boolean {
        return this.forceEnabled
            ? this.workspaceFolders.size > 0
            : this.markerFolders.size > 0;
    }

    public get folders(): readonly vscode.WorkspaceFolder[] {
        if (this.forceEnabled) {
            return [...this.workspaceFolders.values()];
        }

        return [...this.markerFolders]
            .map(key => this.workspaceFolders.get(key))
            .filter((folder): folder is vscode.WorkspaceFolder => folder !== undefined);
    }

    public getProjectFolder(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (!folder) {
            return undefined;
        }

        const key = this.folderKey(folder);
        return this.forceEnabled || this.markerFolders.has(key)
            ? this.workspaceFolders.get(key)
            : undefined;
    }

    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        for (const watcher of this.markerWatchers.values()) {
            watcher.dispose();
        }
        this.changeEmitter.dispose();
    }

    private addFolders(folders: readonly vscode.WorkspaceFolder[]): boolean {
        let changed = false;

        for (const folder of folders) {
            const key = this.folderKey(folder);
            this.workspaceFolders.set(key, folder);
            changed = this.forceEnabled || changed;
            this.addMarkerWatcher(folder, key);

            // This is the only initial marker IO: one existence check per workspace root.
            const markerPath = path.join(folder.uri.fsPath, PROJECT_MARKER);
            if (fs.existsSync(markerPath)) {
                this.markerFolders.add(key);
                changed = true;
            }
        }

        return changed;
    }

    private handleMarkerChange(uri: vscode.Uri, exists: boolean): void {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (!folder || normalizeFsPath(uri.fsPath) !== normalizeFsPath(path.join(folder.uri.fsPath, PROJECT_MARKER))) {
            return;
        }

        const key = this.folderKey(folder);
        const changed = exists
            ? !this.markerFolders.has(key)
            : this.markerFolders.has(key);

        if (!changed) {
            return;
        }

        if (exists) {
            this.workspaceFolders.set(key, folder);
            this.markerFolders.add(key);
        } else {
            this.markerFolders.delete(key);
        }

        if (!this.forceEnabled) {
            this.changeEmitter.fire();
        }
    }

    private addMarkerWatcher(folder: vscode.WorkspaceFolder, key: string): void {
        if (this.markerWatchers.has(key)) {
            return;
        }

        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(folder, PROJECT_MARKER)
        );
        this.markerWatchers.set(key, vscode.Disposable.from(
            watcher,
            watcher.onDidCreate(uri => this.handleMarkerChange(uri, true)),
            watcher.onDidDelete(uri => this.handleMarkerChange(uri, false))
        ));
    }

    private folderKey(folder: vscode.WorkspaceFolder): string {
        return normalizeFsPath(folder.uri.fsPath);
    }
}
