import React, { useEffect, useState } from 'react';
import { vscode } from '../vscode';
import { I18nText } from '../i18n';

interface ModDir {
  path: string;
  hot_reload: boolean;
  enabled: boolean;
}

interface Props {
  t: I18nText;
  modDirs: ModDir[];
  setModDirs: (dirs: ModDir[]) => void;
  setHasChanges: (changed: boolean) => void;
}

type ReviewStatus = 'idle' | 'queued' | 'running' | 'clean' | 'issues' | 'error';
type ReviewScope = 'mod';

interface ReviewTarget {
  targetId: string;
  targetPath: string;
  outputPath: string;
  label: string;
  scope: ReviewScope;
}

interface ReviewState extends ReviewTarget {
  status: ReviewStatus;
  issueCount?: number;
}

const REVIEW_OUTPUT_DIRECTORY = '.mcdev/reviews';
const REVIEW_PROJECT_URL = 'https://github.com/GitHub-Zero123/mcdk-assistant';

const createReportName = (path: string, index: number) => {
  const normalizedPath = path.trim().replace(/[\\/]+$/, '');
  const folderName = normalizedPath && normalizedPath !== '.'
    ? normalizedPath.split(/[\\/]/).pop()
    : 'workspace';
  const safeName = (folderName || `mod-${index + 1}`)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/[. ]+$/g, '') || `mod-${index + 1}`;
  return `${String(index + 1).padStart(2, '0')}-${safeName}.md`;
};

export const ModDirectories: React.FC<Props> = ({ t, modDirs, setModDirs, setHasChanges }) => {
  const [reviewStates, setReviewStates] = useState<Record<string, ReviewState>>({});
  const [reviewLauncherOpen, setReviewLauncherOpen] = useState(false);
  const [selectedReviewTarget, setSelectedReviewTarget] = useState<string | null>(null);

  const availableReviewTargets: ReviewTarget[] = modDirs.map((dir, index) => ({
      targetId: `mod:${dir.path}`,
      targetPath: dir.path,
      outputPath: `${REVIEW_OUTPUT_DIRECTORY}/${createReportName(dir.path, index)}`,
      label: (() => {
        const normalizedPath = dir.path.trim().replace(/[\\/]+$/, '');
        return normalizedPath && normalizedPath !== '.'
          ? normalizedPath.split(/[\\/]/).pop() || normalizedPath
          : './';
      })(),
      scope: 'mod' as const,
    }));
  const selectedTarget = availableReviewTargets.find(
    ({ targetId }) => targetId === selectedReviewTarget,
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      const validStatuses: ReviewStatus[] = [
        'idle', 'queued', 'running', 'clean', 'issues', 'error',
      ];
      if (
        message?.type !== 'codeReviewStatus' ||
        typeof message.targetId !== 'string' ||
        !validStatuses.includes(message.status)
      ) return;

      setReviewStates((current) => {
        const existing = current[message.targetId];
        if (!existing) return current;
        return {
          ...current,
          [message.targetId]: {
            ...existing,
            status: message.status,
            issueCount: typeof message.issueCount === 'number'
              ? message.issueCount
              : undefined,
            outputPath: typeof message.outputPath === 'string'
              ? message.outputPath
              : existing.outputPath,
          },
        };
      });
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const getReviewLabel = (state: ReviewState) => {
    switch (state.status) {
      case 'queued': return t.reviewQueued;
      case 'running': return t.reviewRunning;
      case 'clean': return t.reviewClean;
      case 'issues': return `${state.issueCount ?? 0} ${t.reviewIssues}`;
      case 'error': return t.reviewFailed;
      default: return t.reviewIdle;
    }
  };

  const getReviewIcon = (status: ReviewStatus) => {
    switch (status) {
      case 'queued': return 'codicon-clock';
      case 'running': return 'codicon-loading';
      case 'clean': return 'codicon-pass';
      case 'issues': return 'codicon-warning';
      case 'error': return 'codicon-error';
      default: return 'codicon-circle-outline';
    }
  };

  const startReview = (target: ReviewTarget) => {
    setReviewStates((current) => ({
      ...current,
      [target.targetId]: { ...target, status: 'queued' },
    }));
    setReviewLauncherOpen(false);
    vscode.postMessage({
      type: 'runCodeReview',
      ...target,
      outputDirectory: REVIEW_OUTPUT_DIRECTORY,
    });
  };

  const anyReviewActive = Object.values(reviewStates).some(
    ({ status }) => status === 'queued' || status === 'running',
  );

  const removeDir = (index: number) => {
    const removedPath = modDirs[index]?.path;
    setModDirs(modDirs.filter((_, i) => i !== index));
    if (removedPath) {
      setReviewStates((current) => {
        const next = { ...current };
        delete next[`mod:${removedPath}`];
        return next;
      });
      if (selectedReviewTarget === `mod:${removedPath}`) {
        setSelectedReviewTarget(null);
      }
    }
    setHasChanges(true);
  };

  const updatePath = (index: number, path: string) => {
    const newDirs = [...modDirs];
    const previousPath = newDirs[index].path;
    newDirs[index].path = path;
    setModDirs(newDirs);
    if (previousPath !== path) {
      setReviewStates((current) => {
        const next = { ...current };
        delete next[`mod:${previousPath}`];
        return next;
      });
      if (selectedReviewTarget === `mod:${previousPath}`) {
        setSelectedReviewTarget(null);
      }
    }
    setHasChanges(true);
  };

  const toggleHotReload = (index: number) => {
    const newDirs = [...modDirs];
    newDirs[index].hot_reload = !newDirs[index].hot_reload;
    setModDirs(newDirs);
    setHasChanges(true);
  };

  const toggleEnabled = (index: number) => {
    const newDirs = [...modDirs];
    newDirs[index].enabled = !newDirs[index].enabled;
    setModDirs(newDirs);
    setHasChanges(true);
  };

  return (
    <div className="section">
      <div className="section-header-plain">
        <span className="section-title">
          <span className="codicon codicon-folder-opened"></span>
          {t.modDirectories}
        </span>
        <button
          type="button"
          className="btn-link-compact review-entry-button"
          disabled={modDirs.length === 0 || anyReviewActive}
          onClick={() => setReviewLauncherOpen((current) => !current)}
          title={t.codeReview}
        >
          <span className={`codicon ${anyReviewActive ? 'codicon-loading' : 'codicon-search-fuzzy'}`}></span>
          {anyReviewActive ? t.reviewRunning : t.codeReview}
        </button>
      </div>

      {reviewLauncherOpen && (
        <div className="review-launcher">
          <div className="review-launcher-header">
            <span>{t.selectReviewTarget}</span>
            <button
              type="button"
              className="btn-icon"
              onClick={() => setReviewLauncherOpen(false)}
              title={t.clear}
            >
              <span className="codicon codicon-close" aria-hidden="true"></span>
            </button>
          </div>
          <div className="review-target-list" role="radiogroup" aria-label={t.selectReviewTarget}>
            {availableReviewTargets.map((target) => (
              <button
                key={target.targetId}
                type="button"
                className={`review-target-option${selectedReviewTarget === target.targetId ? ' selected' : ''}`}
                role="radio"
                aria-checked={selectedReviewTarget === target.targetId}
                onClick={() => setSelectedReviewTarget(target.targetId)}
              >
                <span className="codicon codicon-symbol-folder" aria-hidden="true"></span>
                <span className="review-target-copy">
                  <strong>{target.label}</strong>
                  <small>{target.targetPath}</small>
                </span>
                <span className="review-target-radio" aria-hidden="true"></span>
              </button>
            ))}
          </div>
          <div className="review-launcher-footer">
            <span className="review-output-preview">
              <span className="codicon codicon-file" aria-hidden="true"></span>
              <code>{selectedTarget?.outputPath ?? `${REVIEW_OUTPUT_DIRECTORY}/`}</code>
            </span>
            <button
              type="button"
              className="btn-primary"
              disabled={!selectedTarget}
              onClick={() => selectedTarget && startReview(selectedTarget)}
            >
              <span className="codicon codicon-play" aria-hidden="true"></span>
              {t.runReview}
            </button>
          </div>
          {Object.keys(reviewStates).length === 0 && (
            <div className="review-source-footer">
              <span className="codicon codicon-github-inverted" aria-hidden="true"></span>
              <span>
                {t.staticReviewBasedOn}{' '}
                <button
                  type="button"
                  className="review-source-link"
                  onClick={() => vscode.postMessage({
                    type: 'openExternal',
                    url: REVIEW_PROJECT_URL,
                  })}
                >
                  mcdk-assistant
                </button>
                {' '}{t.reviewRulesMayChange}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="mod-list">
        {modDirs.length === 0 ? (
          <div className="mod-empty-state">
            <span className="codicon codicon-folder"></span>
            {t.noModDirs}
          </div>
        ) : (
          modDirs.map((dir, idx) => {
            const normalizedPath = dir.path.trim().replace(/[\\/]+$/, '');
            const folderName = normalizedPath && normalizedPath !== '.'
              ? normalizedPath.split(/[\\/]/).pop() || normalizedPath
              : '';
            return (
            <div key={idx} className="mod-item">
              {folderName && (
                <div className="mod-folder-name" title={dir.path}>
                  <span className="codicon codicon-symbol-folder"></span>
                  {folderName}
                </div>
              )}
              <div className="mod-row">
                <input
                  type="text"
                  className="mod-path"
                  value={dir.path}
                  onChange={(e) => updatePath(idx, e.target.value)}
                  placeholder="./ or D:/Mods"
                />
                <button
                  type="button"
                  className="btn-icon browse"
                  onClick={() => vscode.postMessage({ type: 'browseFolder', index: idx })}
                  title={t.browse}
                >
                  <span className="codicon codicon-folder-opened"></span>
                </button>
              </div>
              <div className="mod-options">
                <label className="checkbox-group">
                  <input
                    type="checkbox"
                    className="mod-enabled"
                    checked={dir.enabled}
                    onChange={() => toggleEnabled(idx)}
                  />
                  <span>{t.enabled}</span>
                </label>
                <label className="checkbox-group">
                  <input
                    type="checkbox"
                    className="mod-hotreload"
                    checked={dir.hot_reload}
                    onChange={() => toggleHotReload(idx)}
                  />
                  <span>{t.hotReload}</span>
                </label>
                <button
                  type="button"
                  className="btn-icon delete"
                  onClick={() => removeDir(idx)}
                  title={t.remove}
                >
                  <span className="codicon codicon-trash"></span>
                </button>
              </div>
            </div>
          );
          })
        )}
      </div>

      {Object.keys(reviewStates).length > 0 && (
        <div className="review-results-panel">
          <div className="review-results-header">
            <span className="review-results-title">
              <span className="codicon codicon-pulse" aria-hidden="true"></span>
              {t.reviewResults}
            </span>
            <span className="review-output-path" title={t.reviewOutputDirectory}>
              <span className="codicon codicon-folder" aria-hidden="true"></span>
              <code>{REVIEW_OUTPUT_DIRECTORY}/</code>
            </span>
          </div>
          <div className="review-results-list">
            {Object.values(reviewStates).map((state) => {
              const active = state.status === 'queued' || state.status === 'running';
              return (
                <div key={state.targetId} className="review-result-row">
                  <span className="review-result-target" title={state.targetPath}>
                    <span className="codicon codicon-symbol-folder" aria-hidden="true"></span>
                    {state.label}
                  </span>
                  <button
                    type="button"
                    className={`mod-review-status review-report-status ${state.status}`}
                    disabled={state.status !== 'clean' && state.status !== 'issues'}
                    onClick={() => vscode.postMessage({
                      type: 'openReviewReport',
                      path: state.outputPath,
                    })}
                    title={t.openReviewReport}
                  >
                    <span className={`codicon ${getReviewIcon(state.status)}`}></span>
                    {getReviewLabel(state)}
                  </button>
                  <button
                    type="button"
                    className="btn-icon review"
                    disabled={active}
                    onClick={() => startReview(state)}
                    title={t.analyzeMod}
                  >
                    <span className={`codicon ${active ? 'codicon-loading' : 'codicon-refresh'}`}></span>
                  </button>
                </div>
              );
            })}
          </div>
          <div className="review-source-footer">
            <span className="codicon codicon-github-inverted" aria-hidden="true"></span>
            <span>
              {t.staticReviewBasedOn}{' '}
              <button
                type="button"
                className="review-source-link"
                onClick={() => vscode.postMessage({
                  type: 'openExternal',
                  url: REVIEW_PROJECT_URL,
                })}
              >
                mcdk-assistant
              </button>
              {' '}{t.reviewRulesMayChange}
            </span>
          </div>
        </div>
      )}

      <div className="mod-add-action">
        <button
          type="button"
          className="btn-primary"
          onClick={() => vscode.postMessage({ type: 'browseFolder', index: -1 })}
        >
          <span className="codicon codicon-folder-opened"></span> {t.addModDirectory}
        </button>
      </div>
    </div>
  );
};
