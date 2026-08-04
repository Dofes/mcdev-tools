import * as path from 'path';
import * as vscode from 'vscode';

const SOURCE_EXCLUDE = '**/{.git,.mcdev,.venv,venv,node_modules,__pycache__,build,dist,out,QuModLibs}/**';

export async function openNativeProfilerSource(
    projectRoot: string,
    sourceFile: string,
    sourceLine: number
): Promise<void> {
    const root = path.resolve(projectRoot);
    const normalized = path.normalize(sourceFile);
    const direct = path.isAbsolute(normalized) ? normalized : path.resolve(root, normalized);
    let uri: vscode.Uri | undefined;
    if (within(root, direct) && await isFile(direct)) {
        uri = vscode.Uri.file(direct);
    } else {
        const basename = path.basename(normalized);
        if (basename) {
            const matches = await vscode.workspace.findFiles(
                new vscode.RelativePattern(root, `**/${escapeGlob(basename)}`),
                SOURCE_EXCLUDE,
                32
            );
            matches.sort((left, right) => left.fsPath.length - right.fsPath.length);
            uri = matches[0];
        }
    }
    if (!uri) {
        throw new Error(`Unable to locate native profile source: ${sourceFile}`);
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const line = Math.max(0, Math.min(document.lineCount - 1, Math.trunc(sourceLine || 1) - 1));
    const position = new vscode.Position(line, document.lineAt(line).firstNonWhitespaceCharacterIndex);
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

async function isFile(filePath: string): Promise<boolean> {
    try {
        return ((await vscode.workspace.fs.stat(vscode.Uri.file(filePath))).type & vscode.FileType.File) !== 0;
    } catch {
        return false;
    }
}

function within(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function escapeGlob(value: string): string {
    return value.replace(/[?*\[\]{}]/g, character => `[${character}]`);
}
