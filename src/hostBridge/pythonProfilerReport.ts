import { promises as fs } from 'fs';
import * as path from 'path';
import { ensureMcdevDirectory } from '../utils/mcdevDirectory';
import {
    PythonProfilerResult,
    PythonProfilerTarget
} from './pythonProfiler';

export interface PythonProfilerReportFiles {
    markdownPath: string;
    svgPath: string;
}

export interface PythonProfilerReportContext {
    projectRoot: string;
    target: PythonProfilerTarget;
    worldName?: string;
    capturedAt: Date;
}

export async function writePythonProfilerReport(
    context: PythonProfilerReportContext,
    result: PythonProfilerResult
): Promise<PythonProfilerReportFiles> {
    const mcdevDirectory = await ensureMcdevDirectory(context.projectRoot);
    const reportDirectory = path.join(mcdevDirectory, 'profiles', 'python');
    const stamp = formatFileTimestamp(context.capturedAt);
    const baseName = `${stamp}-${context.target}-${result.clock.toLowerCase()}`;
    const markdownPath = path.join(reportDirectory, `${baseName}.md`);
    const svgPath = path.join(reportDirectory, `${baseName}.svg`);
    await fs.mkdir(reportDirectory, { recursive: true });
    await Promise.all([
        fs.writeFile(markdownPath, renderMarkdown(context, result), 'utf8'),
        fs.writeFile(svgPath, renderSvg(context, result), 'utf8')
    ]);
    return { markdownPath, svgPath };
}

function renderMarkdown(
    context: PythonProfilerReportContext,
    result: PythonProfilerResult
): string {
    const functions = result.functions.slice().sort((left, right) => right.totalTime - left.totalTime);
    const byId = new Map(result.functions.map(item => [item.id, item]));
    const calls = result.calls.slice().sort((left, right) => right.totalTime - left.totalTime);
    const lines = [
        '# Python Performance Profile',
        '',
        `- Captured: ${context.capturedAt.toISOString()}`,
        `- Target: ${context.target}`,
        `- Clock: ${result.clock}`,
        `- Duration: ${formatSeconds(result.elapsedSeconds)}`,
        `- World: ${context.worldName || 'unknown'}`,
        `- Project functions: ${result.totalFunctions}`,
        `- Payload truncated: ${result.truncated ? 'yes' : 'no'}`,
        '',
        '## Hot Functions',
        '',
        '| # | Function | Location | Calls | Self | Total | Avg | Context |',
        '| -: | --- | --- | ---: | ---: | ---: | ---: | --- |'
    ];
    functions.forEach((item, index) => {
        const average = item.calls > 0 ? item.totalTime / item.calls : 0;
        lines.push(`| ${index + 1} | ${md(item.name)} | ${md(formatLocation(item.module, item.line))} | ${item.calls} | ${formatSeconds(item.selfTime)} | ${formatSeconds(item.totalTime)} | ${formatSeconds(average)} | ${md(item.contextName || String(item.contextId))} |`);
    });
    lines.push('', '## Call Relationships', '');
    if (calls.length === 0) {
        lines.push('No retained project-to-project call edges were captured.');
    } else {
        lines.push('| Caller | Callee | Calls | Self | Total |', '| --- | --- | ---: | ---: | ---: |');
        for (const call of calls) {
            const caller = byId.get(call.callerId);
            const callee = byId.get(call.calleeId);
            if (!caller || !callee) {
                continue;
            }
            lines.push(`| ${md(caller.name)} | ${md(callee.name)} | ${call.calls} | ${formatSeconds(call.selfTime)} | ${formatSeconds(call.totalTime)} |`);
        }
    }
    lines.push(
        '',
        '## Interpretation Notes',
        '',
        '- Self time excludes time spent in child Python functions.',
        '- Total time includes retained child calls and is best for locating expensive call paths.',
        '- CPU clock highlights computation; WALL clock also includes waiting and scheduling delays.',
        '- Profiler instrumentation adds overhead, so compare relative hotspots rather than treating values as production benchmarks.',
        ''
    );
    return lines.join('\n');
}

function renderSvg(
    context: PythonProfilerReportContext,
    result: PythonProfilerResult
): string {
    const functions = result.functions.slice().sort((left, right) => right.totalTime - left.totalTime).slice(0, 60);
    const width = 1400;
    const left = 420;
    const right = 92;
    const top = 112;
    const rowHeight = 26;
    const chartWidth = width - left - right;
    const height = Math.max(220, top + functions.length * rowHeight + 54);
    const maximum = Math.max(0.000001, ...functions.map(item => item.totalTime));
    const rows = functions.map((item, index) => {
        const y = top + index * rowHeight;
        const totalWidth = Math.max(1, item.totalTime / maximum * chartWidth);
        const selfWidth = Math.max(0, item.selfTime / maximum * chartWidth);
        const label = `${item.name} (${formatLocation(item.module, item.line)})`;
        const title = `${label}\nCalls: ${item.calls}\nSelf: ${formatSeconds(item.selfTime)}\nTotal: ${formatSeconds(item.totalTime)}`;
        return [
            `<g><title>${xml(title)}</title>`,
            `<text x="20" y="${y + 17}" class="fn">${xml(shorten(label, 58))}</text>`,
            `<rect x="${left}" y="${y + 4}" width="${totalWidth.toFixed(2)}" height="18" rx="3" fill="#4c8bd9"/>`,
            selfWidth > 0 ? `<rect x="${left}" y="${y + 4}" width="${selfWidth.toFixed(2)}" height="18" rx="3" fill="#b27adf"/>` : '',
            `<text x="${width - 18}" y="${y + 17}" text-anchor="end" class="time">${xml(formatSeconds(item.totalTime))}</text>`,
            '</g>'
        ].join('');
    }).join('\n');
    const empty = functions.length === 0
        ? '<text x="20" y="150" class="empty">No project Python functions were captured.</text>'
        : '';
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        '<style>',
        'text{font-family:Segoe UI,Arial,sans-serif;letter-spacing:0}.title{font-size:20px;font-weight:600;fill:#f2f2f2}.meta,.legend,.time{font-size:12px;fill:#b9bec8}.fn{font-size:12px;fill:#e5e7eb}.empty{font-size:14px;fill:#b9bec8}g:hover rect{stroke:#fff;stroke-width:1}',
        '</style>',
        `<rect width="${width}" height="${height}" fill="#1e1f23"/>`,
        '<text x="20" y="34" class="title">Python Performance Profile</text>',
        `<text x="20" y="58" class="meta">${xml(`${context.target.toUpperCase()} | ${result.clock} | ${formatSeconds(result.elapsedSeconds)} | ${context.capturedAt.toISOString()}`)}</text>`,
        `<text x="20" y="78" class="meta">${xml(context.worldName || path.basename(context.projectRoot))}</text>`,
        `<rect x="${left}" y="80" width="12" height="12" rx="2" fill="#4c8bd9"/><text x="${left + 18}" y="90" class="legend">Total</text>`,
        `<rect x="${left + 72}" y="80" width="12" height="12" rx="2" fill="#b27adf"/><text x="${left + 90}" y="90" class="legend">Self</text>`,
        rows,
        empty,
        '</svg>',
        ''
    ].join('\n');
}

function formatFileTimestamp(value: Date): string {
    const iso = value.toISOString();
    return iso.slice(0, 10).replace(/-/g, '') + '-' + iso.slice(11, 23).replace(/[:.]/g, '');
}

function formatSeconds(value: number): string {
    if (value >= 1) {
        return `${value.toFixed(3)} s`;
    }
    return `${(value * 1000).toFixed(3)} ms`;
}

function formatLocation(module: string, line: number): string {
    return line > 0 ? `${module}:${line}` : module;
}

function shorten(value: string, maximum: number): string {
    return value.length <= maximum ? value : `${value.slice(0, maximum - 3)}...`;
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
