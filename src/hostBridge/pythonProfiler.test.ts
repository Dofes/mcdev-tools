import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
    buildPythonProfilerCleanupCode,
    buildPythonProfilerCollectCode,
    buildPythonProfilerStartCode,
    parsePythonProfilerResult,
    parsePythonProfilerStart
} from './pythonProfiler';

test('Python profiler scripts stay bounded and distinguish client and server projects', () => {
    const timed = buildPythonProfilerStartCode({ target: 'client', clock: 'CPU', durationSeconds: 12.5 });
    const manual = buildPythonProfilerStartCode({ target: 'server', clock: 'WALL' });
    assert.match(timed, /threading\.Timer\(_mcdev_pp_duration/);
    assert.match(timed, /_mcdev_pp_duration=12\.5/);
    assert.match(manual, /_mcdev_pp_duration=None/);
    assert.match(manual, /_mcdev_pp_clock='WALL'/);
    assert.match(buildPythonProfilerCollectCode('client'), /clientScriptNameList/);
    assert.match(buildPythonProfilerCollectCode('server'), /serverScriptNameList/);
    const all = buildPythonProfilerCollectCode('all');
    assert.match(all, /clientScriptNameList/);
    assert.match(all, /serverScriptNameList/);
    assert.ok(timed.length < 2_000);
    assert.ok(buildPythonProfilerCollectCode('client').length < 4_500);
    assert.match(buildPythonProfilerCleanupCode(), /_mcdev_pp_owned/);
});

test('Python profiler refuses invalid durations and existing external profilers', () => {
    assert.throws(
        () => buildPythonProfilerStartCode({ target: 'client', clock: 'CPU', durationSeconds: 0 }),
        /greater than zero/
    );
    assert.throws(() => parsePythonProfilerStart({ ok: false, reason: 'busy' }), /already running/);
    assert.doesNotThrow(() => parsePythonProfilerStart({ ok: true }));
});

test('Python profiler parses compact bounded call graph data', () => {
    const result = parsePythonProfilerResult({
        ok: true,
        clock: 'WALL',
        elapsed: 3.25,
        total: 2,
        truncated: false,
        nodes: [
            [0, 'demo/main.py', 12, 'tick', 5, 5, 0.1, 0.8, 1, 'MainThread'],
            [1, 'demo/util.py', 8, 'work', 10, 10, 0.5, 0.6, 1, 'MainThread']
        ],
        edges: [[0, 1, 10, 0.5, 0.6], [0, 999, 1, 0, 0.1]]
    });
    assert.equal(result.clock, 'WALL');
    assert.equal(result.elapsedSeconds, 3.25);
    assert.equal(result.functions[0].name, 'tick');
    assert.deepEqual(result.calls, [{ callerId: 0, calleeId: 1, calls: 10, selfTime: 0.5, totalTime: 0.6 }]);
});

test('generated Python profiler scripts are syntactically valid', t => {
    const scripts = [
        buildPythonProfilerStartCode({ target: 'client', clock: 'CPU', durationSeconds: 1.5 }),
        buildPythonProfilerStartCode({ target: 'server', clock: 'WALL' }),
        buildPythonProfilerCollectCode('client'),
        buildPythonProfilerCollectCode('server'),
        buildPythonProfilerCollectCode('all'),
        buildPythonProfilerCleanupCode()
    ];
    for (const script of scripts) {
        const result = spawnSync('python', [
            '-c',
            "import sys; compile(sys.stdin.read(), '<mcdev-profiler>', 'exec')"
        ], { input: script, encoding: 'utf8' });
        if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
            t.skip('Python is unavailable');
            return;
        }
        assert.equal(result.status, 0, result.stderr);
    }
});
