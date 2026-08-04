import * as path from 'path';
import * as vscode from 'vscode';

const PYTHON_EXCLUDE = '**/{.git,.mcdev,.venv,venv,env,node_modules,__pycache__,build,dist,out,QuModLibs}/**';
const MAX_SOURCE_MATCHES = 64;

export interface PythonProfilerSourceTarget {
    projectRoot: string;
    module: string;
    line: number;
    functionName: string;
}

export async function openPythonProfilerSource(target: PythonProfilerSourceTarget): Promise<void> {
    const uri = await resolveSourceUri(target.projectRoot, target.module);
    if (!uri) {
        throw new Error(`Unable to locate profiled source file: ${target.module}`);
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const fallback = positionAtProfileLine(document, target.line);
    const position = await resolveFunctionPosition(uri, target.functionName, target.line) ?? fallback;
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );
}

async function resolveSourceUri(projectRoot: string, moduleName: string): Promise<vscode.Uri | undefined> {
    const root = path.resolve(projectRoot);
    const variants = sourceVariants(moduleName);
    for (const variant of variants) {
        const candidate = path.isAbsolute(variant) ? path.resolve(variant) : path.resolve(root, variant);
        if (isWithinRoot(root, candidate) && await isFile(candidate)) {
            return vscode.Uri.file(candidate);
        }
    }

    const basenames = [...new Set(variants.map(value => path.basename(value)).filter(Boolean))];
    const matches: vscode.Uri[] = [];
    for (const basename of basenames) {
        const found = await vscode.workspace.findFiles(
            new vscode.RelativePattern(root, `**/${escapeGlobSegment(basename)}`),
            PYTHON_EXCLUDE,
            MAX_SOURCE_MATCHES
        );
        matches.push(...found);
        if (matches.length >= MAX_SOURCE_MATCHES) {
            break;
        }
    }
    const unique = [...new Map(matches.map(uri => [uri.fsPath.toLowerCase(), uri])).values()];
    unique.sort((left, right) => (
        sourceMatchScore(right.fsPath, variants) - sourceMatchScore(left.fsPath, variants)
        || left.fsPath.length - right.fsPath.length
    ));
    return unique[0];
}

async function resolveFunctionPosition(
    uri: vscode.Uri,
    functionName: string,
    profileLine: number
): Promise<vscode.Position | undefined> {
    let symbols: Array<vscode.DocumentSymbol | vscode.SymbolInformation> | undefined;
    try {
        symbols = await vscode.commands.executeCommand<Array<vscode.DocumentSymbol | vscode.SymbolInformation>>(
            'vscode.executeDocumentSymbolProvider',
            uri
        );
    } catch {
        return undefined;
    }
    if (!symbols?.length) {
        return undefined;
    }
    const candidates = flattenSymbols(symbols).filter(symbol => {
        const name = symbol.name.split('.').pop() ?? symbol.name;
        const expected = functionName.split('.').pop() ?? functionName;
        return name === expected && (
            symbol.kind === vscode.SymbolKind.Function
            || symbol.kind === vscode.SymbolKind.Method
            || symbol.kind === vscode.SymbolKind.Constructor
        );
    });
    candidates.sort((left, right) => (
        Math.abs(symbolPosition(left).line - Math.max(0, profileLine - 1))
        - Math.abs(symbolPosition(right).line - Math.max(0, profileLine - 1))
    ));
    return candidates[0] ? symbolPosition(candidates[0]) : undefined;
}

function flattenSymbols(
    symbols: Array<vscode.DocumentSymbol | vscode.SymbolInformation>
): Array<vscode.DocumentSymbol | vscode.SymbolInformation> {
    const flattened: Array<vscode.DocumentSymbol | vscode.SymbolInformation> = [];
    for (const symbol of symbols) {
        flattened.push(symbol);
        if ('children' in symbol && Array.isArray(symbol.children)) {
            flattened.push(...flattenSymbols(symbol.children));
        }
    }
    return flattened;
}

function symbolPosition(symbol: vscode.DocumentSymbol | vscode.SymbolInformation): vscode.Position {
    return 'selectionRange' in symbol ? symbol.selectionRange.start : symbol.location.range.start;
}

function positionAtProfileLine(document: vscode.TextDocument, line: number): vscode.Position {
    const lineNumber = Math.max(0, Math.min(document.lineCount - 1, Math.trunc(line || 1) - 1));
    return new vscode.Position(lineNumber, document.lineAt(lineNumber).firstNonWhitespaceCharacterIndex);
}

function sourceVariants(moduleName: string): string[] {
    const raw = moduleName.trim().replace(/^file:\/\//i, '');
    if (!raw) {
        return [];
    }
    const variants = [path.normalize(raw.replace(/[\\/]+/g, path.sep))];
    if (!/[\\/]/.test(raw) && !raw.toLowerCase().endsWith('.py')) {
        variants.push(path.normalize(`${raw.replace(/\./g, path.sep)}.py`));
    }
    return [...new Set(variants)];
}

function sourceMatchScore(candidate: string, variants: string[]): number {
    const normalizedCandidate = candidate.replace(/\\/g, '/').toLowerCase();
    return Math.max(0, ...variants.map(variant => {
        const normalizedVariant = variant.replace(/\\/g, '/').toLowerCase();
        if (normalizedCandidate === normalizedVariant) return 10_000;
        if (normalizedCandidate.endsWith(`/${normalizedVariant}`)) return 5_000 + normalizedVariant.length;
        return path.basename(normalizedCandidate) === path.basename(normalizedVariant) ? 100 : 0;
    }));
}

function isWithinRoot(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function isFile(filePath: string): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
        return (stat.type & vscode.FileType.File) !== 0;
    } catch {
        return false;
    }
}

function escapeGlobSegment(value: string): string {
    return value.replace(/[?*\[\]{}]/g, character => `[${character}]`);
}
