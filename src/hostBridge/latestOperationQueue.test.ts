import assert from 'node:assert/strict';
import test from 'node:test';
import { LatestOperationQueue } from './latestOperationQueue';

test('latest operation queue coalesces waiting selections', async () => {
    const queue = new LatestOperationQueue();
    const order: string[] = [];
    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { markStarted = resolve; });

    const first = queue.runLatest('session', async () => {
        order.push('A:start');
        markStarted();
        await gate;
        order.push('A:end');
    });
    await started;
    const second = queue.runLatest('session', async () => { order.push('B'); });
    const third = queue.runLatest('session', async () => { order.push('C'); });
    release();

    await Promise.all([first, second, third]);
    assert.deepEqual(order, ['A:start', 'A:end', 'C']);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual([...queue.keys()], []);
});

test('latest operation queue keeps post-invalidation work behind the barrier', async () => {
    const queue = new LatestOperationQueue();
    const order: string[] = [];
    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { markStarted = resolve; });

    const first = queue.runLatest('session', async () => {
        order.push('select:start');
        markStarted();
        await gate;
        order.push('select:end');
    });
    await started;
    queue.invalidateLatest('session');
    const mode = queue.run('session', async () => { order.push('mode'); });
    const next = queue.runLatest('session', async () => { order.push('next'); });
    release();

    await Promise.all([first, mode, next]);
    assert.deepEqual(order, ['select:start', 'select:end', 'mode', 'next']);
});
