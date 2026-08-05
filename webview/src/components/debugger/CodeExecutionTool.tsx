import { useEffect, useState } from 'react';
import { I18nText } from '../../i18n';
import { HostBridgeSessionSummary } from '../../types';
import { vscode } from '../../vscode';

interface CodeExecutionToolProps {
  session?: HostBridgeSessionSummary;
  t: I18nText;
}

interface ExecutionResult {
  id: string;
  sessionId: string;
  isClient: boolean;
  createdAt: number;
  pending: boolean;
  ok?: boolean;
  output?: string;
}

const MAX_RESULTS_PER_SESSION = 10;

export function CodeExecutionTool({ session, t }: CodeExecutionToolProps) {
  const [isClient, setIsClient] = useState(true);
  const [clientCode, setClientCode] = useState('');
  const [serverCode, setServerCode] = useState('');
  const [resultsBySession, setResultsBySession] = useState<Record<string, ExecutionResult[]>>({});

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message?.type !== 'hostBridgeExecutionResult' || typeof message.requestId !== 'string') {
        return;
      }
      if (typeof message.sessionId !== 'string') {
        return;
      }
      setResultsBySession(previous => {
        const sessionResults = previous[message.sessionId];
        if (!sessionResults?.some(result => result.id === message.requestId)) {
          return previous;
        }
        const output = message.ok
          ? formatResult(message.result)
          : formatExecutionError(message.error, t.hostBridgeRequestFailed);
        return {
          ...previous,
          [message.sessionId]: sessionResults.map(result => result.id === message.requestId
            ? { ...result, pending: false, ok: message.ok === true, output }
            : result),
        };
      });
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [t.hostBridgeRequestFailed]);

  const code = isClient ? clientCode : serverCode;
  const setCode = isClient ? setClientCode : setServerCode;
  const results = session ? resultsBySession[session.id] ?? [] : [];
  const requestPending = results.some(result => result.pending);
  const methodAvailable = session?.methods === undefined
    || session.methods.some(method => method.name === 'game/code/execute' && method.modes.includes('request'));
  const canExecute = Boolean(
    session?.connected
    && session.state === 'game_ready'
    && methodAvailable
    && code.trim()
    && !requestPending
  );

  const execute = () => {
    if (!canExecute || !session) {
      return;
    }
    const requestId = createRequestId();
    const pendingResult: ExecutionResult = {
      id: requestId,
      sessionId: session.id,
      isClient,
      createdAt: Date.now(),
      pending: true,
    };
    setResultsBySession(previous => ({
      ...previous,
      [session.id]: [pendingResult, ...(previous[session.id] ?? [])].slice(0, MAX_RESULTS_PER_SESSION),
    }));
    vscode.postMessage({
      type: 'hostBridgeExecute',
      requestId,
      sessionId: session.id,
      isClient,
      code,
    });
  };

  return (
    <div className="code-execution-grid">
      <div className="host-bridge-execution-pane">
        <div className="host-bridge-segmented" role="group" aria-label={t.hostBridgeTarget}>
          <button
            type="button"
            className={isClient ? 'active' : ''}
            onClick={() => setIsClient(true)}
            aria-pressed={isClient}
          >
            <span className="codicon codicon-device-desktop" />
            {t.hostBridgeClient}
          </button>
          <button
            type="button"
            className={!isClient ? 'active' : ''}
            onClick={() => setIsClient(false)}
            aria-pressed={!isClient}
          >
            <span className="codicon codicon-server" />
            {t.hostBridgeServer}
          </button>
        </div>

        <div className="host-bridge-editor">
          <label htmlFor="host-bridge-code">{t.hostBridgeCode}</label>
          <textarea
            id="host-bridge-code"
            value={code}
            onChange={event => setCode(event.target.value)}
            onKeyDown={event => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                execute();
              }
            }}
            spellCheck={false}
            placeholder={t.hostBridgeCodePlaceholder}
          />
          <div className="host-bridge-editor-actions">
            {!methodAvailable && <span className="host-bridge-method-unavailable">{t.hostBridgeMethodUnavailable}</span>}
            <button type="button" className="btn-primary" disabled={!canExecute} onClick={execute}>
              <span className={`codicon ${requestPending ? 'codicon-loading' : 'codicon-run'}`} />
              {t.hostBridgeExecute}
            </button>
          </div>
        </div>
      </div>

      <div className="host-bridge-output">
        <div className="host-bridge-output-header">
          <span>{t.hostBridgeResult}</span>
          <button
            type="button"
            className="btn-icon host-bridge-icon-button"
            onClick={() => {
              if (!session) {
                return;
              }
              setResultsBySession(previous => ({ ...previous, [session.id]: [] }));
            }}
            disabled={results.length === 0 || requestPending}
            title={t.hostBridgeClear}
            aria-label={t.hostBridgeClear}
          >
            <span className="codicon codicon-clear-all" />
          </button>
        </div>
        <div
          className={`host-bridge-output-body ${results.length > 0 ? 'has-results' : ''}`}
          aria-live="polite"
        >
          {results.length === 0 ? (
            <div className="host-bridge-output-empty">{t.hostBridgeNoResult}</div>
          ) : (
            results.map(result => (
              <div
                className={`host-bridge-output-entry ${result.pending ? 'pending' : result.ok ? 'success' : 'error'}`}
                key={result.id}
              >
                <div className="host-bridge-output-meta">
                  <span>{result.isClient ? t.hostBridgeClient : t.hostBridgeServer}</span>
                  <time>{new Date(result.createdAt).toLocaleTimeString()}</time>
                </div>
                <pre>{result.pending ? t.hostBridgeExecuting : result.output}</pre>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function createRequestId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function formatResult(value: unknown): string {
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else if (value === undefined) {
    text = 'null';
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  }
  const maxLength = 64 * 1024;
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...` : text;
}

function formatExecutionError(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') {
    return fallback;
  }
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === 'string' ? candidate.code : undefined;
  const message = typeof candidate.message === 'string' ? candidate.message : fallback;
  return code ? `[${code}] ${message}` : message;
}
