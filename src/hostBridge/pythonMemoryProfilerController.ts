import * as path from 'path';
import * as vscode from 'vscode';
import { HostBridgeManager } from './manager';
import {
    buildPythonMemoryCleanupCode,
    buildPythonMemoryCollectCode,
    buildPythonMemoryStartCode,
    parsePythonMemoryResult,
    parsePythonMemoryStart,
    PythonMemoryResult,
    PYTHON_MEMORY_MAX_DEPTH
} from './pythonMemoryProfiler';
import {
    PythonMemoryReportFiles,
    writePythonMemoryReport
} from './pythonMemoryProfilerReport';
import { openPythonProfilerSource } from './pythonProfilerNavigation';
import { HostBridgeSnapshot } from './types';

interface PythonMemoryRuntime {
    key: string;
    sessionId: string;
    connectionGeneration: number;
    tracebackDepth: number;
    startedAt: number;
    collecting: boolean;
    webview: vscode.Webview;
}

interface PythonMemoryCompletedState {
    capturedAt: string;
    result: PythonMemoryResult;
    report?: PythonMemoryReportFiles;
    reportError?: string;
}

export class PythonMemoryProfilerController implements vscode.Disposable {
    private readonly runtimes = new Map<string, PythonMemoryRuntime>();
    private readonly completed = new Map<string, PythonMemoryCompletedState>();
    private readonly operations = new Map<string, Promise<void>>();
    private disposePromise?: Promise<void>;
    private disposed = false;

    constructor(private readonly hostBridgeManager: HostBridgeManager) {}

    public async handleMessage(webview: vscode.Webview, message: any): Promise<boolean> {
        if (typeof message?.type !== 'string' || !message.type.startsWith('pythonMemoryProfiler')) {
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
        const key = runtimeKey(sessionId, connectionGeneration);
        try {
            switch (message.type) {
                case 'pythonMemoryProfilerState':
                    await this.postState(webview, requestId, sessionId, connectionGeneration);
                    return true;
                case 'pythonMemoryProfilerStart':
                    await this.runExclusive(key, () => this.start(
                        webview,
                        sessionId,
                        connectionGeneration,
                        readTracebackDepth(message.tracebackDepth)
                    ));
                    await this.postState(webview, requestId, sessionId, connectionGeneration);
                    return true;
                case 'pythonMemoryProfilerStop':
                    await this.runExclusive(key, () => this.collect(key, webview, message.collectGarbage !== false));
                    await this.postState(webview, requestId, sessionId, connectionGeneration);
                    return true;
                case 'pythonMemoryProfilerSaveReport':
                    await this.runExclusive(key, () => this.saveReport(key, sessionId));
                    await this.postState(webview, requestId, sessionId, connectionGeneration);
                    return true;
                case 'pythonMemoryProfilerOpenReport':
                    await this.openReport(key, message.kind === 'svg' ? 'svg' : 'markdown');
                    return true;
                case 'pythonMemoryProfilerRevealReport':
                    await this.revealReport(key);
                    return true;
                case 'pythonMemoryProfilerOpenFrame':
                    await this.openFrame(key, sessionId, message.allocationId, message.frameIndex);
                    return true;
            }
        } catch (error) {
            await this.postState(webview, requestId, sessionId, connectionGeneration).catch(() => undefined);
            await webview.postMessage({
                type: 'pythonMemoryProfilerError',
                requestId,
                sessionId,
                connectionGeneration,
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
            if (session?.connected && session.state === 'game_ready') {
                void this.runExclusive(key, () => this.cleanup(runtime.sessionId)).catch(() => undefined);
            }
            this.completed.delete(key);
            void runtime.webview.postMessage({
                type: 'pythonMemoryProfilerInvalidated',
                sessionId: runtime.sessionId,
                connectionGeneration: runtime.connectionGeneration
            });
        }
        const validKeys = new Set(snapshot.sessions.map(session => (
            runtimeKey(session.id, session.connectionGeneration)
        )));
        for (const key of this.completed.keys()) {
            if (!validKeys.has(key)) {
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
        tracebackDepth: number
    ): Promise<void> {
        this.assertSession(sessionId, connectionGeneration);
        const key = runtimeKey(sessionId, connectionGeneration);
        if (this.runtimes.has(key)) {
            throw new Error('A Python memory capture is already active for this game session');
        }
        try {
            const value = await this.hostBridgeManager.executeCode(
                sessionId,
                buildPythonMemoryStartCode({ tracebackDepth }),
                true
            );
            parsePythonMemoryStart(value);
        } catch (error) {
            await this.cleanup(sessionId);
            throw error;
        }
        this.runtimes.set(key, {
            key,
            sessionId,
            connectionGeneration,
            tracebackDepth,
            startedAt: Date.now(),
            collecting: false,
            webview
        });
        this.completed.delete(key);
    }

    private async collect(key: string, webview: vscode.Webview, collectGarbage: boolean): Promise<void> {
        const runtime = this.runtimes.get(key);
        if (!runtime) {
            if (this.completed.has(key)) {
                return;
            }
            throw new Error('No Python memory capture is active');
        }
        if (runtime.collecting) {
            return;
        }
        runtime.collecting = true;
        await this.postState(
            webview,
            `auto:${Date.now()}`,
            runtime.sessionId,
            runtime.connectionGeneration
        );
        try {
            this.assertSession(runtime.sessionId, runtime.connectionGeneration);
            let result: PythonMemoryResult;
            try {
                const value = await this.hostBridgeManager.executeCode(
                    runtime.sessionId,
                    buildPythonMemoryCollectCode(collectGarbage),
                    true
                );
                result = parsePythonMemoryResult(value);
            } catch (error) {
                await this.cleanup(runtime.sessionId);
                throw error;
            }
            const completed = {
                capturedAt: new Date().toISOString(),
                result
            };
            this.completed.set(key, completed);
            await webview.postMessage({
                type: 'pythonMemoryProfilerResult',
                sessionId: runtime.sessionId,
                connectionGeneration: runtime.connectionGeneration,
                state: completed
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
        const key = runtimeKey(sessionId, connectionGeneration);
        const runtime = this.runtimes.get(key);
        await webview.postMessage({
            type: 'pythonMemoryProfilerState',
            requestId,
            sessionId,
            connectionGeneration,
            state: {
                status: runtime ? (runtime.collecting ? 'collecting' : 'running') : 'idle',
                tracebackDepth: runtime?.tracebackDepth ?? this.completed.get(key)?.result.tracebackDepth ?? 8,
                startedAt: runtime ? new Date(runtime.startedAt).toISOString() : undefined,
                completed: this.completed.get(key)
            }
        });
    }

    private async saveReport(key: string, sessionId: string): Promise<void> {
        const completed = this.completed.get(key);
        if (!completed) {
            throw new Error('No Python memory result is available');
        }
        if (completed.report) {
            return;
        }
        const session = this.hostBridgeManager.getSnapshot().sessions.find(item => item.id === sessionId);
        if (!session?.projectRoot) {
            throw new Error('The selected game session has no project root');
        }
        try {
            completed.report = await writePythonMemoryReport({
                projectRoot: path.resolve(session.projectRoot),
                worldName: session.worldName || session.worldFolderName,
                capturedAt: new Date(completed.capturedAt)
            }, completed.result);
            completed.reportError = undefined;
        } catch (error) {
            completed.reportError = error instanceof Error ? error.message : String(error);
            throw error;
        }
    }

    private async openReport(key: string, kind: 'markdown' | 'svg'): Promise<void> {
        const report = this.completed.get(key)?.report;
        const filePath = kind === 'svg' ? report?.svgPath : report?.markdownPath;
        if (!filePath) {
            throw new Error('No generated Python memory report is available');
        }
        if (kind === 'markdown') {
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document, { preview: true });
        } else {
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
        }
    }

    private async revealReport(key: string): Promise<void> {
        const report = this.completed.get(key)?.report;
        if (!report) {
            throw new Error('No generated Python memory report is available');
        }
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(report.markdownPath));
    }

    private async openFrame(
        key: string,
        sessionId: string,
        rawAllocationId: unknown,
        rawFrameIndex: unknown
    ): Promise<void> {
        const allocationId = readNonNegativeInteger(rawAllocationId);
        const frameIndex = readNonNegativeInteger(rawFrameIndex);
        const allocation = allocationId !== undefined
            ? this.completed.get(key)?.result.allocations.find(item => item.id === allocationId)
            : undefined;
        const frame = frameIndex !== undefined ? allocation?.traceback[frameIndex] : undefined;
        if (!frame) {
            throw new Error('The selected allocation frame is no longer available');
        }
        const session = this.hostBridgeManager.getSnapshot().sessions.find(item => item.id === sessionId);
        if (!session?.projectRoot) {
            throw new Error('The selected game session has no project root');
        }
        await openPythonProfilerSource({
            projectRoot: session.projectRoot,
            module: frame.file,
            line: frame.line,
            functionName: ''
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

    private removeRuntime(runtime: PythonMemoryRuntime): void {
        if (this.runtimes.get(runtime.key) === runtime) {
            this.runtimes.delete(runtime.key);
        }
    }

    private async cleanup(sessionId: string): Promise<void> {
        await this.hostBridgeManager.executeCode(
            sessionId,
            buildPythonMemoryCleanupCode(),
            true
        ).catch(() => undefined);
    }

    private async performDispose(): Promise<void> {
        this.disposed = true;
        const cleanups = [...this.runtimes.values()].map(runtime => this.runExclusive(
            runtime.key,
            async () => {
                this.removeRuntime(runtime);
                await this.cleanup(runtime.sessionId);
            }
        ));
        await Promise.all(cleanups);
        this.completed.clear();
        this.operations.clear();
    }
}

function runtimeKey(sessionId: string, connectionGeneration: number): string {
    return `${sessionId}:${connectionGeneration}`;
}

function readTracebackDepth(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > PYTHON_MEMORY_MAX_DEPTH) {
        throw new Error(`Traceback depth must be between 1 and ${PYTHON_MEMORY_MAX_DEPTH}`);
    }
    return value;
}

function readNonNegativeInteger(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function boundedString(value: unknown, maximum: number): string | undefined {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum
        ? value
        : undefined;
}
