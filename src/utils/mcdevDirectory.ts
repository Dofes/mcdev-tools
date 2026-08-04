import { promises as fs } from 'fs';
import * as path from 'path';

const GENERATED_IGNORE_RULES = [
    '# Generated MC Dev Tools reports',
    'reviews/',
    'profiles/'
];

const pendingInitializations = new Map<string, Promise<string>>();

export function ensureMcdevDirectory(projectRoot: string): Promise<string> {
    const directory = path.resolve(projectRoot, '.mcdev');
    const key = process.platform === 'win32' ? directory.toLowerCase() : directory;
    const existing = pendingInitializations.get(key);
    if (existing) {
        return existing;
    }
    const initialization = initialize(directory).finally(() => {
        if (pendingInitializations.get(key) === initialization) {
            pendingInitializations.delete(key);
        }
    });
    pendingInitializations.set(key, initialization);
    return initialization;
}

async function initialize(directory: string): Promise<string> {
    await fs.mkdir(directory, { recursive: true });
    const ignorePath = path.join(directory, '.gitignore');
    let content = '';
    try {
        content = await fs.readFile(ignorePath, 'utf8');
    } catch (error) {
        if (!isMissing(error)) {
            throw error;
        }
    }
    const existingRules = new Set(content.split(/\r?\n/).map(line => line.trim()));
    const missingRules = GENERATED_IGNORE_RULES.filter(rule => !existingRules.has(rule));
    if (missingRules.length > 0) {
        const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
        const leadingLine = content.length > 0 && !content.endsWith('\n\n') ? '\n' : '';
        await fs.writeFile(
            ignorePath,
            `${content}${separator}${leadingLine}${missingRules.join('\n')}\n`,
            'utf8'
        );
    }
    return directory;
}

function isMissing(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT');
}
