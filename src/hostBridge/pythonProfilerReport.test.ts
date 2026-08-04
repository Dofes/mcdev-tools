import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import test from 'node:test';
import { writePythonProfilerReport } from './pythonProfilerReport';

test('Python profiler writes SVG and AI-readable Markdown under .mcdev', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-profile-'));
    const files = await writePythonProfilerReport({
        projectRoot: root,
        target: 'client',
        worldName: 'Test World',
        capturedAt: new Date('2026-08-04T12:34:56.789Z')
    }, {
        clock: 'CPU',
        elapsedSeconds: 5,
        totalFunctions: 2,
        truncated: false,
        functions: [
            { id: 0, module: 'demo/main.py', line: 10, name: 'tick', calls: 2, actualCalls: 2, selfTime: 0.2, totalTime: 0.8, contextId: 1, contextName: 'MainThread' },
            { id: 1, module: 'demo/work.py', line: 4, name: 'work', calls: 4, actualCalls: 4, selfTime: 0.4, totalTime: 0.5, contextId: 1, contextName: 'MainThread' }
        ],
        calls: [{ callerId: 0, calleeId: 1, calls: 4, selfTime: 0.4, totalTime: 0.5 }]
    });
    assert.match(files.markdownPath, /\.mcdev[\\/]profiles[\\/]python/);
    const [markdown, svg] = await Promise.all([
        fs.readFile(files.markdownPath, 'utf8'),
        fs.readFile(files.svgPath, 'utf8')
    ]);
    assert.match(markdown, /## Hot Functions/);
    assert.match(markdown, /tick \| work/);
    assert.match(svg, /Python Performance Profile/);
    assert.match(svg, /demo\/main\.py:10/);
});
