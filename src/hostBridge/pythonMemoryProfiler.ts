export interface PythonMemoryStartOptions {
    tracebackDepth: number;
}

export interface PythonMemoryFrame {
    file: string;
    line: number;
}

export interface PythonMemoryAllocation {
    id: number;
    sizeDiff: number;
    countDiff: number;
    currentSize: number;
    currentCount: number;
    traceback: PythonMemoryFrame[];
}

export interface PythonMemoryResult {
    elapsedSeconds: number;
    tracebackDepth: number;
    netSizeDiff: number;
    netCountDiff: number;
    currentSize: number;
    currentCount: number;
    totalAllocations: number;
    truncated: boolean;
    allocations: PythonMemoryAllocation[];
}

export const PYTHON_MEMORY_DEFAULT_DEPTH = 8;
export const PYTHON_MEMORY_MAX_DEPTH = 16;
const MAX_ALLOCATIONS = 80;

export function buildPythonMemoryStartCode(options: PythonMemoryStartOptions): string {
    const depth = validateDepth(options.tracebackDepth);
    return [
        'import tracemalloc,time',
        "if tracemalloc.is_tracing() and not globals().get('_mcdev_pm_owned',False):",
        " _result={'ok':False,'reason':'busy'}",
        'else:',
        " if globals().get('_mcdev_pm_owned',False) and tracemalloc.is_tracing(): tracemalloc.stop()",
        ` tracemalloc.start(${depth})`,
        " globals()['_mcdev_pm_owned']=True",
        ` globals()['_mcdev_pm_depth']=${depth}`,
        " globals()['_mcdev_pm_started']=time.time()",
        " globals()['_mcdev_pm_base']=tracemalloc.take_snapshot()",
        ` _result={'ok':True,'depth':${depth}}`
    ].join('\n');
}

export function buildPythonMemoryCollectCode(collectGarbage: boolean): string {
    return [
        'import tracemalloc,time,gc',
        "if not globals().get('_mcdev_pm_owned',False) or not tracemalloc.is_tracing():",
        " _result={'ok':False,'reason':'not_owned'}",
        'else:',
        collectGarbage ? ' gc.collect()' : ' pass',
        " _mcdev_pm_base=globals().get('_mcdev_pm_base')",
        ' _mcdev_pm_now=tracemalloc.take_snapshot()',
        " _mcdev_pm_stats=_mcdev_pm_now.compare_to(_mcdev_pm_base,'traceback')",
        ' try:',
        '  import common.minecraftMod as _mcdev_pm_mod',
        '  _mcdev_pm_instance=_mcdev_pm_mod.instance()',
        "  _mcdev_pm_scripts=set(_mcdev_pm_name for _mcdev_pm_name in ((getattr(_mcdev_pm_instance,'clientScriptNameList',[]) or [])+(getattr(_mcdev_pm_instance,'serverScriptNameList',[]) or [])) if _mcdev_pm_name)",
        ' except: _mcdev_pm_scripts=[]',
        ' _mcdev_pm_all=[]',
        ' for _mcdev_pm_stat in _mcdev_pm_stats:',
        '  _mcdev_pm_project=False',
        "  _mcdev_pm_origin=(_mcdev_pm_stat.traceback[0].filename or '').replace('\\\\','/').lower()",
        "  if 'qumodlibs' in set(_mcdev_pm_origin.split('/')): continue",
        '  for _mcdev_pm_frame in _mcdev_pm_stat.traceback:',
        "   _mcdev_pm_file=_mcdev_pm_frame.filename or ''",
        "   _mcdev_pm_norm=_mcdev_pm_file.replace('\\\\','/').lower()",
        "   _mcdev_pm_parts=set(_mcdev_pm_norm.split('/'))",
        "   if any(_mcdev_pm_name.lower() in _mcdev_pm_parts or _mcdev_pm_norm==_mcdev_pm_name.lower() or _mcdev_pm_norm.startswith(_mcdev_pm_name.lower()+'.') for _mcdev_pm_name in _mcdev_pm_scripts):",
        '    _mcdev_pm_project=True',
        '    break',
        '  if _mcdev_pm_project: _mcdev_pm_all.append(_mcdev_pm_stat)',
        ' _mcdev_pm_all.sort(key=lambda _mcdev_pm_stat:abs(_mcdev_pm_stat.size_diff),reverse=True)',
        ` _mcdev_pm_keep=_mcdev_pm_all[:${MAX_ALLOCATIONS}]`,
        ' _mcdev_pm_rows=[]',
        ' for _mcdev_pm_id,_mcdev_pm_stat in enumerate(_mcdev_pm_keep):',
        "  _mcdev_pm_frames=[[_mcdev_pm_frame.filename or '',int(_mcdev_pm_frame.lineno or 0)] for _mcdev_pm_frame in _mcdev_pm_stat.traceback]",
        '  _mcdev_pm_rows.append([_mcdev_pm_id,int(_mcdev_pm_stat.size_diff),int(_mcdev_pm_stat.count_diff),int(_mcdev_pm_stat.size),int(_mcdev_pm_stat.count),_mcdev_pm_frames])',
        " _result={'ok':True,'elapsed':max(0,time.time()-globals().get('_mcdev_pm_started',time.time())),'depth':int(globals().get('_mcdev_pm_depth',1)),'sizeDiff':sum(_mcdev_pm_stat.size_diff for _mcdev_pm_stat in _mcdev_pm_all),'countDiff':sum(_mcdev_pm_stat.count_diff for _mcdev_pm_stat in _mcdev_pm_all),'size':sum(_mcdev_pm_stat.size for _mcdev_pm_stat in _mcdev_pm_all),'count':sum(_mcdev_pm_stat.count for _mcdev_pm_stat in _mcdev_pm_all),'total':len(_mcdev_pm_all),'truncated':len(_mcdev_pm_all)>len(_mcdev_pm_keep),'rows':_mcdev_pm_rows}",
        ' tracemalloc.stop()',
        " globals()['_mcdev_pm_owned']=False",
        " globals()['_mcdev_pm_base']=None",
        " globals()['_mcdev_pm_started']=None"
    ].join('\n');
}

export function buildPythonMemoryCleanupCode(): string {
    return [
        'import tracemalloc',
        "if globals().get('_mcdev_pm_owned',False) and tracemalloc.is_tracing(): tracemalloc.stop()",
        "globals()['_mcdev_pm_owned']=False",
        "globals()['_mcdev_pm_base']=None",
        "globals()['_mcdev_pm_started']=None",
        '_result=True'
    ].join('\n');
}

export function parsePythonMemoryStart(value: unknown): void {
    const record = asRecord(value);
    if (record.ok === true) {
        return;
    }
    if (record.reason === 'busy') {
        throw new Error('Another Python memory tracer is already active in this game process');
    }
    throw new Error('Python memory tracing could not be started');
}

export function parsePythonMemoryResult(value: unknown): PythonMemoryResult {
    const record = asRecord(value);
    if (record.ok !== true) {
        throw new Error(record.reason === 'not_owned'
            ? 'No MC Dev Tools Python memory capture is active'
            : 'Python memory tracer did not return a result');
    }
    const rows = Array.isArray(record.rows) ? record.rows : [];
    const allocations = rows.slice(0, MAX_ALLOCATIONS).map(parseAllocation).filter(isDefined);
    return {
        elapsedSeconds: nonNegativeNumber(record.elapsed),
        tracebackDepth: clampInteger(record.depth, 1, PYTHON_MEMORY_MAX_DEPTH, 1),
        netSizeDiff: finiteInteger(record.sizeDiff),
        netCountDiff: finiteInteger(record.countDiff),
        currentSize: nonNegativeInteger(record.size),
        currentCount: nonNegativeInteger(record.count),
        totalAllocations: Math.max(allocations.length, nonNegativeInteger(record.total)),
        truncated: record.truncated === true,
        allocations
    };
}

function parseAllocation(value: unknown): PythonMemoryAllocation | undefined {
    if (!Array.isArray(value) || value.length < 6 || !Array.isArray(value[5])) {
        return undefined;
    }
    const id = nonNegativeInteger(value[0], -1);
    if (id < 0) {
        return undefined;
    }
    const traceback = value[5].slice(0, PYTHON_MEMORY_MAX_DEPTH).map(parseFrame).filter(isDefined);
    if (traceback.length === 0) {
        return undefined;
    }
    return {
        id,
        sizeDiff: finiteInteger(value[1]),
        countDiff: finiteInteger(value[2]),
        currentSize: nonNegativeInteger(value[3]),
        currentCount: nonNegativeInteger(value[4]),
        traceback
    };
}

function parseFrame(value: unknown): PythonMemoryFrame | undefined {
    if (!Array.isArray(value) || typeof value[0] !== 'string') {
        return undefined;
    }
    return {
        file: value[0].slice(0, 4096),
        line: nonNegativeInteger(value[1])
    };
}

function validateDepth(value: number): number {
    if (!Number.isInteger(value) || value < 1 || value > PYTHON_MEMORY_MAX_DEPTH) {
        throw new Error(`Traceback depth must be between 1 and ${PYTHON_MEMORY_MAX_DEPTH}`);
    }
    return value;
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Python memory tracer returned an invalid payload');
    }
    return value as Record<string, unknown>;
}

function finiteInteger(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.trunc(value))
        : fallback;
}

function nonNegativeNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
    return Math.max(minimum, Math.min(maximum, finiteInteger(value, fallback)));
}

function isDefined<T>(value: T | undefined): value is T {
    return value !== undefined;
}
