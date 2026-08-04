import { promises as fs } from 'fs';
import * as path from 'path';
import { ensureMcdevDirectory } from '../utils/mcdevDirectory';
import { NativeProfilerCallNode, NativeProfilerResult } from './nativeProfilerTypes';

export interface NativeProfilerReportFiles {
    tracePath: string;
    markdownPath: string;
    svgPath: string;
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
    const svgPath = path.join(directory, `${baseName}.svg`);
    await fs.mkdir(directory, { recursive: true });
    await Promise.all([
        fs.copyFile(options.sourceTracePath, tracePath),
        fs.writeFile(markdownPath, renderMarkdown(options), 'utf8'),
        fs.writeFile(svgPath, renderSvg(options), 'utf8')
    ]);
    return { tracePath, markdownPath, svgPath };
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
        '| # | Zone | Thread | Source | Calls | Self | Total | Mean | Max |',
        '| -: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |'
    ];
    options.result.zones.forEach((zone, index) => lines.push(
        `| ${index + 1} | ${md(zone.name)} | ${md(threadLabel(zone.threadId, zone.threadName))} | ${md(location(zone.sourceFile, zone.sourceLine))} | ${zone.calls} | ${time(zone.selfNanoseconds)} | ${time(zone.totalNanoseconds)} | ${time(zone.meanNanoseconds)} | ${time(zone.maximumNanoseconds)} |`
    ));
    lines.push('', '## Call Hierarchy', '');
    for (const thread of options.result.threads) {
        lines.push(
            `### ${md(thread.name || `Thread ${thread.id}`)}`,
            '',
            `- Thread ID: ${thread.id}`,
            `- Calls: ${thread.calls}`,
            `- Total: ${time(thread.totalNanoseconds)}`,
            ''
        );
        for (const root of thread.roots) appendCallNode(lines, root, 0);
        lines.push('');
    }
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

function appendCallNode(lines: string[], node: NativeProfilerCallNode, depth: number): void {
    const indent = '  '.repeat(depth);
    lines.push(
        `${indent}- ${md(node.name)} | calls ${node.calls} | self ${time(node.selfNanoseconds)} | total ${time(node.totalNanoseconds)} | ${md(location(node.sourceFile, node.sourceLine))}`
    );
    for (const child of node.children) appendCallNode(lines, child, depth + 1);
}

function renderSvg(options: {
    capturedAt: Date;
    worldName?: string;
    pid: number;
    port: number;
    result: NativeProfilerResult;
}): string {
    const width = 1500;
    const chartLeft = 280;
    const chartWidth = width - chartLeft - 28;
    const rowHeight = 22;
    const maximumDepth = 10;
    const threads = options.result.threads
        .filter(thread => thread.roots.length > 0)
        .slice()
        .sort((left, right) => right.totalNanoseconds - left.totalNanoseconds)
        .slice(0, 12);
    const zones = options.result.zones
        .slice()
        .sort((left, right) => right.totalNanoseconds - left.totalNanoseconds)
        .slice(0, 24);
    const content: string[] = [];
    let cursor = 112;

    content.push('<text x="20" y="96" class="section">Call hierarchy</text>');
    if (threads.length === 0) {
        content.push('<text x="20" y="128" class="muted">No native call hierarchy was captured.</text>');
        cursor = 142;
    } else {
        for (const thread of threads) {
            const depth = Math.max(1, Math.min(maximumDepth, callTreeDepth(thread.roots)));
            const total = Math.max(1, thread.roots.reduce((sum, node) => sum + node.totalNanoseconds, 0));
            content.push(
                `<text x="20" y="${cursor + 16}" class="thread">${xml(shorten(thread.name || `Thread ${thread.id}`, 34))}</text>`,
                `<text x="${chartLeft - 12}" y="${cursor + 16}" text-anchor="end" class="meta">${xml(time(thread.totalNanoseconds))}</text>`
            );
            appendSvgCallNodes(
                content,
                thread.roots,
                chartLeft,
                chartWidth,
                cursor,
                0,
                maximumDepth,
                total
            );
            cursor += depth * rowHeight + 12;
        }
    }

    const hotTop = cursor + 34;
    content.push(`<text x="20" y="${hotTop}" class="section">Hot zones</text>`);
    const barLeft = 430;
    const barWidth = width - barLeft - 92;
    const maximumZone = Math.max(1, ...zones.map(zone => zone.totalNanoseconds));
    zones.forEach((zone, index) => {
        const y = hotTop + 18 + index * 25;
        const totalWidth = Math.max(1, zone.totalNanoseconds / maximumZone * barWidth);
        const selfWidth = Math.max(0, zone.selfNanoseconds / maximumZone * barWidth);
        const thread = threadLabel(zone.threadId, zone.threadName);
        const label = `[${thread}] ${zone.name} (${location(zone.sourceFile, zone.sourceLine)})`;
        content.push(
            `<g><title>${xml(`${label}\nThread: ${thread}\nCalls: ${zone.calls}\nSelf: ${time(zone.selfNanoseconds)}\nTotal: ${time(zone.totalNanoseconds)}`)}</title>`,
            `<text x="20" y="${y + 16}" class="zone">${xml(shorten(label, 58))}</text>`,
            `<rect x="${barLeft}" y="${y + 3}" width="${totalWidth.toFixed(2)}" height="17" rx="2" fill="#4c8bd9"/>`,
            selfWidth > 0
                ? `<rect x="${barLeft}" y="${y + 3}" width="${selfWidth.toFixed(2)}" height="17" rx="2" fill="#b16fd1"/>`
                : '',
            `<text x="${width - 20}" y="${y + 16}" text-anchor="end" class="meta">${xml(time(zone.totalNanoseconds))}</text></g>`
        );
    });
    if (zones.length === 0) {
        content.push(`<text x="20" y="${hotTop + 34}" class="muted">No native zones were captured.</text>`);
    }
    const height = Math.max(280, hotTop + Math.max(1, zones.length) * 25 + 64);
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        '<style>',
        'text{font-family:Segoe UI,Arial,sans-serif;letter-spacing:0}.title{font-size:20px;font-weight:600;fill:#f3f4f6}.section{font-size:13px;font-weight:600;fill:#e5e7eb}.thread{font-size:11px;font-weight:600;fill:#d7dae0}.zone{font-size:11px;fill:#e5e7eb}.meta,.muted{font-size:10px;fill:#aeb4bf}.call{font-size:9px;fill:#f8fafc;pointer-events:none}g:hover>rect{stroke:#fff;stroke-width:1}',
        '</style>',
        `<rect width="${width}" height="${height}" fill="#1e1f23"/>`,
        '<text x="20" y="32" class="title">Native Performance Profile</text>',
        `<text x="20" y="55" class="meta">${xml(`${options.worldName || 'unknown'} | PID ${options.pid} | 127.0.0.1:${options.port}`)}</text>`,
        `<text x="20" y="73" class="meta">${xml(`${options.result.capturedSeconds.toFixed(3)} s | ${options.capturedAt.toISOString()} | ${options.result.totalZones} zones`)}</text>`,
        ...content,
        '</svg>',
        ''
    ].join('\n');
}

function appendSvgCallNodes(
    output: string[],
    nodes: NativeProfilerCallNode[],
    startX: number,
    availableWidth: number,
    y: number,
    depth: number,
    maximumDepth: number,
    denominator: number
): void {
    if (depth >= maximumDepth || availableWidth <= 0) return;
    const palette = ['#356fb5', '#7b5bb6', '#278c8c', '#b27635', '#a64f71', '#4f7f4b'];
    let x = startX;
    for (const node of nodes) {
        const nodeWidth = Math.max(0, node.totalNanoseconds) / Math.max(1, denominator) * availableWidth;
        if (nodeWidth < 0.35) {
            x += nodeWidth;
            continue;
        }
        const labelLength = Math.max(0, Math.floor(nodeWidth / 6.5) - 1);
        const label = labelLength >= 6 ? shorten(node.name, labelLength) : '';
        const selfWidth = node.totalNanoseconds > 0
            ? Math.min(nodeWidth, node.selfNanoseconds / node.totalNanoseconds * nodeWidth)
            : 0;
        output.push(
            `<g><title>${xml(`${node.name}\n${location(node.sourceFile, node.sourceLine)}\nCalls: ${node.calls}\nSelf: ${time(node.selfNanoseconds)}\nTotal: ${time(node.totalNanoseconds)}`)}</title>`,
            `<rect x="${x.toFixed(2)}" y="${y}" width="${nodeWidth.toFixed(2)}" height="20" rx="2" fill="${palette[depth % palette.length]}"/>`,
            selfWidth > 0.5
                ? `<rect x="${x.toFixed(2)}" y="${y + 17}" width="${selfWidth.toFixed(2)}" height="3" fill="#e6b85c" opacity="0.9"/>`
                : '',
            label ? `<text x="${(x + 4).toFixed(2)}" y="${y + 14}" class="call">${xml(label)}</text>` : '',
            '</g>'
        );
        if (node.children.length > 0) {
            appendSvgCallNodes(
                output,
                node.children,
                x,
                nodeWidth,
                y + 22,
                depth + 1,
                maximumDepth,
                Math.max(node.totalNanoseconds, node.children.reduce((sum, child) => sum + child.totalNanoseconds, 0))
            );
        }
        x += nodeWidth;
    }
}

function callTreeDepth(nodes: NativeProfilerCallNode[], depth = 0): number {
    let maximum = depth;
    for (const node of nodes) {
        maximum = Math.max(maximum, callTreeDepth(node.children, depth + 1));
    }
    return maximum;
}

function fileStamp(value: Date): string {
    const iso = value.toISOString();
    return iso.slice(0, 10).replace(/-/g, '') + '-' + iso.slice(11, 23).replace(/[:.]/g, '');
}

function location(file: string, line: number): string {
    return line > 0 ? `${file}:${line}` : file;
}

function threadLabel(id: string, name: string): string {
    return name || `Thread ${id}`;
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

function shorten(value: string, maximum: number): string {
    return value.length <= maximum ? value : `${value.slice(0, Math.max(1, maximum - 3))}...`;
}

function xml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
