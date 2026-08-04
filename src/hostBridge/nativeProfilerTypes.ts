export interface NativeProfilerZone {
    id: number;
    name: string;
    sourceFile: string;
    sourceLine: number;
    calls: number;
    totalNanoseconds: number;
    selfNanoseconds: number;
    meanNanoseconds: number;
    maximumNanoseconds: number;
}

export interface NativeProfilerCallNode extends NativeProfilerZone {
    children: NativeProfilerCallNode[];
}

export interface NativeProfilerThread {
    id: string;
    name: string;
    calls: number;
    totalNanoseconds: number;
    roots: NativeProfilerCallNode[];
}

export interface NativeProfilerResult {
    capturedSeconds: number;
    totalZones: number;
    truncated: boolean;
    callTreeTruncated: boolean;
    zones: NativeProfilerZone[];
    threads: NativeProfilerThread[];
}
