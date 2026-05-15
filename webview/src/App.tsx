import { useState, useEffect, useCallback, useRef } from "react";
import { vscode } from "./vscode";
import { i18n } from "./i18n";
import { ModDir, McdevData, WorldRules } from "./types";
import { ModDirectories } from "./components/ModDirectories";
import { WorldSettings, GAME_RULE_DEFAULTS } from "./components/WorldSettings";
import type { Tab } from "./components/WorldSettings";
import { GameOptions } from "./components/GameOptions";
import { UserSettings } from "./components/UserSettings";
import { WindowStyle } from "./components/WindowStyle";
import { SkinOptions } from "./components/SkinOptions";
import { DebugKeybindings } from "./components/DebugKeybindings";
import { LauncherSettings } from "./components/LauncherSettings";
import { McpServerConfig } from "./components/McpServerConfig";
import { AssistantMcpLink } from "./components/AssistantMcpLink";
import "./App.css";

function App() {
  const [lang, setLang] = useState<string>("en");
  const t = i18n[lang] || i18n.en;
  const [data, setData] = useState<McdevData>({});
  const [modDirs, setModDirs] = useState<ModDir[]>([
    { path: "./", hot_reload: true, enabled: true },
  ]);
  const [hasChanges, setHasChanges] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [statusType, setStatusType] = useState<"success" | "error" | "info">(
    "info",
  );
  const [debugExpanded, setDebugExpanded] = useState(false);
  const [activeKeyListener, setActiveKeyListener] = useState<string | null>(
    null,
  );
  const [needsAutoSave, setNeedsAutoSave] = useState(false);
  const [skinPreviewUrl, setSkinPreviewUrl] = useState<string | null>(null);
  const [worldTab, setWorldTab] = useState<Tab>("select");
  const [currentWorldRules, setCurrentWorldRules] = useState<WorldRules>({});
  const [worldRulesChanged, setWorldRulesChanged] = useState(false);

  const initializedComponentsRef = useRef<Set<string>>(new Set());
  const initTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Handle messages from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      const currentT = i18n[lang] || i18n.en;
      switch (msg.type) {
        case "init":
          // 设置语言
          if (msg.language) {
            setLang(msg.language.startsWith("zh") ? "zh" : "en");
          }
          const parsedData = JSON.parse(msg.content || "{}");

          if (msg.needsInitialSave) {
            setNeedsAutoSave(true);
          } else {
            loadData(parsedData, msg.skinPreviewUri);
          }

          showStatus(currentT.loaded, "success");
          setHasChanges(false);
          break;
        case "saved":
          showStatus(currentT.savedSuccess, "success");
          setHasChanges(false);
          break;
        case "folderSelected":
          handleFolderSelected(msg.index, msg.path);
          break;
        case "skinSelected":
          setData((prev) => ({
            ...prev,
            skin_info: {
              slim: prev.skin_info?.slim ?? false,
              skin: msg.path,
            },
          }));
          setSkinPreviewUrl(msg.previewUri || null);
          setHasChanges(true);
          break;
        case "skinPreview":
          setSkinPreviewUrl(msg.previewUri || null);
          break;
        case "gameExecutableSelected":
          setData((prev) => ({
            ...prev,
            game_executable_path: msg.path,
          }));
          setHasChanges(true);
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    vscode.postMessage({ type: "ready" });

    return () => window.removeEventListener("message", handleMessage);
  }, [lang]);

  const showStatus = (
    msg: string,
    type: "success" | "error" | "info" = "info",
  ) => {
    setStatusMsg(msg);
    setStatusType(type);
    setTimeout(() => setStatusMsg(""), 3000);
  };

  const loadData = (newData: McdevData, skinPreviewUri?: string) => {
    setData(newData);
    const dirs = parseModDirs(newData.included_mod_dirs);
    setModDirs(dirs);
    setSkinPreviewUrl(skinPreviewUri || null);
    // Load per-world rules for the current world
    const folder = newData.world_folder_name;
    if (folder && newData.world_rules?.[folder]) {
      setCurrentWorldRules(newData.world_rules[folder]);
    } else {
      setCurrentWorldRules({ ...GAME_RULE_DEFAULTS });
    }
    setWorldRulesChanged(false);
  };

  const parseModDirs = (dirs?: (string | ModDir)[]): ModDir[] => {
    if (!dirs || !Array.isArray(dirs))
      return [{ path: "./", hot_reload: true, enabled: true }];
    return dirs.map((item) => {
      if (typeof item === "string")
        return { path: item, hot_reload: true, enabled: true };
      if (item && typeof item === "object")
        return {
          path: item.path || "./",
          hot_reload: item.hot_reload !== false,
          enabled: item.enabled !== false,
        };
      return { path: "./", hot_reload: true, enabled: true };
    });
  };

  const collectData = useCallback((): McdevData => {
    const allDefault = modDirs.every((d) => d.hot_reload && d.enabled);
    const includedModDirs = allDefault
      ? modDirs.map((d) => d.path)
      : modDirs.map((d) => {
          const obj: any = { path: d.path };
          if (!d.hot_reload) obj.hot_reload = false;
          if (!d.enabled) obj.enabled = false;
          return Object.keys(obj).length === 1 ? d.path : obj;
        });

    // Merge current world rules into the world_rules map
    const folder = data.world_folder_name;
    const updatedWorldRules = { ...(data.world_rules || {}) };
    if (folder) {
      updatedWorldRules[folder] = { ...currentWorldRules };
    }

    return {
      ...data,
      included_mod_dirs: includedModDirs,
      world_rules: updatedWorldRules,
    };
  }, [data, modDirs, currentWorldRules]);

  const performAutoSave = useCallback(() => {
    const saveData = collectData();
    vscode.postMessage({
      type: "save",
      content: JSON.stringify(saveData, null, 4),
    });
    setNeedsAutoSave(false);
    initializedComponentsRef.current.clear();
  }, [collectData]);

  const markInitialized = useCallback(
    (componentId: string) => {
      initializedComponentsRef.current.add(componentId);

      if (needsAutoSave) {
        if (initTimerRef.current) {
          clearTimeout(initTimerRef.current);
        }

        initTimerRef.current = setTimeout(() => {
          performAutoSave();
        }, 100);
      }
    },
    [needsAutoSave, performAutoSave],
  );

  const handleSave = useCallback(() => {
    const saveData = collectData();
    vscode.postMessage({
      type: "save",
      content: JSON.stringify(saveData, null, 4),
    });
  }, [collectData]);

  const handleFolderSelected = (index: number, path: string) => {
    if (index === -1) {
      setModDirs((prev) => [
        ...prev,
        { path, hot_reload: true, enabled: true },
      ]);
    } else if (index >= 0) {
      setModDirs((prev) => {
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
    setData((prev) => ({
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
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (hasChanges) {
          handleSave();
        }
        return;
      }

      if (activeKeyListener) {
        e.preventDefault();
        if (e.keyCode === 27) {
          // ESC
          setActiveKeyListener(null);
          return;
        }
        handleKeyCapture(activeKeyListener, String(e.keyCode));
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeKeyListener, hasChanges, handleSave, handleKeyCapture]);

  const getKeyName = (code?: string): string => {
    if (!code) return "";
    const num = parseInt(code);
    const map: Record<number, string> = {
      8: "Backspace",
      9: "Tab",
      13: "Enter",
      16: "Shift",
      17: "Ctrl",
      18: "Alt",
      27: "Esc",
      32: "Space",
      37: "Left",
      38: "Up",
      39: "Right",
      40: "Down",
      46: "Del",
      112: "F1",
      113: "F2",
      114: "F3",
      115: "F4",
      116: "F5",
      117: "F6",
      118: "F7",
      119: "F8",
      120: "F9",
      121: "F10",
      122: "F11",
      123: "F12",
    };
    if (map[num]) return map[num];
    if (num >= 65 && num <= 90) return String.fromCharCode(num);
    if (num >= 48 && num <= 57) return String.fromCharCode(num);
    return "Key" + num;
  };

  const handleDataChange = (field: string, value: any) => {
    setData((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleWindowStyleChange = (field: string, value: any) => {
    setData((prev) => ({
      ...prev,
      window_style: {
        ...prev.window_style,
        [field]: value,
      },
    }));
    setHasChanges(true);
  };

  const handleSkinInfoChange = (field: string, value: any) => {
    setData((prev) => ({
      ...prev,
      skin_info: {
        slim: prev.skin_info?.slim ?? false,
        skin: prev.skin_info?.skin ?? "",
        [field]: value,
      },
    }));
    if (field === "skin") {
      const text = (value || "").trim();
      if (!text) {
        setSkinPreviewUrl(null);
      } else {
        vscode.postMessage({ type: "updateSkinPreview", path: value });
      }
    }
    setHasChanges(true);
  };

  const handleExperimentChange = (field: string, checked: boolean) => {
    setData((prev) => ({
      ...prev,
      experiment_options: {
        ...prev.experiment_options,
        [field]: checked,
      },
    }));
    setHasChanges(true);
  };

  const handleWorldRuleChange = (field: string, value: any) => {
    setCurrentWorldRules((prev) => ({ ...prev, [field]: value }));
    setWorldRulesChanged(true);
    setHasChanges(true);
  };

  const handleWorldExperimentChange = (field: string, checked: boolean) => {
    setCurrentWorldRules((prev) => ({
      ...prev,
      experiment_options: {
        ...prev.experiment_options,
        [field]: checked,
      },
    }));
    setWorldRulesChanged(true);
    setHasChanges(true);
  };

  const handleSwitchWorld = useCallback(
    (folderName: string, displayName: string) => {
      if (hasChanges || worldRulesChanged) {
        const currentT = i18n[lang] || i18n.en;
        const doSave = window.confirm(currentT.unsavedChangesPrompt);
        if (doSave) {
          handleSave();
        }
      }

      // Save current world's rules before switching
      const oldFolder = data.world_folder_name;
      const updatedRules = { ...(data.world_rules || {}) };
      if (oldFolder) {
        updatedRules[oldFolder] = { ...currentWorldRules };
      }

      // Load new world's rules
      const newRules = updatedRules[folderName] || { ...GAME_RULE_DEFAULTS };

      setData((prev) => ({
        ...prev,
        world_folder_name: folderName,
        world_name: displayName,
        world_rules: updatedRules,
      }));
      setCurrentWorldRules(newRules);
      setWorldRulesChanged(false);
      setHasChanges(true);
    },
    [data.world_folder_name, data.world_rules, currentWorldRules, hasChanges, worldRulesChanged, lang, handleSave],
  );

  const handleDebugOptionChange = (field: string, value: any) => {
    setData((prev) => ({
      ...prev,
      debug_options: {
        ...prev.debug_options,
        [field]: value,
      },
    }));
    setHasChanges(true);
  };

  const handleMcpServerConfigChange = (field: string, value: any) => {
    setData(prev => ({
      ...prev,
      mcp_server_config: {
        ...prev.mcp_server_config,
        [field]: value,
      },
    }));
    setHasChanges(true);
  };

  return (
    <div className="container">
      {/* Toolbar */}
      <div className="toolbar">
        <button
          className="btn-primary btn-run"
          onClick={() => vscode.postMessage({ type: "runGame" })}
          title={t.runGameTooltip}
        >
          <span className="codicon codicon-play"></span>
          {t.runGame}
        </button>
        <button
          className="btn-primary btn-debug"
          onClick={() => vscode.postMessage({ type: "startDebug" })}
          title={t.startDebugTooltip}
        >
          <span className="codicon codicon-debug-alt"></span>
        </button>
      </div>

      {/* Status Bar */}
      <div className={`status-bar ${statusMsg ? "visible" : ""} ${statusType}`}>
        {statusMsg || "\u00A0"}
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
        currentWorldFolder={data.world_folder_name}
        currentWorldName={data.world_name}
        onSwitchWorld={handleSwitchWorld}
        tab={worldTab}
        onTabChange={setWorldTab}
        worldRules={currentWorldRules}
        onWorldRuleChange={handleWorldRuleChange}
        onWorldExperimentChange={handleWorldExperimentChange}
      />

      {/* Game Options */}
      <GameOptions
        t={t}
        data={data}
        onDataChange={handleDataChange}
        markInitialized={markInitialized}
      />

      {/* User Settings */}
      <UserSettings t={t} data={data} onDataChange={handleDataChange} />

      {/* Launcher Settings */}
      <LauncherSettings
        t={t}
        gameExecutablePath={data.game_executable_path || ""}
        onGameExecutablePathChange={(path) => {
          setData((prev) => ({
            ...prev,
            game_executable_path: path || undefined,
          }));
          setHasChanges(true);
        }}
      />

      {/* MCP Server Config */}
      <McpServerConfig
        t={t}
        mcpServerConfig={data.mcp_server_config}
        onMcpServerConfigChange={handleMcpServerConfigChange}
        markInitialized={markInitialized}
      />

      {/* Assistant MCP Link */}
      <AssistantMcpLink t={t} />

      {/* Window Style */}
      <WindowStyle
        t={t}
        windowStyle={data.window_style}
        onWindowStyleChange={handleWindowStyleChange}
        markInitialized={markInitialized}
      />

      {/* Skin Options */}
      <SkinOptions
        t={t}
        skinInfo={data.skin_info}
        previewUrl={skinPreviewUrl}
        onSkinInfoChange={handleSkinInfoChange}
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
