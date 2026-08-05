export type PythonProfilerTarget = 'client' | 'server' | 'all';
export type PythonProfilerSide = Exclude<PythonProfilerTarget, 'all'>;
export type PythonProfilerClock = 'CPU' | 'WALL';

export interface PythonProfilerStartOptions {
    target: PythonProfilerTarget;
    clock: PythonProfilerClock;
    durationSeconds?: number;
}

export interface PythonProfilerFunction {
    id: number;
    target: PythonProfilerSide;
    module: string;
    line: number;
    name: string;
    calls: number;
    actualCalls: number;
    selfTime: number;
    totalTime: number;
    contextId: number;
    contextName: string;
}

export interface PythonProfilerCall {
    callerId: number;
    calleeId: number;
    calls: number;
    selfTime: number;
    totalTime: number;
}

export interface PythonProfilerResult {
    clock: PythonProfilerClock;
    elapsedSeconds: number;
    totalFunctions: number;
    truncated: boolean;
    functions: PythonProfilerFunction[];
    calls: PythonProfilerCall[];
}

const MAX_FUNCTIONS = 160;
const MAX_CALLS = 480;

export function buildPythonProfilerStartCode(options: PythonProfilerStartOptions): string {
    const duration = options.durationSeconds === undefined
        ? 'None'
        : String(validateDuration(options.durationSeconds));
    const clock = options.clock === 'WALL' ? 'WALL' : 'CPU';
    const profileThreads = options.target === 'all' ? 'True' : 'False';
    return [
        'import yappi,threading,time',
        `_mcdev_pp_clock='${clock}'`,
        `_mcdev_pp_duration=${duration}`,
        "if yappi.is_running() and not globals().get('_mcdev_pp_owned',False):",
        " _result={'ok':False,'reason':'busy'}",
        'else:',
        " _mcdev_pp_old=globals().get('_mcdev_pp_timer')",
        ' if _mcdev_pp_old: _mcdev_pp_old.cancel()',
        " if globals().get('_mcdev_pp_owned',False) and yappi.is_running(): yappi.stop()",
        ' yappi.clear_stats()',
        ' yappi.set_clock_type(_mcdev_pp_clock)',
        ` yappi.start(False,${profileThreads})`,
        " globals()['_mcdev_pp_owned']=True",
        " globals()['_mcdev_pp_started']=time.time()",
        " globals()['_mcdev_pp_stopped']=None",
        " globals()['_mcdev_pp_clock']=_mcdev_pp_clock",
        " globals()['_mcdev_pp_timer']=None",
        ' if _mcdev_pp_duration is not None:',
        '  def _mcdev_pp_timeout():',
        '   try:',
        "    if globals().get('_mcdev_pp_owned',False) and yappi.is_running():",
        '     yappi.stop()',
        "     globals()['_mcdev_pp_stopped']=time.time()",
        '   except: pass',
        '  _mcdev_pp_timer=threading.Timer(_mcdev_pp_duration,_mcdev_pp_timeout)',
        '  _mcdev_pp_timer.daemon=True',
        '  _mcdev_pp_timer.start()',
        "  globals()['_mcdev_pp_timer']=_mcdev_pp_timer",
        " _result={'ok':True,'running':True,'clock':_mcdev_pp_clock}"
    ].join('\n');
}

export function buildPythonProfilerMarkCode(target: PythonProfilerSide): string {
    const marker = `_mcdev_pp_${target}_marker`;
    return [
        `def ${marker}(): pass`,
        `${marker}()`,
        '_result=True'
    ].join('\n');
}

export function buildPythonProfilerCollectCode(target: PythonProfilerTarget): string {
    const scriptListCode = target === 'all'
        ? "(getattr(_mcdev_pp_instance,'clientScriptNameList',[]) or [])+(getattr(_mcdev_pp_instance,'serverScriptNameList',[]) or [])"
        : `getattr(_mcdev_pp_instance,'${target === 'client' ? 'clientScriptNameList' : 'serverScriptNameList'}',[]) or []`;
    const contextSetup = target === 'all' ? [
        ' _mcdev_pp_context_targets={}',
        ' for _mcdev_pp_stat in _mcdev_pp_stats:',
        "  if _mcdev_pp_stat.name=='_mcdev_pp_client_marker': _mcdev_pp_context_targets[int(_mcdev_pp_stat.ctx_id or 0)]='client'",
        "  elif _mcdev_pp_stat.name=='_mcdev_pp_server_marker': _mcdev_pp_context_targets[int(_mcdev_pp_stat.ctx_id or 0)]='server'"
    ] : [' _mcdev_pp_context_targets={}'];
    const sideSelection = target === 'all' ? [
        '  _mcdev_pp_side=_mcdev_pp_context_targets.get(int(_mcdev_pp_stat.ctx_id or 0))',
        '  _mcdev_pp_project=_mcdev_pp_project and _mcdev_pp_side is not None'
    ] : [`  _mcdev_pp_side='${target}'`];
    return [
        'import yappi,time',
        "if not globals().get('_mcdev_pp_owned',False):",
        " _result={'ok':False,'reason':'not_owned'}",
        'else:',
        " _mcdev_pp_timer=globals().get('_mcdev_pp_timer')",
        ' if _mcdev_pp_timer: _mcdev_pp_timer.cancel()',
        ' if yappi.is_running():',
        '  yappi.stop()',
        "  globals()['_mcdev_pp_stopped']=time.time()",
        ' _mcdev_pp_stats=yappi.get_func_stats()',
        " _mcdev_pp_stats.sort('ttot','desc')",
        ...contextSetup,
        ' try:',
        '  import common.minecraftMod as _mcdev_pp_mod',
        '  _mcdev_pp_instance=_mcdev_pp_mod.instance()',
        `  _mcdev_pp_scripts=set(_mcdev_pp_name for _mcdev_pp_name in ${scriptListCode} if _mcdev_pp_name)`,
        ' except: _mcdev_pp_scripts=[]',
        ' _mcdev_pp_all=[]',
        ' _mcdev_pp_sides={}',
        ' for _mcdev_pp_stat in _mcdev_pp_stats:',
        "  _mcdev_pp_module=_mcdev_pp_stat.module or ''",
        "  _mcdev_pp_parts=set(_mcdev_pp_module.replace('\\\\','/').split('/'))",
        "  _mcdev_pp_project=any(_mcdev_pp_name in _mcdev_pp_parts or _mcdev_pp_module==_mcdev_pp_name or _mcdev_pp_module.startswith(_mcdev_pp_name+'.') for _mcdev_pp_name in _mcdev_pp_scripts)",
        ...sideSelection,
        "  if _mcdev_pp_project and not _mcdev_pp_stat.name.startswith('_mcdev_pp_'):",
        '   _mcdev_pp_all.append(_mcdev_pp_stat)',
        '   _mcdev_pp_sides[_mcdev_pp_stat.index]=_mcdev_pp_side',
        ` _mcdev_pp_keep=_mcdev_pp_all[:${MAX_FUNCTIONS}]`,
        ' _mcdev_pp_ids=dict((_mcdev_pp_stat.index,_mcdev_pp_pos) for _mcdev_pp_pos,_mcdev_pp_stat in enumerate(_mcdev_pp_keep))',
        ' _mcdev_pp_nodes=[]',
        ' for _mcdev_pp_pos,_mcdev_pp_stat in enumerate(_mcdev_pp_keep):',
        "  _mcdev_pp_nodes.append([_mcdev_pp_pos,_mcdev_pp_stat.module or '',int(_mcdev_pp_stat.lineno or 0),_mcdev_pp_stat.name or '',int(_mcdev_pp_stat.ncall or 0),int(_mcdev_pp_stat.nactualcall or 0),float(_mcdev_pp_stat.tsub or 0),float(_mcdev_pp_stat.ttot or 0),int(_mcdev_pp_stat.ctx_id or 0),_mcdev_pp_stat.ctx_name or '',_mcdev_pp_sides.get(_mcdev_pp_stat.index)])",
        ' _mcdev_pp_edges=[]',
        ' for _mcdev_pp_parent in _mcdev_pp_keep:',
        '  for _mcdev_pp_child in _mcdev_pp_parent.children:',
        '   if _mcdev_pp_child.index in _mcdev_pp_ids:',
        '    _mcdev_pp_edges.append([_mcdev_pp_ids[_mcdev_pp_parent.index],_mcdev_pp_ids[_mcdev_pp_child.index],int(_mcdev_pp_child.ncall or 0),float(_mcdev_pp_child.tsub or 0),float(_mcdev_pp_child.ttot or 0)])',
        `    if len(_mcdev_pp_edges)>=${MAX_CALLS}: break`,
        `  if len(_mcdev_pp_edges)>=${MAX_CALLS}: break`,
        " _mcdev_pp_end=globals().get('_mcdev_pp_stopped') or time.time()",
        " _result={'ok':True,'clock':globals().get('_mcdev_pp_clock','CPU'),'elapsed':max(0,_mcdev_pp_end-globals().get('_mcdev_pp_started',_mcdev_pp_end)),'total':len(_mcdev_pp_all),'truncated':len(_mcdev_pp_all)>len(_mcdev_pp_keep),'targets':list(set(_mcdev_pp_context_targets.values())),'nodes':_mcdev_pp_nodes,'edges':_mcdev_pp_edges}",
        ' yappi.clear_stats()',
        " globals()['_mcdev_pp_owned']=False",
        " globals()['_mcdev_pp_timer']=None",
        " globals()['_mcdev_pp_stopped']=None"
    ].join('\n');
}

export function buildPythonProfilerCleanupCode(): string {
    return [
        'import yappi',
        "_mcdev_pp_timer=globals().get('_mcdev_pp_timer')",
        'if _mcdev_pp_timer: _mcdev_pp_timer.cancel()',
        "if globals().get('_mcdev_pp_owned',False):",
        ' if yappi.is_running(): yappi.stop()',
        ' yappi.clear_stats()',
        "globals()['_mcdev_pp_owned']=False",
        "globals()['_mcdev_pp_timer']=None",
        "globals()['_mcdev_pp_stopped']=None",
        '_result=True'
    ].join('\n');
}

export function parsePythonProfilerStart(value: unknown): void {
    const record = asRecord(value);
    if (record.ok === true) {
        return;
    }
    if (record.reason === 'busy') {
        throw new Error('Another Python profiler is already running in this target');
    }
    throw new Error('Python profiler could not be started');
}

export function parsePythonProfilerResult(
    value: unknown,
    target: PythonProfilerTarget = 'client'
): PythonProfilerResult {
    const record = asRecord(value);
    if (record.ok !== true) {
        throw new Error(record.reason === 'not_owned'
            ? 'No MC Dev Tools Python profile is active'
            : 'Python profiler did not return a result');
    }
    const clock: PythonProfilerClock = record.clock === 'WALL' ? 'WALL' : 'CPU';
    const nodes = Array.isArray(record.nodes) ? record.nodes : [];
    const edges = Array.isArray(record.edges) ? record.edges : [];
    if (target === 'all') {
        const markedTargets = new Set(Array.isArray(record.targets) ? record.targets : []);
        if (!markedTargets.has('client') || !markedTargets.has('server')) {
            throw new Error('Python profiler could not distinguish client and server thread contexts');
        }
    }
    const functions = nodes.slice(0, MAX_FUNCTIONS).map(value => parseFunctionRow(value, target)).filter(isDefined);
    const ids = new Set(functions.map(item => item.id));
    const calls = edges.slice(0, MAX_CALLS).map(parseCallRow).filter(isDefined).filter(item => (
        ids.has(item.callerId) && ids.has(item.calleeId)
    ));
    return {
        clock,
        elapsedSeconds: finiteNumber(record.elapsed),
        totalFunctions: Math.max(functions.length, finiteInteger(record.total)),
        truncated: record.truncated === true,
        functions,
        calls
    };
}

function validateDuration(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error('Profile duration must be greater than zero');
    }
    return value;
}

function parseFunctionRow(value: unknown, fallbackTarget: PythonProfilerTarget): PythonProfilerFunction | undefined {
    if (!Array.isArray(value) || value.length < 10) {
        return undefined;
    }
    const id = finiteInteger(value[0], -1);
    if (id < 0 || typeof value[1] !== 'string' || typeof value[3] !== 'string') {
        return undefined;
    }
    const rowTarget = value[10] === 'client' || value[10] === 'server' ? value[10] : undefined;
    const target = rowTarget ?? (fallbackTarget === 'all' ? undefined : fallbackTarget);
    if (!target) {
        return undefined;
    }
    return {
        id,
        target,
        module: value[1].slice(0, 4096),
        line: finiteInteger(value[2]),
        name: value[3].slice(0, 512),
        calls: finiteInteger(value[4]),
        actualCalls: finiteInteger(value[5]),
        selfTime: finiteNumber(value[6]),
        totalTime: finiteNumber(value[7]),
        contextId: finiteInteger(value[8]),
        contextName: typeof value[9] === 'string' ? value[9].slice(0, 512) : ''
    };
}

function parseCallRow(value: unknown): PythonProfilerCall | undefined {
    if (!Array.isArray(value) || value.length < 5) {
        return undefined;
    }
    const callerId = finiteInteger(value[0], -1);
    const calleeId = finiteInteger(value[1], -1);
    if (callerId < 0 || calleeId < 0) {
        return undefined;
    }
    return {
        callerId,
        calleeId,
        calls: finiteInteger(value[2]),
        selfTime: finiteNumber(value[3]),
        totalTime: finiteNumber(value[4])
    };
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Python profiler returned an invalid payload');
    }
    return value as Record<string, unknown>;
}

function finiteInteger(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.trunc(value))
        : fallback;
}

function finiteNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function isDefined<T>(value: T | undefined): value is T {
    return value !== undefined;
}
