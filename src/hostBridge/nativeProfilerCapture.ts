import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { dynamicLibraryManager } from '../native/dynamicLibraryManager';
import { NativeProfilerResult } from './nativeProfilerTypes';

export interface NativeProfilerCaptureOptions {
    extensionRoot: string;
    port: number;
    maximumSeconds: number;
    memoryLimitPercent?: number;
}

export interface NativeProfilerCaptureResult {
    tracePath: string;
    capturedSeconds: number;
    result: NativeProfilerResult;
}

type NativeFunction = ((...args: unknown[]) => unknown) & {
    async: (...args: unknown[]) => void;
};

interface TracyBridgeBindings {
    apiVersion: NativeFunction;
    protocolVersion: NativeFunction;
    start: NativeFunction;
    status: NativeFunction;
    stop: NativeFunction;
    resultSize: NativeFunction;
    copyResult: NativeFunction;
    errorSize: NativeFunction;
    copyError: NativeFunction;
    lastErrorSize: NativeFunction;
    copyLastError: NativeFunction;
    release: NativeFunction;
    shutdownAll: NativeFunction;
}

const BRIDGE_API_VERSION = 1;
const MAXIMUM_RESULT_BYTES = 16 * 1024 * 1024;
const STATUS_COMPLETED = 4;
const STATUS_FAILED = 5;
const bindingsByLibrary = new WeakMap<object, TracyBridgeBindings>();
let bridgeActivated = false;

export class NativeProfilerCapture {
    public readonly tracePath: string;
    public readonly completion: Promise<NativeProfilerCaptureResult>;

    private handle: unknown;
    private released = false;
    private disposePromise?: Promise<void>;

    private constructor(
        private readonly libraryPath: string,
        private readonly temporaryDirectory: string,
        tracePath: string,
        handle: unknown
    ) {
        this.tracePath = tracePath;
        this.handle = handle;
        this.completion = this.waitForCompletion();
    }

    public static async start(options: NativeProfilerCaptureOptions): Promise<NativeProfilerCapture> {
        if (process.platform !== 'win32' || process.arch !== 'x64') {
            throw new Error('Native Tracy profiling currently supports Windows x64 only');
        }
        const libraryPath = resolveTracyBridge(options.extensionRoot);
        await fs.access(libraryPath);
        const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-native-profile-'));
        const tracePath = path.join(temporaryDirectory, 'capture.tracy');
        try {
            bridgeActivated = true;
            const handle = await withBridge(libraryPath, bindings => {
                const apiVersion = Number(bindings.apiVersion());
                const protocolVersion = String(bindings.protocolVersion());
                if (apiVersion !== BRIDGE_API_VERSION) {
                    throw new Error(`Unsupported MC Dev Tools Tracy bridge API: ${apiVersion}`);
                }
                if (protocolVersion !== '0.11.1') {
                    throw new Error(`Unsupported Tracy bridge protocol version: ${protocolVersion}`);
                }
                const value = bindings.start(
                    '127.0.0.1',
                    options.port,
                    Math.ceil(options.maximumSeconds),
                    options.memoryLimitPercent ?? 50,
                    160,
                    tracePath
                );
                if (value === null || value === undefined) {
                    throw new Error(readLastError(bindings) || 'Unable to start native Tracy capture');
                }
                return value;
            });
            return new NativeProfilerCapture(libraryPath, temporaryDirectory, tracePath, handle);
        } catch (error) {
            await removeTemporaryDirectory(temporaryDirectory);
            throw error;
        }
    }

    public async stop(): Promise<void> {
        const handle = this.handle;
        if (this.released || handle === undefined) return;
        await withBridge(this.libraryPath, bindings => {
            if (Number(bindings.stop(handle)) !== 0) {
                throw new Error('The native Tracy capture handle is no longer available');
            }
        });
    }

    public dispose(): Promise<void> {
        this.disposePromise ??= this.performDispose();
        return this.disposePromise;
    }

    private async performDispose(): Promise<void> {
        await this.stop().catch(() => undefined);
        await this.completion.catch(() => undefined);
        await removeTemporaryDirectory(this.temporaryDirectory);
    }

    private async waitForCompletion(): Promise<NativeProfilerCaptureResult> {
        try {
            while (true) {
                const status = await withBridge(this.libraryPath, bindings => (
                    Number(bindings.status(this.handle))
                ));
                if (status === STATUS_COMPLETED) {
                    const json = await withBridge(this.libraryPath, bindings => (
                        readSessionString(bindings, this.handle, false)
                    ));
                    const result = parseNativeProfilerResult(json);
                    const stat = await fs.stat(this.tracePath);
                    if (!stat.isFile() || stat.size === 0) {
                        throw new Error('Native Tracy capture completed without producing a trace');
                    }
                    return {
                        tracePath: this.tracePath,
                        capturedSeconds: result.capturedSeconds,
                        result
                    };
                }
                if (status === STATUS_FAILED) {
                    const error = await withBridge(this.libraryPath, bindings => (
                        readSessionString(bindings, this.handle, true)
                    ));
                    throw new Error(error || 'Native Tracy capture failed');
                }
                if (status < 1 || status > STATUS_FAILED) {
                    throw new Error(`Native Tracy bridge returned an invalid status: ${status}`);
                }
                await delay(40);
            }
        } finally {
            await this.release();
        }
    }

    private async release(): Promise<void> {
        if (this.released) return;
        this.released = true;
        const handle = this.handle;
        this.handle = undefined;
        if (handle === undefined) return;
        await withBridge(this.libraryPath, bindings => new Promise<void>((resolve, reject) => {
            bindings.release.async(handle, (error: unknown, result: unknown) => {
                if (error) {
                    reject(error);
                } else if (Number(result) !== 0) {
                    reject(new Error('Unable to release the native Tracy capture handle'));
                } else {
                    resolve();
                }
            });
        }));
    }
}

export function resolveTracyBridge(extensionRoot: string): string {
    return path.join(
        extensionRoot,
        'bin',
        'native',
        'windows',
        'x64',
        'mcdev-tracy-bridge.dll'
    );
}

export async function shutdownAllNativeProfilerCaptures(extensionRoot: string): Promise<void> {
    if (!bridgeActivated) return;
    const libraryPath = resolveTracyBridge(extensionRoot);
    try {
        await fs.access(libraryPath);
    } catch {
        return;
    }
    await withBridge(libraryPath, bindings => new Promise<void>((resolve, reject) => {
        bindings.shutdownAll.async((error: unknown) => error ? reject(error) : resolve());
    }));
}

function withBridge<T>(
    libraryPath: string,
    operation: (bindings: TracyBridgeBindings) => T | Promise<T>
): Promise<T> {
    return dynamicLibraryManager.run(libraryPath, library => {
        let bindings = bindingsByLibrary.get(library);
        if (!bindings) {
            bindings = bindBridge(library);
            bindingsByLibrary.set(library, bindings);
        }
        return operation(bindings);
    });
}

function bindBridge(library: { func(definition: string): NativeFunction }): TracyBridgeBindings {
    return {
        apiVersion: library.func('uint32_t mcdev_tracy_api_version()'),
        protocolVersion: library.func('const char *mcdev_tracy_protocol_version()'),
        start: library.func('void *mcdev_tracy_start(const char *, uint16_t, uint32_t, uint32_t, uint32_t, const char *)'),
        status: library.func('int32_t mcdev_tracy_get_status(void *)'),
        stop: library.func('int32_t mcdev_tracy_stop(void *)'),
        resultSize: library.func('size_t mcdev_tracy_result_size(void *)'),
        copyResult: library.func('int32_t mcdev_tracy_copy_result(void *, void *, size_t)'),
        errorSize: library.func('size_t mcdev_tracy_error_size(void *)'),
        copyError: library.func('int32_t mcdev_tracy_copy_error(void *, void *, size_t)'),
        lastErrorSize: library.func('size_t mcdev_tracy_last_error_size()'),
        copyLastError: library.func('int32_t mcdev_tracy_copy_last_error(void *, size_t)'),
        release: library.func('int32_t mcdev_tracy_release(void *)'),
        shutdownAll: library.func('void mcdev_tracy_shutdown_all()')
    };
}

function readLastError(bindings: TracyBridgeBindings): string {
    return copyNativeString(Number(bindings.lastErrorSize()), buffer => (
        Number(bindings.copyLastError(buffer, buffer.length))
    ));
}

function readSessionString(bindings: TracyBridgeBindings, handle: unknown, error: boolean): string {
    const size = Number(error ? bindings.errorSize(handle) : bindings.resultSize(handle));
    return copyNativeString(size, buffer => Number(
        error
            ? bindings.copyError(handle, buffer, buffer.length)
            : bindings.copyResult(handle, buffer, buffer.length)
    ));
}

function copyNativeString(size: number, copy: (buffer: Buffer) => number): string {
    if (size === 0) return '';
    if (!Number.isSafeInteger(size) || size < 1 || size > MAXIMUM_RESULT_BYTES) {
        throw new Error(`Native Tracy bridge returned an invalid string size: ${size}`);
    }
    const buffer = Buffer.alloc(size);
    if (copy(buffer) !== 0 || buffer[size - 1] !== 0) {
        throw new Error('Native Tracy bridge returned an invalid string buffer');
    }
    return buffer.toString('utf8', 0, size - 1);
}

export function parseNativeProfilerResult(json: string): NativeProfilerResult {
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== 'object') {
        throw new Error('Native Tracy bridge returned an invalid result');
    }
    const result = value as NativeProfilerResult;
    if (
        !finiteNonNegative(result.capturedSeconds)
        || !Number.isSafeInteger(result.totalZones)
        || result.totalZones < 0
        || typeof result.truncated !== 'boolean'
        || typeof result.callTreeTruncated !== 'boolean'
        || !Array.isArray(result.zones)
        || result.zones.length > 10_000
        || !Array.isArray(result.threads)
        || result.threads.length > 128
    ) {
        throw new Error('Native Tracy bridge returned invalid profile metadata');
    }
    for (const zone of result.zones) {
        if (!validZone(zone)) {
            throw new Error('Native Tracy bridge returned an invalid profile zone');
        }
    }
    const callNodes = result.threads.flatMap(thread => {
        if (
            !thread || typeof thread.id !== 'string' || thread.id.length > 64
            || typeof thread.name !== 'string' || thread.name.length > 4096
            || !Number.isSafeInteger(thread.calls) || thread.calls < 0
            || !finiteNonNegative(thread.totalNanoseconds)
            || !Array.isArray(thread.roots)
        ) {
            throw new Error('Native Tracy bridge returned an invalid profile thread');
        }
        return thread.roots;
    });
    let callNodeCount = 0;
    while (callNodes.length > 0) {
        const node = callNodes.pop();
        if (!node || !validZone(node) || !Array.isArray(node.children)) {
            throw new Error('Native Tracy bridge returned an invalid call tree node');
        }
        callNodeCount += 1;
        if (callNodeCount > 10_000) {
            throw new Error('Native Tracy bridge returned too many call tree nodes');
        }
        callNodes.push(...node.children);
    }
    result.zones = result.zones.filter(zone => !isIgnoredNativeSource(zone.sourceFile));
    result.threads = result.threads.flatMap(thread => {
        thread.roots = filterIgnoredCallNodes(thread.roots);
        if (thread.roots.length === 0) return [];
        thread.totalNanoseconds = thread.roots.reduce((total, root) => total + root.totalNanoseconds, 0);
        thread.calls = countCallNodeInvocations(thread.roots);
        return [thread];
    });
    return result;
}

function filterIgnoredCallNodes(nodes: NativeProfilerResult['threads'][number]['roots']): NativeProfilerResult['threads'][number]['roots'] {
    return nodes.flatMap(node => {
        node.children = filterIgnoredCallNodes(node.children);
        return isIgnoredNativeSource(node.sourceFile) ? node.children : [node];
    });
}

function countCallNodeInvocations(nodes: NativeProfilerResult['threads'][number]['roots']): number {
    let calls = 0;
    const pending = nodes.slice();
    while (pending.length > 0) {
        const node = pending.pop();
        if (!node) continue;
        calls += node.calls;
        pending.push(...node.children);
    }
    return calls;
}

function isIgnoredNativeSource(sourceFile: string): boolean {
    const prefix = 'DEBUG_ENV_SCRIPT';
    if (sourceFile === prefix) return true;
    if (!sourceFile.startsWith(prefix) || sourceFile.length <= prefix.length) return false;
    return ['.', '/', '\\'].includes(sourceFile[prefix.length]);
}

function validZone(zone: any): boolean {
    return Boolean(
        zone && typeof zone.name === 'string' && zone.name.length <= 4096
        && typeof zone.sourceFile === 'string' && zone.sourceFile.length <= 32 * 1024
        && Number.isSafeInteger(zone.id) && zone.id >= 0
        && Number.isSafeInteger(zone.sourceLine) && zone.sourceLine >= 0
        && Number.isSafeInteger(zone.calls) && zone.calls >= 0
        && finiteNonNegative(zone.totalNanoseconds)
        && finiteNonNegative(zone.selfNanoseconds)
        && finiteNonNegative(zone.meanNanoseconds)
        && finiteNonNegative(zone.maximumNanoseconds)
    );
}

function finiteNonNegative(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => {
        const timer = setTimeout(resolve, milliseconds);
        timer.unref?.();
    });
}

async function removeTemporaryDirectory(directory: string): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
            await fs.rm(directory, { recursive: true, force: true });
            return;
        } catch {
            if (attempt < 5) await delay(400);
        }
    }
}
