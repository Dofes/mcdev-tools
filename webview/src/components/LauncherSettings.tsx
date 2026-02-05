import React from 'react';
import { I18nText } from '../i18n';
import { vscode } from '../vscode';

interface Props {
  t: I18nText;
  gameExecutablePath: string;
  onGameExecutablePathChange: (path: string) => void;
}

export const LauncherSettings: React.FC<Props> = ({ t, gameExecutablePath, onGameExecutablePathChange }) => {
  const handleBrowse = () => {
    vscode.postMessage({ type: 'browseGameExecutable' });
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
          <input
            type="text"
            id="game_executable_path"
            value={gameExecutablePath}
            onChange={(e) => onGameExecutablePathChange(e.target.value)}
            placeholder={t.launcherPathPlaceholder}
          />
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
