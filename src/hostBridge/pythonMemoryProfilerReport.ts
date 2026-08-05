import { promises as fs } from 'fs';
import * as path from 'path';
import { ensureMcdevDirectory } from '../utils/mcdevDirectory';
import { PythonMemoryAllocation, PythonMemoryResult } from './pythonMemoryProfiler';

export interface PythonMemoryReportFiles {
    markdownPath: string;
    svgPath: string;
}

export interface PythonMemoryReportContext {
    projectRoot: string;
    worldName?: string;
    capturedAt: Date;
}

export async function writePythonMemoryReport(
    context: PythonMemoryReportContext,
    result: PythonMemoryResult
): Promise<PythonMemoryReportFiles> {
    const mcdevDirectory = await ensureMcdevDirectory(context.projectRoot);
    const reportDirectory = path.join(mcdevDirectory, 'profiles', 'python-memory');
    const baseName = formatFileTimestamp(context.capturedAt);
    const markdownPath = path.join(reportDirectory, `${baseName}.md`);
    const svgPath = path.join(reportDirectory, `${baseName}.svg`);
    await fs.mkdir(reportDirectory, { recursive: true });
    await Promise.all([
        fs.writeFile(markdownPath, renderMarkdown(context, result), 'utf8'),
        fs.writeFile(svgPath, renderSvg(context, result), 'utf8')
    ]);
    return { markdownPath, svgPath };
}

function renderMarkdown(context: PythonMemoryReportContext, result: PythonMemoryResult): string {
    const allocations = result.allocations.slice().sort((left, right) => (
        Math.abs(right.sizeDiff) - Math.abs(left.sizeDiff)
    ));
    const lines = [
        '# Python Memory Profile',
        '',
        `- Captured: ${context.capturedAt.toISOString()}`,
        `- Duration: ${formatDuration(result.elapsedSeconds)}`,
        `- World: ${context.worldName || 'unknown'}`,
        `- Traceback depth: ${result.tracebackDepth}`,
        `- Net retained growth: ${formatSignedBytes(result.netSizeDiff)}`,
        `- Current retained project memory: ${formatBytes(result.currentSize)}`,
        `- Live project blocks: ${result.currentCount}`,
        `- Net block change: ${formatSignedInteger(result.netCountDiff)}`,
        `- Project allocation sites: ${result.totalAllocations}`,
        `- Payload truncated: ${result.truncated ? 'yes' : 'no'}`,
        '',
        '## Allocation Sites',
        ''
    ];
    if (allocations.length === 0) {
        lines.push('No project allocation changes were captured.', '');
    } else {
        allocations.forEach((allocation, index) => {
            const site = allocation.traceback[0];
            lines.push(
                `### ${index + 1}. ${md(formatLocation(site.file, site.line))}`,
                '',
                `- Retained change: ${formatSignedBytes(allocation.sizeDiff)}`,
                `- Current retained: ${formatBytes(allocation.currentSize)}`,
                `- Block change: ${formatSignedInteger(allocation.countDiff)}`,
                `- Current blocks: ${allocation.currentCount}`,
                '',
                '```text',
                ...allocation.traceback.map(frame => `File "${frame.file}", line ${frame.line}`),
                '```',
                ''
            );
        });
    }
    lines.push(
        '## Interpretation Notes',
        '',
        '- This report covers Python allocations traced by `tracemalloc`; it is not process RSS or native memory.',
        '- Positive retained change means more traced bytes remained at collection time than at the baseline.',
        '- A traceback identifies where the retained block was allocated, not necessarily where it is still referenced.',
        '- Garbage collection before the final snapshot may remove unreachable cycles and reduce false positives.',
        ''
    );
    return lines.join('\n');
}

function renderSvg(context: PythonMemoryReportContext, result: PythonMemoryResult): string {
    const allocations = result.allocations.slice().sort((left, right) => (
        Math.abs(right.sizeDiff) - Math.abs(left.sizeDiff)
    )).slice(0, 60);
    const width = 1400;
    const labelWidth = 420;
    const chartLeft = 430;
    const chartWidth = 700;
    const zero = chartLeft + chartWidth / 2;
    const valueX = width - 24;
    const top = 132;
    const rowHeight = 28;
    const height = Math.max(250, top + allocations.length * rowHeight + 58);
    const maximum = Math.max(1, ...allocations.map(item => Math.abs(item.sizeDiff)));
    const rows = allocations.map((item, index) => renderAllocationRow(
        item, index, top, rowHeight, labelWidth, zero, chartWidth / 2, maximum, valueX
    )).join('\n');
    const empty = allocations.length === 0
        ? '<text x="20" y="170" class="empty">No project allocation changes were captured.</text>'
        : '';
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        '<style>',
        'text{font-family:Segoe UI,Arial,sans-serif;letter-spacing:0}.title{font-size:20px;font-weight:600;fill:#f2f2f2}.meta,.legend,.value{font-size:12px;fill:#b9bec8}.site{font-size:12px;fill:#e5e7eb}.empty{font-size:14px;fill:#b9bec8}g:hover rect{stroke:#fff;stroke-width:1}',
        '</style>',
        `<rect width="${width}" height="${height}" fill="#1e1f23"/>`,
        '<text x="20" y="34" class="title">Python Memory Profile</text>',
        `<text x="20" y="58" class="meta">${xml(`${formatDuration(result.elapsedSeconds)} | depth ${result.tracebackDepth} | ${context.capturedAt.toISOString()}`)}</text>`,
        `<text x="20" y="79" class="meta">${xml(`${context.worldName || path.basename(context.projectRoot)} | net ${formatSignedBytes(result.netSizeDiff)} | retained ${formatBytes(result.currentSize)}`)}</text>`,
        `<rect x="${chartLeft}" y="96" width="12" height="12" rx="2" fill="#b27adf"/><text x="${chartLeft + 18}" y="106" class="legend">Released</text>`,
        `<rect x="${zero + 18}" y="96" width="12" height="12" rx="2" fill="#4c8bd9"/><text x="${zero + 36}" y="106" class="legend">Growth</text>`,
        `<line x1="${zero}" y1="116" x2="${zero}" y2="${height - 30}" stroke="#6b7280" stroke-width="1"/>`,
        rows,
        empty,
        '</svg>',
        ''
    ].join('\n');
}

function renderAllocationRow(
    item: PythonMemoryAllocation,
    index: number,
    top: number,
    rowHeight: number,
    labelWidth: number,
    zero: number,
    halfChartWidth: number,
    maximum: number,
    valueX: number
): string {
    const y = top + index * rowHeight;
    const width = Math.max(item.sizeDiff === 0 ? 1 : 2, Math.abs(item.sizeDiff) / maximum * halfChartWidth);
    const x = item.sizeDiff >= 0 ? zero : zero - width;
    const color = item.sizeDiff >= 0 ? '#4c8bd9' : '#b27adf';
    const site = item.traceback[0];
    const label = formatLocation(site.file, site.line);
    const title = `${label}\nChange: ${formatSignedBytes(item.sizeDiff)} (${formatSignedInteger(item.countDiff)} blocks)\nRetained: ${formatBytes(item.currentSize)} (${item.currentCount} blocks)`;
    return [
        `<g><title>${xml(title)}</title>`,
        `<text x="20" y="${y + 18}" class="site">${xml(shorten(label, Math.floor(labelWidth / 7)))}</text>`,
        `<rect x="${x.toFixed(2)}" y="${y + 5}" width="${width.toFixed(2)}" height="18" rx="3" fill="${color}"/>`,
        `<text x="${valueX}" y="${y + 18}" text-anchor="end" class="value">${xml(formatSignedBytes(item.sizeDiff))}</text>`,
        '</g>'
    ].join('');
}

function formatFileTimestamp(value: Date): string {
    const iso = value.toISOString();
    return iso.slice(0, 10).replace(/-/g, '') + '-' + iso.slice(11, 23).replace(/[:.]/g, '');
}

function formatDuration(seconds: number): string {
    return seconds >= 1 ? `${seconds.toFixed(2)} s` : `${(seconds * 1000).toFixed(1)} ms`;
}

function formatBytes(value: number): string {
    const absolute = Math.abs(value);
    if (absolute >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
    if (absolute >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
    if (absolute >= 1024) return `${(value / 1024).toFixed(2)} KiB`;
    return `${value} B`;
}

function formatSignedBytes(value: number): string {
    return `${value > 0 ? '+' : ''}${formatBytes(value)}`;
}

function formatSignedInteger(value: number): string {
    return `${value > 0 ? '+' : ''}${value}`;
}

function formatLocation(file: string, line: number): string {
    return line > 0 ? `${file}:${line}` : file;
}

function shorten(value: string, maximum: number): string {
    return value.length <= maximum ? value : `${value.slice(0, Math.max(0, maximum - 3))}...`;
}

function md(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function xml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
