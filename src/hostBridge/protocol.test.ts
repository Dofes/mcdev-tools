import * as assert from 'node:assert/strict';
import { once } from 'node:events';
import * as net from 'node:net';
import test from 'node:test';
import {
    HostBridgeFrameDecoder,
    JsonObject,
    encodeHostBridgeFrame
} from './protocol';
import { HostBridgeServer } from './server';

test('frame decoder handles fragmented and coalesced messages', () => {
    const first = { jsonrpc: '2.0', id: 'mcdk:1', result: { value: '你好' } };
    const second = { jsonrpc: '2.0', method: 'mcdk/cancel', params: { id: 'host:1' } };
    const firstFrame = encodeHostBridgeFrame(first);
    const secondFrame = encodeHostBridgeFrame(second);
    const decoder = new HostBridgeFrameDecoder();

    assert.deepEqual(decoder.push(firstFrame.subarray(0, 2)), []);
    assert.deepEqual(decoder.push(firstFrame.subarray(2, 7)), []);
    assert.deepEqual(
        decoder.push(Buffer.concat([firstFrame.subarray(7), secondFrame])),
        [first, second]
    );

    const invalidLength = Buffer.alloc(4);
    assert.throws(() => new HostBridgeFrameDecoder().push(invalidLength), /frame length/i);
});

test('server authenticates and manages concurrent MCDK sessions', async t => {
    const server = new HostBridgeServer({
        name: 'mcdev-tools-test',
        version: '1.0.0',
        instanceId: 'test-window'
    });
    t.after(async () => server.dispose());
    const port = await server.start(0);
    const firstLaunch = server.registerLaunch('D:/workspace/one');
    const secondLaunch = server.registerLaunch('D:/workspace/two');

    const first = await connectMcdk(
        port,
        firstLaunch.environment.MCDEV_HOST_TOKEN,
        '11111111-1111-4111-8111-111111111111',
        101,
        201
    );
    t.after(() => first.socket.destroy());
    const second = await connectMcdk(
        port,
        secondLaunch.environment.MCDEV_HOST_TOKEN,
        '22222222-2222-4222-8222-222222222222',
        102,
        202
    );
    t.after(() => second.socket.destroy());

    await waitFor(() => server.getSnapshot().sessions.filter(session => session.connected).length === 2);
    assert.deepEqual(
        server.getSnapshot().sessions.filter(session => session.connected).map(session => session.id).sort(),
        ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
    );

    first.socket.write(encodeHostBridgeFrame({
        jsonrpc: '2.0',
        method: 'mcdk/session/stateChanged',
        params: {
            sessionId: '11111111-1111-4111-8111-111111111111',
            sequence: 2,
            state: 'game_ready',
            timestamp: new Date().toISOString(),
            gameIpcConnected: true,
            reason: null,
            minecraftExitCode: null
        }
    }));
    await waitFor(() => server.getSnapshot().sessions.find(session => session.id === '11111111-1111-4111-8111-111111111111')?.state === 'game_ready');

    const firstRequest = server.request('11111111-1111-4111-8111-111111111111', 'game/code/execute', { code: '1 + 1', isClient: true });
    const secondRequest = server.request('11111111-1111-4111-8111-111111111111', 'game/code/execute', { code: '2 + 2', isClient: false });
    const firstMessage = await first.reader.next();
    const secondMessage = await first.reader.next();
    assert.equal(firstMessage.method, 'game/code/execute');
    assert.equal(secondMessage.method, 'game/code/execute');

    first.socket.write(encodeHostBridgeFrame({ jsonrpc: '2.0', id: secondMessage.id, result: 4 }));
    first.socket.write(encodeHostBridgeFrame({ jsonrpc: '2.0', id: firstMessage.id, result: 2 }));
    assert.deepEqual(await Promise.all([firstRequest, secondRequest]), [2, 4]);

    const firstSummary = server.getSnapshot().sessions.find(session => session.id === '11111111-1111-4111-8111-111111111111');
    assert.equal(firstSummary?.methods?.some(method => method.name === 'game/code/execute'), true);
});

test('server rejects an unknown authentication token', async t => {
    const server = new HostBridgeServer({
        name: 'mcdev-tools-test',
        version: '1.0.0',
        instanceId: 'test-window'
    });
    t.after(async () => server.dispose());
    const port = await server.start(0);
    server.registerLaunch('D:/workspace/expected');

    const socket = net.createConnection({ host: '127.0.0.1', port });
    const reader = new FrameReader(socket);
    t.after(() => socket.destroy());
    await once(socket, 'connect');
    socket.write(encodeHostBridgeFrame(createInitializeRequest(
        '0'.repeat(64),
        '33333333-3333-4333-8333-333333333333',
        300,
        400
    )));

    const response = await reader.next();
    assert.equal((response.error as JsonObject).code, -32001);
    assert.equal(((response.error as JsonObject).data as JsonObject).code, 'AUTH_FAILED');
});

test('listeners use OS-assigned ports instead of a fixed port', async t => {
    const first = new HostBridgeServer({ name: 'test', version: '1', instanceId: 'one' });
    const second = new HostBridgeServer({ name: 'test', version: '1', instanceId: 'two' });
    t.after(async () => Promise.all([first.dispose(), second.dispose()]));

    const firstPort = await first.start(0);
    const secondPort = await second.start(0);
    assert.ok(firstPort > 0 && firstPort <= 65_535);
    assert.ok(secondPort > 0 && secondPort <= 65_535);
    assert.notEqual(firstPort, secondPort);
});

class FrameReader {
    private readonly decoder = new HostBridgeFrameDecoder();
    private readonly queued: JsonObject[] = [];
    private readonly waiters: Array<(message: JsonObject) => void> = [];

    constructor(socket: net.Socket) {
        socket.on('data', chunk => {
            for (const message of this.decoder.push(chunk)) {
                const waiter = this.waiters.shift();
                if (waiter) {
                    waiter(message);
                } else {
                    this.queued.push(message);
                }
            }
        });
    }

    public async next(timeoutMs = 2_000): Promise<JsonObject> {
        const queued = this.queued.shift();
        if (queued) {
            return queued;
        }
        return new Promise<JsonObject>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Timed out waiting for Host Bridge frame')), timeoutMs);
            this.waiters.push(message => {
                clearTimeout(timer);
                resolve(message);
            });
        });
    }
}

async function connectMcdk(
    port: number,
    token: string,
    sessionId: string,
    mcdkPid: number,
    minecraftPid: number
): Promise<{ socket: net.Socket; reader: FrameReader }> {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const reader = new FrameReader(socket);
    await once(socket, 'connect');
    const initialize = createInitializeRequest(token, sessionId, mcdkPid, minecraftPid);
    const frame = encodeHostBridgeFrame(initialize);
    socket.write(frame.subarray(0, 3));
    socket.write(frame.subarray(3, 11));
    socket.write(frame.subarray(11));

    const response = await reader.next();
    assert.equal(response.id, initialize.id);
    assert.equal((response.result as JsonObject).protocolVersion, 1);

    const discovery = await reader.next();
    assert.equal(discovery.method, 'mcdk/methods/list');
    socket.write(encodeHostBridgeFrame({
        jsonrpc: '2.0',
        id: discovery.id,
        result: {
            methods: [{
                name: 'game/code/execute',
                modes: ['request', 'notification'],
                gameAvailability: 'in_world',
                paramsSchema: { type: 'object' },
                resultSchema: null
            }]
        }
    }));
    return { socket, reader };
}

function createInitializeRequest(
    token: string,
    sessionId: string,
    mcdkPid: number,
    minecraftPid: number
): JsonObject {
    return {
        jsonrpc: '2.0',
        id: `mcdk:init:${sessionId}`,
        method: 'mcdk/initialize',
        params: {
            protocol: { minVersion: 1, maxVersion: 1 },
            authToken: token,
            session: {
                id: sessionId,
                connectionGeneration: 1,
                startedAt: new Date().toISOString(),
                state: 'process_started',
                stateSequence: 1
            },
            mcdk: { pid: mcdkPid, version: '1.0.0' },
            minecraft: { pid: minecraftPid },
            gameIpc: { host: '127.0.0.1', port: 49_152, connected: false },
            project: { root: `D:/workspace/${sessionId}` },
            world: {
                name: sessionId,
                folderName: sessionId,
                runtimePath: `D:/runtime/${sessionId}`,
                sourcePath: null
            },
            capabilities: {
                methodDiscovery: true,
                notifications: true,
                cancellation: true,
                debugCapabilityEnabled: true
            },
            limits: {
                maxFrameBytes: 16 * 1024 * 1024,
                maxInFlightRequests: 64
            }
        }
    };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for condition');
}
