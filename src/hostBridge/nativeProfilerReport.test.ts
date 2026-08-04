import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import test from 'node:test';
import { writeNativeProfilerReport } from './nativeProfilerReport';

test('Native profiler writes the trace, Markdown, and SVG visualization under .mcdev', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcdev-native-profile-'));
    const sourceTracePath = path.join(root, 'capture.tracy');
    await fs.writeFile(sourceTracePath, 'trace-data');

    const files = await writeNativeProfilerReport({
        projectRoot: root,
        sourceTracePath,
        capturedAt: new Date('2026-08-05T12:34:56.789Z'),
        worldName: 'Test & World',
        pid: 1234,
        port: 8086,
        result: {
            capturedSeconds: 2.5,
            totalZones: 2,
            truncated: false,
            callTreeTruncated: false,
            zones: [
                {
                    id: 1,
                    name: 'Parent <tick>',
                    sourceFile: 'engine/main.cpp',
                    sourceLine: 10,
                    calls: 2,
                    totalNanoseconds: 800_000,
                    selfNanoseconds: 300_000,
                    meanNanoseconds: 400_000,
                    maximumNanoseconds: 500_000
                },
                {
                    id: 2,
                    name: 'Child & work',
                    sourceFile: 'engine/work.cpp',
                    sourceLine: 20,
                    calls: 4,
                    totalNanoseconds: 500_000,
                    selfNanoseconds: 500_000,
                    meanNanoseconds: 125_000,
                    maximumNanoseconds: 200_000
                }
            ],
            threads: [{
                id: '7',
                name: 'Main Thread',
                calls: 2,
                totalNanoseconds: 800_000,
                roots: [{
                    id: 1,
                    name: 'Parent <tick>',
                    sourceFile: 'engine/main.cpp',
                    sourceLine: 10,
                    calls: 2,
                    totalNanoseconds: 800_000,
                    selfNanoseconds: 300_000,
                    meanNanoseconds: 400_000,
                    maximumNanoseconds: 500_000,
                    children: [{
                        id: 2,
                        name: 'Child & work',
                        sourceFile: 'engine/work.cpp',
                        sourceLine: 20,
                        calls: 4,
                        totalNanoseconds: 500_000,
                        selfNanoseconds: 500_000,
                        meanNanoseconds: 125_000,
                        maximumNanoseconds: 200_000,
                        children: []
                    }]
                }]
            }]
        }
    });

    assert.match(files.tracePath, /\.mcdev[\\/]profiles[\\/]native/);
    const [trace, markdown, svg] = await Promise.all([
        fs.readFile(files.tracePath, 'utf8'),
        fs.readFile(files.markdownPath, 'utf8'),
        fs.readFile(files.svgPath, 'utf8')
    ]);
    assert.equal(trace, 'trace-data');
    assert.match(markdown, /## Call Hierarchy/);
    assert.match(markdown, /Parent <tick>/);
    assert.match(markdown, /Child & work/);
    assert.match(svg, /Native Performance Profile/);
    assert.match(svg, /Parent &lt;tick&gt;/);
    assert.match(svg, /Child &amp; work/);
    assert.doesNotMatch(svg, /Test & World/);
});
