import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { I18nText } from '../../i18n';
import {
  HostBridgeSessionSummary,
  NativeProfilerCompletedState,
  NativeProfilerState,
  NativeProfilerZone,
} from '../../types';
import { vscode } from '../../vscode';

interface NativeProfilerToolProps {
  session?: HostBridgeSessionSummary;
  t: I18nText;
}

const EMPTY_STATE: NativeProfilerState = { status: 'idle' };

export function NativeProfilerTool({ session, t }: NativeProfilerToolProps) {
  const [maximumSeconds, setMaximumSeconds] = useState('30');
  const [state, setState] = useState<NativeProfilerState>(EMPTY_STATE);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [, setClockTick] = useState(0);
  const sessionKey = session ? `${session.id}:${session.connectionGeneration}` : '';

  useEffect(() => {
    vscode.postMessage({ type: 'nativeProfilerActivate' });
    return () => vscode.postMessage({ type: 'nativeProfilerDeactivate' });
  }, []);

  useEffect(() => {
    setState(EMPTY_STATE);
    setPending(false);
    setError(undefined);
    if (session) {
      vscode.postMessage({
        type: 'nativeProfilerState',
        requestId: requestId(),
        sessionId: session.id,
        connectionGeneration: session.connectionGeneration,
      });
    }
  }, [sessionKey]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message?.type === 'nativeProfilerScanError') {
        setError(typeof message.message === 'string' ? message.message : t.hostBridgeRequestFailed);
        return;
      }
      if (
        !session
        || message?.sessionId !== session.id
        || message?.connectionGeneration !== session.connectionGeneration
      ) {
        return;
      }
      if (message.type === 'nativeProfilerState') {
        setState({
          endpoint: message.endpoint,
          status: isStatus(message.status) ? message.status : 'idle',
          maximumSeconds: typeof message.maximumSeconds === 'number' ? message.maximumSeconds : undefined,
          startedAt: typeof message.startedAt === 'string' ? message.startedAt : undefined,
          completed: message.completed as NativeProfilerCompletedState | undefined,
        });
        setPending(false);
        setError(undefined);
      } else if (message.type === 'nativeProfilerError') {
        setPending(false);
        setError(typeof message.message === 'string' ? message.message : t.hostBridgeRequestFailed);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [session, sessionKey, t.hostBridgeRequestFailed]);

  useEffect(() => {
    if (state.status !== 'capturing') return;
    const timer = window.setInterval(() => setClockTick(value => value + 1), 250);
    return () => window.clearInterval(timer);
  }, [state.status, state.startedAt]);

  const send = (type: string, extra?: Record<string, unknown>) => {
    if (!session) return;
    vscode.postMessage({
      type,
      requestId: requestId(),
      sessionId: session.id,
      connectionGeneration: session.connectionGeneration,
      ...extra,
    });
  };
  const start = () => {
    const seconds = Number(maximumSeconds);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600) {
      setError(`${t.nativeProfilerMaximumDuration}: 1-3600`);
      return;
    }
    setPending(true);
    setError(undefined);
    send('nativeProfilerStart', { maximumSeconds: seconds });
  };
  const action = (type: string) => {
    if (type === 'nativeProfilerStop' || type === 'nativeProfilerSave') setPending(true);
    setError(undefined);
    send(type);
  };
  const canStart = Boolean(
    session?.connected
    && session.state === 'game_ready'
    && session.minecraftPid
    && state.endpoint
    && state.status === 'idle'
  );
  const hasEndpoint = Boolean(state.endpoint);
  const completed = state.completed;
  const elapsed = state.startedAt
    ? Math.max(0, (Date.now() - Date.parse(state.startedAt)) / 1000)
    : 0;

  return (
    <div className="native-profiler-workspace">
      <div className="native-profiler-toolbar">
        <div className="native-profiler-endpoint">
          <span>{t.nativeProfilerEndpoint}</span>
          {state.endpoint ? (
            <code>127.0.0.1:{state.endpoint.port} <small>PID {state.endpoint.pid}</small></code>
          ) : (
            <span className="detecting"><i />{t.nativeProfilerDetecting}</span>
          )}
        </div>
        <label className="native-profiler-duration">
          <span>{t.nativeProfilerMaximumDuration}</span>
          <span className="native-profiler-number-field">
            <input
              type="text"
              inputMode="numeric"
              value={maximumSeconds}
              disabled={state.status !== 'idle'}
              onChange={event => setMaximumSeconds(event.target.value)}
            />
            <small>{t.nativeProfilerSeconds}</small>
          </span>
        </label>
        <div className="native-profiler-primary-action">
          {state.status === 'capturing' ? (
            <button type="button" className="native-profiler-stop" disabled={pending} onClick={() => action('nativeProfilerStop')}>
              <span className="codicon codicon-debug-stop" />
              <span>{t.nativeProfilerStop}</span>
            </button>
          ) : (
            <button type="button" className="native-profiler-start" disabled={!canStart || pending || state.status === 'analyzing'} onClick={start}>
              <span className="codicon codicon-record" />
              <span>{t.nativeProfilerStart}</span>
            </button>
          )}
        </div>
      </div>

      <div className={`native-profiler-status ${state.status}`}>
        <span className={`codicon ${state.status === 'analyzing' ? 'codicon-loading codicon-modifier-spin' : state.status === 'capturing' ? 'codicon-pulse' : 'codicon-circle-outline'}`} />
        <span>{statusText(state, hasEndpoint, elapsed, t)}</span>
        {completed && !completed.report && (
          <button type="button" disabled={pending} onClick={() => action('nativeProfilerSave')} title={t.nativeProfilerSave}>
            <span className="codicon codicon-save" />
            <span>{t.nativeProfilerSave}</span>
          </button>
        )}
        {completed && (
          <div className="native-profiler-report-actions">
            {completed.report && (
              <>
                <button type="button" onClick={() => action('nativeProfilerOpenReport')} title={t.nativeProfilerOpenReport}>
                  <span className="codicon codicon-markdown" />
                </button>
                <button type="button" onClick={() => action('nativeProfilerReveal')} title={t.nativeProfilerReveal}>
                  <span className="codicon codicon-folder-opened" />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {(error || completed?.reportError) && (
        <div className="native-profiler-error" role="alert">
          <span className="codicon codicon-error" />
          <span>{error || completed?.reportError}</span>
        </div>
      )}

      {completed ? (
        <NativeProfilerResults
          completed={completed}
          session={session}
          t={t}
          onOpen={zone => send('nativeProfilerOpenSource', { zoneId: zone.id })}
        />
      ) : (
        <div className="native-profiler-empty">
          <span className="codicon codicon-dashboard" />
          <span>{hasEndpoint ? t.nativeProfilerIdle : t.nativeProfilerUnavailable}</span>
        </div>
      )}
    </div>
  );
}

function NativeProfilerResults({
  completed,
  session,
  t,
  onOpen,
}: {
  completed: NativeProfilerCompletedState;
  session?: HostBridgeSessionSummary;
  t: I18nText;
  onOpen(zone: NativeProfilerZone): void;
}) {
  const [selectedId, setSelectedId] = useState<number>();
  const [tableWidth, setTableWidth] = useState(68);
  const layout = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);
  const zones = useMemo(
    () => completed.result.zones.slice().sort((left, right) => right.totalNanoseconds - left.totalNanoseconds),
    [completed.result.zones]
  );
  const maximum = Math.max(1, ...zones.map(zone => zone.totalNanoseconds));
  useEffect(() => {
    if (!zones.some(zone => zone.id === selectedId)) setSelectedId(zones[0]?.id);
  }, [selectedId, zones]);
  const selected = zones.find(zone => zone.id === selectedId);
  const resize = (clientX: number) => {
    const bounds = layout.current?.getBoundingClientRect();
    if (!bounds) return;
    setTableWidth(Math.max(35, Math.min(78, ((clientX - bounds.left) / bounds.width) * 100)));
  };
  return (
    <div
      className="native-profiler-results"
      ref={layout}
      style={{ '--native-profiler-table-width': `${tableWidth}%` } as CSSProperties}
    >
      <section className="native-profiler-zones">
        <header>
          <h2>{t.nativeProfilerHotZones}</h2>
          <span>{t.nativeProfilerDoubleClickHint}</span>
        </header>
        <div className="native-profiler-table-header">
          <span>{t.nativeProfilerZone}</span>
          <span />
          <span>{t.nativeProfilerCalls}</span>
          <span>{t.nativeProfilerSelfTime}</span>
          <span>{t.nativeProfilerTotalTime}</span>
        </div>
        <div className="native-profiler-table" role="listbox">
          {zones.map(zone => (
            <button
              type="button"
              role="option"
              aria-selected={zone.id === selectedId}
              className={zone.id === selectedId ? 'selected' : ''}
              key={zone.id}
              onClick={() => setSelectedId(zone.id)}
              onDoubleClick={() => onOpen(zone)}
            >
              <span className="native-profiler-zone-name">
                <strong>{zone.name}</strong>
                <small title={location(zone)}>{location(zone)}</small>
              </span>
              <span className="native-profiler-time-bar">
                <i className="total" style={{ width: `${zone.totalNanoseconds / maximum * 100}%` }} />
                <i className="self" style={{ width: `${zone.selfNanoseconds / maximum * 100}%` }} />
              </span>
              <span>{zone.calls}</span>
              <span>{formatNanoseconds(zone.selfNanoseconds)}</span>
              <span>{formatNanoseconds(zone.totalNanoseconds)}</span>
            </button>
          ))}
        </div>
        {completed.result.truncated && <small className="native-profiler-truncated">{t.nativeProfilerTruncated}</small>}
      </section>
      <div
        className="native-profiler-splitter"
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-valuemin={35}
        aria-valuemax={78}
        aria-valuenow={Math.round(tableWidth)}
        onDoubleClick={() => setTableWidth(68)}
        onPointerDown={event => {
          resizing.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          resize(event.clientX);
        }}
        onPointerMove={event => resizing.current && resize(event.clientX)}
        onPointerUp={event => {
          resizing.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            setTableWidth(value => Math.max(35, Math.min(78, value + (event.key === 'ArrowLeft' ? -2 : 2))));
          }
        }}
      />
      <section className="native-profiler-details">
        <header><h2>{t.nativeProfilerDetails}</h2></header>
        {selected ? (
          <div className="native-profiler-detail-content">
            <div className="native-profiler-selected-zone">
              <span className="codicon codicon-dashboard" />
              <strong>{selected.name}</strong>
              {session && selected.sourceFile && (
                <button type="button" onClick={() => onOpen(selected)} title={t.nativeProfilerOpenSource}>
                  <span className="codicon codicon-go-to-file" />
                </button>
              )}
            </div>
            <Metric label={t.nativeProfilerCalls} value={String(selected.calls)} />
            <Metric label={t.nativeProfilerSelfTime} value={formatNanoseconds(selected.selfNanoseconds)} />
            <Metric label={t.nativeProfilerTotalTime} value={formatNanoseconds(selected.totalNanoseconds)} />
            <Metric label={t.nativeProfilerMeanTime} value={formatNanoseconds(selected.meanNanoseconds)} />
            <Metric label={t.nativeProfilerMaxTime} value={formatNanoseconds(selected.maximumNanoseconds)} />
            <div className="native-profiler-source">
              <span>{t.nativeProfilerSource}</span>
              <code title={location(selected)}>{location(selected)}</code>
            </div>
          </div>
        ) : <div className="native-profiler-detail-empty">{t.nativeProfilerSelectZone}</div>}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="native-profiler-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function statusText(state: NativeProfilerState, hasEndpoint: boolean, elapsed: number, t: I18nText): string {
  if (state.status === 'capturing') {
    return `${t.nativeProfilerCapturing} · ${elapsed.toFixed(1)} / ${state.maximumSeconds ?? 0} ${t.nativeProfilerSeconds}`;
  }
  if (state.status === 'analyzing') return t.nativeProfilerAnalyzing;
  if (state.completed?.report) return t.nativeProfilerSaved;
  return hasEndpoint ? t.nativeProfilerIdle : t.nativeProfilerUnavailable;
}

function isStatus(value: unknown): value is NativeProfilerState['status'] {
  return value === 'idle' || value === 'capturing' || value === 'analyzing';
}

function location(zone: NativeProfilerZone): string {
  if (!zone.sourceFile) return '-';
  return zone.sourceLine > 0 ? `${zone.sourceFile}:${zone.sourceLine}` : zone.sourceFile;
}

function formatNanoseconds(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} s`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} ms`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)} us`;
  return `${Math.round(value)} ns`;
}

function requestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
