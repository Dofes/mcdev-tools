import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseNetstatTracyListeners } from './nativeProfilerPortDiscovery';

test('maps Tracy listeners by owning PID and deduplicates IPv4 and IPv6', () => {
    const output = [
        '  TCP    0.0.0.0:8086           0.0.0.0:0              LISTENING       2012',
        '  TCP    [::]:8086              [::]:0                 LISTENING       2012',
        '  TCP    127.0.0.1:8087         0.0.0.0:0              LISTENING       3000',
        '  TCP    127.0.0.1:8088         127.0.0.1:50000        ESTABLISHED     4000',
        '  TCP    0.0.0.0:8106           0.0.0.0:0              LISTENING       5000'
    ].join('\r\n');
    assert.deepEqual(parseNetstatTracyListeners(output), [
        { pid: 2012, port: 8086 },
        { pid: 3000, port: 8087 }
    ]);
});

test('accepts localized Windows listening state', () => {
    const output = '  TCP    0.0.0.0:8105           0.0.0.0:0              侦听       42';
    assert.deepEqual(parseNetstatTracyListeners(output), [{ pid: 42, port: 8105 }]);
});
