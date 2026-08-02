import { ReactNode, useEffect, useState } from 'react';
import { CodeExecutionTool } from './components/debugger/CodeExecutionTool';
import { SessionPicker } from './components/debugger/SessionPicker';
import { I18nText, i18n } from './i18n';
import { HostBridgeSessionSummary, HostBridgeSnapshot } from './types';
import { vscode } from './vscode';
import './DebugApp.css';

interface DebugToolContext {
  session?: HostBridgeSessionSummary;
  t: I18nText;
}

interface DebugToolDefinition {
  id: string;
  icon: string;
  label(t: I18nText): string;
  render(context: DebugToolContext): ReactNode;
}

const DEBUG_TOOLS: DebugToolDefinition[] = [
  {
    id: 'code-execution',
    icon: 'codicon-code',
    label: t => t.hostBridgeCodeTab,
    render: ({ session, t }) => <CodeExecutionTool session={session} t={t} />,
  },
];

const EMPTY_SNAPSHOT: HostBridgeSnapshot = { status: 'idle', sessions: [] };

function DebugApp() {
  const language = document.documentElement.lang.startsWith('zh') ? 'zh' : 'en';
  const t = i18n[language] || i18n.en;
  const [snapshot, setSnapshot] = useState<HostBridgeSnapshot>(EMPTY_SNAPSHOT);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [activeToolId, setActiveToolId] = useState(DEBUG_TOOLS[0].id);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'hostBridgeState' && event.data.snapshot) {
        setSnapshot(event.data.snapshot as HostBridgeSnapshot);
      }
    };
    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    setSelectedSessionId(previous => {
      if (snapshot.sessions.some(session => session.id === previous)) {
        return previous;
      }
      return snapshot.sessions.find(session => session.connected)?.id
        ?? snapshot.sessions[0]?.id
        ?? '';
    });
  }, [snapshot.sessions]);

  const selectedSession = snapshot.sessions.find(session => session.id === selectedSessionId);
  const activeTool = DEBUG_TOOLS.find(tool => tool.id === activeToolId) ?? DEBUG_TOOLS[0];
  const status = getStatus(selectedSession, snapshot, t);

  return (
    <main className="debug-workbench">
      <header className="debug-workbench-header">
        <div className="debug-workbench-title">
          <span className="codicon codicon-debug-console" />
          <h1>{t.hostBridgeTitle}</h1>
        </div>
        <div className="debug-session-controls">
          <SessionPicker
            sessions={snapshot.sessions}
            selectedId={selectedSessionId}
            onSelect={setSelectedSessionId}
            t={t}
          />
          <div className={`host-bridge-status ${status.tone}`} aria-live="polite">
            <span className="host-bridge-status-dot" />
            <span>{status.label}</span>
          </div>
          {snapshot.sessions.length > 0 && <span className="host-bridge-count">{snapshot.sessions.length}</span>}
          <button
            type="button"
            className="btn-icon host-bridge-icon-button"
            onClick={() => vscode.postMessage({ type: 'hostBridgeRefresh' })}
            title={t.hostBridgeRefresh}
            aria-label={t.hostBridgeRefresh}
          >
            <span className="codicon codicon-refresh" />
          </button>
        </div>
      </header>

      <div className="debug-workbench-body">
        <nav className="debug-tool-nav" aria-label={t.hostBridgeTitle}>
          {DEBUG_TOOLS.map(tool => (
            <button
              type="button"
              key={tool.id}
              className={tool.id === activeTool.id ? 'active' : ''}
              aria-current={tool.id === activeTool.id ? 'page' : undefined}
              onClick={() => setActiveToolId(tool.id)}
              title={tool.label(t)}
            >
              <span className={`codicon ${tool.icon}`} />
              <span>{tool.label(t)}</span>
            </button>
          ))}
        </nav>
        <section className="debug-tool-page" aria-label={activeTool.label(t)}>
          <header className="debug-tool-page-header">
            <span className={`codicon ${activeTool.icon}`} />
            <h2>{activeTool.label(t)}</h2>
          </header>
          <div className="debug-tool-page-content">
            {activeTool.render({ session: selectedSession, t })}
          </div>
        </section>
      </div>
    </main>
  );
}

function getStatus(
  session: HostBridgeSessionSummary | undefined,
  snapshot: HostBridgeSnapshot,
  t: I18nText
): { label: string; tone: 'neutral' | 'warning' | 'success' | 'error' } {
  if (!session) {
    if (snapshot.status === 'error') {
      return { label: snapshot.error || t.hostBridgeError, tone: 'error' };
    }
    return snapshot.status === 'listening'
      ? { label: t.hostBridgeWaiting, tone: 'neutral' }
      : { label: t.hostBridgeIdle, tone: 'neutral' };
  }
  if (session.state === 'starting') {
    return { label: t.hostBridgeStarting, tone: 'warning' };
  }
  switch (session.state) {
    case 'process_started':
      return session.connected
        ? { label: t.hostBridgeProcessStarted, tone: 'warning' }
        : { label: t.hostBridgeDisconnected, tone: 'error' };
    case 'game_ready':
      return session.connected
        ? { label: t.hostBridgeReady, tone: 'success' }
        : { label: t.hostBridgeDisconnected, tone: 'error' };
    case 'game_unavailable':
      return { label: t.hostBridgeUnavailable, tone: 'warning' };
    case 'exiting':
      return { label: t.hostBridgeExiting, tone: 'warning' };
    case 'exited':
      return { label: t.hostBridgeExited, tone: 'neutral' };
  }
}

export default DebugApp;
