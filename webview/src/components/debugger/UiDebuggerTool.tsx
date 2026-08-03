import { CSSProperties, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { I18nText } from '../../i18n';
import { HostBridgeSessionSummary } from '../../types';
import { vscode } from '../../vscode';

interface UiDebuggerToolProps {
  session?: HostBridgeSessionSummary;
  t: I18nText;
}

type UiPickerMode = 'off' | 'select' | 'layout';

interface UiNodeSummary {
  name: string;
  path: string;
  typeId: number;
  type: string;
  childCount?: number;
  index?: number;
}

interface UiNodeDetails extends UiNodeSummary {
  screen: string;
  visible?: boolean;
  childCount?: number;
  properties: Record<string, Record<string, unknown>>;
}

interface UiContextState {
  screens: string[];
  selectedScreen: string;
  screensLoading: boolean;
  children: Record<string, UiNodeSummary[]>;
  totals: Record<string, number>;
  expanded: Record<string, boolean>;
  loadingParents: Record<string, boolean>;
  selectedPath: string;
  details: Record<string, UiNodeDetails>;
  loadingDetails: Record<string, boolean>;
  visibilitySaving: Record<string, boolean>;
  nativeData: Record<string, Record<string, unknown>>;
  pickerMode: UiPickerMode;
  pickerBusy: boolean;
  error?: string;
}

interface PendingRequest {
  kind: 'screens' | 'children' | 'node' | 'visibility' | 'pickerMode' | 'pickerSelect' | 'reveal';
  contextKey: string;
  screen?: string;
  parentPath?: string;
  path?: string;
  mode?: UiPickerMode;
}

interface VisibleTreeRow {
  kind: 'node' | 'more';
  depth: number;
  node?: UiNodeSummary;
  parentPath?: string;
  offset?: number;
}

export function UiDebuggerTool({ session, t }: UiDebuggerToolProps) {
  const [contexts, setContexts] = useState<Record<string, UiContextState>>({});
  const [treePaneWidth, setTreePaneWidth] = useState(46);
  const pendingRequests = useRef(new Map<string, PendingRequest>());
  const pendingPickerEvents = useRef(new Map<string, unknown>());
  const pickerDetailTimers = useRef(new Map<string, number>());
  const activePickerContexts = useRef(new Set<string>());
  const pendingGameSelectionScroll = useRef<{
    contextKey: string;
    screen: string;
    path: string;
  }>();
  const treeRows = useRef(new Map<string, HTMLDivElement>());
  const debuggerLayout = useRef<HTMLDivElement>(null);
  const resizingTreePane = useRef(false);
  const contextKey = session ? `${session.id}:${session.connectionGeneration}` : '';
  const state = contexts[contextKey] ?? createContextState();
  const contextsRef = useRef(contexts);
  const sessionRef = useRef(session);
  contextsRef.current = contexts;
  sessionRef.current = session;
  const methodAvailable = session?.methods === undefined
    || session.methods.some(method => method.name === 'game/code/execute' && method.modes.includes('request'));
  const canQuery = Boolean(session?.connected && session.state === 'game_ready' && methodAvailable);

  useEffect(() => {
    if (!session || !contextKey) {
      return;
    }
    const sessionPrefix = `${session.id}:`;
    setContexts(previous => {
      const staleKeys = Object.keys(previous).filter(key => (
        key.startsWith(sessionPrefix) && key !== contextKey
      ));
      if (staleKeys.length === 0) {
        return previous;
      }
      const next = { ...previous };
      staleKeys.forEach(key => delete next[key]);
      return next;
    });
    for (const [id, request] of pendingRequests.current) {
      if (request.contextKey.startsWith(sessionPrefix) && request.contextKey !== contextKey) {
        pendingRequests.current.delete(id);
      }
    }
  }, [contextKey, session]);

  useEffect(() => {
    const scopedSession = session;
    return () => {
      if (!scopedSession || !contextKey || !activePickerContexts.current.has(contextKey)) {
        return;
      }
      activePickerContexts.current.delete(contextKey);
      const detailTimer = pickerDetailTimers.current.get(contextKey);
      if (detailTimer !== undefined) {
        window.clearTimeout(detailTimer);
        pickerDetailTimers.current.delete(contextKey);
      }
      requestPickerMode(scopedSession, contextKey, 'off', pendingRequests.current);
    };
  }, [contextKey]);

  useEffect(() => {
    const applyPickerEvent = (
      responseKey: string,
      rawEvent: unknown,
      screensOverride?: string[],
      allowScreenRefresh = true
    ) => {
      const current = contextsRef.current[responseKey];
      if (!current) {
        return;
      }
      const selection = findPickerSelection(
        rawEvent, screensOverride ?? current.screens
      );
      const activeSession = sessionRef.current;
      const activeForResponse = activeSession
        && responseKey === `${activeSession.id}:${activeSession.connectionGeneration}`;
      if (!selection?.screen) {
        if (!selection || !allowScreenRefresh) {
          pendingPickerEvents.current.delete(responseKey);
          return;
        }
        pendingPickerEvents.current.set(responseKey, rawEvent);
        if (
          activeForResponse
          && !hasPendingRequest(pendingRequests.current, responseKey, 'screens')
        ) {
          requestScreens(activeSession, responseKey, pendingRequests.current);
        }
        return;
      }
      pendingPickerEvents.current.delete(responseKey);
      const key = treeKey(selection.screen, selection.path);
      const nativeData = flattenNativeData(rawEvent, selection.screen, selection.path);
      pendingGameSelectionScroll.current = {
        contextKey: responseKey,
        screen: selection.screen,
        path: selection.path,
      };
      setContexts(previous => updateContext(previous, responseKey, value => ({
        ...value,
        selectedScreen: selection.screen!,
        selectedPath: selection.path,
        expanded: { ...value.expanded, ...expandedKeysForPath(selection.screen!, selection.path) },
        nativeData: Object.keys(nativeData).length > 0
          ? { ...value.nativeData, [key]: nativeData }
          : value.nativeData,
        error: undefined,
      })));
      if (!activeForResponse) {
        return;
      }
      const existingTimer = pickerDetailTimers.current.get(responseKey);
      if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
      }
      const selectedScreen = selection.screen;
      const selectedPath = selection.path;
      const timer = window.setTimeout(() => {
        pickerDetailTimers.current.delete(responseKey);
        const latestSession = sessionRef.current;
        const latest = contextsRef.current[responseKey];
        if (
          !latestSession
          || responseKey !== `${latestSession.id}:${latestSession.connectionGeneration}`
          || latest?.selectedScreen !== selectedScreen
          || latest.selectedPath !== selectedPath
        ) {
          return;
        }
        if (!hasPendingRequest(
          pendingRequests.current, responseKey, 'reveal', selectedScreen, selectedPath
        )) {
          requestReveal(
            latestSession, responseKey, selectedScreen, selectedPath, pendingRequests.current
          );
        }
        if (!hasPendingRequest(
          pendingRequests.current, responseKey, 'node', selectedScreen, selectedPath
        )) {
          requestNode(
            latestSession, responseKey, selectedScreen, selectedPath, pendingRequests.current
          );
        }
      }, 120);
      pickerDetailTimers.current.set(responseKey, timer);
    };

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (
        message?.type === 'uiDebuggerScreensEvent'
        && typeof message.sessionId === 'string'
        && Number.isInteger(message.connectionGeneration)
      ) {
        const responseKey = `${message.sessionId}:${message.connectionGeneration}`;
        if (!contextsRef.current[responseKey]) {
          return;
        }
        const screens = Array.isArray(message.screens)
          ? message.screens.filter((item: unknown): item is string => typeof item === 'string')
          : [];
        setContexts(previous => updateContext(
          previous, responseKey, current => updateScreens(current, screens)
        ));
        if (pendingPickerEvents.current.has(responseKey)) {
          applyPickerEvent(
            responseKey, pendingPickerEvents.current.get(responseKey), screens, false
          );
        }
        return;
      }
      if (
        (message?.type === 'uiDebuggerPickerEvent' || message?.type === 'uiDebuggerPickerStopped')
        && typeof message.sessionId === 'string'
        && Number.isInteger(message.connectionGeneration)
      ) {
        const responseKey = `${message.sessionId}:${message.connectionGeneration}`;
        if (!contextsRef.current[responseKey]) {
          return;
        }
        if (message.type === 'uiDebuggerPickerStopped') {
          activePickerContexts.current.delete(responseKey);
          const detailTimer = pickerDetailTimers.current.get(responseKey);
          if (detailTimer !== undefined) {
            window.clearTimeout(detailTimer);
            pickerDetailTimers.current.delete(responseKey);
          }
          setContexts(previous => updateContext(previous, responseKey, value => ({
            ...value,
            pickerMode: 'off',
            pickerBusy: false,
            error: typeof message.message === 'string' ? message.message : t.uiDebuggerRequestFailed,
          })));
          return;
        }
        applyPickerEvent(responseKey, message.event);
        return;
      }
      if (
        typeof message?.requestId !== 'string'
        || typeof message.type !== 'string'
        || !message.type.startsWith('uiDebugger')
      ) {
        return;
      }
      const pending = pendingRequests.current.get(message.requestId);
      if (!pending) {
        return;
      }
      pendingRequests.current.delete(message.requestId);
      if (`${message.sessionId}:${message.connectionGeneration}` !== pending.contextKey) {
        return;
      }

      const refreshedScreens = message.type === 'uiDebuggerScreensResult' && pending.kind === 'screens'
        ? (Array.isArray(message.screens)
          ? message.screens.filter((item: unknown): item is string => typeof item === 'string')
          : [])
        : undefined;
      setContexts(previous => {
        const current = previous[pending.contextKey] ?? createContextState();
        let next = current;
        if (message.type === 'uiDebuggerScreensResult' && pending.kind === 'screens') {
          const screens = refreshedScreens ?? [];
          next = updateScreens(current, screens);
        } else if (message.type === 'uiDebuggerChildrenResult' && pending.kind === 'children') {
          const screen = typeof message.screen === 'string' ? message.screen : pending.screen ?? '';
          const parentPath = typeof message.parentPath === 'string'
            ? message.parentPath
            : pending.parentPath ?? '';
          const key = treeKey(screen, parentPath);
          const incoming = Array.isArray(message.nodes) ? message.nodes as UiNodeSummary[] : [];
          const existing = current.children[key] ?? [];
          const nodes = deduplicateNodes([...existing, ...incoming]);
          const totals = { ...current.totals, [key]: Number(message.total) || nodes.length };
          for (const node of incoming) {
            if (Number.isInteger(node.childCount)) {
              totals[treeKey(screen, node.path)] = Number(node.childCount);
            }
          }
          next = {
            ...current,
            children: { ...current.children, [key]: nodes },
            totals,
            loadingParents: { ...current.loadingParents, [key]: false },
            error: undefined,
          };
        } else if (message.type === 'uiDebuggerNodeResult' && pending.kind === 'node' && message.node) {
          const node = message.node as UiNodeDetails;
          const key = treeKey(node.screen, node.path);
          next = {
            ...current,
            details: { ...current.details, [key]: node },
            loadingDetails: { ...current.loadingDetails, [key]: false },
            totals: Number.isInteger(node.childCount)
              ? { ...current.totals, [key]: Number(node.childCount) }
              : current.totals,
            error: undefined,
          };
        } else if (message.type === 'uiDebuggerVisibilityResult' && pending.kind === 'visibility') {
          const screen = typeof message.screen === 'string' ? message.screen : pending.screen ?? '';
          const path = typeof message.path === 'string' ? message.path : pending.path ?? '';
          const key = treeKey(screen, path);
          const details = current.details[key];
          next = {
            ...current,
            details: details ? {
              ...current.details,
              [key]: {
                ...details,
                visible: message.visible === true,
                properties: {
                  ...details.properties,
                  runtime: { ...details.properties.runtime, visible: message.visible === true },
                },
              },
            } : current.details,
            visibilitySaving: { ...current.visibilitySaving, [key]: false },
            error: undefined,
          };
        } else if (message.type === 'uiDebuggerPickerModeResult' && pending.kind === 'pickerMode') {
          const mode: UiPickerMode = message.mode === 'select' || message.mode === 'layout'
            ? message.mode
            : 'off';
          if (mode !== 'off') {
            activePickerContexts.current.add(pending.contextKey);
          } else {
            activePickerContexts.current.delete(pending.contextKey);
            const detailTimer = pickerDetailTimers.current.get(pending.contextKey);
            if (detailTimer !== undefined) {
              window.clearTimeout(detailTimer);
              pickerDetailTimers.current.delete(pending.contextKey);
            }
          }
          next = { ...current, pickerMode: mode, pickerBusy: false, error: undefined };
        } else if (message.type === 'uiDebuggerRevealResult' && pending.kind === 'reveal') {
          const children = { ...current.children };
          const totals = { ...current.totals };
          if (Array.isArray(message.pages)) {
            for (const page of message.pages) {
              if (!page || typeof page.parentPath !== 'string' || !Array.isArray(page.nodes)) {
                continue;
              }
              const key = treeKey(message.screen, page.parentPath);
              children[key] = deduplicateNodes([
                ...(children[key] ?? []),
                ...page.nodes as UiNodeSummary[],
              ]);
              totals[key] = Number(page.total) || children[key].length;
              for (const node of children[key]) {
                if (Number.isInteger(node.childCount)) {
                  totals[treeKey(message.screen, node.path)] = Number(node.childCount);
                }
              }
            }
          }
          const stillSelected = current.selectedScreen === message.screen
            && current.selectedPath === message.path;
          next = {
            ...current,
            expanded: stillSelected
              ? { ...current.expanded, ...expandedKeysForPath(message.screen, message.path) }
              : current.expanded,
            children,
            totals,
            error: undefined,
          };
        } else if (message.type === 'uiDebuggerPickerSelectResult' && pending.kind === 'pickerSelect') {
          next = { ...current, error: undefined };
        } else if (message.type === 'uiDebuggerError') {
          const loadingParents = { ...current.loadingParents };
          const loadingDetails = { ...current.loadingDetails };
          if (pending.kind === 'children') {
            loadingParents[treeKey(pending.screen ?? '', pending.parentPath ?? '')] = false;
          } else if (pending.kind === 'node') {
            loadingDetails[treeKey(pending.screen ?? '', pending.path ?? '')] = false;
          }
          const visibilitySaving = { ...current.visibilitySaving };
          if (pending.kind === 'visibility') {
            visibilitySaving[treeKey(pending.screen ?? '', pending.path ?? '')] = false;
          }
          if (pending.kind === 'pickerMode') {
            activePickerContexts.current.delete(pending.contextKey);
          }
          next = {
            ...current,
            screensLoading: pending.kind === 'screens' ? false : current.screensLoading,
            loadingParents,
            loadingDetails,
            visibilitySaving,
            pickerBusy: pending.kind === 'pickerMode' ? false : current.pickerBusy,
            pickerMode: pending.kind === 'pickerMode' ? 'off' : current.pickerMode,
            error: typeof message.message === 'string' ? message.message : t.uiDebuggerRequestFailed,
          };
        }
        return next === current ? previous : { ...previous, [pending.contextKey]: next };
      });
      if (refreshedScreens && pendingPickerEvents.current.has(pending.contextKey)) {
        const rawEvent = pendingPickerEvents.current.get(pending.contextKey);
        applyPickerEvent(pending.contextKey, rawEvent, refreshedScreens, false);
      } else if (message.type === 'uiDebuggerError' && pending.kind === 'screens') {
        pendingPickerEvents.current.delete(pending.contextKey);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [t.uiDebuggerRequestFailed]);

  useEffect(() => () => {
    for (const timer of pickerDetailTimers.current.values()) {
      window.clearTimeout(timer);
    }
    pickerDetailTimers.current.clear();
  }, []);

  useEffect(() => {
    if (
      !session || !canQuery || !contextKey || contexts[contextKey]
      || hasPendingRequest(pendingRequests.current, contextKey, 'screens')
    ) {
      return;
    }
    setContexts(previous => ({
      ...previous,
      [contextKey]: { ...createContextState(), screensLoading: true },
    }));
    requestScreens(session, contextKey, pendingRequests.current);
  }, [canQuery, contextKey, contexts, session]);

  useEffect(() => {
    if (!contextKey || canQuery || (state.pickerMode === 'off' && !state.pickerBusy)) {
      return;
    }
    activePickerContexts.current.delete(contextKey);
    const detailTimer = pickerDetailTimers.current.get(contextKey);
    if (detailTimer !== undefined) {
      window.clearTimeout(detailTimer);
      pickerDetailTimers.current.delete(contextKey);
    }
    setContexts(previous => updateContext(previous, contextKey, current => ({
      ...current, pickerMode: 'off', pickerBusy: false,
    })));
  }, [canQuery, contextKey, state.pickerBusy, state.pickerMode]);

  useEffect(() => {
    if (!session || !canQuery || !contextKey || state.pickerMode !== 'off') {
      return;
    }
    const timer = window.setInterval(() => {
      if (!hasPendingRequest(pendingRequests.current, contextKey, 'screens')) {
        requestScreens(session, contextKey, pendingRequests.current);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [canQuery, contextKey, session, state.pickerMode]);

  useEffect(() => {
    if (!session || !canQuery || !state.selectedScreen) {
      return;
    }
    const key = treeKey(state.selectedScreen, '');
    if (
      state.children[key] !== undefined
      || state.loadingParents[key]
      || hasPendingRequest(pendingRequests.current, contextKey, 'children', state.selectedScreen, '')
    ) {
      return;
    }
    setContexts(previous => updateContext(previous, contextKey, current => ({
      ...current,
      loadingParents: { ...current.loadingParents, [key]: true },
    })));
    requestChildren(session, contextKey, state.selectedScreen, '', 0, pendingRequests.current);
  }, [canQuery, contextKey, session, state.children, state.loadingParents, state.selectedScreen]);

  const selectedDetailKey = treeKey(state.selectedScreen, state.selectedPath);
  const selectedDetails = state.details[selectedDetailKey];
  const selectedNativeData = state.nativeData[selectedDetailKey];
  const visibleRows = useMemo(
    () => buildVisibleRows(state, state.selectedScreen),
    [state, state.selectedScreen]
  );

  useEffect(() => {
    const target = pendingGameSelectionScroll.current;
    if (
      !target
      || target.contextKey !== contextKey
      || target.screen !== state.selectedScreen
      || target.path !== state.selectedPath
    ) {
      return;
    }
    const row = treeRows.current.get(treeKey(target.screen, target.path));
    if (!row) {
      return;
    }
    pendingGameSelectionScroll.current = undefined;
    row.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }, [contextKey, state.selectedPath, state.selectedScreen, visibleRows]);

  const refresh = () => {
    if (!session || !canQuery) {
      return;
    }
    for (const [id, request] of pendingRequests.current) {
      if (
        request.contextKey === contextKey
        && request.kind !== 'pickerMode'
        && request.kind !== 'pickerSelect'
      ) {
        pendingRequests.current.delete(id);
      }
    }
    setContexts(previous => updateContext(previous, contextKey, current => ({
      ...createContextState(),
      screensLoading: true,
      pickerMode: current.pickerMode,
      pickerBusy: current.pickerBusy,
    })));
    requestScreens(session, contextKey, pendingRequests.current);
  };

  const selectScreen = (screen: string) => {
    setContexts(previous => updateContext(previous, contextKey, current => ({
      ...current, selectedScreen: screen, selectedPath: '', error: undefined,
    })));
  };

  const toggleNode = (node: UiNodeSummary) => {
    if (!session || !canQuery) {
      return;
    }
    const key = treeKey(state.selectedScreen, node.path);
    const expanded = !state.expanded[key];
    setContexts(previous => updateContext(previous, contextKey, current => ({
      ...current,
      expanded: { ...current.expanded, [key]: expanded },
      loadingParents: expanded && current.children[key] === undefined
        ? { ...current.loadingParents, [key]: true }
        : current.loadingParents,
    })));
    if (
      expanded
      && state.children[key] === undefined
      && !state.loadingParents[key]
      && !hasPendingRequest(
        pendingRequests.current, contextKey, 'children', state.selectedScreen, node.path
      )
    ) {
      requestChildren(session, contextKey, state.selectedScreen, node.path, 0, pendingRequests.current);
    }
  };

  const selectNode = (node: UiNodeSummary) => {
    const key = treeKey(state.selectedScreen, node.path);
    setContexts(previous => updateContext(previous, contextKey, current => ({
      ...current,
      selectedPath: node.path,
      loadingDetails: current.details[key] === undefined
        ? { ...current.loadingDetails, [key]: true }
        : current.loadingDetails,
    })));
    if (
      session
      && canQuery
      && state.details[key] === undefined
      && !state.loadingDetails[key]
      && !hasPendingRequest(
        pendingRequests.current, contextKey, 'node', state.selectedScreen, node.path
      )
    ) {
      requestNode(session, contextKey, state.selectedScreen, node.path, pendingRequests.current);
    }
    if (
      session
      && state.pickerMode !== 'off'
      && !state.pickerBusy
      && !hasPendingRequest(
        pendingRequests.current, contextKey, 'pickerSelect', state.selectedScreen, node.path
      )
    ) {
      requestPickerSelect(
        session, contextKey, state.selectedScreen, node.path, pendingRequests.current
      );
    }
  };

  const setVisibility = (visible: boolean) => {
    if (!session || !selectedDetails || state.visibilitySaving[selectedDetailKey]) {
      return;
    }
    setContexts(previous => updateContext(previous, contextKey, current => ({
      ...current,
      visibilitySaving: { ...current.visibilitySaving, [selectedDetailKey]: true },
    })));
    requestVisibility(
      session, contextKey, selectedDetails.screen, selectedDetails.path, visible,
      pendingRequests.current
    );
  };

  const setPickerMode = (mode: UiPickerMode) => {
    if (!session || state.pickerBusy || mode === state.pickerMode) {
      return;
    }
    if (mode !== 'off') {
      activePickerContexts.current.add(contextKey);
    } else {
      activePickerContexts.current.delete(contextKey);
      const detailTimer = pickerDetailTimers.current.get(contextKey);
      if (detailTimer !== undefined) {
        window.clearTimeout(detailTimer);
        pickerDetailTimers.current.delete(contextKey);
      }
    }
    setContexts(previous => updateContext(previous, contextKey, current => ({
      ...current, pickerBusy: true, error: undefined,
    })));
    requestPickerMode(session, contextKey, mode, pendingRequests.current);
  };

  const loadMore = (parentPath: string, offset: number) => {
    if (!session || !canQuery) {
      return;
    }
    const key = treeKey(state.selectedScreen, parentPath);
    if (state.loadingParents[key]) {
      return;
    }
    setContexts(previous => updateContext(previous, contextKey, current => ({
      ...current,
      loadingParents: { ...current.loadingParents, [key]: true },
    })));
    requestChildren(session, contextKey, state.selectedScreen, parentPath, offset, pendingRequests.current);
  };

  const resizeTreePane = (clientX: number) => {
    const bounds = debuggerLayout.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) {
      return;
    }
    const minimum = Math.min(42, (260 / bounds.width) * 100);
    const next = ((clientX - bounds.left) / bounds.width) * 100;
    setTreePaneWidth(Math.max(minimum, Math.min(100 - minimum, next)));
  };

  if (!session || !canQuery) {
    return (
      <div className="ui-debugger-empty-page">
        <span className="codicon codicon-inspect" />
        <strong>{t.uiDebuggerUnavailable}</strong>
        <span>{methodAvailable ? t.hostBridgeUnavailable : t.hostBridgeMethodUnavailable}</span>
      </div>
    );
  }

  return (
    <div className="ui-debugger-workspace">
      <div className="ui-debugger-toolbar">
        <ScreenPicker
          screens={state.screens}
          selected={state.selectedScreen}
          loading={state.screensLoading}
          onSelect={selectScreen}
          t={t}
        />
        <div className="ui-debugger-toolbar-meta">
          <div
            className={`ui-debugger-picker-modes ${state.pickerBusy ? 'busy' : ''}`}
            role="group"
            aria-label={t.uiDebuggerPickerMode}
          >
            <PickerModeButton
              mode="off"
              currentMode={state.pickerMode}
              icon="codicon-eye-closed"
              label={t.uiDebuggerPickerOff}
              hint={t.uiDebuggerPickerOffHint}
              disabled={state.pickerBusy}
              onSelect={setPickerMode}
            />
            <PickerModeButton
              mode="select"
              currentMode={state.pickerMode}
              icon="codicon-target"
              label={t.uiDebuggerPickerSelect}
              hint={t.uiDebuggerPickerSelectHint}
              disabled={state.pickerBusy}
              onSelect={setPickerMode}
            />
            <PickerModeButton
              mode="layout"
              currentMode={state.pickerMode}
              icon="codicon-layers"
              label={t.uiDebuggerPickerLayout}
              hint={t.uiDebuggerPickerLayoutHint}
              disabled={state.pickerBusy}
              onSelect={setPickerMode}
            />
          </div>
          {state.selectedScreen && (
            <span>{visibleRows.filter(row => row.kind === 'node').length} {t.uiDebuggerLoadedNodes}</span>
          )}
          <button
            type="button"
            className="btn-icon host-bridge-icon-button"
            onClick={refresh}
            disabled={state.screensLoading || state.pickerBusy}
            title={t.uiDebuggerRefresh}
            aria-label={t.uiDebuggerRefresh}
          >
            <span className={`codicon ${state.screensLoading ? 'codicon-loading' : 'codicon-refresh'}`} />
          </button>
        </div>
      </div>

      {state.error && <div className="ui-debugger-error" role="alert">{state.error}</div>}

      <div
        className="ui-debugger-layout"
        ref={debuggerLayout}
        style={{ '--ui-debugger-tree-width': `${treePaneWidth}%` } as CSSProperties}
      >
        <section className="ui-debugger-tree-pane" aria-label={t.uiDebuggerTree}>
          <div className="ui-debugger-pane-title">
            <span className="codicon codicon-list-tree" />
            <span>{t.uiDebuggerTree}</span>
          </div>
          <div className="ui-debugger-tree" role="tree">
            {!state.selectedScreen ? (
              <div className="ui-debugger-pane-empty">{t.uiDebuggerNoScreens}</div>
            ) : state.loadingParents[treeKey(state.selectedScreen, '')] && visibleRows.length === 0 ? (
              <div className="ui-debugger-pane-empty loading">
                <span className="codicon codicon-loading" /> {t.uiDebuggerLoading}
              </div>
            ) : visibleRows.length === 0 ? (
              <div className="ui-debugger-pane-empty">{t.uiDebuggerNoNodes}</div>
            ) : (
              visibleRows.map(row => row.kind === 'node' && row.node ? (
                <UiTreeRow
                  key={row.node.path}
                  node={row.node}
                  depth={row.depth}
                  selected={state.selectedPath === row.node.path}
                  expanded={Boolean(state.expanded[treeKey(state.selectedScreen, row.node.path)])}
                  loading={Boolean(state.loadingParents[treeKey(state.selectedScreen, row.node.path)])}
                  knownLeaf={row.node.childCount === 0
                    || state.totals[treeKey(state.selectedScreen, row.node.path)] === 0}
                  rowRef={element => {
                    const key = treeKey(state.selectedScreen, row.node!.path);
                    if (element) {
                      treeRows.current.set(key, element);
                    } else {
                      treeRows.current.delete(key);
                    }
                  }}
                  onToggle={() => toggleNode(row.node!)}
                  onSelect={() => selectNode(row.node!)}
                />
              ) : (
                <button
                  type="button"
                  className="ui-debugger-load-more"
                  style={{ paddingLeft: `${row.depth * 14 + 24}px` }}
                  key={`more:${row.parentPath}:${row.offset}`}
                  onClick={() => loadMore(row.parentPath ?? '', row.offset ?? 0)}
                >
                  <span className="codicon codicon-add" />
                  {t.uiDebuggerLoadMore}
                </button>
              ))
            )}
          </div>
        </section>

        <div
          className="ui-debugger-splitter"
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-valuemin={24}
          aria-valuemax={76}
          aria-valuenow={Math.round(treePaneWidth)}
          onDoubleClick={() => setTreePaneWidth(46)}
          onKeyDown={event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
              return;
            }
            event.preventDefault();
            setTreePaneWidth(value => Math.max(24, Math.min(76, value + (event.key === 'ArrowLeft' ? -2 : 2))));
          }}
          onPointerDown={event => {
            resizingTreePane.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            resizeTreePane(event.clientX);
          }}
          onPointerMove={event => {
            if (resizingTreePane.current) {
              resizeTreePane(event.clientX);
            }
          }}
          onPointerUp={event => {
            resizingTreePane.current = false;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            resizingTreePane.current = false;
          }}
        />

        <section className="ui-debugger-details-pane" aria-label={t.uiDebuggerDetails}>
          <div className="ui-debugger-pane-title">
            <span className="codicon codicon-symbol-property" />
            <span>{t.uiDebuggerDetails}</span>
          </div>
          {!state.selectedPath ? (
            <div className="ui-debugger-pane-empty">{t.uiDebuggerSelectNode}</div>
          ) : state.loadingDetails[selectedDetailKey] && !selectedDetails ? (
            <div className="ui-debugger-pane-empty loading">
              <span className="codicon codicon-loading" /> {t.uiDebuggerLoading}
            </div>
          ) : selectedDetails ? (
            <NodeDetailsView
              node={selectedDetails}
              nativeData={selectedNativeData}
              visibilitySaving={Boolean(state.visibilitySaving[selectedDetailKey])}
              onVisibilityChange={setVisibility}
              t={t}
            />
          ) : (
            <div className="ui-debugger-pane-empty">{t.uiDebuggerRequestFailed}</div>
          )}
        </section>
      </div>
    </div>
  );
}

function PickerModeButton({
  mode, currentMode, icon, label, hint, disabled, onSelect,
}: {
  mode: UiPickerMode;
  currentMode: UiPickerMode;
  icon: string;
  label: string;
  hint: string;
  disabled: boolean;
  onSelect(mode: UiPickerMode): void;
}) {
  const active = mode === currentMode;
  return (
    <button
      type="button"
      className={`${mode} ${active ? 'active' : ''}`}
      onClick={() => onSelect(mode)}
      disabled={disabled}
      aria-pressed={active}
      title={hint}
    >
      <span className={`codicon ${icon}`} />
      <span>{label}</span>
    </button>
  );
}

function ScreenPicker({
  screens, selected, loading, onSelect, t,
}: {
  screens: string[];
  selected: string;
  loading: boolean;
  onSelect(screen: string): void;
  t: I18nText;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className={`ui-screen-picker ${open ? 'open' : ''}`} ref={root}>
      <span className="ui-screen-picker-label">{t.uiDebuggerScreen}</span>
      <button
        type="button"
        className="ui-screen-picker-trigger"
        onClick={() => setOpen(previous => !previous)}
        disabled={loading || screens.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`codicon ${loading ? 'codicon-loading' : 'codicon-window'}`} />
        <span>{loading ? t.uiDebuggerLoading : selected || t.uiDebuggerNoScreens}</span>
        <span className="codicon codicon-chevron-down" />
      </button>
      {open && (
        <div className="ui-screen-picker-menu" role="listbox">
          {screens.map(screen => (
            <button
              type="button"
              role="option"
              aria-selected={screen === selected}
              className={screen === selected ? 'selected' : ''}
              key={screen}
              onClick={() => {
                onSelect(screen);
                setOpen(false);
              }}
            >
              <span className="codicon codicon-window" />
              <span>{screen}</span>
              {screen === selected && <span className="codicon codicon-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UiTreeRow({
  node, depth, selected, expanded, loading, knownLeaf, rowRef, onToggle, onSelect,
}: {
  node: UiNodeSummary;
  depth: number;
  selected: boolean;
  expanded: boolean;
  loading: boolean;
  knownLeaf: boolean;
  rowRef(element: HTMLDivElement | null): void;
  onToggle(): void;
  onSelect(): void;
}) {
  return (
    <div
      ref={rowRef}
      className={`ui-debugger-tree-row ${selected ? 'selected' : ''}`}
      style={{ paddingLeft: `${depth * 14 + 4}px` }}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={knownLeaf ? undefined : expanded}
    >
      <button
        type="button"
        className="ui-debugger-tree-toggle"
        onClick={onToggle}
        disabled={knownLeaf || loading}
        aria-label={node.name}
      >
        {!knownLeaf && (
          <span className={`codicon ${loading ? 'codicon-loading' : expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} />
        )}
      </button>
      <button type="button" className="ui-debugger-tree-node" onClick={onSelect}>
        <span className={`ui-node-type-icon type-${node.typeId}`} />
        <span className="ui-debugger-node-name">{node.name}</span>
        <span className="ui-debugger-node-type">{node.type}</span>
      </button>
    </div>
  );
}

function NodeDetailsView({
  node, nativeData, visibilitySaving, onVisibilityChange, t,
}: {
  node: UiNodeDetails;
  nativeData?: Record<string, unknown>;
  visibilitySaving: boolean;
  onVisibilityChange(visible: boolean): void;
  t: I18nText;
}) {
  const propertyGroups = [
    { key: 'runtime', title: t.uiDebuggerRuntime, values: node.properties.runtime },
    { key: 'layout', title: t.uiDebuggerLayout, values: node.properties.layout },
    { key: 'text', title: t.uiDebuggerTextProperties, values: node.properties.text },
    { key: 'control', title: t.uiDebuggerControlState, values: node.properties.control },
    { key: 'native', title: t.uiDebuggerNativeData, values: nativeData ?? {} },
  ].filter(group => Object.keys(group.values).length > 0);

  return (
    <div className="ui-node-details">
      <header className="ui-node-details-header">
        <div>
          <strong>{node.name}</strong>
          <span>{node.type}</span>
        </div>
        <label className={`ui-node-visibility-toggle ${node.visible ? 'visible' : 'hidden'}`}>
          <input
            type="checkbox"
            checked={node.visible === true}
            disabled={visibilitySaving || node.visible === undefined}
            onChange={event => onVisibilityChange(event.target.checked)}
          />
          <span className={`codicon ${visibilitySaving ? 'codicon-loading' : node.visible ? 'codicon-eye' : 'codicon-eye-closed'}`} />
          <span>{node.visible ? t.uiDebuggerVisible : t.uiDebuggerHidden}</span>
        </label>
      </header>
      <div className="ui-node-path-row">
        <code title={node.path}>{node.path}</code>
        <button
          type="button"
          className="btn-icon host-bridge-icon-button"
          onClick={() => void navigator.clipboard.writeText(node.path)}
          title={t.uiDebuggerCopyPath}
          aria-label={t.uiDebuggerCopyPath}
        >
          <span className="codicon codicon-copy" />
        </button>
      </div>
      {propertyGroups.map(group => (
        <PropertySection title={group.title} key={group.key}>
          {Object.entries(group.values).map(([key, value]) => (
            <PropertyRow
              label={getPropertyLabel(key)}
              value={value}
              wide={typeof value === 'object' && value !== null}
              key={key}
            />
          ))}
        </PropertySection>
      ))}
    </div>
  );
}

function PropertySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ui-node-property-section">
      <h3>{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

function PropertyRow({ label, value, wide = false }: { label: string; value: unknown; wide?: boolean }) {
  return (
    <div className={wide ? 'wide' : ''}>
      <dt>{label}</dt>
      <dd>{formatValue(value)}</dd>
    </div>
  );
}

function createContextState(): UiContextState {
  return {
    screens: [], selectedScreen: '', screensLoading: false, children: {}, totals: {}, expanded: {},
    loadingParents: {}, selectedPath: '', details: {}, loadingDetails: {}, visibilitySaving: {},
    nativeData: {}, pickerMode: 'off', pickerBusy: false,
  };
}

function updateContext(
  contexts: Record<string, UiContextState>,
  key: string,
  update: (current: UiContextState) => UiContextState
): Record<string, UiContextState> {
  const current = contexts[key] ?? createContextState();
  const next = update(current);
  return next === current ? contexts : { ...contexts, [key]: next };
}

function updateScreens(current: UiContextState, screens: string[]): UiContextState {
  const normalized = Array.from(new Set(screens));
  const unchanged = normalized.length === current.screens.length
    && normalized.every((screen, index) => screen === current.screens[index]);
  if (unchanged && !current.screensLoading && !current.error) {
    return current;
  }
  const available = new Set(normalized);
  const addedScreens = normalized.filter(screen => !current.screens.includes(screen));
  const selectedScreen = addedScreens[addedScreens.length - 1]
    ?? (available.has(current.selectedScreen)
      ? current.selectedScreen
      : normalized[normalized.length - 1] ?? '');
  if (unchanged) {
    return { ...current, screensLoading: false, error: undefined };
  }
  const filter = <T,>(record: Record<string, T>): Record<string, T> => Object.fromEntries(
    Object.entries(record).filter(([key]) => {
      try {
        const parsed = JSON.parse(key);
        return Array.isArray(parsed) && typeof parsed[0] === 'string' && available.has(parsed[0]);
      } catch {
        return false;
      }
    })
  );
  return {
    ...current,
    screens: normalized,
    selectedScreen,
    selectedPath: selectedScreen === current.selectedScreen ? current.selectedPath : '',
    children: filter(current.children),
    totals: filter(current.totals),
    expanded: filter(current.expanded),
    loadingParents: filter(current.loadingParents),
    details: filter(current.details),
    loadingDetails: filter(current.loadingDetails),
    visibilitySaving: filter(current.visibilitySaving),
    nativeData: filter(current.nativeData),
    screensLoading: false,
    error: undefined,
  };
}

function requestScreens(
  session: HostBridgeSessionSummary,
  contextKey: string,
  pending: Map<string, PendingRequest>
) {
  const requestId = createRequestId();
  pending.set(requestId, { kind: 'screens', contextKey });
  vscode.postMessage({
    type: 'uiDebuggerScreens', requestId, sessionId: session.id,
    connectionGeneration: session.connectionGeneration,
  });
}

function requestChildren(
  session: HostBridgeSessionSummary,
  contextKey: string,
  screen: string,
  parentPath: string,
  offset: number,
  pending: Map<string, PendingRequest>
) {
  const requestId = createRequestId();
  pending.set(requestId, { kind: 'children', contextKey, screen, parentPath });
  vscode.postMessage({
    type: 'uiDebuggerChildren', requestId, sessionId: session.id,
    connectionGeneration: session.connectionGeneration, screen, parentPath, offset,
  });
}

function requestNode(
  session: HostBridgeSessionSummary,
  contextKey: string,
  screen: string,
  path: string,
  pending: Map<string, PendingRequest>
) {
  const requestId = createRequestId();
  pending.set(requestId, { kind: 'node', contextKey, screen, path });
  vscode.postMessage({
    type: 'uiDebuggerNode', requestId, sessionId: session.id,
    connectionGeneration: session.connectionGeneration, screen, path,
  });
}

function requestVisibility(
  session: HostBridgeSessionSummary,
  contextKey: string,
  screen: string,
  path: string,
  visible: boolean,
  pending: Map<string, PendingRequest>
) {
  const requestId = createRequestId();
  pending.set(requestId, { kind: 'visibility', contextKey, screen, path });
  vscode.postMessage({
    type: 'uiDebuggerSetVisibility', requestId, sessionId: session.id,
    connectionGeneration: session.connectionGeneration, screen, path, visible,
  });
}

function requestPickerMode(
  session: HostBridgeSessionSummary,
  contextKey: string,
  mode: UiPickerMode,
  pending: Map<string, PendingRequest>
) {
  const requestId = createRequestId();
  pending.set(requestId, { kind: 'pickerMode', contextKey, mode });
  vscode.postMessage({
    type: 'uiDebuggerPickerMode', requestId, sessionId: session.id,
    connectionGeneration: session.connectionGeneration, mode,
  });
}

function requestPickerSelect(
  session: HostBridgeSessionSummary,
  contextKey: string,
  screen: string,
  path: string,
  pending: Map<string, PendingRequest>
) {
  const requestId = createRequestId();
  pending.set(requestId, { kind: 'pickerSelect', contextKey, screen, path });
  vscode.postMessage({
    type: 'uiDebuggerPickerSelect', requestId, sessionId: session.id,
    connectionGeneration: session.connectionGeneration, screen, path,
  });
}

function requestReveal(
  session: HostBridgeSessionSummary,
  contextKey: string,
  screen: string,
  path: string,
  pending: Map<string, PendingRequest>
) {
  const requestId = createRequestId();
  pending.set(requestId, { kind: 'reveal', contextKey, screen, path });
  vscode.postMessage({
    type: 'uiDebuggerReveal', requestId, sessionId: session.id,
    connectionGeneration: session.connectionGeneration, screen, path,
  });
}

function buildVisibleRows(state: UiContextState, screen: string): VisibleTreeRow[] {
  if (!screen) {
    return [];
  }
  const rows: VisibleTreeRow[] = [];
  const appendChildren = (parentPath: string, depth: number) => {
    const key = treeKey(screen, parentPath);
    const children = state.children[key] ?? [];
    for (const node of children) {
      rows.push({ kind: 'node', depth, node });
      if (state.expanded[treeKey(screen, node.path)]) {
        appendChildren(node.path, depth + 1);
      }
    }
    const total = state.totals[key] ?? children.length;
    const nextOffset = getNextChildrenOffset(children, total);
    if (nextOffset !== undefined) {
      rows.push({ kind: 'more', depth, parentPath, offset: nextOffset });
    }
  };
  appendChildren('', 0);
  return rows;
}

function deduplicateNodes(nodes: UiNodeSummary[]): UiNodeSummary[] {
  return Array.from(new Map(nodes.map(node => [node.path, node])).values()).sort((left, right) => (
    (left.index ?? Number.MAX_SAFE_INTEGER) - (right.index ?? Number.MAX_SAFE_INTEGER)
  ));
}

function getNextChildrenOffset(nodes: UiNodeSummary[], total: number): number | undefined {
  let expected = 0;
  const indices = nodes.flatMap(node => Number.isInteger(node.index) ? [node.index as number] : [])
    .sort((left, right) => left - right);
  for (const index of indices) {
    if (index > expected) {
      break;
    }
    if (index === expected) {
      expected += 1;
    }
  }
  if (expected === 0 && nodes.length > 0 && nodes.every(node => node.index === undefined)) {
    expected = nodes.length;
  }
  return expected < total ? expected : undefined;
}

function hasPendingRequest(
  pending: Map<string, PendingRequest>,
  contextKey: string,
  kind: PendingRequest['kind'],
  screen?: string,
  path?: string
): boolean {
  for (const request of pending.values()) {
    if (request.contextKey !== contextKey || request.kind !== kind) {
      continue;
    }
    if (screen === undefined) {
      return true;
    }
    if (request.screen === screen && (request.parentPath ?? request.path ?? '') === (path ?? '')) {
      return true;
    }
  }
  return false;
}

function treeKey(screen: string, path: string): string {
  return JSON.stringify([screen, path]);
}

function expandedKeysForPath(screen: string, path: string): Record<string, boolean> {
  const segments = path.split('/').filter(Boolean);
  const expanded: Record<string, boolean> = {};
  for (let index = 1; index < segments.length; index += 1) {
    expanded[treeKey(screen, `/${segments.slice(0, index).join('/')}`)] = true;
  }
  return expanded;
}

function findPickerSelection(
  rawEvent: unknown,
  screens: string[]
): { screen?: string; path: string } | undefined {
  const event = parsePossibleJson(rawEvent);
  const candidates: Array<{ value: string; score: number }> = [];
  const addCandidate = (value: string, score: number) => {
    if (value.startsWith('/') && value.length <= 4096 && !value.includes('\0')) {
      candidates.push({ value, score });
    }
  };
  const visit = (value: unknown, key: string, depth: number) => {
    if (depth > 8 || candidates.length >= 256) {
      return;
    }
    if (typeof value === 'string' && value.startsWith('/')) {
      const normalizedKey = key.toLowerCase();
      const score = normalizedKey.includes('path') || normalizedKey.includes('control') ? 2 : 1;
      addCandidate(value, score);
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 128).forEach(item => visit(item, key, depth + 1));
    } else if (value && typeof value === 'object') {
      Object.entries(value as Record<string, unknown>).slice(0, 128).forEach(([childKey, item]) => {
        addCandidate(childKey, 4);
        visit(item, childKey, depth + 1);
      });
    }
  };
  visit(event, '', 0);
  candidates.sort((left, right) => right.score - left.score || right.value.length - left.value.length);

  for (const candidate of candidates) {
    const segments = candidate.value.split('/').filter(Boolean);
    if (segments.length < 2) {
      continue;
    }
    const screen = screens.find(item => item === segments[0] || item.endsWith(`.${segments[0]}`));
    if (screen) {
      return {
        screen,
        path: `/${segments.slice(1).join('/')}`,
      };
    }
  }
  const unknown = candidates.find(candidate => candidate.value.split('/').filter(Boolean).length >= 2);
  if (!unknown) {
    return undefined;
  }
  const segments = unknown.value.split('/').filter(Boolean);
  return {
    path: `/${segments.slice(1).join('/')}`,
  };
}

function flattenNativeData(
  rawEvent: unknown,
  screen: string,
  selectedPath: string
): Record<string, unknown> {
  const event = parsePossibleJson(rawEvent);
  const flattened: Record<string, unknown> = {};
  const visit = (value: unknown, path: string, depth: number) => {
    if (depth > 6 || Object.keys(flattened).length >= 80) {
      return;
    }
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      if (path) {
        flattened[path] = value;
      }
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 32).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
    } else if (value && typeof value === 'object') {
      Object.entries(value as Record<string, unknown>).slice(0, 80).forEach(([key, item]) => (
        visit(item, path ? `${path}.${key}` : key, depth + 1)
      ));
    }
  };
  visit(event, '', 0);
  return compactNativeDataKeys(flattened, screen, selectedPath);
}

function compactNativeDataKeys(
  flattened: Record<string, unknown>,
  screen: string,
  selectedPath: string
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const screenRoot = screen.split('.').pop() || screen;
  const nudPath = `/${screenRoot}${selectedPath.startsWith('/') ? selectedPath : `/${selectedPath}`}`;
  for (const [originalKey, value] of Object.entries(flattened)) {
    let key = originalKey.replace(/^(?:(?:data|result|controlData)\.)+/i, '');
    const controlPath = [nudPath, selectedPath]
      .filter(Boolean)
      .sort((left, right) => right.length - left.length)
      .find(path => key.includes(path));
    if (controlPath) {
      key = key.slice(key.indexOf(controlPath) + controlPath.length).replace(/^\./, '');
    } else {
      key = key.replace(/^\/[^.]+\./, '');
    }
    const propertyBag = key.lastIndexOf('propertyBag.');
    if (propertyBag >= 0) {
      key = key.slice(propertyBag + 'propertyBag.'.length);
    }
    key = key.replace(/^(?:(?:data|properties|propertyBag)\.)+/i, '') || 'value';
    let uniqueKey = key;
    let suffix = 2;
    while (Object.prototype.hasOwnProperty.call(result, uniqueKey)) {
      uniqueKey = `${key} (${suffix})`;
      suffix += 1;
    }
    result[uniqueKey] = value;
  }
  return result;
}

function parsePossibleJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const PROPERTY_LABELS: Record<string, { en: string; zh: string }> = {
  visible: { en: 'Visible', zh: '可见性' },
  size: { en: 'Size', zh: '尺寸' },
  position: { en: 'Position', zh: '相对位置' },
  globalPosition: { en: 'Global position', zh: '全局位置' },
  layer: { en: 'Layer', zh: '层级' },
  order: { en: 'Order', zh: '顺序' },
  directChildren: { en: 'Direct children', zh: '直接子节点' },
  minSize: { en: 'Minimum size', zh: '最小尺寸' },
  maxSize: { en: 'Maximum size', zh: '最大尺寸' },
  clipsChildren: { en: 'Clip children', zh: '裁剪子节点' },
  sizeX: { en: 'Width expression', zh: '宽度表达式' },
  sizeY: { en: 'Height expression', zh: '高度表达式' },
  positionX: { en: 'X expression', zh: 'X 位置表达式' },
  positionY: { en: 'Y expression', zh: 'Y 位置表达式' },
  anchorFrom: { en: 'Anchor from', zh: '父级锚点' },
  anchorTo: { en: 'Anchor to', zh: '自身锚点' },
  text: { en: 'Text', zh: '文本' },
  editText: { en: 'Edit text', zh: '输入文本' },
  color: { en: 'Text color', zh: '文本颜色' },
  alignment: { en: 'Alignment', zh: '对齐方式' },
  shadow: { en: 'Text shadow', zh: '文本阴影' },
  linePadding: { en: 'Line padding', zh: '行间距' },
  gridDimension: { en: 'Grid dimension', zh: '网格维度' },
  stackOrientation: { en: 'Stack orientation', zh: '堆叠方向' },
  scrollPosition: { en: 'Scroll position', zh: '滚动位置' },
  scrollPercent: { en: 'Scroll percent', zh: '滚动百分比' },
  toggleState: { en: 'Toggle state', zh: '开关状态' },
  sliderValue: { en: 'Slider value', zh: '滑块值' },
};

function getPropertyLabel(key: string): string {
  const language = document.documentElement.lang.startsWith('zh') ? 'zh' : 'en';
  return PROPERTY_LABELS[key]?.[language] ?? key;
}

function createRequestId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '-';
  }
  if (typeof value === 'string') {
    return value || '""';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
