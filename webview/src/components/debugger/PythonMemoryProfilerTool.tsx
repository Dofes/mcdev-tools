import { CSSProperties, memo, useEffect, useMemo, useRef, useState } from 'react';
import { I18nText } from '../../i18n';
import {
  HostBridgeSessionSummary,
  PythonMemoryAllocation,
  PythonMemoryCompletedState,
  PythonMemoryState,
} from '../../types';
import { vscode } from '../../vscode';

interface PythonMemoryProfilerToolProps {
  session?: HostBridgeSessionSummary;
  t: I18nText;
}

const DEFAULT_DEPTH = 8;
const MAX_DEPTH = 16;

export function PythonMemoryProfilerTool({ session, t }: PythonMemoryProfilerToolProps) {
  const [tracebackDepth, setTracebackDepth] = useState(DEFAULT_DEPTH);
  const [collectGarbage, setCollectGarbage] = useState(true);
  const [state, setState] = useState<PythonMemoryState>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [, setClockTick] = useState(0);
  const contextKey = session ? `${session.id}:${session.connectionGeneration}` : '';
  const completed = state?.completed;
  const result = completed?.result;
  const methodAvailable = session?.methods === undefined
    || session.methods.some(method => method.name === 'game/code/execute' && method.modes.includes('request'));
  const canProfile = Boolean(session?.connected && session.state === 'game_ready' && methodAvailable);

  useEffect(() => {
    setState(undefined);
    setPending(false);
    setError(undefined);
    if (!session) {
      return;
    }
    vscode.postMessage({
      type: 'pythonMemoryProfilerState',
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
      if (message.type === 'pythonMemoryProfilerState' && message.state) {
        const next = message.state as PythonMemoryState;
        setState(next);
        setTracebackDepth(next.tracebackDepth);
        setPending(false);
        setError(undefined);
      } else if (message.type === 'pythonMemoryProfilerResult' && message.state) {
        const captured = message.state as PythonMemoryCompletedState;
        setState({
          status: 'idle',
          tracebackDepth: captured.result.tracebackDepth,
          completed: captured,
        });
        setPending(false);
      } else if (message.type === 'pythonMemoryProfilerError') {
        setPending(false);
        setError(typeof message.message === 'string' ? message.message : t.hostBridgeRequestFailed);
      } else if (message.type === 'pythonMemoryProfilerInvalidated') {
        setState(undefined);
        setPending(false);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [contextKey, session, t.hostBridgeRequestFailed]);

  useEffect(() => {
    if (state?.status !== 'running') {
      return;
    }
    const timer = window.setInterval(() => setClockTick(value => value + 1), 250);
    return () => window.clearInterval(timer);
  }, [state?.startedAt, state?.status]);

  const start = () => {
    if (!session || !canProfile || pending) {
      return;
    }
    setPending(true);
    setError(undefined);
    vscode.postMessage({
      type: 'pythonMemoryProfilerStart',
      requestId: createRequestId(),
      sessionId: session.id,
      connectionGeneration: session.connectionGeneration,
      tracebackDepth,
    });
  };

  const stop = () => {
    if (!session || pending || state?.status !== 'running') {
      return;
    }
    setPending(true);
    setError(undefined);
    vscode.postMessage({
      type: 'pythonMemoryProfilerStop',
      requestId: createRequestId(),
      sessionId: session.id,
      connectionGeneration: session.connectionGeneration,
      collectGarbage,
    });
  };

  const reportAction = (
    type: 'pythonMemoryProfilerSaveReport' | 'pythonMemoryProfilerOpenReport' | 'pythonMemoryProfilerRevealReport',
    kind?: 'markdown' | 'svg'
  ) => {
    if (!session) {
      return;
    }
    if (type === 'pythonMemoryProfilerSaveReport') {
      setPending(true);
      setError(undefined);
    }
    vscode.postMessage({
      type,
      requestId: createRequestId(),
      sessionId: session.id,
      connectionGeneration: session.connectionGeneration,
      kind,
    });
  };

  const elapsed = state?.startedAt && state.status !== 'idle'
    ? Math.max(0, (Date.now() - Date.parse(state.startedAt)) / 1000)
    : undefined;

  return (
    <div className="python-memory-workspace">
      <div className="python-memory-toolbar">
        <label className="python-memory-depth">
          <span>{t.pythonMemoryTracebackDepth}</span>
          <span className="python-memory-number-field">
            <input
              type="number"
              min={1}
              max={MAX_DEPTH}
              step={1}
              value={tracebackDepth}
              disabled={state?.status !== undefined && state.status !== 'idle'}
              onChange={event => setTracebackDepth(clampDepth(Number(event.target.value)))}
            />
            <small>1-{MAX_DEPTH}</small>
          </span>
        </label>
        <label className="python-memory-gc">
          <input
            type="checkbox"
            checked={collectGarbage}
            disabled={state?.status === 'collecting'}
            onChange={event => setCollectGarbage(event.target.checked)}
          />
          <span>{t.pythonMemoryCollectGarbage}</span>
        </label>
        <div className="python-memory-action">
          {state?.status === 'running' ? (
            <button type="button" className="python-memory-stop" disabled={pending} onClick={stop}>
              <span className="codicon codicon-debug-stop" />
              <span>{t.pythonMemoryStop}</span>
            </button>
          ) : (
            <button
              type="button"
              className="python-memory-start"
              disabled={!canProfile || pending || state?.status === 'collecting'}
              onClick={start}
            >
              <span className="codicon codicon-record" />
              <span>{t.pythonMemoryStart}</span>
            </button>
          )}
        </div>
      </div>

      <div className={`python-memory-status ${state?.status ?? 'idle'}`}>
        <span className="python-memory-status-dot" />
        <strong>{canProfile ? statusText(state, t) : t.pythonMemoryUnavailable}</strong>
        {elapsed !== undefined && <time>{formatDuration(elapsed)}</time>}
        {result && (
          <div className="python-memory-summary">
            <SummaryMetric label={t.pythonMemoryNetGrowth} value={formatSignedBytes(result.netSizeDiff)} tone={result.netSizeDiff} />
            <SummaryMetric label={t.pythonMemoryRetained} value={formatBytes(result.currentSize)} />
            <SummaryMetric label={t.pythonMemoryBlockChange} value={formatSignedInteger(result.netCountDiff)} tone={result.netCountDiff} />
            <SummaryMetric label={t.pythonMemoryLiveBlocks} value={String(result.currentCount)} />
          </div>
        )}
        {completed && !completed.report && (
          <button
            type="button"
            className="python-memory-save-report"
            disabled={pending}
            onClick={() => reportAction('pythonMemoryProfilerSaveReport')}
          >
            <span className="codicon codicon-save" />
            <span>{t.pythonMemorySaveReport}</span>
          </button>
        )}
        {completed?.report && (
          <div className="python-memory-report-actions">
            <button type="button" onClick={() => reportAction('pythonMemoryProfilerOpenReport', 'markdown')} title={t.pythonMemoryOpenMarkdown}>
              <span className="codicon codicon-markdown" />
            </button>
            <button type="button" onClick={() => reportAction('pythonMemoryProfilerOpenReport', 'svg')} title={t.pythonMemoryOpenSvg}>
              <span className="codicon codicon-graph" />
            </button>
            <button type="button" onClick={() => reportAction('pythonMemoryProfilerRevealReport')} title={t.pythonMemoryRevealReport}>
              <span className="codicon codicon-folder-opened" />
            </button>
          </div>
        )}
      </div>

      {(error || completed?.reportError) && (
        <div className="python-memory-error" role="alert">
          <span className="codicon codicon-error" />
          <span>{error || `${t.pythonMemoryReportFailed}: ${completed?.reportError}`}</span>
        </div>
      )}

      {result ? (
        <PythonMemoryResults result={result} session={session} t={t} />
      ) : (
        <div className="python-memory-empty">
          <span className="codicon codicon-database" />
          <span>{canProfile ? t.pythonMemoryIdle : t.pythonMemoryUnavailable}</span>
        </div>
      )}
    </div>
  );
}

const PythonMemoryResults = memo(function PythonMemoryResults({
  result,
  session,
  t,
}: {
  result: NonNullable<PythonMemoryCompletedState['result']>;
  session?: HostBridgeSessionSummary;
  t: I18nText;
}) {
  const [selectedId, setSelectedId] = useState<number>();
  const [listWidth, setListWidth] = useState(58);
  const layout = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);
  const allocations = useMemo(() => result.allocations.slice().sort((left, right) => (
    Math.abs(right.sizeDiff) - Math.abs(left.sizeDiff)
  )), [result]);
  const maximumDelta = Math.max(1, ...allocations.map(item => Math.abs(item.sizeDiff)));

  useEffect(() => {
    if (!allocations.some(item => item.id === selectedId)) {
      setSelectedId(allocations[0]?.id);
    }
  }, [allocations, selectedId]);

  const selected = allocations.find(item => item.id === selectedId);
  const openFrame = (allocation: PythonMemoryAllocation, frameIndex: number) => {
    if (!session) {
      return;
    }
    vscode.postMessage({
      type: 'pythonMemoryProfilerOpenFrame',
      requestId: createRequestId(),
      sessionId: session.id,
      connectionGeneration: session.connectionGeneration,
      allocationId: allocation.id,
      frameIndex,
    });
  };
  const limits = () => {
    const bounds = layout.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) {
      return { minimum: 28, maximum: 72 };
    }
    const minimum = Math.min(44, (300 / bounds.width) * 100);
    const maximum = Math.max(minimum, 100 - ((300 + 5) / bounds.width) * 100);
    return { minimum, maximum };
  };
  const resize = (clientX: number) => {
    const bounds = layout.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) {
      return;
    }
    const { minimum, maximum } = limits();
    const next = ((clientX - bounds.left) / bounds.width) * 100;
    setListWidth(Math.max(minimum, Math.min(maximum, next)));
  };

  return (
    <div
      className="python-memory-results"
      ref={layout}
      style={{ '--python-memory-list-width': `${listWidth}%` } as CSSProperties}
    >
      <section className="python-memory-sites" aria-label={t.pythonMemoryAllocationSites}>
        <header>
          <h2>{t.pythonMemoryAllocationSites}</h2>
          <span>{result.totalAllocations}{result.truncated ? `+ · ${t.pythonMemoryTruncated}` : ''}</span>
        </header>
        <div className="python-memory-table-header" aria-hidden="true">
          <span>{t.pythonMemoryAllocationSite}</span>
          <span>{t.pythonMemoryChange}</span>
          <span>{t.pythonMemoryBlocks}</span>
          <span>{t.pythonMemoryRetained}</span>
        </div>
        <div className="python-memory-table" role="listbox">
          {allocations.map(item => {
            const site = item.traceback[0];
            return (
              <button
                type="button"
                role="option"
                aria-selected={item.id === selectedId}
                className={item.id === selectedId ? 'selected' : ''}
                key={item.id}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="python-memory-site-name">
                  <strong>{shortFile(site.file)}</strong>
                  <small title={formatLocation(site.file, site.line)}>{formatLocation(site.file, site.line)}</small>
                </span>
                <span className="python-memory-delta">
                  <i
                    className={item.sizeDiff >= 0 ? 'growth' : 'release'}
                    style={{ width: `${Math.max(2, Math.abs(item.sizeDiff) / maximumDelta * 100)}%` }}
                  />
                  <em className={deltaTone(item.sizeDiff)}>{formatSignedBytes(item.sizeDiff)}</em>
                </span>
                <span className={deltaTone(item.countDiff)}>{formatSignedInteger(item.countDiff)}</span>
                <span>{formatBytes(item.currentSize)}</span>
              </button>
            );
          })}
        </div>
      </section>
      <div
        className="python-memory-splitter"
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-valuemin={28}
        aria-valuemax={72}
        aria-valuenow={Math.round(listWidth)}
        onDoubleClick={() => setListWidth(58)}
        onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const { minimum, maximum } = limits();
          setListWidth(value => Math.max(minimum, Math.min(maximum, value + (event.key === 'ArrowLeft' ? -2 : 2))));
        }}
        onPointerDown={event => {
          resizing.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          resize(event.clientX);
        }}
        onPointerMove={event => {
          if (resizing.current) resize(event.clientX);
        }}
        onPointerUp={event => {
          resizing.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { resizing.current = false; }}
      />
      <section className="python-memory-trace" aria-label={t.pythonMemoryTraceback}>
        <header><h2>{t.pythonMemoryTraceback}</h2></header>
        {selected ? (
          <div className="python-memory-trace-content">
            <div className="python-memory-selected">
              <span className="codicon codicon-symbol-variable" />
              <div>
                <strong>{formatSignedBytes(selected.sizeDiff)}</strong>
                <small>{formatSignedInteger(selected.countDiff)} {t.pythonMemoryBlocks.toLowerCase()}</small>
              </div>
            </div>
            <dl className="python-memory-detail-metrics">
              <div><dt>{t.pythonMemoryRetained}</dt><dd>{formatBytes(selected.currentSize)}</dd></div>
              <div><dt>{t.pythonMemoryLiveBlocks}</dt><dd>{selected.currentCount}</dd></div>
            </dl>
            <ol className="python-memory-stack">
              {selected.traceback.map((frame, index) => (
                <li key={`${frame.file}:${frame.line}:${index}`}>
                  <button type="button" onClick={() => openFrame(selected, index)} title={t.pythonMemoryOpenSource}>
                    <span className="python-memory-frame-index">{index + 1}</span>
                    <span>
                      <strong>{shortFile(frame.file)}</strong>
                      <small title={formatLocation(frame.file, frame.line)}>{formatLocation(frame.file, frame.line)}</small>
                    </span>
                    <span className="codicon codicon-go-to-file" />
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="python-memory-detail-empty">{t.pythonMemorySelectAllocation}</div>
        )}
      </section>
    </div>
  );
});

function SummaryMetric({ label, value, tone = 0 }: { label: string; value: string; tone?: number }) {
  return <span><small>{label}</small><strong className={deltaTone(tone)}>{value}</strong></span>;
}

function statusText(state: PythonMemoryState | undefined, t: I18nText): string {
  if (state?.status === 'running') return t.pythonMemoryRunning;
  if (state?.status === 'collecting') return t.pythonMemoryCollecting;
  return t.pythonMemoryIdle;
}

function clampDepth(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(MAX_DEPTH, Math.round(value))) : DEFAULT_DEPTH;
}

function deltaTone(value: number): string {
  return value > 0 ? 'positive' : value < 0 ? 'negative' : '';
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

function formatDuration(seconds: number): string {
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
    : `${seconds.toFixed(1)} s`;
}

function shortFile(file: string): string {
  const normalized = file.replace(/\\/g, '/');
  return normalized.split('/').pop() || file;
}

function formatLocation(file: string, line: number): string {
  return line > 0 ? `${file}:${line}` : file;
}

function createRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
