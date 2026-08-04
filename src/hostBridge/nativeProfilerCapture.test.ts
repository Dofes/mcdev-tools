import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNativeProfilerResult } from './nativeProfilerCapture';

test('Native profiler removes DEBUG_ENV_SCRIPT frames and promotes visible descendants', () => {
    const zone = (id: number, name: string, sourceFile: string, children: unknown[] = []) => ({
        id,
        name,
        sourceFile,
        sourceLine: 12,
        calls: 2,
        totalNanoseconds: 100,
        selfNanoseconds: 40,
        meanNanoseconds: 50,
        maximumNanoseconds: 60,
        children
    });
    const result = parseNativeProfilerResult(JSON.stringify({
        capturedSeconds: 5,
        totalZones: 3,
        truncated: false,
        callTreeTruncated: false,
        zones: [
            zone(0, '_recvAll', 'DEBUG_ENV_SCRIPT.IPCSystem'),
            zone(1, 'tick', 'demo/main.cpp')
        ],
        threads: [
            {
                id: '1',
                name: 'Main',
                calls: 4,
                totalNanoseconds: 200,
                roots: [zone(2, '_recvAll', 'DEBUG_ENV_SCRIPT/IPCSystem.py', [
                    zone(3, 'tick', 'demo/main.cpp')
                ])]
            },
            {
                id: '2',
                name: 'IPC',
                calls: 2,
                totalNanoseconds: 100,
                roots: [zone(4, '_recvAll', 'DEBUG_ENV_SCRIPT\\IPCSystem.py')]
            }
        ]
    }));

    assert.deepEqual(result.zones.map(item => item.name), ['tick']);
    assert.equal(result.threads.length, 1);
    assert.equal(result.threads[0].name, 'Main');
    assert.deepEqual(result.threads[0].roots.map(item => item.name), ['tick']);
    assert.equal(result.threads[0].totalNanoseconds, 100);
    assert.equal(result.threads[0].calls, 2);
});
