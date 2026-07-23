import * as path from 'path';

type KoffiFunction = ((...args: unknown[]) => unknown) & {
    async: (...args: unknown[]) => void;
};

type KoffiLibrary = {
    func(definition: string): KoffiFunction;
    unload(): void;
};

type KoffiModule = {
    load(libraryPath: string): KoffiLibrary;
    array(type: string, length: number): unknown;
    decode(pointer: unknown, type: unknown): unknown;
};

type LibraryEntry = {
    path: string;
    handle: KoffiLibrary;
};

class DynamicLibraryManager {
    private readonly handles = new Map<string, LibraryEntry>();
    private readonly pendingCalls = new Set<Promise<unknown>>();
    private koffi?: KoffiModule;
    private disposing = false;
    private unloadPromise?: Promise<void>;

    public run<T>(
        libraryPath: string,
        operation: (library: KoffiLibrary, koffi: KoffiModule) => Promise<T> | T
    ): Promise<T> {
        if (this.disposing) {
            return Promise.reject(new Error('Native libraries are being unloaded'));
        }

        const call = Promise.resolve().then(() => {
            if (this.disposing) {
                throw new Error('Native libraries are being unloaded');
            }

            const resolvedPath = path.resolve(libraryPath);
            const libraryKey = process.platform === 'win32'
                ? resolvedPath.toLowerCase()
                : resolvedPath;
            const koffi = this.koffi
                ?? require(path.join(path.dirname(resolvedPath), 'koffi.node')) as KoffiModule;
            this.koffi = koffi;

            let entry = this.handles.get(libraryKey);
            if (!entry) {
                entry = { path: resolvedPath, handle: koffi.load(resolvedPath) };
                this.handles.set(libraryKey, entry);
            }

            return operation(entry.handle, koffi);
        });

        this.pendingCalls.add(call);
        void call.finally(() => this.pendingCalls.delete(call)).catch(() => undefined);
        return call;
    }

    public unloadAll(): Promise<void> {
        if (!this.unloadPromise) {
            this.disposing = true;
            this.unloadPromise = this.finishUnload();
        }
        return this.unloadPromise;
    }

    private async finishUnload(): Promise<void> {
        await Promise.allSettled(Array.from(this.pendingCalls));

        for (const { path: libraryPath, handle } of Array.from(this.handles.values()).reverse()) {
            try {
                handle.unload();
            } catch (error) {
                console.error(`Failed to unload native library: ${libraryPath}`, error);
            }
        }

        this.handles.clear();
        this.koffi = undefined;
    }
}

export const dynamicLibraryManager = new DynamicLibraryManager();
