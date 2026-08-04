import { execFile } from 'child_process';

export const TRACY_PORT_START = 8086;
export const TRACY_PORT_END = 8105;

export interface NativeProfilerEndpoint {
    pid: number;
    port: number;
}

export function parseNetstatTracyListeners(output: string): NativeProfilerEndpoint[] {
    const endpoints = new Map<string, NativeProfilerEndpoint>();
    for (const rawLine of output.split(/\r?\n/)) {
        const columns = rawLine.trim().split(/\s+/);
        if (columns.length < 5 || columns[0].toUpperCase() !== 'TCP') {
            continue;
        }
        const state = columns[columns.length - 2].toUpperCase();
        if (state !== 'LISTENING' && state !== '侦听') {
            continue;
        }
        const pid = Number(columns[columns.length - 1]);
        const port = endpointPort(columns[1]);
        if (
            !Number.isInteger(pid)
            || pid <= 0
            || port === undefined
            || port < TRACY_PORT_START
            || port > TRACY_PORT_END
        ) {
            continue;
        }
        endpoints.set(`${pid}:${port}`, { pid, port });
    }
    return [...endpoints.values()].sort((left, right) => left.port - right.port || left.pid - right.pid);
}

export function discoverTracyListeners(): Promise<NativeProfilerEndpoint[]> {
    if (process.platform !== 'win32') {
        return Promise.resolve([]);
    }
    return new Promise((resolve, reject) => {
        execFile(
            'netstat.exe',
            ['-ano', '-p', 'tcp'],
            { windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
            (error, stdout) => {
                if (error) {
                    reject(new Error(`Unable to inspect Tracy ports: ${error.message}`));
                    return;
                }
                resolve(parseNetstatTracyListeners(stdout));
            }
        );
    });
}

function endpointPort(endpoint: string): number | undefined {
    const match = /:(\d+)$/.exec(endpoint);
    if (!match) {
        return undefined;
    }
    const value = Number(match[1]);
    return Number.isInteger(value) ? value : undefined;
}
