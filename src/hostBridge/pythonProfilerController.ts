import * as path from 'path';
import * as vscode from 'vscode';
import { HostBridgeManager } from './manager';
import {
    buildPythonProfilerCleanupCode,
    buildPythonProfilerCollectCode,
    buildPythonProfilerStartCode,
    parsePythonProfilerResult,
    parsePythonProfilerStart,
    PythonProfilerClock,
    PythonProfilerResult,
    PythonProfilerTarget
} from './pythonProfiler';
import {
    PythonProfilerReportFiles,
    writePythonProfilerReport
} from './pythonProfilerReport';
import { openPythonProfilerSource } from './pythonProfilerNavigation';
import { HostBridgeSnapshot } from './types';

interface PythonProfilerRuntime {
    key: string;
    sessionId: string;
    connectionGeneration: number;
    target: PythonProfilerTarget;
    clock: PythonProfilerClock;
    durationSeconds?: number;
    startedAt: number;
    timer?: NodeJS.Timeout;
    collecting: boolean;
    webview: vscode.Webview;
}

interface PythonProfilerCompletedState {
    target: PythonProfilerTarget;
    clock: PythonProfilerClock;
    capturedAt: string;
    result: PythonProfilerResult;
    report?: PythonProfilerReportFiles;
    reportError?: string;
}

const MAX_TIMER_DELAY_MS = 2_000_000_000;
const GAME_TIMER_SETTLE_MS = 150;

export class PythonProfilerController implements vscode.Disposable {
    private readonly runtimes = new Map<string, PythonProfilerRuntime>();
    private readonly completed = new Map<string, PythonProfilerCompletedState>();
    private readonly operations = new Map<string, Promise<void>>();
    private disposePromise?: Promise<void>;
    private disposed = false;

    constructor(private readonly hostBridgeManager: HostBridgeManager) {}

    public async handleMessage(webview: vscode.Webview, message: any): Promise<boolean> {
        if (typeof message?.type !== 'string' || !message.type.startsWith('pythonProfiler')) {
            return false;
        }
        if (this.disposed) {
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
        const target = readTarget(message.target);
        try {
            if (message.type === 'pythonProfilerState') {
                await this.postState(webview, requestId, sessionId, connectionGeneration);
                return true;
            }
            if (!target) {
                throw new Error('Invalid Python profiler target');
            }
            const key = runtimeKey(sessionId, connectionGeneration, target);
            switch (message.type) {
                case 'pythonProfilerStart':
                    await this.runExclusive(key, () => this.start(
                        webview,
                        sessionId,
                        connectionGeneration,
                        target,
                        message.clock === 'WALL' ? 'WALL' : 'CPU',
                        readDuration(message.durationSeconds)
                    ));
                    await this.postState(webview, requestId, sessionId, connectionGeneration);
                    return true;
                case 'pythonProfilerStop':
                    await this.runExclusive(key, () => this.collect(key, webview));
                    await this.postState(webview, requestId, sessionId, connectionGeneration);
                    return true;
                case 'pythonProfilerSaveReport':
                    await this.runExclusive(key, () => this.saveReport(key, sessionId));
                    await this.postState(webview, requestId, sessionId, connectionGeneration);
                    return true;
                case 'pythonProfilerOpenReport':
                    await this.openReport(key, message.kind === 'svg' ? 'svg' : 'markdown');
                    return true;
                case 'pythonProfilerRevealReport':
                    await this.revealReport(key);
                    return true;
                case 'pythonProfilerOpenFunction':
                    await this.openFunction(key, sessionId, message.functionId);
                    return true;
            }
        } catch (error) {
            await this.postState(
                webview, requestId, sessionId, connectionGeneration
            ).catch(() => undefined);
            await webview.postMessage({
                type: 'pythonProfilerError',
                requestId,
                sessionId,
                connectionGeneration,
                target,
                message: error instanceof Error ? error.message : String(error)
            });
        }
        return true;
    }

    public reconcile(snapshot: HostBridgeSnapshot): void {
        for (const [key, runtime] of this.runtimes) {
            const session = snapshot.sessions.find(item => item.id === runtime.sessionId);
            if (
                session?.connected
                && session.state === 'game_ready'
                && session.connectionGeneration === runtime.connectionGeneration
            ) {
                continue;
            }
            this.removeRuntime(runtime);
            if (session?.connected && session.connectionGeneration === runtime.connectionGeneration) {
                void this.runExclusive(key, async () => {
                    await this.hostBridgeManager.executeCode(
                        runtime.sessionId,
                        buildPythonProfilerCleanupCode(),
                        isClientExecution(runtime.target)
                    );
                }).catch(() => undefined);
            }
            this.completed.delete(key);
            void runtime.webview.postMessage({
                type: 'pythonProfilerInvalidated',
                sessionId: runtime.sessionId,
                connectionGeneration: runtime.connectionGeneration,
                target: runtime.target
            });
        }
        const validPrefixes = new Set(snapshot.sessions.map(session => (
            `${session.id}:${session.connectionGeneration}:`
        )));
        for (const key of this.completed.keys()) {
            if (![...validPrefixes].some(prefix => key.startsWith(prefix))) {
                this.completed.delete(key);
            }
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
        target: PythonProfilerTarget,
        clock: PythonProfilerClock,
        durationSeconds?: number
    ): Promise<void> {
        this.assertSession(sessionId, connectionGeneration);
        const key = runtimeKey(sessionId, connectionGeneration, target);
        const activeRuntime = [...this.runtimes.values()].find(runtime => (
            runtime.sessionId === sessionId
            && runtime.connectionGeneration === connectionGeneration
        ));
        if (activeRuntime && activeRuntime.key !== key) {
            throw new Error('Another Python profile is already active for this game session');
        }
        if (this.runtimes.has(key)) {
            throw new Error('This target is already being profiled');
        }
        try {
            const value = await this.hostBridgeManager.executeCode(
                sessionId,
                buildPythonProfilerStartCode({ target, clock, durationSeconds }),
                isClientExecution(target)
            );
            parsePythonProfilerStart(value);
        } catch (error) {
            await this.hostBridgeManager.executeCode(
                sessionId,
                buildPythonProfilerCleanupCode(),
                isClientExecution(target)
            ).catch(() => undefined);
            throw error;
        }
        const runtime: PythonProfilerRuntime = {
            key,
            sessionId,
            connectionGeneration,
            target,
            clock,
            durationSeconds,
            startedAt: Date.now(),
            collecting: false,
            webview
        };
        this.runtimes.set(key, runtime);
        this.completed.delete(key);
        if (durationSeconds !== undefined) {
            this.scheduleCollection(runtime);
        }
    }

    private scheduleCollection(runtime: PythonProfilerRuntime): void {
        if (runtime.durationSeconds === undefined || this.runtimes.get(runtime.key) !== runtime) {
            return;
        }
        const deadline = runtime.startedAt + runtime.durationSeconds * 1000 + GAME_TIMER_SETTLE_MS;
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            void this.runExclusive(
                runtime.key,
                () => this.collect(runtime.key, runtime.webview)
            ).catch(error => this.postAutomaticError(runtime, error));
            return;
        }
        runtime.timer = setTimeout(
            () => this.scheduleCollection(runtime),
            Math.min(remaining, MAX_TIMER_DELAY_MS)
        );
        runtime.timer.unref?.();
    }

    private async collect(key: string, webview: vscode.Webview): Promise<void> {
        const runtime = this.runtimes.get(key);
        if (!runtime) {
            if (this.completed.has(key)) {
                return;
            }
            throw new Error('No Python profile is active for this target');
        }
        if (runtime.collecting) {
            return;
        }
        runtime.collecting = true;
        if (runtime.timer) {
            clearTimeout(runtime.timer);
            runtime.timer = undefined;
        }
        await this.postState(
            webview,
            `auto:${Date.now()}`,
            runtime.sessionId,
            runtime.connectionGeneration
        );
        try {
            this.assertSession(runtime.sessionId, runtime.connectionGeneration);
            const value = await this.hostBridgeManager.executeCode(
                runtime.sessionId,
                buildPythonProfilerCollectCode(runtime.target),
                isClientExecution(runtime.target)
            );
            const result = parsePythonProfilerResult(value);
            const capturedAt = new Date();
            this.completed.set(key, {
                target: runtime.target,
                clock: runtime.clock,
                capturedAt: capturedAt.toISOString(),
                result
            });
            await webview.postMessage({
                type: 'pythonProfilerResult',
                sessionId: runtime.sessionId,
                connectionGeneration: runtime.connectionGeneration,
                target: runtime.target,
                state: this.completed.get(key)
            });
        } finally {
            this.removeRuntime(runtime);
        }
    }

    private async postState(
        webview: vscode.Webview,
        requestId: string,
        sessionId: string,
        connectionGeneration: number
    ): Promise<void> {
        const states = (['client', 'server', 'all'] as const).map(target => {
            const key = runtimeKey(sessionId, connectionGeneration, target);
            const runtime = this.runtimes.get(key);
            const completed = this.completed.get(key);
            return {
                target,
                status: runtime ? (runtime.collecting ? 'collecting' : 'running') : 'idle',
                clock: runtime?.clock ?? completed?.clock ?? 'CPU',
                durationSeconds: runtime?.durationSeconds,
                startedAt: runtime ? new Date(runtime.startedAt).toISOString() : undefined,
                completed
            };
        });
        await webview.postMessage({
            type: 'pythonProfilerState',
            requestId,
            sessionId,
            connectionGeneration,
            states
        });
    }

    private async openReport(key: string, kind: 'markdown' | 'svg'): Promise<void> {
        const report = this.completed.get(key)?.report;
        const filePath = kind === 'svg' ? report?.svgPath : report?.markdownPath;
        if (!filePath) {
            throw new Error('No generated profile report is available');
        }
        if (kind === 'markdown') {
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document, { preview: true });
        } else {
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
        }
    }

    private async saveReport(key: string, sessionId: string): Promise<void> {
        const completed = this.completed.get(key);
        if (!completed) {
            throw new Error('No Python profile result is available');
        }
        if (completed.report) {
            return;
        }
        const session = this.hostBridgeManager.getSnapshot().sessions.find(item => item.id === sessionId);
        if (!session?.projectRoot) {
            throw new Error('The selected game session has no project root');
        }
        try {
            completed.report = await writePythonProfilerReport({
                projectRoot: path.resolve(session.projectRoot),
                target: completed.target,
                worldName: session.worldName || session.worldFolderName,
                capturedAt: new Date(completed.capturedAt)
            }, completed.result);
            completed.reportError = undefined;
        } catch (error) {
            completed.reportError = error instanceof Error ? error.message : String(error);
            throw error;
        }
    }

    private async revealReport(key: string): Promise<void> {
        const report = this.completed.get(key)?.report;
        if (!report) {
            throw new Error('No generated profile report is available');
        }
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(report.markdownPath));
    }

    private async openFunction(key: string, sessionId: string, rawFunctionId: unknown): Promise<void> {
        const completed = this.completed.get(key);
        const functionId = typeof rawFunctionId === 'number' && Number.isInteger(rawFunctionId)
            ? rawFunctionId
            : undefined;
        const profiledFunction = functionId !== undefined
            ? completed?.result.functions.find(item => item.id === functionId)
            : undefined;
        if (!profiledFunction) {
            throw new Error('The selected profiled function is no longer available');
        }
        const session = this.hostBridgeManager.getSnapshot().sessions.find(item => item.id === sessionId);
        if (!session?.projectRoot) {
            throw new Error('The selected game session has no project root');
        }
        await openPythonProfilerSource({
            projectRoot: session.projectRoot,
            module: profiledFunction.module,
            line: profiledFunction.line,
            functionName: profiledFunction.name
        });
    }

    private async postAutomaticError(runtime: PythonProfilerRuntime, error: unknown): Promise<void> {
        await this.postState(
            runtime.webview,
            `auto:${Date.now()}`,
            runtime.sessionId,
            runtime.connectionGeneration
        ).catch(() => undefined);
        await runtime.webview.postMessage({
            type: 'pythonProfilerError',
            requestId: `auto:${Date.now()}`,
            sessionId: runtime.sessionId,
            connectionGeneration: runtime.connectionGeneration,
            target: runtime.target,
            message: error instanceof Error ? error.message : String(error)
        });
    }

    private assertSession(sessionId: string, connectionGeneration: number): void {
        const session = this.hostBridgeManager.getSnapshot().sessions.find(item => item.id === sessionId);
        if (
            !session?.connected
            || session.state !== 'game_ready'
            || session.connectionGeneration !== connectionGeneration
        ) {
            throw new Error('The selected game connection has changed');
        }
    }

    private runExclusive(key: string, operation: () => Promise<void>): Promise<void> {
        const previous = this.operations.get(key) ?? Promise.resolve();
        const current = previous.catch(() => undefined).then(operation);
        this.operations.set(key, current);
        return current.finally(() => {
            if (this.operations.get(key) === current) {
                this.operations.delete(key);
            }
        });
    }

    private removeRuntime(runtime: PythonProfilerRuntime): void {
        if (runtime.timer) {
            clearTimeout(runtime.timer);
        }
        if (this.runtimes.get(runtime.key) === runtime) {
            this.runtimes.delete(runtime.key);
        }
    }

    private async performDispose(): Promise<void> {
        this.disposed = true;
        const cleanups = [...this.runtimes.values()].map(runtime => this.runExclusive(
            runtime.key,
            async () => {
                this.removeRuntime(runtime);
                await this.hostBridgeManager.executeCode(
                    runtime.sessionId,
                    buildPythonProfilerCleanupCode(),
                    isClientExecution(runtime.target)
                ).catch(() => undefined);
            }
        ));
        await Promise.all(cleanups);
        this.completed.clear();
        this.operations.clear();
    }
}

function runtimeKey(
    sessionId: string,
    connectionGeneration: number,
    target: PythonProfilerTarget
): string {
    return `${sessionId}:${connectionGeneration}:${target}`;
}

function readTarget(value: unknown): PythonProfilerTarget | undefined {
    return value === 'client' || value === 'server' || value === 'all' ? value : undefined;
}

function isClientExecution(target: PythonProfilerTarget): boolean {
    return target !== 'server';
}

function readDuration(value: unknown): number | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error('Profile duration must be greater than zero');
    }
    return value;
}

function boundedString(value: unknown, maximum: number): string | undefined {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum
        ? value
        : undefined;
}
