import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import test from 'node:test';
import { ensureMcdevDirectory } from './mcdevDirectory';

test('MC Dev directory ignores generated reports but keeps shared debug functions trackable', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-directory-'));
    const directory = await ensureMcdevDirectory(root);
    const ignore = await fs.readFile(path.join(directory, '.gitignore'), 'utf8');
    assert.match(ignore, /^reviews\/$/m);
    assert.match(ignore, /^profiles\/$/m);
    assert.doesNotMatch(ignore, /debug-functions/);
});

test('MC Dev directory preserves existing ignore rules and does not duplicate generated rules', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-directory-existing-'));
    const directory = path.join(root, '.mcdev');
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, '.gitignore'), 'custom.tmp\nprofiles/\n', 'utf8');
    await ensureMcdevDirectory(root);
    const ignore = await fs.readFile(path.join(directory, '.gitignore'), 'utf8');
    assert.match(ignore, /^custom\.tmp$/m);
    assert.equal(ignore.match(/^profiles\/$/gm)?.length, 1);
    assert.match(ignore, /^reviews\/$/m);
});
