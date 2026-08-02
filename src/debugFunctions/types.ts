export type DebugFunctionTarget = 'client' | 'server';

export type DebugFunctionParameterKind = 'value' | 'varargs' | 'kwargs';

export type DebugFunctionArgumentMode = 'fixed' | 'optional' | 'required';

export interface DebugFunctionArgumentConfig {
    mode: DebugFunctionArgumentMode;
    value: string;
}

export interface DebugFunctionParameter {
    name: string;
    kind: DebugFunctionParameterKind;
    required: boolean;
    defaultValue?: string;
}

export interface DiscoveredDebugFunction {
    key: string;
    modulePath: string;
    functionName: string;
    relativeFilePath: string;
    line: number;
    parameters: DebugFunctionParameter[];
}

export interface SavedDebugFunction extends DiscoveredDebugFunction {
    id: string;
    label: string;
    target: DebugFunctionTarget;
    argumentConfigs: Record<string, DebugFunctionArgumentConfig>;
}

export interface DebugFunctionsDocument {
    version: 1;
    functions: SavedDebugFunction[];
}
