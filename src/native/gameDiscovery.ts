import * as fs from 'fs';
import * as path from 'path';
import { dynamicLibraryManager } from './dynamicLibraryManager';

const MAX_GAME_PATHS = 10_000;

let discoveryPromise: Promise<string[]> | undefined;

export const isGameExecutableDiscoverySupported =
    process.platform === 'win32' && process.arch === 'x64';

export function getGameExecutablePaths(extensionPath: string): Promise<string[]> {
    if (!isGameExecutableDiscoverySupported) {
        return Promise.resolve([]);
    }

    if (!discoveryPromise) {
        discoveryPromise = discoverGameExecutablePaths(extensionPath).catch(error => {
            discoveryPromise = undefined;
            throw error;
        });
    }

    return discoveryPromise;
}

async function discoverGameExecutablePaths(extensionPath: string): Promise<string[]> {
    const libraryPath = path.join(
        extensionPath,
        'bin',
        'native',
        'windows',
        'x64',
        'mcdk-api.dll'
    );

    if (!fs.existsSync(libraryPath)) {
        throw new Error(`Native game discovery library was not found: ${libraryPath}`);
    }

    return dynamicLibraryManager.run(libraryPath, (library, koffi) => new Promise((resolve, reject) => {
        const getPaths = library.func(
            'const char **mcdk_api_get_game_exe_paths(_Out_ size_t *count)'
        );
        const count = [0];

        getPaths.async(count, (error: unknown, pointer: unknown) => {
            if (error) {
                reject(error);
                return;
            }

            const pathCount = count[0];
            if (!Number.isSafeInteger(pathCount) || pathCount < 0 || pathCount > MAX_GAME_PATHS) {
                reject(new Error(`Native game discovery returned an invalid path count: ${pathCount}`));
                return;
            }
            if (pathCount === 0 || pointer === null) {
                resolve([]);
                return;
            }

            try {
                const pathArrayType = koffi.array('const char *', pathCount);
                const decoded = koffi.decode(pointer, pathArrayType) as unknown[];
                const paths = decoded.filter((value): value is string =>
                    typeof value === 'string' && value.length > 0
                );
                resolve(Array.from(new Set(paths)));
            } catch (decodeError) {
                reject(decodeError);
            }
        });
    }));
}

