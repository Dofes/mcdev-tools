import { useEffect, useRef, useState } from 'react';
import { I18nText } from '../../i18n';
import { HostBridgeSessionSummary } from '../../types';

interface SessionPickerProps {
  sessions: HostBridgeSessionSummary[];
  selectedId: string;
  onSelect(id: string): void;
  t: I18nText;
}

export function SessionPicker({ sessions, selectedId, onSelect, t }: SessionPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedIndex = Math.max(0, sessions.findIndex(session => session.id === selectedId));
  const selected = sessions[selectedIndex];

  useEffect(() => {
    if (!open) {
      return;
    }
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);

  useEffect(() => {
    setActiveIndex(selectedIndex);
  }, [selectedIndex]);

  const moveActive = (direction: 1 | -1) => {
    if (sessions.length === 0) {
      return;
    }
    setActiveIndex(current => (current + direction + sessions.length) % sessions.length);
  };

  const choose = (index: number) => {
    const session = sessions[index];
    if (session) {
      onSelect(session.id);
      setActiveIndex(index);
    }
    setOpen(false);
  };

  return (
    <div className={`session-picker${open ? ' open' : ''}`} ref={rootRef}>
      <span className="session-picker-label">{t.hostBridgeSession}</span>
      <button
        type="button"
        className="session-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="game-debugger-session-list"
        disabled={sessions.length === 0}
        onClick={() => setOpen(value => !value)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              setActiveIndex(selectedIndex);
            } else {
              moveActive(event.key === 'ArrowDown' ? 1 : -1);
            }
          } else if (event.key === 'Enter' && open) {
            event.preventDefault();
            choose(activeIndex);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      >
        <span className={`session-state-dot ${getSessionTone(selected)}`} />
        <span className="session-picker-current">
          {selected ? getSessionName(selected, t) : t.hostBridgeIdle}
        </span>
        {selected?.minecraftPid !== undefined && <code>PID {selected.minecraftPid}</code>}
        <span className="codicon codicon-chevron-down" />
      </button>

      {open && (
        <div id="game-debugger-session-list" className="session-picker-menu" role="listbox">
          {sessions.map((session, index) => (
            <button
              type="button"
              role="option"
              aria-selected={session.id === selectedId}
              className={`session-picker-option${index === activeIndex ? ' active' : ''}${session.id === selectedId ? ' selected' : ''}`}
              key={session.id}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              <span className={`session-state-dot ${getSessionTone(session)}`} />
              <span className="session-picker-option-text">
                <strong>{getSessionName(session, t)}</strong>
                <small>{getSessionDetail(session, t)}</small>
              </span>
              {session.id === selectedId && <span className="codicon codicon-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function getSessionName(session: HostBridgeSessionSummary, t: I18nText): string {
  const projectName = session.projectRoot.split(/[\\/]/).filter(Boolean).pop();
  return session.worldName || session.worldFolderName || projectName || t.hostBridgeSession;
}

function getSessionDetail(session: HostBridgeSessionSummary, t: I18nText): string {
  const state = getSessionStateLabel(session, t);
  return session.minecraftPid === undefined ? state : `${state} | PID ${session.minecraftPid}`;
}

function getSessionStateLabel(session: HostBridgeSessionSummary, t: I18nText): string {
  switch (session.state) {
    case 'starting':
      return t.hostBridgeStarting;
    case 'game_unavailable':
      return t.hostBridgeUnavailable;
    case 'exiting':
      return t.hostBridgeExiting;
    case 'exited':
      return t.hostBridgeExited;
    case 'game_ready':
      return session.connected ? t.hostBridgeReady : t.hostBridgeDisconnected;
    case 'process_started':
      return session.connected ? t.hostBridgeProcessStarted : t.hostBridgeDisconnected;
  }
}

function getSessionTone(session: HostBridgeSessionSummary | undefined): 'neutral' | 'warning' | 'success' | 'error' {
  if (!session) {
    return 'neutral';
  }
  if (session.state === 'exited') {
    return 'neutral';
  }
  if (session.state === 'starting' || session.state === 'exiting') {
    return 'warning';
  }
  if (!session.connected) {
    return 'error';
  }
  if (session.state === 'game_ready') {
    return 'success';
  }
  if (session.state === 'process_started' || session.state === 'game_unavailable') {
    return 'warning';
  }
  return 'neutral';
}
