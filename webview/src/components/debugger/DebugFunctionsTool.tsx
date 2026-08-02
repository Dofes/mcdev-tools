import { useEffect, useMemo, useRef, useState } from 'react';
import { I18nText } from '../../i18n';
import {
  DebugFunctionArgumentMode,
  DiscoveredDebugFunction,
  HostBridgeSessionSummary,
  SavedDebugFunction,
} from '../../types';
import { vscode } from '../../vscode';

interface DebugFunctionsToolProps {
  session?: HostBridgeSessionSummary;
  t: I18nText;
}

interface PendingRequest {
  action: 'load' | 'discover' | 'save' | 'delete' | 'execute' | 'open';
  functionId?: string;
}

interface FunctionExecution {
  pending: boolean;
  ok?: boolean;
  output?: string;
  createdAt: number;
}

export function DebugFunctionsTool({ session, t }: DebugFunctionsToolProps) {
  const [functions, setFunctions] = useState<SavedDebugFunction[]>([]);
  const [draft, setDraft] = useState<SavedDebugFunction>();
  const [runtimeArguments, setRuntimeArguments] = useState<Record<string, string>>({});
  const [workspacePath, setWorkspacePath] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savedNotice, setSavedNotice] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredDebugFunction[]>([]);
  const [search, setSearch] = useState('');
  const [execution, setExecution] = useState<FunctionExecution>();
  const [viewMode, setViewMode] = useState<'run' | 'manage'>('run');
  const [librarySearch, setLibrarySearch] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState('');
  const [guidedFunctionId, setGuidedFunctionId] = useState('');
  const [tabScrollState, setTabScrollState] = useState({ left: false, right: false });
  const pendingRequests = useRef(new Map<string, PendingRequest>());
  const activeFunctionId = useRef('');
  const runTabsRef = useRef<HTMLElement>(null);
  const editPanelRef = useRef<HTMLElement>(null);
  const guideTimer = useRef<number>();
  activeFunctionId.current = draft?.id ?? '';

  const postRequest = (type: string, pending: PendingRequest, extra: Record<string, unknown> = {}) => {
    const requestId = createRequestId();
    pendingRequests.current.set(requestId, pending);
    vscode.postMessage({ type, requestId, sessionId: session?.id ?? '', ...extra });
    return requestId;
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      const requestId = typeof message?.requestId === 'string' ? message.requestId : '';
      const pending = pendingRequests.current.get(requestId);
      if (!pending) {
        return;
      }
      pendingRequests.current.delete(requestId);

      if (message.type === 'debugFunctionsState' && Array.isArray(message.functions)) {
        const next = message.functions as SavedDebugFunction[];
        setFunctions(next);
        setWorkspacePath(typeof message.workspacePath === 'string' ? message.workspacePath : '');
        setLoading(false);
        setError('');
        if (pending.action === 'save' && pending.functionId) {
          setDraft(cloneSaved(next.find(item => item.id === pending.functionId)));
          setSavedNotice(true);
        } else if (pending.action === 'delete') {
          setDraft(previous => previous?.id === pending.functionId
            ? cloneSaved(next[0])
            : previous);
          setDeleteConfirmId('');
        } else if (pending.action === 'load') {
          setDraft(previous => cloneSaved(next.find(item => item.id === previous?.id) ?? next[0]));
        }
        return;
      }
      if (message.type === 'debugFunctionsDiscovered' && Array.isArray(message.functions)) {
        setDiscovered(message.functions as DiscoveredDebugFunction[]);
        setDiscovering(false);
        setError('');
        return;
      }
      if (message.type === 'debugFunctionExecutionResult') {
        if (message.functionId !== activeFunctionId.current) {
          return;
        }
        setExecution({
          pending: false,
          ok: message.ok === true,
          output: message.ok === true
            ? formatResult(message.result)
            : formatError(message.error, t.hostBridgeRequestFailed),
          createdAt: Date.now(),
        });
        return;
      }
      if (message.type === 'debugFunctionsError') {
        setLoading(false);
        setDiscovering(false);
        setError(typeof message.message === 'string' ? message.message : t.hostBridgeRequestFailed);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [t.hostBridgeRequestFailed]);

  useEffect(() => {
    pendingRequests.current.clear();
    setFunctions([]);
    setDraft(undefined);
    setWorkspacePath('');
    setRuntimeArguments({});
    setExecution(undefined);
    setError('');
    setLoading(true);
    postRequest('debugFunctionsLoad', { action: 'load' });
  }, [session?.id, session?.projectRoot]);

  useEffect(() => {
    setRuntimeArguments({});
    setExecution(undefined);
    setSavedNotice(false);
  }, [draft?.id]);

  useEffect(() => () => {
    if (guideTimer.current !== undefined) {
      window.clearTimeout(guideTimer.current);
    }
  }, []);

  useEffect(() => {
    const tabs = runTabsRef.current;
    if (!tabs || viewMode !== 'run') {
      return;
    }
    const update = () => setTabScrollState({
      left: tabs.scrollLeft > 1,
      right: tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 1,
    });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(tabs);
    return () => observer.disconnect();
  }, [functions, viewMode]);

  const persisted = draft ? functions.find(item => item.id === draft.id) : undefined;
  const dirty = Boolean(draft && JSON.stringify(draft) !== JSON.stringify(persisted));
  const methodAvailable = session?.methods === undefined
    || session.methods.some(method => method.name === 'game/code/execute' && method.modes.includes('request'));
  const missingRunValue = draft?.parameters.some(parameter => {
    const config = draft.argumentConfigs[parameter.name];
    if (config?.mode === 'fixed') {
      return !config.value.trim();
    }
    if (config?.mode === 'required') {
      return !runtimeArguments[parameter.name]?.trim();
    }
    return parameter.required
      && !config?.value.trim()
      && !runtimeArguments[parameter.name]?.trim();
  }) ?? false;
  const canRun = Boolean(
    draft
    && session?.connected
    && session.state === 'game_ready'
    && methodAvailable
    && !missingRunValue
    && !execution?.pending
  );

  const filteredDiscovered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? discovered.filter(item => `${item.modulePath}.${item.functionName}`.toLowerCase().includes(query))
      : discovered;
  }, [discovered, search]);
  const filteredSavedFunctions = useMemo(() => {
    const query = librarySearch.trim().toLowerCase();
    return query
      ? functions.filter(item => `${item.label} ${item.modulePath}.${item.functionName}`.toLowerCase().includes(query))
      : functions;
  }, [functions, librarySearch]);

  const discover = (force = false) => {
    setDiscoveryOpen(true);
    setDiscovering(true);
    setError('');
    postRequest('debugFunctionsDiscover', { action: 'discover' }, { force });
  };

  const selectSaved = (item: SavedDebugFunction) => {
    setDraft(cloneSaved(item));
    setSavedNotice(false);
    setDeleteConfirmId('');
    window.requestAnimationFrame(() => {
      const tab = runTabsRef.current?.querySelector<HTMLElement>(`[data-function-id="${item.id}"]`);
      tab?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    });
  };

  const switchView = (next: 'run' | 'manage') => {
    if (next === 'run') {
      const saved = functions.find(item => item.id === draft?.id) ?? functions[0];
      setDraft(cloneSaved(saved));
      setSavedNotice(false);
      setError('');
    }
    setDeleteConfirmId('');
    setGuidedFunctionId('');
    if (guideTimer.current !== undefined) {
      window.clearTimeout(guideTimer.current);
      guideTimer.current = undefined;
    }
    setViewMode(next);
  };

  const addDiscovered = (item: DiscoveredDebugFunction) => {
    const existing = functions.find(saved => saved.key === item.key);
    if (existing) {
      setDraft(mergeDiscoveredFunction(existing, item));
      setGuidedFunctionId('');
    } else {
      const created = createSavedFunction(item);
      setDraft(created);
      setGuidedFunctionId(created.id);
      if (guideTimer.current !== undefined) {
        window.clearTimeout(guideTimer.current);
      }
      guideTimer.current = window.setTimeout(() => setGuidedFunctionId(''), 3200);
      window.requestAnimationFrame(() => {
        editPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    setDiscoveryOpen(false);
  };

  const updateArgumentMode = (name: string, mode: DebugFunctionArgumentMode) => {
    setDraft(previous => previous && ({
      ...previous,
      argumentConfigs: {
        ...previous.argumentConfigs,
        [name]: { mode, value: mode === 'required' ? '' : previous.argumentConfigs[name]?.value ?? '' },
      },
    }));
    if (mode === 'fixed') {
      setRuntimeArguments(previous => ({ ...previous, [name]: '' }));
    }
    setSavedNotice(false);
  };

  const save = () => {
    if (!draft?.label.trim()) {
      return;
    }
    setError('');
    setSavedNotice(false);
    setDeleteConfirmId('');
    setGuidedFunctionId('');
    if (guideTimer.current !== undefined) {
      window.clearTimeout(guideTimer.current);
      guideTimer.current = undefined;
    }
    postRequest('debugFunctionSave', { action: 'save', functionId: draft.id }, { function: draft });
  };

  const remove = () => {
    if (!draft || !persisted || deleteConfirmId !== draft.id) {
      return;
    }
    postRequest('debugFunctionDelete', { action: 'delete', functionId: draft.id }, { id: draft.id });
  };

  const handleRunKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      execute();
    }
  };

  const updateTabScrollState = () => {
    const tabs = runTabsRef.current;
    if (!tabs) {
      return;
    }
    setTabScrollState({
      left: tabs.scrollLeft > 1,
      right: tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 1,
    });
  };

  const scrollFunctionTabs = (direction: -1 | 1) => {
    runTabsRef.current?.scrollBy({
      left: direction * Math.max(180, runTabsRef.current.clientWidth * 0.65),
      behavior: 'smooth',
    });
  };

  const execute = () => {
    if (!draft || !canRun) {
      return;
    }
    setError('');
    setExecution({ pending: true, createdAt: Date.now() });
    postRequest('debugFunctionExecute', { action: 'execute', functionId: draft.id }, {
      function: draft,
      runtimeArguments,
    });
  };

  const openSource = (item: SavedDebugFunction) => {
    postRequest('debugFunctionOpenSource', { action: 'open' }, {
      relativeFilePath: item.relativeFilePath,
      line: item.line,
    });
  };

  const fixedParameters = draft?.parameters.filter(
    parameter => draft.argumentConfigs[parameter.name]?.mode === 'fixed',
  ) ?? [];
  const runtimeParameters = draft?.parameters.filter(
    parameter => draft.argumentConfigs[parameter.name]?.mode !== 'fixed',
  ) ?? [];

  return (
    <div className="debug-functions-workspace">
      <header className="debug-functions-view-bar">
        <div className="debug-functions-view-switcher" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'run'}
            className={viewMode === 'run' ? 'active' : ''}
            onClick={() => switchView('run')}
          >
            <span className="codicon codicon-run" />
            {t.debugFunctionsRunView}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'manage'}
            className={viewMode === 'manage' ? 'active' : ''}
            onClick={() => switchView('manage')}
          >
            <span className="codicon codicon-settings-gear" />
            {t.debugFunctionsManageView}
          </button>
        </div>
      </header>

      <div className={`debug-functions-layout ${viewMode}`}>
        {viewMode === 'manage' && (
          <aside className="debug-function-library">
          <header className="debug-function-pane-header">
            <div>
              <strong>{t.debugFunctionsSaved}</strong>
              <span>{functions.length}</span>
            </div>
            {viewMode === 'manage' && (
              <button type="button" className="btn-icon" onClick={() => discover(false)} title={t.debugFunctionsAdd}>
                <span className="codicon codicon-add" />
              </button>
            )}
          </header>
          {functions.length > 0 && (
            <label className="debug-function-library-search">
              <span className="codicon codicon-search" />
              <input
                type="text"
                value={librarySearch}
                onChange={event => setLibrarySearch(event.target.value)}
                placeholder={t.debugFunctionsFilterSaved}
              />
              {librarySearch && (
                <button type="button" onClick={() => setLibrarySearch('')} aria-label={t.clear}>
                  <span className="codicon codicon-close" />
                </button>
              )}
            </label>
          )}
          <div className="debug-function-list">
            {loading ? (
              <EmptyState icon="codicon-loading" text={t.hostBridgeExecuting} />
            ) : functions.length === 0 ? (
              <EmptyState icon="codicon-symbol-function" text={t.debugFunctionsEmpty} />
            ) : filteredSavedFunctions.length === 0 ? (
              <EmptyState icon="codicon-search-stop" text={t.debugFunctionsEmpty} />
            ) : filteredSavedFunctions.map(item => (
              <button
                type="button"
                className={`debug-function-list-item ${draft?.id === item.id ? 'active' : ''}`}
                key={item.id}
                onClick={() => selectSaved(item)}
              >
                <span className={`codicon ${item.target === 'client' ? 'codicon-device-desktop' : 'codicon-server'}`} />
                <span>
                  <strong>{item.label}</strong>
                  <code>{item.modulePath}.{item.functionName}</code>
                </span>
              </button>
            ))}
          </div>
          {viewMode === 'manage' && (
            <button type="button" className="debug-function-add-button" onClick={() => discover(false)}>
              <span className="codicon codicon-search" />
              {t.debugFunctionsAdd}
            </button>
          )}
          </aside>
        )}

        {viewMode === 'run' && (
          <div className="debug-function-run-tab-strip">
            <button
              type="button"
              className="debug-function-tab-scroll-button"
              disabled={!tabScrollState.left}
              onClick={() => scrollFunctionTabs(-1)}
              aria-label={t.debugFunctionsScrollLeft}
            >
              <span className="codicon codicon-chevron-left" />
            </button>
            <nav
              className="debug-function-run-tabs"
              aria-label={t.debugFunctionsSaved}
              ref={runTabsRef}
              onScroll={updateTabScrollState}
              onWheel={event => {
                if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && event.currentTarget.scrollWidth > event.currentTarget.clientWidth) {
                  event.preventDefault();
                  event.currentTarget.scrollBy({ left: event.deltaY, behavior: 'auto' });
                }
              }}
            >
              {loading ? (
                <span className="debug-function-run-tabs-empty">{t.hostBridgeExecuting}</span>
              ) : functions.length === 0 ? (
                <button type="button" className="debug-function-run-tabs-empty" onClick={() => switchView('manage')}>
                  <span className="codicon codicon-add" />
                  {t.debugFunctionsAdd}
                </button>
              ) : functions.map(item => (
                <button
                  type="button"
                  className={draft?.id === item.id ? 'active' : ''}
                  key={item.id}
                  data-function-id={item.id}
                  onClick={() => selectSaved(item)}
                  title={`${item.modulePath}.${item.functionName}`}
                >
                  <span className={`codicon ${item.target === 'client' ? 'codicon-device-desktop' : 'codicon-server'}`} />
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
            <button
              type="button"
              className="debug-function-tab-scroll-button"
              disabled={!tabScrollState.right}
              onClick={() => scrollFunctionTabs(1)}
              aria-label={t.debugFunctionsScrollRight}
            >
              <span className="codicon codicon-chevron-right" />
            </button>
          </div>
        )}

        {viewMode === 'manage' ? (
          <section
            className={`debug-function-config ${guidedFunctionId === draft?.id ? 'guide-new-function' : ''}`}
            ref={editPanelRef}
          >
            {!draft ? (
              <EmptyState
                icon="codicon-settings-gear"
                text={loading ? t.hostBridgeExecuting : error || t.debugFunctionsSelect}
              />
            ) : (
              <div className="debug-function-config-scroll">
                <header className="debug-function-config-header">
                  <div>
                    <strong>{t.debugFunctionsConfiguration}</strong>
                    {dirty && <span className="debug-function-dirty-dot" />}
                    {savedNotice && <small>{t.debugFunctionsSavedStatus}</small>}
                  </div>
                  <div>
                    {persisted && (
                      <button
                        type="button"
                        className="debug-function-delete-button"
                        onClick={() => setDeleteConfirmId(draft.id)}
                      >
                        <span className="codicon codicon-trash" />
                        {t.debugFunctionsDelete}
                      </button>
                    )}
                    <button type="button" className="btn-secondary" onClick={save} disabled={!draft.label.trim()}>
                      <span className="codicon codicon-save" />
                      {t.debugFunctionsSave}
                    </button>
                  </div>
                </header>

                {deleteConfirmId === draft.id && (
                  <div className="debug-function-delete-confirm" role="alert">
                    <span>{t.debugFunctionsDeleteConfirm}</span>
                    <div>
                      <button type="button" className="btn-secondary" onClick={() => setDeleteConfirmId('')}>
                        {t.debugFunctionsCancelDelete}
                      </button>
                      <button type="button" className="debug-function-delete-confirm-button" onClick={remove}>
                        <span className="codicon codicon-trash" />
                        {t.debugFunctionsConfirmDelete}
                      </button>
                    </div>
                  </div>
                )}

                <div className="debug-function-fields">
                  <label className="debug-function-field">
                    <span>{t.debugFunctionsDisplayName}</span>
                    <input
                      type="text"
                      value={draft.label}
                      onChange={event => {
                        setDraft({ ...draft, label: event.target.value });
                        setSavedNotice(false);
                      }}
                    />
                  </label>

                  <div className="debug-function-source-row">
                    <span>{t.debugFunctionsSource}</span>
                    <button type="button" onClick={() => openSource(draft)}>
                      <code>{draft.modulePath}.{draft.functionName}</code>
                      <small>{draft.relativeFilePath}:{draft.line}</small>
                      <span className="codicon codicon-go-to-file" />
                    </button>
                  </div>

                  <div className="host-bridge-segmented" role="group" aria-label={t.hostBridgeTarget}>
                    <button
                      type="button"
                      className={draft.target === 'client' ? 'active' : ''}
                      onClick={() => { setDraft({ ...draft, target: 'client' }); setSavedNotice(false); }}
                    >
                      <span className="codicon codicon-device-desktop" />{t.hostBridgeClient}
                    </button>
                    <button
                      type="button"
                      className={draft.target === 'server' ? 'active' : ''}
                      onClick={() => { setDraft({ ...draft, target: 'server' }); setSavedNotice(false); }}
                    >
                      <span className="codicon codicon-server" />{t.hostBridgeServer}
                    </button>
                  </div>
                </div>

                <section className="debug-function-arguments">
                  <h3>{t.debugFunctionsArguments}</h3>
                  {draft.parameters.length === 0 ? (
                    <p className="debug-function-inline-empty">{t.debugFunctionsNoArguments}</p>
                  ) : draft.parameters.map(parameter => {
                    const config = draft.argumentConfigs[parameter.name];
                    return (
                      <div className="debug-function-parameter" key={parameter.name}>
                        <div className="debug-function-parameter-title">
                          <code>{formatParameterName(parameter.kind, parameter.name)}</code>
                          {parameter.defaultValue !== undefined && (
                            <small>{t.debugFunctionsPythonDefault}: {parameter.defaultValue}</small>
                          )}
                        </div>
                        <div className="debug-function-mode" role="group">
                          {(['fixed', 'optional', 'required'] as const).map(mode => (
                            <button
                              type="button"
                              key={mode}
                              className={config?.mode === mode ? 'active' : ''}
                              onClick={() => updateArgumentMode(parameter.name, mode)}
                            >
                              {mode === 'fixed'
                                ? t.debugFunctionsModeFixed
                                : mode === 'optional'
                                  ? t.debugFunctionsModeOptional
                                  : t.debugFunctionsModeRequired}
                            </button>
                          ))}
                        </div>
                        {config?.mode !== 'required' && (
                          <label className="debug-function-value">
                            <span>{config?.mode === 'fixed'
                              ? t.debugFunctionsFixedValue
                              : t.debugFunctionsOptionalDefault}</span>
                            <input
                              type="text"
                              value={config?.value ?? ''}
                              placeholder={argumentPlaceholder(parameter.kind, t)}
                              spellCheck={false}
                              onChange={event => {
                                setDraft({
                                  ...draft,
                                  argumentConfigs: {
                                    ...draft.argumentConfigs,
                                    [parameter.name]: { ...config, value: event.target.value },
                                  },
                                });
                                setSavedNotice(false);
                              }}
                            />
                          </label>
                        )}
                      </div>
                    );
                  })}
                </section>
                {error && <div className="debug-function-error">{error}</div>}
              </div>
            )}
          </section>
        ) : (
          <section className="debug-function-run-panel">
            {!draft ? (
              <EmptyState
                icon="codicon-run"
                text={loading ? t.hostBridgeExecuting : error || t.debugFunctionsSelect}
              />
            ) : (
              <div className="debug-function-run-content">
                <header className="debug-function-run-header">
                  <div>
                    <span className={`codicon ${draft.target === 'client' ? 'codicon-device-desktop' : 'codicon-server'}`} />
                    <span>
                      <strong>{draft.label}</strong>
                      <code>{draft.modulePath}.{draft.functionName}</code>
                    </span>
                  </div>
                  <div>
                    <button type="button" className="btn-icon" onClick={() => openSource(draft)} title={t.debugFunctionsSource}>
                      <span className="codicon codicon-go-to-file" />
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => switchView('manage')}>
                      <span className="codicon codicon-edit" />
                      {t.debugFunctionsEdit}
                    </button>
                  </div>
                </header>

                <div className="debug-function-run-scroll">
                  {fixedParameters.length > 0 && (
                    <section className="debug-function-fixed-summary">
                      <h3>{t.debugFunctionsFixedArguments}</h3>
                      <div>
                        {fixedParameters.map(parameter => (
                          <div key={parameter.name}>
                            <code>{formatParameterName(parameter.kind, parameter.name)}</code>
                            <pre>{draft.argumentConfigs[parameter.name]?.value}</pre>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <section className="debug-function-run-arguments">
                    <h3>{t.debugFunctionsRunArguments}</h3>
                    {runtimeParameters.length === 0 ? (
                      <p className="debug-function-inline-empty">{t.debugFunctionsNoRuntimeArguments}</p>
                    ) : runtimeParameters.map(parameter => {
                      const config = draft.argumentConfigs[parameter.name];
                      const required = config?.mode === 'required';
                      return (
                        <label className="debug-function-value runtime" key={parameter.name}>
                          <span>
                            <code>{formatParameterName(parameter.kind, parameter.name)}</code>
                            <small>{required ? t.debugFunctionsRuntimeRequired : t.debugFunctionsRuntimeOverride}</small>
                          </span>
                          <input
                            type="text"
                            value={runtimeArguments[parameter.name] ?? ''}
                            placeholder={required
                              ? argumentPlaceholder(parameter.kind, t)
                              : config?.value || parameter.defaultValue || argumentPlaceholder(parameter.kind, t)}
                            spellCheck={false}
                            onKeyDown={handleRunKeyDown}
                            onChange={event => setRuntimeArguments({
                              ...runtimeArguments,
                              [parameter.name]: event.target.value,
                            })}
                          />
                        </label>
                      );
                    })}
                  </section>
                  {error && <div className="debug-function-error">{error}</div>}
                  {!methodAvailable && <div className="debug-function-error">{t.hostBridgeMethodUnavailable}</div>}
                </div>

                <footer className="debug-function-run-bar">
                  <span>{workspacePath || t.debugFunctionsProjectUnavailable}</span>
                  <button type="button" className="btn-primary" disabled={!canRun} onClick={execute}>
                    <span className={`codicon ${execution?.pending ? 'codicon-loading' : 'codicon-run'}`} />
                    {execution?.pending ? t.hostBridgeExecuting : t.hostBridgeExecute}
                  </button>
                </footer>
              </div>
            )}
          </section>
        )}

        {viewMode === 'run' && (
          <section className="debug-function-result">
            <header className="debug-function-pane-header">
              <strong>{t.debugFunctionsResult}</strong>
              {execution && <time>{new Date(execution.createdAt).toLocaleTimeString()}</time>}
            </header>
            {!execution ? (
              <EmptyState icon="codicon-output" text={t.debugFunctionsNoResult} />
            ) : (
              <pre className={execution.pending ? 'pending' : execution.ok ? 'success' : 'error'}>
                {execution.pending ? t.hostBridgeExecuting : execution.output}
              </pre>
            )}
          </section>
        )}
      </div>

      {discoveryOpen && (
        <div className="debug-function-dialog-backdrop" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget) {
            setDiscoveryOpen(false);
          }
        }}>
          <section className="debug-function-dialog" role="dialog" aria-modal="true" aria-label={t.debugFunctionsDiscoverTitle}>
            <header>
              <strong>{t.debugFunctionsDiscoverTitle}</strong>
              <div>
                <button type="button" className="btn-icon" onClick={() => discover(true)} title={t.debugFunctionsRefresh}>
                  <span className={`codicon ${discovering ? 'codicon-loading' : 'codicon-refresh'}`} />
                </button>
                <button type="button" className="btn-icon" onClick={() => setDiscoveryOpen(false)} aria-label={t.clear}>
                  <span className="codicon codicon-close" />
                </button>
              </div>
            </header>
            <label className="debug-function-search">
              <span className="codicon codicon-search" />
              <input
                autoFocus
                type="text"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder={t.debugFunctionsSearch}
              />
            </label>
            <div className="debug-function-discovery-list">
              {discovering ? (
                <EmptyState icon="codicon-loading" text={t.hostBridgeExecuting} />
              ) : filteredDiscovered.length === 0 ? (
                <EmptyState icon="codicon-search-stop" text={t.debugFunctionsNoDiscovered} />
              ) : filteredDiscovered.map(item => {
                const saved = functions.some(candidate => candidate.key === item.key);
                return (
                  <button type="button" key={item.key} onClick={() => addDiscovered(item)}>
                    <span className="codicon codicon-symbol-function" />
                    <span>
                      <strong>{item.functionName}</strong>
                      <code>{item.modulePath}</code>
                      <small>{item.relativeFilePath}:{item.line}</small>
                    </span>
                    <span>{saved ? t.debugFunctionsSavedStatus : `${item.parameters.length}`}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="debug-function-empty">
      <span className={`codicon ${icon}`} />
      <span>{text}</span>
    </div>
  );
}

function createSavedFunction(item: DiscoveredDebugFunction): SavedDebugFunction {
  return {
    ...item,
    parameters: item.parameters.map(parameter => ({ ...parameter })),
    id: createRequestId(),
    label: item.functionName,
    target: 'client',
    argumentConfigs: Object.fromEntries(item.parameters.map(parameter => [parameter.name, {
      mode: parameter.required ? 'required' : 'optional',
      value: '',
    }])),
  };
}

function mergeDiscoveredFunction(
  saved: SavedDebugFunction,
  discovered: DiscoveredDebugFunction,
): SavedDebugFunction {
  return {
    ...saved,
    ...discovered,
    parameters: discovered.parameters.map(parameter => ({ ...parameter })),
    argumentConfigs: Object.fromEntries(discovered.parameters.map(parameter => [
      parameter.name,
      saved.argumentConfigs[parameter.name] ?? {
        mode: parameter.required ? 'required' : 'optional',
        value: '',
      },
    ])),
  };
}

function cloneSaved(item: SavedDebugFunction | undefined): SavedDebugFunction | undefined {
  return item && {
    ...item,
    parameters: item.parameters.map(parameter => ({ ...parameter })),
    argumentConfigs: Object.fromEntries(
      Object.entries(item.argumentConfigs).map(([name, config]) => [name, { ...config }]),
    ),
  };
}

function formatParameterName(kind: string, name: string): string {
  return `${kind === 'kwargs' ? '**' : kind === 'varargs' ? '*' : ''}${name}`;
}

function argumentPlaceholder(kind: string, t: I18nText): string {
  if (kind === 'varargs') {
    return t.debugFunctionsArgsPlaceholder;
  }
  if (kind === 'kwargs') {
    return t.debugFunctionsKwargsPlaceholder;
  }
  return t.debugFunctionsJsonPlaceholder;
}

function createRequestId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function formatResult(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value);
  }
}

function formatError(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') {
    return fallback;
  }
  const candidate = error as { code?: unknown; message?: unknown };
  const message = typeof candidate.message === 'string' ? candidate.message : fallback;
  return typeof candidate.code === 'string' ? `[${candidate.code}] ${message}` : message;
}
