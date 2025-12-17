import React from 'react';
import { vscode } from '../vscode';
import { I18nText } from '../i18n';

interface ModDir {
  path: string;
  hot_reload: boolean;
}

interface Props {
  t: I18nText;
  modDirs: ModDir[];
  setModDirs: (dirs: ModDir[]) => void;
  setHasChanges: (changed: boolean) => void;
}

export const ModDirectories: React.FC<Props> = ({ t, modDirs, setModDirs, setHasChanges }) => {
  const removeDir = (index: number) => {
    setModDirs(modDirs.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const updatePath = (index: number, path: string) => {
    const newDirs = [...modDirs];
    newDirs[index].path = path;
    setModDirs(newDirs);
    setHasChanges(true);
  };

  const toggleHotReload = (index: number) => {
    const newDirs = [...modDirs];
    newDirs[index].hot_reload = !newDirs[index].hot_reload;
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
      </div>
      <div className="mod-list">
        {modDirs.length === 0 ? (
          <div style={{ padding: '10px', textAlign: 'center', opacity: 0.6 }}>
            {t.noModDirs}
          </div>
        ) : (
          modDirs.map((dir, idx) => (
            <div key={idx} className="mod-item">
              <div className="mod-row">
                <input
                  type="text"
                  className="mod-path"
                  value={dir.path}
                  onChange={(e) => updatePath(idx, e.target.value)}
                  placeholder="./ or D:/Mods"
                />
                <button
                  className="btn-icon browse"
                  onClick={() => vscode.postMessage({ type: 'browseFolder', index: idx })}
                  title={t.browse}
                >
                  <span className="codicon codicon-folder-opened"></span>
                </button>
              </div>
              <div className="mod-options">
                <label className="checkbox-group" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    className="mod-hotreload"
                    checked={dir.hot_reload}
                    onChange={() => toggleHotReload(idx)}
                  />
                  <span>{t.hotReload}</span>
                </label>
                <button
                  className="btn-icon delete"
                  onClick={() => removeDir(idx)}
                  title={t.remove}
                >
                  <span className="codicon codicon-trash"></span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <div style={{ marginTop: '12px' }}>
        <button
          className="btn-primary"
          onClick={() => vscode.postMessage({ type: 'browseFolder', index: -1 })}
          style={{ width: '100%' }}
        >
          <span className="codicon codicon-folder-opened"></span> {t.addModDirectory}
        </button>
      </div>
    </div>
  );
};
