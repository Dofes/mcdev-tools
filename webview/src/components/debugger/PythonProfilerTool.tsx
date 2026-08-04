import { memo, useEffect, useMemo, useState } from 'react';
import { I18nText } from '../../i18n';
import {
  HostBridgeSessionSummary,
  PythonProfilerCall,
  PythonProfilerCompletedState,
  PythonProfilerFunction,
  PythonProfilerTarget,
  PythonProfilerTargetState,
} from '../../types';
import { vscode } from '../../vscode';

interface PythonProfilerToolProps {
  session?: HostBridgeSessionSummary;
  t: I18nText;
}

type CaptureMode = 'timed' | 'manual';

export function PythonProfilerTool({ session, t }: PythonProfilerToolProps) {
  const [target, setTarget] = useState<PythonProfilerTarget>('client');
  const [clock, setClock] = useState<'CPU' | 'WALL'>('CPU');
  const [mode, setMode] = useState<CaptureMode>('timed');
  const [duration, setDuration] = useState('10');
  const [states, setStates] = useState<Partial<Record<PythonProfilerTarget, PythonProfilerTargetState>>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [, setClockTick] = useState(0);
  const contextKey = session ? `${session.id}:${session.connectionGeneration}` : '';
  const targetState = states[target];
  const completed = targetState?.completed;
  const result = completed?.result;
  const methodAvailable = session?.methods === undefined
    || session.methods.some(method => method.name === 'game/code/execute' && method.modes.includes('request'));
  const canProfile = Boolean(session?.connected && session.state === 'game_ready' && methodAvailable);
  const anyTargetActive = Object.values(states).some(state => (
    state?.status === 'running' || state?.status === 'collecting'
  ));

  useEffect(() => {
    setStates({});
    setPending(false);
    setError(undefined);
    if (!session) {
      return;
    }
    vscode.postMessage({
      type: 'pythonProfilerState',
      requestId: createRequestId(),
      sessionId: session.id,
      connectionGeneration: session.connectionGeneration,
    });
  }, [contextKey]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (
        !session
        || message?.sessionId !== session.id
        || message?.connectionGeneration !== session.connectionGeneration
      ) {
        return;
      }
      if (message.type === 'pythonProfilerState' && Array.isArray(message.states)) {
        const next: Partial<Record<PythonProfilerTarget, PythonProfilerTargetState>> = {};
        for (const state of message.states as PythonProfilerTargetState[]) {
          if (isTarget(state.target)) {
            next[state.target] = state;
          }
        }
        setStates(next);
        setPending(false);
        setError(undefined);
      } else if (message.type === 'pythonProfilerResult' && isTarget(message.target) && message.state) {
        const captured = message.state as PythonProfilerCompletedState;
        setStates(previous => ({
          ...previous,
          [message.target]: {
            target: message.target,
            status: 'idle',
            clock: captured.clock,
            completed: captured,
          },
        }));
        setPending(false);
      } else if (message.type === 'pythonProfilerError') {
        setPending(false);
        setError(typeof message.message === 'string' ? message.message : t.hostBridgeRequestFailed);
      } else if (message.type === 'pythonProfilerInvalidated' && isTarget(message.target)) {
        setStates(previous => ({ ...previous, [message.target]: undefined }));
        setPending(false);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [contextKey, session, t.hostBridgeRequestFailed]);

  useEffect(() => {
    if (targetState?.status !== 'running') {
      return;
    }
    const timer = window.setInterval(() => setClockTick(value => value + 1), 250);
    return () => window.clearInterval(timer);
  }, [targetState?.status, targetState?.startedAt]);

  const statusLabel = getStatusLabel(targetState, t);
  const elapsed = getElapsed(targetState);

  const start = () => {
    if (!session || !canProfile || pending) {
      return;
    }
    const seconds = mode === 'timed' ? Number(duration) : undefined;
    if (seconds !== undefined && (!Number.isFinite(seconds) || seconds <= 0)) {
      setError(`${t.pythonProfilerDuration}: > 0`);
      return;
    }
    setPending(true);
    setError(undefined);
    vscode.postMessage({
      type: 'pythonProfilerStart',
      requestId: createRequestId(),
      sessionId: session.id,
      connectionGeneration: session.connectionGeneration,
      target,
      clock,
      durationSeconds: seconds,
    });
  };

  const stop = () => {
    if (!session || pending || targetState?.status !== 'running') {
      return;
    }
    setPending(true);
    setError(undefined);
    vscode.postMessage({
      type: 'pythonProfilerStop',
      requestId: createRequestId(),
      sessionId: session.id,
      connectionGeneration: session.connectionGeneration,
      target,
    });
  };

  const reportAction = (
    type: 'pythonProfilerSaveReport' | 'pythonProfilerOpenReport' | 'pythonProfilerRevealReport',
    kind?: 'markdown' | 'svg'
  ) => {
    if (!session) {
      return;
    }
    if (type === 'pythonProfilerSaveReport') {
      setPending(true);
      setError(undefined);
    }
    vscode.postMessage({
      type,
      requestId: createRequestId(),
      sessionId: session.id,
      connectionGeneration: session.connectionGeneration,
      target,
      kind,
    });
  };

  return (
    <div className="python-profiler-workspace">
      <div className="python-profiler-toolbar">
        <ControlGroup label={t.pythonProfilerTarget}>
          <SegmentedControl
            value={target}
            options={[
              ['client', t.hostBridgeClient],
              ['server', t.hostBridgeServer],
              ['all', t.pythonProfilerAll],
            ]}
            disabled={anyTargetActive}
            onChange={value => {
              setTarget(value as PythonProfilerTarget);
            }}
          />
        </ControlGroup>
        <ControlGroup label={t.pythonProfilerClock}>
          <SegmentedControl
            value={clock}
            options={[
              ['CPU', t.pythonProfilerCpu],
              ['WALL', t.pythonProfilerWall],
            ]}
            onChange={value => setClock(value as 'CPU' | 'WALL')}
            disabled={targetState?.status !== 'idle' && targetState !== undefined}
          />
        </ControlGroup>
        <ControlGroup label={t.pythonProfilerMode}>
          <SegmentedControl
            value={mode}
            options={[
              ['timed', t.pythonProfilerTimed],
              ['manual', t.pythonProfilerManual],
            ]}
            onChange={value => setMode(value as CaptureMode)}
            disabled={targetState?.status !== 'idle' && targetState !== undefined}
          />
        </ControlGroup>
        {mode === 'timed' && (
          <label className="python-profiler-duration">
            <span>{t.pythonProfilerDuration}</span>
            <span className="python-profiler-number-field">
              <input
                type="text"
                inputMode="decimal"
                value={duration}
                disabled={targetState?.status !== 'idle' && targetState !== undefined}
                onChange={event => setDuration(event.target.value)}
              />
              <small>{t.pythonProfilerSeconds}</small>
              <span className="python-profiler-stepper">
                <button
                  type="button"
                  disabled={targetState?.status !== 'idle' && targetState !== undefined}
                  onClick={() => setDuration(adjustDuration(duration, -1))}
                  title={`-1 ${t.pythonProfilerSeconds}`}
                  aria-label={`-1 ${t.pythonProfilerSeconds}`}
                ><span className="codicon codicon-remove" /></button>
                <button
                  type="button"
                  disabled={targetState?.status !== 'idle' && targetState !== undefined}
                  onClick={() => setDuration(adjustDuration(duration, 1))}
                  title={`+1 ${t.pythonProfilerSeconds}`}
                  aria-label={`+1 ${t.pythonProfilerSeconds}`}
                ><span className="codicon codicon-add" /></button>
              </span>
            </span>
          </label>
        )}
        <div className="python-profiler-action">
          {targetState?.status === 'running' ? (
            <button type="button" className="python-profiler-stop" disabled={pending} onClick={stop}>
              <span className="codicon codicon-debug-stop" />
              <span>{t.pythonProfilerStop}</span>
            </button>
          ) : (
            <button
              type="button"
              className="python-profiler-start"
              disabled={!canProfile || pending || targetState?.status === 'collecting'}
              onClick={start}
            >
              <span className="codicon codicon-record" />
              <span>{t.pythonProfilerStart}</span>
            </button>
          )}
        </div>
      </div>

      <div className={`python-profiler-status ${targetState?.status ?? 'idle'}`}>
        <span className="python-profiler-status-dot" />
        <strong>{canProfile ? statusLabel : t.pythonProfilerUnavailable}</strong>
        {elapsed !== undefined && <time>{formatTime(elapsed)}</time>}
        {result && (
          <span className="python-profiler-result-meta">
            {formatTime(result.elapsedSeconds)} · {result.totalFunctions} {t.pythonProfilerFunction.toLowerCase()}
            {result.truncated ? ` · ${t.pythonProfilerTruncated}` : ''}
          </span>
        )}
        {completed && !completed.report && (
          <button
            type="button"
            className="python-profiler-save-report"
            disabled={pending}
            onClick={() => reportAction('pythonProfilerSaveReport')}
          >
            <span className="codicon codicon-save" />
            <span>{t.pythonProfilerSaveReport}</span>
          </button>
        )}
        {completed?.report && (
          <div className="python-profiler-report-actions">
            <button type="button" onClick={() => reportAction('pythonProfilerOpenReport', 'markdown')} title={t.pythonProfilerOpenMarkdown}>
              <span className="codicon codicon-markdown" />
            </button>
            <button type="button" onClick={() => reportAction('pythonProfilerOpenReport', 'svg')} title={t.pythonProfilerOpenSvg}>
              <span className="codicon codicon-graph" />
            </button>
            <button type="button" onClick={() => reportAction('pythonProfilerRevealReport')} title={t.pythonProfilerRevealReport}>
              <span className="codicon codicon-folder-opened" />
            </button>
          </div>
        )}
      </div>

      {(error || completed?.reportError) && (
        <div className="python-profiler-error" role="alert">
          <span className="codicon codicon-error" />
          <span>{error || `${t.pythonProfilerReportFailed}: ${completed?.reportError}`}</span>
        </div>
      )}

      {result ? (
        <PythonProfilerResults result={result} t={t} />
      ) : (
        <div className="python-profiler-empty">
          <span className="codicon codicon-pulse" />
          <span>{canProfile ? t.pythonProfilerIdle : t.pythonProfilerUnavailable}</span>
        </div>
      )}
    </div>
  );
}

const PythonProfilerResults = memo(function PythonProfilerResults({
  result,
  t,
}: {
  result: NonNullable<PythonProfilerCompletedState['result']>;
  t: I18nText;
}) {
  const [selectedFunctionId, setSelectedFunctionId] = useState<number>();
  const functions = useMemo(
    () => result.functions.slice().sort((left, right) => right.totalTime - left.totalTime),
    [result]
  );
  useEffect(() => {
    if (!functions.some(item => item.id === selectedFunctionId)) {
      setSelectedFunctionId(functions[0]?.id);
    }
  }, [functions, selectedFunctionId]);
  const selectedFunction = functions.find(item => item.id === selectedFunctionId);
  const relationships = useMemo(
    () => getRelationships(selectedFunction, result.functions, result.calls),
    [result, selectedFunction]
  );
  return (
    <div className="python-profiler-results">
      <section className="python-profiler-functions" aria-label={t.pythonProfilerHotFunctions}>
        <header><h2>{t.pythonProfilerHotFunctions}</h2></header>
        <div className="python-profiler-table-header" aria-hidden="true">
          <span>{t.pythonProfilerFunction}</span>
          <span>{t.pythonProfilerCalls}</span>
          <span>{t.pythonProfilerSelfTime}</span>
          <span>{t.pythonProfilerTotalTime}</span>
        </div>
        <div className="python-profiler-table" role="listbox">
          {functions.map(item => (
            <button
              type="button"
              role="option"
              aria-selected={item.id === selectedFunctionId}
              className={item.id === selectedFunctionId ? 'selected' : ''}
              key={item.id}
              onClick={() => setSelectedFunctionId(item.id)}
            >
              <span className="python-profiler-function-name">
                <strong>{item.name}</strong>
                <small title={formatLocation(item)}>{formatLocation(item)}</small>
              </span>
              <span>{item.calls}</span>
              <span>{formatTime(item.selfTime)}</span>
              <span>{formatTime(item.totalTime)}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="python-profiler-call-details" aria-label={t.pythonProfilerCallDetails}>
        <header><h2>{t.pythonProfilerCallDetails}</h2></header>
        {selectedFunction ? (
          <div className="python-profiler-call-content">
            <div className="python-profiler-selected-function">
              <span className="codicon codicon-symbol-function" />
              <div>
                <strong>{selectedFunction.name}</strong>
                <small title={formatLocation(selectedFunction)}>{formatLocation(selectedFunction)}</small>
              </div>
            </div>
            <CallSection label={t.pythonProfilerCallers} relationships={relationships.callers} empty={t.pythonProfilerNoCalls} />
            <CallSection label={t.pythonProfilerCallees} relationships={relationships.callees} empty={t.pythonProfilerNoCalls} />
          </div>
        ) : (
          <div className="python-profiler-detail-empty">{t.pythonProfilerSelectFunction}</div>
        )}
      </section>
    </div>
  );
});

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="python-profiler-control-group"><span>{label}</span>{children}</div>;
}

function SegmentedControl({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: [string, string][];
  onChange(value: string): void;
  disabled?: boolean;
}) {
  return (
    <div className="python-profiler-segmented">
      {options.map(([option, label]) => (
        <button
          type="button"
          className={value === option ? 'active' : ''}
          aria-pressed={value === option}
          disabled={disabled}
          key={option}
          onClick={() => onChange(option)}
        >{label}</button>
      ))}
    </div>
  );
}

interface Relationship {
  function: PythonProfilerFunction;
  call: PythonProfilerCall;
}

function CallSection({ label, relationships, empty }: { label: string; relationships: Relationship[]; empty: string }) {
  return (
    <div className="python-profiler-call-section">
      <h3>{label}</h3>
      {relationships.length === 0 ? <p>{empty}</p> : relationships.map(relationship => (
        <div className="python-profiler-call-row" key={`${relationship.call.callerId}:${relationship.call.calleeId}`}>
          <span>{relationship.function.name}</span>
          <small>{relationship.call.calls} ×</small>
          <time>{formatTime(relationship.call.totalTime)}</time>
        </div>
      ))}
    </div>
  );
}

function getRelationships(
  selected: PythonProfilerFunction | undefined,
  functions: PythonProfilerFunction[],
  calls: PythonProfilerCall[]
): { callers: Relationship[]; callees: Relationship[] } {
  if (!selected) {
    return { callers: [], callees: [] };
  }
  const byId = new Map(functions.map(item => [item.id, item]));
  const callers: Relationship[] = [];
  const callees: Relationship[] = [];
  for (const call of calls) {
    if (call.calleeId === selected.id) {
      const fn = byId.get(call.callerId);
      if (fn) callers.push({ function: fn, call });
    }
    if (call.callerId === selected.id) {
      const fn = byId.get(call.calleeId);
      if (fn) callees.push({ function: fn, call });
    }
  }
  callers.sort((left, right) => right.call.totalTime - left.call.totalTime);
  callees.sort((left, right) => right.call.totalTime - left.call.totalTime);
  return { callers, callees };
}

function getStatusLabel(state: PythonProfilerTargetState | undefined, t: I18nText): string {
  if (state?.status === 'running') return t.pythonProfilerRunning;
  if (state?.status === 'collecting') return t.pythonProfilerCollecting;
  return state?.completed ? t.hostBridgeResult : t.pythonProfilerIdle;
}

function adjustDuration(value: string, delta: number): string {
  const parsed = Number(value);
  const next = Math.max(0.001, (Number.isFinite(parsed) ? parsed : 10) + delta);
  return Number(next.toFixed(3)).toString();
}

function getElapsed(state: PythonProfilerTargetState | undefined): number | undefined {
  if (state?.status !== 'running' || !state.startedAt) return undefined;
  const startedAt = Date.parse(state.startedAt);
  return Number.isFinite(startedAt) ? Math.max(0, (Date.now() - startedAt) / 1000) : undefined;
}

function formatTime(seconds: number): string {
  if (seconds >= 1) return `${seconds.toFixed(3)} s`;
  if (seconds >= 0.001) return `${(seconds * 1000).toFixed(2)} ms`;
  return `${(seconds * 1_000_000).toFixed(0)} µs`;
}

function formatLocation(item: PythonProfilerFunction): string {
  return item.line > 0 ? `${item.module}:${item.line}` : item.module;
}

function isTarget(value: unknown): value is PythonProfilerTarget {
  return value === 'client' || value === 'server' || value === 'all';
}

function createRequestId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}:${Math.random().toString(16).slice(2)}`;
}
