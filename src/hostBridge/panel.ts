import * as vscode from 'vscode';
import * as path from 'path';
import {
    buildDebugFunctionInvocation,
    DebugFunctionService,
    validateSavedFunction
} from '../debugFunctions';
import { getNonce } from '../utils';
import { HostBridgeManager } from './manager';
import { LatestOperationQueue } from './latestOperationQueue';
import { HostBridgeRpcError } from './server';
import { DisposableLike } from './types';
import { PythonProfilerController } from './pythonProfilerController';
import { NativeProfilerController } from './nativeProfilerController';
import {
    buildUiDebuggerChildrenCode,
    buildUiDebuggerNodeCode,
    buildUiDebuggerPickerDisableCode,
    buildUiDebuggerPickerEnableCode,
    buildUiDebuggerPickerPollCode,
    buildUiDebuggerPickerSelectCode,
    buildUiDebuggerPropertyCode,
    buildUiDebuggerRevealCode,
    buildUiDebuggerScreensCode,
    buildUiDebuggerVisibilityCode,
    parseUiDebuggerChildren,
    parseUiDebuggerNode,
    parseUiDebuggerReveal,
    parseUiDebuggerScreens,
    UI_DEBUGGER_PAGE_SIZE
} from './uiDebugger';

interface UiPickerRuntime {
    connectionGeneration: number;
    timer: NodeJS.Timeout;
    busy: boolean;
    failures: number;
    polls: number;
    webview: vscode.Webview;
}

export class GameDebuggerPanel implements vscode.Disposable {
    private panel?: vscode.WebviewPanel;
    private bridgeSubscription?: DisposableLike;
    private messageSubscription?: vscode.Disposable;
    private panelDisposeSubscription?: vscode.Disposable;
    private panelViewStateSubscription?: vscode.Disposable;
    private debugFunctionService?: DebugFunctionService;
    private readonly uiPickers = new Map<string, UiPickerRuntime>();
    private readonly uiPickerQueue = new LatestOperationQueue();
    private readonly uiPropertyQueue = new LatestOperationQueue();
    private pythonProfilerController?: PythonProfilerController;
    private nativeProfilerController?: NativeProfilerController;
    private releasePromise: Promise<void> = Promise.resolve();

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly hostBridgeManager: HostBridgeManager
    ) {}

    public show(): void {
        if (this.panel) {
            this.panel.reveal(this.panel.viewColumn, false);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'mcdev-tools.gameDebugger',
            'MC Dev Tools - 游戏调试',
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                enableFindWidget: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this.extensionUri]
            }
        );
        this.panel = panel;
        this.pythonProfilerController = new PythonProfilerController(this.hostBridgeManager);
        panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'images', 'icon.png');
        panel.webview.html = this.getHtml(panel.webview);

        this.messageSubscription = panel.webview.onDidReceiveMessage(message => {
            void this.handleMessage(panel.webview, message);
        });
        this.bridgeSubscription = this.hostBridgeManager.onDidChange(snapshot => {
            this.reconcileUiPickers(snapshot);
            this.pythonProfilerController?.reconcile(snapshot);
            this.nativeProfilerController?.reconcile(snapshot);
            void panel.webview.postMessage({ type: 'hostBridgeState', snapshot });
        });
        this.panelDisposeSubscription = panel.onDidDispose(() => this.releasePanel());
        this.panelViewStateSubscription = panel.onDidChangeViewState(event => {
            this.nativeProfilerController?.setPanelVisible(event.webviewPanel.visible);
        });
    }

    public dispose(): void {
        const panel = this.panel;
        void this.releasePanel();
        panel?.dispose();
    }

    public async disposeAsync(): Promise<void> {
        const panel = this.panel;
        const release = this.releasePanel();
        panel?.dispose();
        await release;
        await this.releasePromise;
    }

    private releasePanel(): Promise<void> {
        const pickerCleanup = this.disposeUiPickersAsync();
        const pythonProfilerController = this.pythonProfilerController;
        const nativeProfilerController = this.nativeProfilerController;
        this.pythonProfilerController = undefined;
        this.nativeProfilerController = undefined;
        this.messageSubscription?.dispose();
        this.messageSubscription = undefined;
        this.bridgeSubscription?.dispose();
        this.bridgeSubscription = undefined;
        this.panelDisposeSubscription?.dispose();
        this.panelDisposeSubscription = undefined;
        this.panelViewStateSubscription?.dispose();
        this.panelViewStateSubscription = undefined;
        this.debugFunctionService?.dispose();
        this.debugFunctionService = undefined;
        this.panel = undefined;

        const cleanup = Promise.all([
            pickerCleanup,
            pythonProfilerController?.disposeAsync(),
            nativeProfilerController?.disposeAsync()
        ]).then(() => undefined);
        this.releasePromise = Promise.allSettled([this.releasePromise, cleanup]).then(results => {
            for (const result of results) {
                if (result.status === 'rejected') {
                    console.error('Failed to release the game debugger panel', result.reason);
                }
            }
        });
        return this.releasePromise;
    }

    private async handleMessage(webview: vscode.Webview, message: any): Promise<void> {
        if (message?.type === 'ready') {
            await this.postState(webview);
            return;
        }
        if (message?.type === 'hostBridgeRefresh') {
            await this.hostBridgeManager.refreshSessions();
            await this.postState(webview);
            return;
        }
        if (typeof message?.type === 'string' && message.type.startsWith('debugFunction')) {
            await this.handleDebugFunctionMessage(webview, message);
            return;
        }
        if (typeof message?.type === 'string' && message.type.startsWith('uiDebugger')) {
            await this.handleUiDebuggerMessage(webview, message);
            return;
        }
        if (typeof message?.type === 'string' && message.type.startsWith('pythonProfiler')) {
            await this.pythonProfilerController?.handleMessage(webview, message);
            return;
        }
        if (typeof message?.type === 'string' && message.type.startsWith('nativeProfiler')) {
            const controller = this.nativeProfilerController ??= new NativeProfilerController(
                this.extensionUri.fsPath,
                this.hostBridgeManager
            );
            controller.setPanelVisible(this.panel?.visible ?? true);
            await controller.handleMessage(webview, message);
            return;
        }
        if (message?.type !== 'hostBridgeExecute') {
            return;
        }

        const requestId = typeof message.requestId === 'string' && message.requestId.length <= 128
            ? message.requestId
            : '';
        const sessionId = typeof message.sessionId === 'string' && message.sessionId.length <= 128
            ? message.sessionId
            : '';
        const code = typeof message.code === 'string' ? message.code : '';
        const isClient = message.isClient !== false;
        if (!requestId || !sessionId) {
            return;
        }

        try {
            const result = await this.hostBridgeManager.executeCode(sessionId, code, isClient);
            await webview.postMessage({
                type: 'hostBridgeExecutionResult',
                requestId,
                sessionId,
                isClient,
                ok: true,
                result
            });
        } catch (error) {
            const rpcError = error instanceof HostBridgeRpcError ? error : undefined;
            await webview.postMessage({
                type: 'hostBridgeExecutionResult',
                requestId,
                sessionId,
                isClient,
                ok: false,
                error: {
                    code: rpcError?.symbolicCode,
                    rpcCode: rpcError?.rpcCode,
                    message: error instanceof Error ? error.message : String(error)
                }
            });
        }
    }

    private async handleUiDebuggerMessage(webview: vscode.Webview, message: any): Promise<void> {
        const requestId = readBoundedString(message.requestId, 128);
        const sessionId = readBoundedString(message.sessionId, 128);
        const connectionGeneration = Number.isInteger(message.connectionGeneration)
            ? Number(message.connectionGeneration)
            : -1;
        if (!requestId || !sessionId || connectionGeneration < 0) {
            return;
        }

        const session = this.hostBridgeManager.getSnapshot().sessions.find(item => item.id === sessionId);
        if (!session || session.connectionGeneration !== connectionGeneration) {
            await this.postUiDebuggerError(
                webview, requestId, message.type, sessionId, connectionGeneration,
                'The selected game connection has changed'
            );
            return;
        }

        try {
            switch (message.type) {
                case 'uiDebuggerScreens': {
                    const result = await this.hostBridgeManager.executeCode(
                        sessionId, buildUiDebuggerScreensCode(), true
                    );
                    await webview.postMessage({
                        type: 'uiDebuggerScreensResult', requestId, sessionId, connectionGeneration,
                        screens: parseUiDebuggerScreens(result)
                    });
                    return;
                }
                case 'uiDebuggerChildren': {
                    const screen = readBoundedString(message.screen, 512);
                    const parentPath = readBoundedString(message.parentPath, 4096, true);
                    const offset = Number.isInteger(message.offset) ? Number(message.offset) : 0;
                    if (!screen || parentPath === undefined) {
                        throw new Error('Invalid UI tree path');
                    }
                    const code = buildUiDebuggerChildrenCode(
                        screen, parentPath, offset, UI_DEBUGGER_PAGE_SIZE
                    );
                    const result = await this.hostBridgeManager.executeCode(sessionId, code, true);
                    await webview.postMessage({
                        type: 'uiDebuggerChildrenResult', requestId, sessionId, connectionGeneration,
                        screen, parentPath,
                        ...parseUiDebuggerChildren(result, parentPath, offset)
                    });
                    return;
                }
                case 'uiDebuggerNode': {
                    const screen = readBoundedString(message.screen, 512);
                    const nodePath = readBoundedString(message.path, 4096);
                    if (!screen || !nodePath) {
                        throw new Error('Invalid UI node path');
                    }
                    const result = await this.hostBridgeManager.executeCode(
                        sessionId, buildUiDebuggerNodeCode(screen, nodePath), true
                    );
                    await webview.postMessage({
                        type: 'uiDebuggerNodeResult', requestId, sessionId, connectionGeneration,
                        node: parseUiDebuggerNode(result, screen, nodePath)
                    });
                    return;
                }
                case 'uiDebuggerSetVisibility': {
                    const screen = readBoundedString(message.screen, 512);
                    const nodePath = readBoundedString(message.path, 4096);
                    if (!screen || !nodePath || typeof message.visible !== 'boolean') {
                        throw new Error('Invalid UI visibility update');
                    }
                    const result = await this.hostBridgeManager.executeCode(
                        sessionId,
                        buildUiDebuggerVisibilityCode(screen, nodePath, message.visible),
                        true
                    );
                    await webview.postMessage({
                        type: 'uiDebuggerVisibilityResult', requestId, sessionId, connectionGeneration,
                        screen, path: nodePath, visible: result === true
                    });
                    return;
                }
                case 'uiDebuggerSetProperty': {
                    const screen = readBoundedString(message.screen, 512);
                    const nodePath = readBoundedString(message.path, 4096);
                    const property = readBoundedString(message.property, 64);
                    if (!screen || !nodePath || !property) {
                        throw new Error('Invalid UI property update');
                    }
                    const code = buildUiDebuggerPropertyCode(screen, nodePath, property, message.value);
                    const queueKey = JSON.stringify([
                        sessionId, connectionGeneration, screen, nodePath, property
                    ]);
                    let value: unknown;
                    await this.uiPropertyQueue.runLatest(queueKey, async () => {
                        this.assertUiDebuggerSession(sessionId, connectionGeneration);
                        value = await this.hostBridgeManager.executeCode(sessionId, code, true);
                    });
                    await webview.postMessage({
                        type: 'uiDebuggerPropertyResult', requestId, sessionId, connectionGeneration,
                        screen, path: nodePath, property, value
                    });
                    return;
                }
                case 'uiDebuggerPickerMode': {
                    const mode = message.mode === 'select' || message.mode === 'layout'
                        ? message.mode
                        : 'off';
                    this.uiPickerQueue.invalidateLatest(sessionId);
                    await this.uiPickerQueue.run(sessionId, async () => {
                        try {
                            this.assertUiDebuggerSession(sessionId, connectionGeneration);
                            if (mode !== 'off') {
                                const result = await this.hostBridgeManager.executeCode(
                                    sessionId, buildUiDebuggerPickerEnableCode(mode === 'layout'), true
                                );
                                if (result !== true) {
                                    throw new Error('The native UI picker is unavailable in this game build');
                                }
                                this.assertUiDebuggerSession(sessionId, connectionGeneration);
                                this.startUiPicker(webview, sessionId, connectionGeneration);
                            } else {
                                await this.stopUiPicker(sessionId, true);
                            }
                        } catch (error) {
                            await this.stopUiPicker(sessionId, true, true);
                            throw error;
                        }
                    });
                    await webview.postMessage({
                        type: 'uiDebuggerPickerModeResult', requestId, sessionId, connectionGeneration,
                        mode
                    });
                    return;
                }
                case 'uiDebuggerPickerSelect': {
                    const screen = readBoundedString(message.screen, 512);
                    const nodePath = readBoundedString(message.path, 4096);
                    if (!screen || !nodePath) {
                        throw new Error('Invalid UI node path');
                    }
                    await this.uiPickerQueue.runLatest(sessionId, async () => {
                        this.assertUiDebuggerSession(sessionId, connectionGeneration);
                        const picker = this.uiPickers.get(sessionId);
                        if (picker?.connectionGeneration !== connectionGeneration) {
                            throw new Error('Enable the native UI picker before selecting a node');
                        }
                        await this.hostBridgeManager.executeCode(
                            sessionId,
                            buildUiDebuggerPickerSelectCode(screen, nodePath),
                            true
                        );
                    });
                    await webview.postMessage({
                        type: 'uiDebuggerPickerSelectResult', requestId, sessionId, connectionGeneration,
                        screen, path: nodePath
                    });
                    return;
                }
                case 'uiDebuggerReveal': {
                    const screen = readBoundedString(message.screen, 512);
                    const nodePath = readBoundedString(message.path, 4096);
                    if (!screen || !nodePath) {
                        throw new Error('Invalid UI reveal path');
                    }
                    const result = await this.hostBridgeManager.executeCode(
                        sessionId,
                        buildUiDebuggerRevealCode(screen, nodePath),
                        true
                    );
                    await webview.postMessage({
                        type: 'uiDebuggerRevealResult', requestId, sessionId, connectionGeneration,
                        screen, path: nodePath, pages: parseUiDebuggerReveal(result)
                    });
                    return;
                }
            }
        } catch (error) {
            await this.postUiDebuggerError(
                webview, requestId, message.type, sessionId, connectionGeneration,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    private startUiPicker(
        webview: vscode.Webview,
        sessionId: string,
        connectionGeneration: number
    ): void {
        const existing = this.uiPickers.get(sessionId);
        if (existing) {
            clearInterval(existing.timer);
        }
        const picker: UiPickerRuntime = {
            connectionGeneration,
            timer: undefined as unknown as NodeJS.Timeout,
            busy: false,
            failures: 0,
            polls: 0,
            webview
        };
        picker.timer = setInterval(() => {
            void this.pollUiPicker(sessionId, picker);
        }, 60);
        this.uiPickers.set(sessionId, picker);
    }

    private async pollUiPicker(sessionId: string, picker: UiPickerRuntime): Promise<void> {
        if (picker.busy || this.uiPickers.get(sessionId) !== picker) {
            return;
        }
        picker.busy = true;
        try {
            picker.polls += 1;
            const includeScreens = picker.polls % 8 === 0;
            const result = await this.hostBridgeManager.executeCode(
                sessionId, buildUiDebuggerPickerPollCode(includeScreens), true
            );
            picker.failures = 0;
            const eventEnvelope = includeScreens && Array.isArray(result) ? result[0] : result;
            if (includeScreens && Array.isArray(result)) {
                await picker.webview.postMessage({
                    type: 'uiDebuggerScreensEvent',
                    sessionId,
                    connectionGeneration: picker.connectionGeneration,
                    screens: parseUiDebuggerScreens(result[1])
                });
            }
            if (eventEnvelope !== null && eventEnvelope !== undefined) {
                const isResolvedEnvelope = Array.isArray(eventEnvelope)
                    && eventEnvelope.length === 3
                    && typeof eventEnvelope[2] === 'string';
                const event = isResolvedEnvelope ? eventEnvelope[0] : eventEnvelope;
                const screen = isResolvedEnvelope && typeof eventEnvelope[1] === 'string'
                    && eventEnvelope[1].length <= 512
                    ? eventEnvelope[1]
                    : undefined;
                const pickerPath = isResolvedEnvelope && eventEnvelope[2].length <= 4096
                    ? eventEnvelope[2]
                    : undefined;
                await picker.webview.postMessage({
                    type: 'uiDebuggerPickerEvent',
                    sessionId,
                    connectionGeneration: picker.connectionGeneration,
                    event,
                    screen,
                    path: pickerPath
                });
            }
        } catch (error) {
            picker.failures += 1;
            if (picker.failures >= 3) {
                await this.uiPickerQueue.run(
                    sessionId, () => this.stopUiPicker(sessionId, true, true)
                );
                await picker.webview.postMessage({
                    type: 'uiDebuggerPickerStopped',
                    sessionId,
                    connectionGeneration: picker.connectionGeneration,
                    message: error instanceof Error ? error.message : String(error)
                });
            }
        } finally {
            picker.busy = false;
        }
    }

    private async stopUiPicker(
        sessionId: string,
        cleanupGame: boolean,
        suppressCleanupError = false
    ): Promise<void> {
        this.uiPickerQueue.invalidateLatest(sessionId);
        const picker = this.uiPickers.get(sessionId);
        if (picker) {
            clearInterval(picker.timer);
            this.uiPickers.delete(sessionId);
        }
        if (cleanupGame) {
            const cleanup = this.hostBridgeManager.executeCode(
                sessionId, buildUiDebuggerPickerDisableCode(), true
            );
            if (suppressCleanupError) {
                await cleanup.catch(() => undefined);
            } else {
                await cleanup;
            }
        }
    }

    private reconcileUiPickers(snapshot: ReturnType<HostBridgeManager['getSnapshot']>): void {
        for (const [sessionId, picker] of this.uiPickers) {
            const session = snapshot.sessions.find(item => item.id === sessionId);
            if (
                !session?.connected
                || session.state !== 'game_ready'
                || session.connectionGeneration !== picker.connectionGeneration
            ) {
                clearInterval(picker.timer);
                this.uiPickers.delete(sessionId);
                this.uiPickerQueue.invalidateLatest(sessionId);
                if (session?.connected) {
                    void this.uiPickerQueue.run(sessionId, async () => {
                        await this.hostBridgeManager.executeCode(
                            sessionId, buildUiDebuggerPickerDisableCode(), true
                        ).catch(() => undefined);
                    });
                }
            }
        }
    }

    private disposeUiPickers(): void {
        void this.disposeUiPickersAsync();
    }

    private async disposeUiPickersAsync(): Promise<void> {
        const cleanups: Promise<unknown>[] = [];
        const sessionIds = new Set([
            ...this.uiPickers.keys(),
            ...this.uiPickerQueue.keys()
        ]);
        for (const sessionId of sessionIds) {
            this.uiPickerQueue.invalidateLatest(sessionId);
            const picker = this.uiPickers.get(sessionId);
            if (picker) {
                clearInterval(picker.timer);
                this.uiPickers.delete(sessionId);
            }
            cleanups.push(this.uiPickerQueue.run(sessionId, async () => {
                await this.hostBridgeManager.executeCode(
                    sessionId, buildUiDebuggerPickerDisableCode(), true
                ).catch(() => undefined);
            }));
        }
        await Promise.all(cleanups);
    }

    private assertUiDebuggerSession(sessionId: string, connectionGeneration: number): void {
        const session = this.hostBridgeManager.getSnapshot().sessions.find(item => item.id === sessionId);
        if (
            !session?.connected
            || session.state !== 'game_ready'
            || session.connectionGeneration !== connectionGeneration
        ) {
            throw new Error('The selected game connection has changed');
        }
    }

    private async postUiDebuggerError(
        webview: vscode.Webview,
        requestId: string,
        action: string,
        sessionId: string,
        connectionGeneration: number,
        message: string
    ): Promise<void> {
        await webview.postMessage({
            type: 'uiDebuggerError', requestId, action, sessionId, connectionGeneration, message
        });
    }

    private async handleDebugFunctionMessage(webview: vscode.Webview, message: any): Promise<void> {
        const requestId = typeof message.requestId === 'string' && message.requestId.length <= 128
            ? message.requestId
            : '';
        const sessionId = typeof message.sessionId === 'string' && message.sessionId.length <= 128
            ? message.sessionId
            : '';
        if (!requestId) {
            return;
        }
        const workspacePath = this.resolveWorkspacePath(sessionId);
        if (!workspacePath) {
            await this.postDebugFunctionError(webview, requestId, message.type, 'No project is available');
            return;
        }
        const service = this.debugFunctionService ??= new DebugFunctionService();

        try {
            switch (message.type) {
                case 'debugFunctionsLoad': {
                    const functions = await service.load(workspacePath);
                    await webview.postMessage({
                        type: 'debugFunctionsState', requestId, workspacePath, functions
                    });
                    return;
                }
                case 'debugFunctionsDiscover': {
                    const functions = await service.discover(workspacePath, message.force === true);
                    await webview.postMessage({
                        type: 'debugFunctionsDiscovered', requestId, workspacePath, functions
                    });
                    return;
                }
                case 'debugFunctionSave': {
                    const functions = await service.save(workspacePath, message.function);
                    await webview.postMessage({
                        type: 'debugFunctionsState', requestId, workspacePath, functions, saved: true
                    });
                    return;
                }
                case 'debugFunctionDelete': {
                    const id = typeof message.id === 'string' ? message.id : '';
                    const functions = await service.delete(workspacePath, id);
                    await webview.postMessage({
                        type: 'debugFunctionsState', requestId, workspacePath, functions, deletedId: id
                    });
                    return;
                }
                case 'debugFunctionExecute': {
                    if (!sessionId) {
                        throw new Error('Select a game session before running the function');
                    }
                    const saved = validateSavedFunction(message.function);
                    const runtimeArguments = isStringRecord(message.runtimeArguments)
                        ? message.runtimeArguments
                        : {};
                    const code = buildDebugFunctionInvocation(saved, runtimeArguments);
                    const result = await this.hostBridgeManager.executeCode(
                        sessionId,
                        code,
                        saved.target === 'client'
                    );
                    await webview.postMessage({
                        type: 'debugFunctionExecutionResult',
                        requestId,
                        sessionId,
                        functionId: saved.id,
                        ok: true,
                        result
                    });
                    return;
                }
                case 'debugFunctionOpenSource': {
                    await this.openDebugFunctionSource(
                        workspacePath,
                        typeof message.relativeFilePath === 'string' ? message.relativeFilePath : '',
                        Number.isInteger(message.line) ? Number(message.line) : 1
                    );
                    await webview.postMessage({ type: 'debugFunctionSourceOpened', requestId });
                    return;
                }
            }
        } catch (error) {
            if (message.type === 'debugFunctionExecute') {
                const rpcError = error instanceof HostBridgeRpcError ? error : undefined;
                await webview.postMessage({
                    type: 'debugFunctionExecutionResult',
                    requestId,
                    sessionId,
                    functionId: typeof message.function?.id === 'string' ? message.function.id : '',
                    ok: false,
                    error: {
                        code: rpcError?.symbolicCode,
                        rpcCode: rpcError?.rpcCode,
                        message: error instanceof Error ? error.message : String(error)
                    }
                });
                return;
            }
            await this.postDebugFunctionError(
                webview,
                requestId,
                message.type,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    private resolveWorkspacePath(sessionId: string): string | undefined {
        if (sessionId) {
            const session = this.hostBridgeManager.getSnapshot().sessions.find(item => item.id === sessionId);
            if (session?.projectRoot) {
                return path.resolve(session.projectRoot);
            }
        }
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    private async openDebugFunctionSource(
        workspacePath: string,
        relativeFilePath: string,
        line: number
    ): Promise<void> {
        const root = path.resolve(workspacePath);
        const target = path.resolve(root, relativeFilePath);
        const relative = path.relative(root, target);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error('Source file is outside the project');
        }
        const document = await vscode.workspace.openTextDocument(target);
        const editor = await vscode.window.showTextDocument(document, { preview: true });
        const position = new vscode.Position(Math.max(0, line - 1), 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    private async postDebugFunctionError(
        webview: vscode.Webview,
        requestId: string,
        action: string,
        message: string
    ): Promise<void> {
        await webview.postMessage({
            type: 'debugFunctionsError', requestId, action, message
        });
    }

    private async postState(webview: vscode.Webview): Promise<void> {
        await webview.postMessage({
            type: 'hostBridgeState',
            snapshot: this.hostBridgeManager.getSnapshot()
        });
    }

    private getHtml(webview: vscode.Webview): string {
        const nonce = getNonce();
        const language = vscode.env.language.startsWith('zh') ? 'zh' : 'en';
        const webviewPath = vscode.Uri.joinPath(this.extensionUri, 'out', 'webview');
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewPath, 'sidebar.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewPath, 'sidebar.css'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewPath, 'codicons', 'codicon.css'));

        return `<!doctype html>
<html lang="${language}">
<head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MC Dev Tools - Game Debugger</title>
    <link href="${codiconsUri}" rel="stylesheet" />
    <link href="${styleUri}" rel="stylesheet" />
</head>
<body data-view="game-debugger">
    <div id="root"></div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function isStringRecord(value: unknown): value is Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    return Object.values(value).every(item => typeof item === 'string' && item.length <= 64 * 1024);
}

function readBoundedString(value: unknown, maxLength: number, allowEmpty = false): string | undefined {
    if (typeof value !== 'string' || value.length > maxLength || value.includes('\0')) {
        return undefined;
    }
    return allowEmpty || value.length > 0 ? value : undefined;
}
