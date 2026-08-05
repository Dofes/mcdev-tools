import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import test from 'node:test';
import { writePythonMemoryReport } from './pythonMemoryProfilerReport';

test('Python memory reports are written manually under the dedicated profile directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-memory-'));
    const files = await writePythonMemoryReport({
        projectRoot: root,
        worldName: 'Memory World',
        capturedAt: new Date('2026-08-05T12:34:56.789Z')
    }, {
        elapsedSeconds: 7,
        tracebackDepth: 8,
        netSizeDiff: 3072,
        netCountDiff: 3,
        currentSize: 8192,
        currentCount: 10,
        totalAllocations: 2,
        truncated: false,
        allocations: [
            { id: 0, sizeDiff: 4096, countDiff: 5, currentSize: 6144, currentCount: 8, traceback: [{ file: 'demo/cache.py', line: 12 }, { file: 'demo/main.py', line: 3 }] },
            { id: 1, sizeDiff: -1024, countDiff: -2, currentSize: 2048, currentCount: 2, traceback: [{ file: 'demo/old.py', line: 8 }] }
        ]
    });
    assert.match(files.markdownPath, /\.mcdev[\\/]profiles[\\/]python-memory/);
    const [markdown, svg] = await Promise.all([
        fs.readFile(files.markdownPath, 'utf8'),
        fs.readFile(files.svgPath, 'utf8')
    ]);
    assert.match(markdown, /Net retained growth: \+3\.00 KiB/);
    assert.match(markdown, /demo\/cache\.py/);
    assert.match(svg, /Python Memory Profile/);
    assert.match(svg, /Released/);
    assert.match(svg, /Growth/);
});
