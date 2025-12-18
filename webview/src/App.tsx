import React, { useState, useEffect, useCallback, useRef } from 'react';
import { vscode } from './vscode';
import { i18n, I18nText } from './i18n';
import { logger } from './logger';
import { ModDir, McdevData } from './types';
import { ModDirectories } from './components/ModDirectories';
import { WorldSettings } from './components/WorldSettings';
import { GameOptions } from './components/GameOptions';
import { UserSettings } from './components/UserSettings';
import { WindowStyle } from './components/WindowStyle';
import { DebugKeybindings } from './components/DebugKeybindings';
import './App.css';

function App() {
  const [lang, setLang] = useState<string>('en');
  const t = i18n[lang] || i18n.en;
  const [data, setData] = useState<McdevData>({});
  const [modDirs, setModDirs] = useState<ModDir[]>([{ path: './', hot_reload: true }]);
  const [hasChanges, setHasChanges] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [statusType, setStatusType] = useState<'success' | 'error' | 'info'>('info');
  const [debugExpanded, setDebugExpanded] = useState(false);
  const [activeKeyListener, setActiveKeyListener] = useState<string | null>(null);
  const [needsAutoSave, setNeedsAutoSave] = useState(false);
  
  const initializedComponentsRef = useRef<Set<string>>(new Set());
  const initTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Handle messages from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      const currentT = i18n[lang] || i18n.en;
      switch (msg.type) {
        case 'init':
          // 设置语言
          if (msg.language) {
            setLang(msg.language.startsWith('zh') ? 'zh' : 'en');
          }
          const parsedData = JSON.parse(msg.content || '{}');
          
          if (msg.needsInitialSave) {
            setNeedsAutoSave(true);
          } else {
            loadData(parsedData);
          }
          
          showStatus(currentT.loaded, 'success');
          setHasChanges(false);
          break;
        case 'saved':
          showStatus(currentT.savedSuccess, 'success');
          setHasChanges(false);
          break;
        case 'folderSelected':
          handleFolderSelected(msg.index, msg.path);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'ready' });

    return () => window.removeEventListener('message', handleMessage);
  }, [lang]);

  const showStatus = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setStatusMsg(msg);
    setStatusType(type);
    setTimeout(() => setStatusMsg(''), 3000);
  };

  const loadData = (newData: McdevData) => {
    setData(newData);
    const dirs = parseModDirs(newData.included_mod_dirs);
    setModDirs(dirs);
  };

  const parseModDirs = (dirs?: (string | ModDir)[]): ModDir[] => {
    if (!dirs || !Array.isArray(dirs)) return [{ path: './', hot_reload: true }];
    return dirs.map(item => {
      if (typeof item === 'string') return { path: item, hot_reload: true };
      if (item && typeof item === 'object') return { path: item.path || './', hot_reload: item.hot_reload !== false };
      return { path: './', hot_reload: true };
    });
  };

  const collectData = useCallback((): McdevData => {
    const allHotReload = modDirs.every(d => d.hot_reload);
    const includedModDirs = allHotReload
      ? modDirs.map(d => d.path)
      : modDirs.map(d => ({ path: d.path, hot_reload: d.hot_reload }));

    return {
      ...data,
      included_mod_dirs: includedModDirs,
    };
  }, [data, modDirs]);

  const performAutoSave = useCallback(() => {
    const saveData = collectData();
    vscode.postMessage({ type: 'save', content: JSON.stringify(saveData, null, 4) });
    setNeedsAutoSave(false);
    initializedComponentsRef.current.clear();
  }, [collectData]);

  const markInitialized = useCallback((componentId: string) => {
    initializedComponentsRef.current.add(componentId);
    
    if (needsAutoSave) {
      if (initTimerRef.current) {
        clearTimeout(initTimerRef.current);
      }
      
      initTimerRef.current = setTimeout(() => {
        performAutoSave();
      }, 100);
    }
  }, [needsAutoSave, performAutoSave]);

  const handleSave = useCallback(() => {
    const saveData = collectData();
    vscode.postMessage({ type: 'save', content: JSON.stringify(saveData, null, 4) });
  }, [collectData]);

  const handleFolderSelected = (index: number, path: string) => {
    if (index === -1) {
      setModDirs(prev => [...prev, { path, hot_reload: true }]);
    } else if (index >= 0) {
      setModDirs(prev => {
        if (index < prev.length) {
          const newDirs = [...prev];
          newDirs[index].path = path;
          return newDirs;
        }
        return prev;
      });
    }
    setHasChanges(true);
  };

  const handleKeyCapture = useCallback((key: string, keyCode: string) => {
    setData(prev => ({
      ...prev,
      debug_options: {
        ...prev.debug_options,
        [key]: keyCode,
      },
    }));
    setActiveKeyListener(null);
    setHasChanges(true);
  }, []);

  useEffect(() => {
    if (!needsAutoSave || initializedComponentsRef.current.size === 0) {
      return;
    }

    initTimerRef.current = setTimeout(() => {
      performAutoSave();
    }, 100);
    
    return () => {
      if (initTimerRef.current) {
        clearTimeout(initTimerRef.current);
      }
    };
  }, [needsAutoSave, performAutoSave]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (hasChanges) {
          handleSave();
        }
        return;
      }

      if (activeKeyListener) {
        e.preventDefault();
        if (e.keyCode === 27) { // ESC
          setActiveKeyListener(null);
          return;
        }
        handleKeyCapture(activeKeyListener, String(e.keyCode));
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeKeyListener, hasChanges, handleSave, handleKeyCapture]);

  const getKeyName = (code?: string): string => {
    if (!code) return '';
    const num = parseInt(code);
    const map: Record<number, string> = {
      8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'Shift', 17: 'Ctrl', 18: 'Alt', 27: 'Esc', 32: 'Space',
      37: 'Left', 38: 'Up', 39: 'Right', 40: 'Down', 46: 'Del',
      112: 'F1', 113: 'F2', 114: 'F3', 115: 'F4', 116: 'F5', 117: 'F6', 118: 'F7', 119: 'F8', 120: 'F9', 121: 'F10', 122: 'F11', 123: 'F12'
    };
    if (map[num]) return map[num];
    if (num >= 65 && num <= 90) return String.fromCharCode(num);
    if (num >= 48 && num <= 57) return String.fromCharCode(num);
    return 'Key' + num;
  };

  const handleDataChange = (field: string, value: any) => {
    setData(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleWindowStyleChange = (field: string, value: any) => {
    setData(prev => ({
      ...prev,
      window_style: {
        ...prev.window_style,
        [field]: value,
      },
    }));
    setHasChanges(true);
  };

  const handleExperimentChange = (field: string, checked: boolean) => {
    setData(prev => ({
      ...prev,
      experiment_options: {
        ...prev.experiment_options,
        [field]: checked,
      },
    }));
    setHasChanges(true);
  };

  const handleDebugOptionChange = (field: string, value: any) => {
    setData(prev => ({
      ...prev,
      debug_options: {
        ...prev.debug_options,
        [field]: value,
      },
    }));
    setHasChanges(true);
  };

  return (
    <div className="container">
      {/* Toolbar */}
      <div className="toolbar">
        <button className="btn-primary btn-run" onClick={() => vscode.postMessage({ type: 'runGame' })}>
          <span className="codicon codicon-play"></span>
          {t.runGame}
        </button>
      </div>

      {/* Status Bar */}
      <div className={`status-bar ${statusMsg ? 'visible' : ''} ${statusType}`}>
        {statusMsg || '\u00A0'}
      </div>

      {/* Mod Directories */}
      <ModDirectories
        t={t}
        modDirs={modDirs}
        setModDirs={setModDirs}
        setHasChanges={setHasChanges}
      />

      {/* World Settings */}
      <WorldSettings
        t={t}
        data={data}
        onDataChange={handleDataChange}
        onExperimentChange={handleExperimentChange}
        markInitialized={markInitialized}
      />

      {/* Game Options */}
      <GameOptions
        t={t}
        data={data}
        onDataChange={handleDataChange}
        markInitialized={markInitialized}
      />

      {/* User Settings */}
      <UserSettings
        t={t}
        data={data}
        onDataChange={handleDataChange}
      />

      {/* Window Style */}
      <WindowStyle
        t={t}
        windowStyle={data.window_style}
        onWindowStyleChange={handleWindowStyleChange}
        markInitialized={markInitialized}
      />

      {/* Debug Keybindings */}
      <DebugKeybindings
        t={t}
        debugOptions={data.debug_options}
        debugExpanded={debugExpanded}
        setDebugExpanded={setDebugExpanded}
        activeKeyListener={activeKeyListener}
        setActiveKeyListener={setActiveKeyListener}
        onDebugOptionChange={handleDebugOptionChange}
        getKeyName={getKeyName}
        markInitialized={markInitialized}
      />

      {/* Floating Save Button */}
      {hasChanges && (
        <div className="floating-save-container">
          <button className="btn-primary" onClick={handleSave}>
            <span className="codicon codicon-save"></span>
            {t.saveChanges}
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
