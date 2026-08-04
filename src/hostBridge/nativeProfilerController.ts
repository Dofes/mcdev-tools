import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { HostBridgeManager } from './manager';
import { NativeProfilerCapture } from './nativeProfilerCapture';
import { openNativeProfilerSource } from './nativeProfilerNavigation';
import { discoverTracyListeners, NativeProfilerEndpoint } from './nativeProfilerPortDiscovery';
import { NativeProfilerReportFiles, writeNativeProfilerReport } from './nativeProfilerReport';
import { NativeProfilerResult } from './nativeProfilerTypes';
import { HostBridgeSnapshot } from './types';

interface NativeProfilerRuntime {
    key: string;
    sessionId: string;
    connectionGeneration: number;
    pid: number;
    port: number;
    maximumSeconds: number;
    startedAt: number;
    status: 'capturing' | 'analyzing';
    capture: NativeProfilerCapture;
    webview: vscode.Webview;
    cancelled: boolean;
    task?: Promise<void>;
}

interface NativeProfilerCompleted {
    pid: number;
    port: number;
    capturedAt: string;
    result: NativeProfilerResult;
    capture: NativeProfilerCapture;
    report?: NativeProfilerReportFiles;
    reportError?: string;
}

const SCAN_INTERVAL_MS = 1_000;

export class NativeProfilerController implements vscode.Disposable {
    private readonly activeWebviews = new Set<vscode.Webview>();
    private readonly endpoints = new Map<string, NativeProfilerEndpoint>();
    private readonly runtimes = new Map<string, NativeProfilerRuntime>();
    private readonly completed = new Map<string, NativeProfilerCompleted>();
    private readonly pendingOperations = new Set<Promise<unknown>>();
    private readonly cleanupTasks = new Set<Promise<unknown>>();
    private scanTimer?: NodeJS.Timeout;
    private scanBusy = false;
    private scanGeneration = 0;
    private panelVisible = true;
    private disposed = false;
    private disposePromise?: Promise<void>;
    private suspendPromise?: Promise<void>;

    constructor(
        private readonly extensionRoot: string,
        private readonly hostBridgeManager: HostBridgeManager
    ) {}

    public handleMessage(webview: vscode.Webview, message: any): Promise<boolean> {
        if (typeof message?.type !== 'string' || !message.type.startsWith('nativeProfiler')) {
            return Promise.resolve(false);
        }
        if (this.disposed) {
            return Promise.resolve(true);
        }
        const operation = this.handleActiveMessage(webview, message);
        this.pendingOperations.add(operation);
        void operation.finally(() => this.pendingOperations.delete(operation)).catch(() => undefined);
        return operation;
    }

    private async handleActiveMessage(webview: vscode.Webview, message: any): Promise<boolean> {
        if (message.type === 'nativeProfilerActivate') {
            this.activeWebviews.add(webview);
            this.ensureScanner();
            await this.scanNow();
            await this.postStateForMessage(webview, message);
            return true;
        }
        if (message.type === 'nativeProfilerDeactivate') {
            this.activeWebviews.delete(webview);
            if (this.activeWebviews.size === 0) {
                this.stopScanner();
            }
            return true;
        }

        const requestId = boundedString(message.requestId, 128);
        const sessionId = boundedString(message.sessionId, 128);
        const connectionGeneration = Number.isInteger(message.connectionGeneration)
            ? Number(message.connectionGeneration)
            : -1;
        if (!requestId || !sessionId || connectionGeneration < 0) {
            return true;
        }
        const key = runtimeKey(sessionId, connectionGeneration);
        try {
            switch (message.type) {
                case 'nativeProfilerState':
                    await this.postState(webview, requestId, sessionId, connectionGeneration);
                    break;
                case 'nativeProfilerStart':
                    await this.start(webview, sessionId, connectionGeneration, readMaximumSeconds(message.maximumSeconds));
                    await this.postState(webview, requestId, sessionId, connectionGeneration);
                    break;
                case 'nativeProfilerStop':
                    await this.stop(key);
                    await this.postState(webview, requestId, sessionId, connectionGeneration);
                    break;
                case 'nativeProfilerSave':
                    await this.save(key, sessionId);
                    await this.postState(webview, requestId, sessionId, connectionGeneration);
                    break;
                case 'nativeProfilerOpenReport':
                    await this.openReport(key);
                    break;
                case 'nativeProfilerReveal':
                    await this.reveal(key);
                    break;
                case 'nativeProfilerOpenSource':
                    await this.openSource(key, sessionId, message.zoneId);
                    break;
            }
        } catch (error) {
            await this.postState(webview, requestId, sessionId, connectionGeneration).catch(() => undefined);
            await webview.postMessage({
                type: 'nativeProfilerError',
                requestId,
                sessionId,
                connectionGeneration,
                message: error instanceof Error ? error.message : String(error)
            });
        }
        return true;
    }

    public reconcile(snapshot: HostBridgeSnapshot): void {
        if (
            this.disposed
            || (this.activeWebviews.size === 0 && this.runtimes.size === 0 && this.completed.size === 0)
        ) {
            return;
        }
        const valid = new Set(snapshot.sessions.map(session => runtimeKey(session.id, session.connectionGeneration)));
        for (const [key, runtime] of this.runtimes) {
            const session = snapshot.sessions.find(item => item.id === runtime.sessionId);
            if (session?.connected && session.minecraftPid === runtime.pid && valid.has(key)) {
                continue;
            }
            runtime.cancelled = true;
            this.runtimes.delete(key);
            this.trackCleanup(this.disposeRuntime(runtime));
        }
        for (const [key, completed] of this.completed) {
            if (!valid.has(key)) {
                this.completed.delete(key);
                this.trackCleanup(completed.capture.dispose());
            }
        }
        if (this.activeWebviews.size > 0) {
            void this.scanNow();
        }
    }

    public setPanelVisible(visible: boolean): void {
        if (this.panelVisible === visible || this.disposed) {
            return;
        }
        this.panelVisible = visible;
        if (visible && this.activeWebviews.size > 0) {
            this.ensureScanner();
            void this.scanNow();
        } else if (!visible) {
            this.stopScanner();
        }
    }

    public dispose(): void {
        void this.disposeAsync();
    }

    public disposeAsync(): Promise<void> {
        this.disposePromise ??= this.performDispose();
        return this.disposePromise;
    }

    private async start(
        webview: vscode.Webview,
        sessionId: string,
        connectionGeneration: number,
        maximumSeconds: number
    ): Promise<void> {
        if (!this.activeWebviews.has(webview) || !this.panelVisible) {
            throw new Error('Native profiler page is not active');
        }
        const session = this.hostBridgeManager.getSnapshot().sessions.find(item => (
            item.id === sessionId && item.connectionGeneration === connectionGeneration
        ));
        if (!session?.connected || session.state !== 'game_ready' || !session.minecraftPid) {
            throw new Error('The selected game process is unavailable');
        }
        const key = runtimeKey(sessionId, connectionGeneration);
        if (this.runtimes.has(key)) {
            throw new Error('A native capture is already active for this game session');
        }
        const endpoint = this.endpoints.get(key);
        if (!endpoint || endpoint.pid !== session.minecraftPid) {
            await this.scanNow();
        }
        const currentEndpoint = this.endpoints.get(key);
        if (!currentEndpoint || currentEndpoint.pid !== session.minecraftPid) {
            throw new Error('No Tracy endpoint was detected for the selected game process');
        }
        if (this.runtimes.size > 0) {
            throw new Error('Only one native capture can run in this VS Code extension host at a time');
        }
        const previous = this.completed.get(key);
        if (previous) {
            this.completed.delete(key);
            await previous.capture.dispose();
        }
        const capture = await NativeProfilerCapture.start({
            extensionRoot: this.extensionRoot,
            port: currentEndpoint.port,
            maximumSeconds
        });
        const runtime: NativeProfilerRuntime = {
            key,
            sessionId,
            connectionGeneration,
            pid: currentEndpoint.pid,
            port: currentEndpoint.port,
            maximumSeconds,
            startedAt: Date.now(),
            status: 'capturing',
            capture,
            webview,
            cancelled: false
        };
        this.runtimes.set(key, runtime);
        runtime.task = this.finishCapture(runtime);
        void runtime.task;
    }

    private async stop(key: string): Promise<void> {
        const runtime = this.runtimes.get(key);
        if (!runtime || runtime.status !== 'capturing') {
            throw new Error('No native profile is active for this game session');
        }
        await runtime.capture.stop();
    }

    private async finishCapture(runtime: NativeProfilerRuntime): Promise<void> {
        try {
            const captureResult = await runtime.capture.completion;
            if (runtime.cancelled || this.runtimes.get(runtime.key) !== runtime) {
                return;
            }
            runtime.status = 'analyzing';
            await this.postState(runtime.webview, `auto:${Date.now()}`, runtime.sessionId, runtime.connectionGeneration);
            const result = captureResult.result;
            if (runtime.cancelled || this.runtimes.get(runtime.key) !== runtime) {
                return;
            }
            this.completed.set(runtime.key, {
                pid: runtime.pid,
                port: runtime.port,
                capturedAt: new Date().toISOString(),
                result,
                capture: runtime.capture
            });
        } catch (error) {
            if (!runtime.cancelled) {
                await runtime.webview.postMessage({
                    type: 'nativeProfilerError',
                    requestId: `auto:${Date.now()}`,
                    sessionId: runtime.sessionId,
                    connectionGeneration: runtime.connectionGeneration,
                    message: error instanceof Error ? error.message : String(error)
                });
                await runtime.capture.dispose();
            }
        } finally {
            if (this.runtimes.get(runtime.key) === runtime) {
                this.runtimes.delete(runtime.key);
            }
            if (!runtime.cancelled) {
                await this.postState(
                    runtime.webview,
                    `auto:${Date.now()}`,
                    runtime.sessionId,
                    runtime.connectionGeneration
                ).catch(() => undefined);
            } else {
                await runtime.capture.dispose();
            }
        }
    }

    private async save(key: string, sessionId: string): Promise<void> {
        const completed = this.completed.get(key);
        if (!completed) {
            throw new Error('No native profile result is available');
        }
        if (completed.report) {
            return;
        }
        const session = this.hostBridgeManager.getSnapshot().sessions.find(item => item.id === sessionId);
        if (!session?.projectRoot) {
            throw new Error('The selected game session has no project root');
        }
        try {
            completed.report = await writeNativeProfilerReport({
                projectRoot: path.resolve(session.projectRoot),
                sourceTracePath: completed.capture.tracePath,
                capturedAt: new Date(completed.capturedAt),
                worldName: session.worldName || session.worldFolderName,
                pid: completed.pid,
                port: completed.port,
                result: completed.result
            });
            completed.reportError = undefined;
        } catch (error) {
            completed.reportError = error instanceof Error ? error.message : String(error);
            throw error;
        }
    }

    private async openReport(key: string): Promise<void> {
        const report = this.completed.get(key)?.report;
        if (!report) {
            throw new Error('Save the native profile before opening its report');
        }
        const document = await vscode.workspace.openTextDocument(report.markdownPath);
        await vscode.window.showTextDocument(document, { preview: true });
    }

    private async reveal(key: string): Promise<void> {
        const report = this.completed.get(key)?.report;
        if (!report) {
            throw new Error('Save the native profile before revealing it');
        }
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(report.tracePath));
    }

    private async openSource(key: string, sessionId: string, rawZoneId: unknown): Promise<void> {
        const zoneId = typeof rawZoneId === 'number' && Number.isInteger(rawZoneId) ? rawZoneId : -1;
        const zone = this.completed.get(key)?.result.zones.find(item => item.id === zoneId);
        const session = this.hostBridgeManager.getSnapshot().sessions.find(item => item.id === sessionId);
        if (!zone || !session?.projectRoot || !zone.sourceFile) {
            throw new Error('The selected native source location is unavailable');
        }
        await openNativeProfilerSource(session.projectRoot, zone.sourceFile, zone.sourceLine);
    }

    private ensureScanner(): void {
        if (this.scanTimer || this.activeWebviews.size === 0 || !this.panelVisible) {
            return;
        }
        this.scanTimer = setInterval(() => void this.scanNow(), SCAN_INTERVAL_MS);
        this.scanTimer.unref?.();
    }

    private stopScanner(): void {
        this.scanGeneration += 1;
        if (this.scanTimer) {
            clearInterval(this.scanTimer);
            this.scanTimer = undefined;
        }
    }

    private async scanNow(): Promise<void> {
        if (this.scanBusy || this.activeWebviews.size === 0 || !this.panelVisible || this.disposed) {
            return;
        }
        this.scanBusy = true;
        const generation = this.scanGeneration;
        try {
            const listeners = await discoverTracyListeners();
            if (
                generation !== this.scanGeneration
                || this.activeWebviews.size === 0
                || !this.panelVisible
                || this.disposed
            ) {
                return;
            }
            const byPid = new Map(listeners.map(endpoint => [endpoint.pid, endpoint]));
            const next = new Map<string, NativeProfilerEndpoint>();
            for (const session of this.hostBridgeManager.getSnapshot().sessions) {
                const endpoint = session.minecraftPid ? byPid.get(session.minecraftPid) : undefined;
                if (endpoint) {
                    next.set(runtimeKey(session.id, session.connectionGeneration), endpoint);
                }
            }
            if (!endpointMapsEqual(this.endpoints, next)) {
                this.endpoints.clear();
                for (const [key, endpoint] of next) this.endpoints.set(key, endpoint);
                await this.broadcastStates();
            }
        } catch (error) {
            await this.broadcastError(error);
        } finally {
            this.scanBusy = false;
        }
    }

    private async postStateForMessage(webview: vscode.Webview, message: any): Promise<void> {
        const requestId = boundedString(message.requestId, 128);
        const sessionId = boundedString(message.sessionId, 128);
        const generation = Number.isInteger(message.connectionGeneration) ? Number(message.connectionGeneration) : -1;
        if (requestId && sessionId && generation >= 0) {
            await this.postState(webview, requestId, sessionId, generation);
        }
    }

    private async postState(
        webview: vscode.Webview,
        requestId: string,
        sessionId: string,
        connectionGeneration: number
    ): Promise<void> {
        const key = runtimeKey(sessionId, connectionGeneration);
        const runtime = this.runtimes.get(key);
        const completed = this.completed.get(key);
        await webview.postMessage({
            type: 'nativeProfilerState',
            requestId,
            sessionId,
            connectionGeneration,
            endpoint: this.endpoints.get(key),
            status: runtime?.status ?? 'idle',
            maximumSeconds: runtime?.maximumSeconds,
            startedAt: runtime ? new Date(runtime.startedAt).toISOString() : undefined,
            completed: completed ? {
                pid: completed.pid,
                port: completed.port,
                capturedAt: completed.capturedAt,
                result: completed.result,
                report: completed.report,
                reportError: completed.reportError
            } : undefined
        });
    }

    private async broadcastStates(): Promise<void> {
        const snapshot = this.hostBridgeManager.getSnapshot();
        await Promise.all([...this.activeWebviews].flatMap(webview => snapshot.sessions.map(session => (
            this.postState(webview, `scan:${Date.now()}`, session.id, session.connectionGeneration)
        ))));
    }

    private async broadcastError(error: unknown): Promise<void> {
        const message = error instanceof Error ? error.message : String(error);
        await Promise.all([...this.activeWebviews].map(webview => webview.postMessage({
            type: 'nativeProfilerScanError',
            message
        })));
    }

    private suspend(): Promise<void> {
        if (!this.suspendPromise) {
            const operation = this.performSuspend();
            const tracked = operation.finally(() => {
                if (this.suspendPromise === tracked) {
                    this.suspendPromise = undefined;
                }
            });
            this.suspendPromise = tracked;
        }
        return this.suspendPromise;
    }

    private async performSuspend(): Promise<void> {
        this.stopScanner();
        this.endpoints.clear();
        const runtimes = [...this.runtimes.values()];
        this.runtimes.clear();
        for (const runtime of runtimes) runtime.cancelled = true;
        const completed = [...this.completed.values()];
        this.completed.clear();
        await Promise.all([
            ...runtimes.map(runtime => this.disposeRuntime(runtime)),
            ...completed.map(item => item.capture.dispose())
        ]);
    }

    private async performDispose(): Promise<void> {
        this.disposed = true;
        this.activeWebviews.clear();
        await Promise.allSettled([...this.pendingOperations]);
        await this.suspend();
        await this.drainCleanupTasks();
    }

    private async disposeRuntime(runtime: NativeProfilerRuntime): Promise<void> {
        await runtime.capture.dispose();
        await runtime.task?.catch(() => undefined);
    }

    private trackCleanup(task: Promise<unknown>): void {
        this.cleanupTasks.add(task);
        void task.finally(() => this.cleanupTasks.delete(task)).catch(error => {
            console.error('Failed to clean up a native profile capture', error);
        });
    }

    private async drainCleanupTasks(): Promise<void> {
        while (this.cleanupTasks.size > 0) {
            await Promise.allSettled([...this.cleanupTasks]);
        }
    }
}

function runtimeKey(sessionId: string, connectionGeneration: number): string {
    return `${sessionId}:${connectionGeneration}`;
}

function readMaximumSeconds(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('Maximum capture time is invalid');
    }
    const seconds = Math.ceil(value);
    if (seconds < 1 || seconds > 3600) {
        throw new Error('Maximum capture time must be between 1 and 3600 seconds');
    }
    return seconds;
}

function boundedString(value: unknown, maximum: number): string | undefined {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : undefined;
}

function endpointMapsEqual(
    left: Map<string, NativeProfilerEndpoint>,
    right: Map<string, NativeProfilerEndpoint>
): boolean {
    if (left.size !== right.size) return false;
    for (const [key, endpoint] of left) {
        const other = right.get(key);
        if (!other || other.pid !== endpoint.pid || other.port !== endpoint.port) return false;
    }
    return true;
}
