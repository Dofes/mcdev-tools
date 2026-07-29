import { randomUUID } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { McdevProjectRegistry } from './projectRegistry';

export type PythonExecutionTarget = 'server' | 'client';
export type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | { [key: string]: JsonValue };

export interface PythonFunctionArguments {
    args: JsonValue[];
    kwargs: Record<string, JsonValue>;
}

export interface RunPythonFunctionRequest {
    id: string;
    target: PythonExecutionTarget;
    relativePath: string;
    functionName: string;
    qualifiedName: string;
    source: string;
    documentVersion: number;
    isDirty: boolean;
    args: JsonValue[];
    kwargs: Record<string, JsonValue>;
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
}

export async function submitPythonFunctionToGame(
    _request: RunPythonFunctionRequest
): Promise<void> {
    // TODO: 在这里把请求提交到对应的游戏服务端或客户端。
}

interface RunFunctionCommandArguments {
    uri: vscode.Uri;
    range: vscode.Range;
    qualifiedName: string;
}

const RUN_FUNCTION_COMMAND = 'mcdev-tools.runPythonFunction';
const MAX_ARGUMENT_INPUT_LENGTH = 16 * 1024;
const MAX_ARGUMENT_DEPTH = 16;

export function parsePythonFunctionArguments(input: string): PythonFunctionArguments {
    const trimmed = input.trim();
    if (!trimmed) {
        return { args: [], kwargs: {} };
    }
    if (Buffer.byteLength(trimmed, 'utf8') > MAX_ARGUMENT_INPUT_LENGTH) {
        throw new Error('参数内容不能超过 16 KiB');
    }

    let value: unknown;
    try {
        value = JSON.parse(trimmed);
    } catch {
        throw new Error('请输入有效的 JSON');
    }

    assertJsonDepth(value, 0);

    if (Array.isArray(value)) {
        return { args: value as JsonValue[], kwargs: {} };
    }
    if (!isJsonObject(value)) {
        throw new Error('参数必须是 JSON 数组或包含 args/kwargs 的对象');
    }

    const unknownKeys = Object.keys(value).filter(key => key !== 'args' && key !== 'kwargs');
    if (unknownKeys.length > 0) {
        throw new Error(`不支持的参数字段：${unknownKeys.join(', ')}`);
    }

    const args = Object.prototype.hasOwnProperty.call(value, 'args') ? value.args : [];
    const kwargs = Object.prototype.hasOwnProperty.call(value, 'kwargs') ? value.kwargs : {};
    if (!Array.isArray(args)) {
        throw new Error('args 必须是 JSON 数组');
    }
    if (!isJsonObject(kwargs)) {
        throw new Error('kwargs 必须是 JSON 对象');
    }

    return {
        args: args as JsonValue[],
        kwargs: kwargs as Record<string, JsonValue>
    };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertJsonDepth(value: unknown, depth: number): void {
    if (depth > MAX_ARGUMENT_DEPTH) {
        throw new Error(`参数嵌套不能超过 ${MAX_ARGUMENT_DEPTH} 层`);
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            assertJsonDepth(item, depth + 1);
        }
    } else if (isJsonObject(value)) {
        for (const item of Object.values(value)) {
            assertJsonDepth(item, depth + 1);
        }
    }
}

export class PythonFunctionRunner implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private codeLensRegistration: vscode.Disposable | undefined;

    public constructor(private readonly projects: McdevProjectRegistry) {
        this.disposables.push(
            vscode.commands.registerCommand(
                RUN_FUNCTION_COMMAND,
                (args: RunFunctionCommandArguments) => this.pickTargetAndRun(args)
            ),
            projects.onDidChange(() => this.refreshCodeLensRegistration())
        );

        this.refreshCodeLensRegistration();
    }

    private async pickTargetAndRun(args: RunFunctionCommandArguments): Promise<void> {
        const selection = await vscode.window.showQuickPick<{
            label: string;
            target: PythonExecutionTarget;
        }>([
            { label: '服务端', target: 'server' },
            { label: '客户端', target: 'client' }
        ], {
            placeHolder: '选择运行环境'
        });

        if (selection) {
            const targetLabel = selection.target === 'server' ? '服务端' : '客户端';
            const input = await vscode.window.showInputBox({
                title: `${targetLabel} · ${args.qualifiedName}`,
                prompt: '函数参数（JSON，可留空）',
                placeHolder: '[1, "text"] 或 {"args":[],"kwargs":{}}',
                validateInput: value => {
                    try {
                        parsePythonFunctionArguments(value);
                        return undefined;
                    } catch (error) {
                        return error instanceof Error ? error.message : String(error);
                    }
                }
            });

            if (input !== undefined) {
                await this.run(
                    args,
                    selection.target,
                    parsePythonFunctionArguments(input)
                );
            }
        }
    }

    public dispose(): void {
        this.codeLensRegistration?.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    private refreshCodeLensRegistration(): void {
        this.codeLensRegistration?.dispose();
        this.codeLensRegistration = undefined;

        if (!this.projects.hasProjects) {
            return;
        }

        const selector: vscode.DocumentSelector = this.projects.folders.map(folder => ({
            language: 'python',
            scheme: folder.uri.scheme,
            pattern: new vscode.RelativePattern(folder, '**/*.py')
        }));

        this.codeLensRegistration = vscode.languages.registerCodeLensProvider(
            selector,
            new PythonFunctionCodeLensProvider()
        );
    }

    private async run(
        args: RunFunctionCommandArguments | undefined,
        target: PythonExecutionTarget,
        parameters: PythonFunctionArguments
    ): Promise<void> {
        if (!args?.uri || !args.range || !args.qualifiedName) {
            vscode.window.showErrorMessage('无法确定要运行的 Python 函数。');
            return;
        }

        const projectFolder = this.projects.getProjectFolder(args.uri);
        if (!projectFolder) {
            vscode.window.showWarningMessage('当前文件不属于包含 .mcdev.json 的项目。');
            return;
        }

        const document = await vscode.workspace.openTextDocument(args.uri);
        if (document.languageId !== 'python') {
            vscode.window.showErrorMessage('只能向游戏提交 Python 函数。');
            return;
        }

        const request: RunPythonFunctionRequest = {
            id: randomUUID(),
            target,
            relativePath: path.relative(projectFolder.uri.fsPath, document.uri.fsPath)
                .split(path.sep)
                .join('/'),
            functionName: args.qualifiedName.split('.').at(-1) ?? args.qualifiedName,
            qualifiedName: args.qualifiedName,
            source: document.getText(args.range),
            documentVersion: document.version,
            isDirty: document.isDirty,
            args: parameters.args,
            kwargs: parameters.kwargs,
            range: {
                start: {
                    line: args.range.start.line,
                    character: args.range.start.character
                },
                end: {
                    line: args.range.end.line,
                    character: args.range.end.character
                }
            }
        };

        await submitPythonFunctionToGame(request);

        const targetLabel = target === 'server' ? '服务端' : '客户端';
        vscode.window.showInformationMessage(
            `已生成${targetLabel}运行请求：${request.qualifiedName}（游戏侧提交尚未接入）`
        );
    }

}

class PythonFunctionCodeLensProvider implements vscode.CodeLensProvider {
    public async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> {
        const symbols = await vscode.commands.executeCommand<
            Array<vscode.DocumentSymbol | vscode.SymbolInformation>
        >(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        );

        if (token.isCancellationRequested || !symbols) {
            return [];
        }

        const codeLenses: vscode.CodeLens[] = [];
        this.collectFunctionLenses(document.uri, symbols, '', codeLenses);
        return codeLenses;
    }

    private collectFunctionLenses(
        uri: vscode.Uri,
        symbols: ReadonlyArray<vscode.DocumentSymbol | vscode.SymbolInformation>,
        parentName: string,
        result: vscode.CodeLens[]
    ): void {
        for (const symbol of symbols) {
            const isFlatSymbol = 'location' in symbol;
            const symbolParentName = isFlatSymbol ? symbol.containerName : parentName;
            const qualifiedName = symbolParentName
                ? `${symbolParentName}.${symbol.name}`
                : symbol.name;
            const range = isFlatSymbol ? symbol.location.range : symbol.range;
            const selectionRange = isFlatSymbol ? symbol.location.range : symbol.selectionRange;

            if (symbol.kind === vscode.SymbolKind.Function || symbol.kind === vscode.SymbolKind.Method) {
                const args: RunFunctionCommandArguments = {
                    uri,
                    range,
                    qualifiedName
                };

                result.push(new vscode.CodeLens(selectionRange, {
                    title: '运行函数',
                    command: RUN_FUNCTION_COMMAND,
                    arguments: [args]
                }));
            }

            if (!isFlatSymbol && symbol.children.length > 0) {
                this.collectFunctionLenses(uri, symbol.children, qualifiedName, result);
            }
        }
    }
}
