import React, { useEffect, useRef, useState } from 'react';
import { I18nText } from '../i18n';
import { vscode } from '../vscode';

interface Props {
  t: I18nText;
  gameExecutablePath: string;
  onGameExecutablePathChange: (path: string) => void;
  discoverySupported: boolean;
  discoveryLoaded: boolean;
  discoveredPaths: string[];
}

const getGamePathLabel = (candidate: string): string => {
  const segments = candidate.replace(/\\/g, '/').split('/').filter(Boolean);
  const executableName = segments.at(-1) || candidate;
  const parentName = segments.at(-2);
  return parentName && /^\d+(?:\.\d+)+/.test(parentName)
    ? `Minecraft ${parentName}`
    : executableName;
};

const getGameExecutableName = (candidate: string): string =>
  candidate.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || candidate;

export const LauncherSettings: React.FC<Props> = ({
  t,
  gameExecutablePath,
  onGameExecutablePathChange,
  discoverySupported,
  discoveryLoaded,
  discoveredPaths,
}) => {
  const discoveryRequested = useRef(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (!discoverySupported) {
      discoveryRequested.current = false;
      setIsOpen(false);
    }
  }, [discoverySupported]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const requestDiscoveredPaths = () => {
    if (!discoverySupported || discoveryRequested.current) {
      return;
    }
    discoveryRequested.current = true;
    vscode.postMessage({ type: 'getGameExecutablePaths' });
  };

  const openPicker = () => {
    if (!discoverySupported) {
      return;
    }
    requestDiscoveredPaths();
    setIsOpen(true);
  };

  const selectPath = (candidate: string) => {
    onGameExecutablePathChange(candidate);
    setIsOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!discoverySupported) {
      return;
    }

    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openPicker();
      if (discoveredPaths.length > 0) {
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex(current => {
          if (current < 0) {
            return direction > 0 ? 0 : discoveredPaths.length - 1;
          }
          return (current + direction + discoveredPaths.length) % discoveredPaths.length;
        });
      }
      return;
    }

    if (event.key === 'Enter' && isOpen && activeIndex >= 0) {
      event.preventDefault();
      selectPath(discoveredPaths[activeIndex]);
    }
  };

  const handleBrowse = () => {
    vscode.postMessage({ type: 'browseGameExecutable', currentPath: gameExecutablePath });
  };

  return (
    <div className="section">
      <div className="section-header-plain">
        <span className="section-title">
          <span className="codicon codicon-rocket"></span>
          {t.launcherSettings}
        </span>
      </div>

      <div className="control-group">
        <label htmlFor="game_executable_path">{t.launcherPath}</label>
        <div className="input-row">
          <div className={`game-path-picker${isOpen ? ' open' : ''}`} ref={pickerRef}>
            <input
              ref={inputRef}
              type="text"
              id="game_executable_path"
              role={discoverySupported ? 'combobox' : undefined}
              aria-autocomplete={discoverySupported ? 'list' : undefined}
              aria-expanded={discoverySupported ? isOpen : undefined}
              aria-controls={discoverySupported ? 'game-executable-path-list' : undefined}
              value={gameExecutablePath}
              onChange={(event) => onGameExecutablePathChange(event.target.value)}
              onFocus={openPicker}
              onKeyDown={handleKeyDown}
              placeholder={t.launcherPathPlaceholder}
            />
            {discoverySupported && (
              <button
                type="button"
                className="game-path-toggle"
                onClick={() => {
                  if (isOpen) {
                    setIsOpen(false);
                  } else {
                    openPicker();
                    inputRef.current?.focus();
                  }
                }}
                title={t.launcherShowDetectedPaths}
                aria-label={t.launcherShowDetectedPaths}
                aria-expanded={isOpen}
              >
                <span className="codicon codicon-chevron-down"></span>
              </button>
            )}

            {discoverySupported && isOpen && (
              <div
                id="game-executable-path-list"
                className="game-path-menu"
                role="listbox"
              >
                {!discoveryLoaded ? (
                  <div className="game-path-menu-state" aria-live="polite">
                    <span className="codicon codicon-loading codicon-modifier-spin"></span>
                  </div>
                ) : discoveredPaths.length === 0 ? (
                  <div className="game-path-menu-state">
                    <span className="codicon codicon-search-stop"></span>
                    <span>{t.launcherNoDetectedPaths}</span>
                  </div>
                ) : discoveredPaths.map((candidate, index) => {
                  const selected = candidate === gameExecutablePath;
                  return (
                    <button
                      type="button"
                      key={candidate}
                      className={`game-path-option${selected ? ' selected' : ''}${activeIndex === index ? ' active' : ''}`}
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setActiveIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectPath(candidate)}
                      title={candidate}
                    >
                      <span className={`codicon ${selected ? 'codicon-check' : 'codicon-file-binary'}`}></span>
                      <span className="game-path-option-content">
                        <span className="game-path-option-heading">
                          <span className="game-path-option-title">{getGamePathLabel(candidate)}</span>
                          {index === 0 && (
                            <span className="game-path-latest-badge">{t.launcherLatest}</span>
                          )}
                        </span>
                        <span className="game-path-option-path">{getGameExecutableName(candidate)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn-icon browse"
            onClick={handleBrowse}
            title={t.browse}
          >
            <span className="codicon codicon-folder-opened"></span>
          </button>
        </div>
      </div>
    </div>
  );
};
