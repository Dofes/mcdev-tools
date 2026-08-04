import { promises as fs } from 'fs';
import * as path from 'path';
import { ensureMcdevDirectory } from '../utils/mcdevDirectory';
import { NativeProfilerResult } from './nativeProfilerTypes';

export interface NativeProfilerReportFiles {
    tracePath: string;
    markdownPath: string;
}

export async function writeNativeProfilerReport(options: {
    projectRoot: string;
    sourceTracePath: string;
    capturedAt: Date;
    worldName?: string;
    pid: number;
    port: number;
    result: NativeProfilerResult;
}): Promise<NativeProfilerReportFiles> {
    const mcdev = await ensureMcdevDirectory(options.projectRoot);
    const directory = path.join(mcdev, 'profiles', 'native');
    const baseName = `${fileStamp(options.capturedAt)}-pid-${options.pid}`;
    const tracePath = path.join(directory, `${baseName}.tracy`);
    const markdownPath = path.join(directory, `${baseName}.md`);
    await fs.mkdir(directory, { recursive: true });
    await fs.copyFile(options.sourceTracePath, tracePath);
    await fs.writeFile(markdownPath, renderMarkdown(options), 'utf8');
    return { tracePath, markdownPath };
}

function renderMarkdown(options: {
    capturedAt: Date;
    worldName?: string;
    pid: number;
    port: number;
    result: NativeProfilerResult;
}): string {
    const lines = [
        '# Native Performance Profile',
        '',
        `- Captured: ${options.capturedAt.toISOString()}`,
        `- World: ${options.worldName || 'unknown'}`,
        `- Process: ${options.pid}`,
        `- Tracy endpoint: 127.0.0.1:${options.port}`,
        `- Capture duration: ${options.result.capturedSeconds.toFixed(3)} s`,
        `- Tracy zones: ${options.result.totalZones}`,
        '',
        '## Hot Zones',
        '',
        '| # | Zone | Source | Calls | Self | Total | Mean | Max |',
        '| -: | --- | --- | ---: | ---: | ---: | ---: | ---: |'
    ];
    options.result.zones.forEach((zone, index) => lines.push(
        `| ${index + 1} | ${md(zone.name)} | ${md(location(zone.sourceFile, zone.sourceLine))} | ${zone.calls} | ${time(zone.selfNanoseconds)} | ${time(zone.totalNanoseconds)} | ${time(zone.meanNanoseconds)} | ${time(zone.maximumNanoseconds)} |`
    ));
    lines.push(
        '',
        '## Notes',
        '',
        '- Inclusive time contains child zones; self time excludes them.',
        '- The table is intentionally bounded. The `.tracy` capture remains the source of truth.',
        ''
    );
    return lines.join('\n');
}

function fileStamp(value: Date): string {
    const iso = value.toISOString();
    return iso.slice(0, 10).replace(/-/g, '') + '-' + iso.slice(11, 23).replace(/[:.]/g, '');
}

function location(file: string, line: number): string {
    return line > 0 ? `${file}:${line}` : file;
}

function time(nanoseconds: number): string {
    if (nanoseconds >= 1_000_000_000) return `${(nanoseconds / 1_000_000_000).toFixed(3)} s`;
    if (nanoseconds >= 1_000_000) return `${(nanoseconds / 1_000_000).toFixed(3)} ms`;
    if (nanoseconds >= 1_000) return `${(nanoseconds / 1_000).toFixed(3)} us`;
    return `${Math.round(nanoseconds)} ns`;
}

function md(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
