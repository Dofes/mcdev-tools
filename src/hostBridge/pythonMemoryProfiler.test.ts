import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
    buildPythonMemoryCleanupCode,
    buildPythonMemoryCollectCode,
    buildPythonMemoryStartCode,
    parsePythonMemoryResult,
    parsePythonMemoryStart
} from './pythonMemoryProfiler';

test('Python memory scripts are compact, bounded, and project-filtered', () => {
    const start = buildPythonMemoryStartCode({ tracebackDepth: 8 });
    const collect = buildPythonMemoryCollectCode(true);
    assert.match(start, /tracemalloc\.start\(8\)/);
    assert.match(collect, /gc\.collect\(\)/);
    assert.match(collect, /compare_to\(_mcdev_pm_base,'traceback'\)/);
    assert.match(collect, /clientScriptNameList/);
    assert.match(collect, /serverScriptNameList/);
    assert.match(collect, /'qumodlibs' in set\(_mcdev_pm_origin\.split\('\/'\)\)/);
    assert.match(collect, /_mcdev_pm_all\[:80\]/);
    assert.ok(start.length < 1_000);
    assert.ok(collect.length < 4_500);
    assert.throws(() => buildPythonMemoryStartCode({ tracebackDepth: 17 }), /between 1 and 16/);
});

test('Python memory parser preserves signed deltas and bounded tracebacks', () => {
    const result = parsePythonMemoryResult({
        ok: true,
        elapsed: 4.25,
        depth: 8,
        sizeDiff: 1536,
        countDiff: -2,
        size: 8192,
        count: 12,
        total: 2,
        truncated: false,
        rows: [
            [0, 2048, 3, 4096, 6, [['demo/main.py', 12], ['demo/cache.py', 4]]],
            [1, -512, -5, 4096, 6, [['demo/old.py', 20]]],
            ['bad', 1, 1, 1, 1, []]
        ]
    });
    assert.equal(result.netSizeDiff, 1536);
    assert.equal(result.netCountDiff, -2);
    assert.equal(result.allocations.length, 2);
    assert.deepEqual(result.allocations[1], {
        id: 1,
        sizeDiff: -512,
        countDiff: -5,
        currentSize: 4096,
        currentCount: 6,
        traceback: [{ file: 'demo/old.py', line: 20 }]
    });
});

test('Python memory parser reports ownership conflicts', () => {
    assert.throws(() => parsePythonMemoryStart({ ok: false, reason: 'busy' }), /already active/);
    assert.throws(() => parsePythonMemoryResult({ ok: false, reason: 'not_owned' }), /No MC Dev Tools/);
});

test('generated Python memory scripts are syntactically valid', t => {
    for (const script of [
        buildPythonMemoryStartCode({ tracebackDepth: 1 }),
        buildPythonMemoryStartCode({ tracebackDepth: 16 }),
        buildPythonMemoryCollectCode(false),
        buildPythonMemoryCollectCode(true),
        buildPythonMemoryCleanupCode()
    ]) {
        const result = spawnSync('python', [
            '-c',
            "import sys; compile(sys.stdin.read(), '<mcdev-memory>', 'exec')"
        ], { input: script, encoding: 'utf8' });
        if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
            t.skip('Python is unavailable');
            return;
        }
        assert.equal(result.status, 0, result.stderr);
    }
});
