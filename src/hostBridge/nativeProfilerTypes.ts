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

export interface NativeProfilerResult {
    capturedSeconds: number;
    totalZones: number;
    truncated: boolean;
    zones: NativeProfilerZone[];
}
