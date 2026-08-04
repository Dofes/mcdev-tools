import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { ensureMcdevDirectory } from '../utils/mcdevDirectory';
import { discoverDebugFunctions, PythonSourceFile } from './parser';
import {
    DebugFunctionArgumentConfig,
    DebugFunctionParameter,
    DebugFunctionsDocument,
    DiscoveredDebugFunction,
    SavedDebugFunction
} from './types';

const DOCUMENT_PATH = '.mcdev/debug-functions.json';
const PYTHON_EXCLUDE = '**/{.git,.mcdev,.venv,venv,env,node_modules,__pycache__,build,dist,out,QuModLibs}/**';
const MAX_PYTHON_FILES = 10_000;

interface WorkspaceCache {
    saved?: SavedDebugFunction[];
    discovered?: DiscoveredDebugFunction[];
    pythonWatcher: vscode.FileSystemWatcher;
    documentWatcher: vscode.FileSystemWatcher;
    writeTail: Promise<void>;
}

export class DebugFunctionService implements vscode.Disposable {
    private readonly caches = new Map<string, WorkspaceCache>();

    public async load(workspacePath: string): Promise<SavedDebugFunction[]> {
        const cache = this.ensureCache(workspacePath);
        if (!cache.saved) {
            cache.saved = await this.readDocument(workspacePath);
        }
        return cache.saved.map(cloneSavedFunction);
    }

    public async discover(workspacePath: string, force = false): Promise<DiscoveredDebugFunction[]> {
        const cache = this.ensureCache(workspacePath);
        if (!cache.discovered || force) {
            const pattern = new vscode.RelativePattern(workspacePath, '**/*.py');
            const uris = await vscode.workspace.findFiles(pattern, PYTHON_EXCLUDE, MAX_PYTHON_FILES);
            const sources: PythonSourceFile[] = [];
            for (let index = 0; index < uris.length; index += 32) {
                const batch = uris.slice(index, index + 32);
                const contents = await Promise.all(batch.map(async uri => ({
                    relativePath: normalizeRelative(workspacePath, uri.fsPath),
                    content: Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')
                })));
                sources.push(...contents);
            }
            cache.discovered = discoverDebugFunctions(path.basename(workspacePath), sources);
        }
        return cache.discovered.map(cloneDiscoveredFunction);
    }

    public async save(workspacePath: string, candidate: unknown): Promise<SavedDebugFunction[]> {
        const saved = validateSavedFunction(candidate);
        const cache = this.ensureCache(workspacePath);
        const current = await this.load(workspacePath);
        const index = current.findIndex(item => item.id === saved.id);
        if (index >= 0) {
            current[index] = saved;
        } else {
            current.push(saved);
        }
        cache.saved = current;
        await this.queueWrite(workspacePath, cache, current);
        return current.map(cloneSavedFunction);
    }

    public async delete(workspacePath: string, id: string): Promise<SavedDebugFunction[]> {
        const cache = this.ensureCache(workspacePath);
        const current = await this.load(workspacePath);
        const next = current.filter(item => item.id !== id);
        cache.saved = next;
        await this.queueWrite(workspacePath, cache, next);
        return next.map(cloneSavedFunction);
    }

    public dispose(): void {
        for (const cache of this.caches.values()) {
            cache.pythonWatcher.dispose();
            cache.documentWatcher.dispose();
        }
        this.caches.clear();
    }

    private ensureCache(workspacePath: string): WorkspaceCache {
        const key = normalizeKey(workspacePath);
        const existing = this.caches.get(key);
        if (existing) {
            return existing;
        }
        const pythonWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspacePath, '**/*.py')
        );
        const documentWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspacePath, DOCUMENT_PATH)
        );
        const cache: WorkspaceCache = {
            pythonWatcher,
            documentWatcher,
            writeTail: Promise.resolve()
        };
        const invalidateDiscovery = (uri: vscode.Uri) => {
            if (!hasQuModLibsDirectory(normalizeRelative(workspacePath, uri.fsPath))) {
                cache.discovered = undefined;
            }
        };
        pythonWatcher.onDidCreate(invalidateDiscovery);
        pythonWatcher.onDidChange(invalidateDiscovery);
        pythonWatcher.onDidDelete(invalidateDiscovery);
        const invalidateSaved = () => { cache.saved = undefined; };
        documentWatcher.onDidCreate(invalidateSaved);
        documentWatcher.onDidChange(invalidateSaved);
        documentWatcher.onDidDelete(invalidateSaved);
        this.caches.set(key, cache);
        return cache;
    }

    private async readDocument(workspacePath: string): Promise<SavedDebugFunction[]> {
        const uri = vscode.Uri.file(path.join(workspacePath, ...DOCUMENT_PATH.split('/')));
        try {
            const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
            const parsed: unknown = JSON.parse(content);
            if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.functions)) {
                return [];
            }
            return parsed.functions.flatMap(candidate => {
                try {
                    return [validateSavedFunction(candidate)];
                } catch {
                    return [];
                }
            });
        } catch (error) {
            if (isFileNotFound(error)) {
                return [];
            }
            throw error;
        }
    }

    private queueWrite(
        workspacePath: string,
        cache: WorkspaceCache,
        functions: SavedDebugFunction[]
    ): Promise<void> {
        const snapshot: DebugFunctionsDocument = {
            version: 1,
            functions: functions.map(cloneSavedFunction)
        };
        cache.writeTail = cache.writeTail.catch(() => undefined).then(async () => {
            const directory = vscode.Uri.file(await ensureMcdevDirectory(workspacePath));
            const target = vscode.Uri.joinPath(directory, 'debug-functions.json');
            const temporary = vscode.Uri.joinPath(
                directory,
                `.debug-functions.${crypto.randomUUID()}.tmp`
            );
            await vscode.workspace.fs.createDirectory(directory);
            await vscode.workspace.fs.writeFile(
                temporary,
                Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
            );
            try {
                await vscode.workspace.fs.rename(temporary, target, { overwrite: true });
            } catch (error) {
                await Promise.resolve(vscode.workspace.fs.delete(temporary)).catch(() => undefined);
                throw error;
            }
        });
        return cache.writeTail;
    }
}

export function validateSavedFunction(candidate: unknown): SavedDebugFunction {
    if (!isRecord(candidate)) {
        throw new Error('Invalid debug function');
    }
    const id = boundedString(candidate.id, 128) || crypto.randomUUID();
    const label = boundedString(candidate.label, 160);
    const modulePath = boundedString(candidate.modulePath, 512);
    const functionName = boundedString(candidate.functionName, 160);
    const relativeFilePath = boundedString(candidate.relativeFilePath, 1024).replace(/\\/g, '/');
    const line = Number.isInteger(candidate.line) && Number(candidate.line) > 0
        ? Number(candidate.line)
        : 1;
    if (!label || !isModulePath(modulePath) || !isIdentifier(functionName) || !relativeFilePath) {
        throw new Error('Debug function metadata is incomplete');
    }
    const parameters = Array.isArray(candidate.parameters)
        ? candidate.parameters.map(validateParameter)
        : [];
    const argumentConfigs: Record<string, DebugFunctionArgumentConfig> = {};
    if (isRecord(candidate.argumentConfigs)) {
        for (const parameter of parameters) {
            const config = candidate.argumentConfigs[parameter.name];
            if (isRecord(config)) {
                const mode = config.mode === 'fixed' || config.mode === 'required'
                    ? config.mode
                    : 'optional';
                const value = typeof config.value === 'string'
                    ? config.value.slice(0, 64 * 1024)
                    : '';
                argumentConfigs[parameter.name] = { mode, value };
            }
        }
    }
    for (const parameter of parameters) {
        argumentConfigs[parameter.name] ??= {
            mode: parameter.required ? 'required' : 'optional',
            value: ''
        };
    }
    return {
        id,
        key: `${modulePath}:${functionName}`,
        label,
        modulePath,
        functionName,
        relativeFilePath,
        line,
        parameters,
        target: candidate.target === 'server' ? 'server' : 'client',
        argumentConfigs
    };
}

function validateParameter(candidate: unknown): DebugFunctionParameter {
    if (!isRecord(candidate)) {
        throw new Error('Invalid function parameter');
    }
    const name = boundedString(candidate.name, 160);
    if (!isIdentifier(name)) {
        throw new Error('Invalid function parameter name');
    }
    const kind = candidate.kind === 'varargs' || candidate.kind === 'kwargs'
        ? candidate.kind
        : 'value';
    const defaultValue = typeof candidate.defaultValue === 'string'
        ? candidate.defaultValue.slice(0, 4096)
        : undefined;
    return {
        name,
        kind,
        required: kind === 'value' && candidate.required === true,
        ...(defaultValue ? { defaultValue } : {})
    };
}

function cloneSavedFunction(value: SavedDebugFunction): SavedDebugFunction {
    return {
        ...cloneDiscoveredFunction(value),
        id: value.id,
        label: value.label,
        target: value.target,
        argumentConfigs: Object.fromEntries(
            Object.entries(value.argumentConfigs).map(([name, config]) => [name, { ...config }])
        )
    };
}

function cloneDiscoveredFunction(value: DiscoveredDebugFunction): DiscoveredDebugFunction {
    return {
        ...value,
        parameters: value.parameters.map(parameter => ({ ...parameter }))
    };
}

function normalizeRelative(root: string, filePath: string): string {
    return path.relative(root, filePath).split(path.sep).join('/');
}

function hasQuModLibsDirectory(relativePath: string): boolean {
    return relativePath
        .split('/')
        .slice(0, -1)
        .some(part => part.toLowerCase() === 'qumodlibs');
}

function normalizeKey(value: string): string {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function boundedString(value: unknown, maxLength: number): string {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isIdentifier(value: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function isModulePath(value: string): boolean {
    return Boolean(value) && value.split('.').every(isIdentifier);
}

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFileNotFound(error: unknown): boolean {
    return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}
