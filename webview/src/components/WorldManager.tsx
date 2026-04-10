import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { I18nText } from "../i18n";
import { WorldInfo } from "../types";
import { vscode } from "../vscode";

interface Props {
  t: I18nText;
  currentWorldFolder?: string;
  onSwitchWorld: (folderName: string, displayName: string) => void;
  embedded?: boolean;
}

type SortKey = "date" | "name";
type SortDir = "asc" | "desc";

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1073741824).toFixed(1) + " GB";
};

export const WorldManager: React.FC<Props> = ({
  t,
  currentWorldFolder,
  onSwitchWorld,
  embedded = false,
}) => {
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renamingRef = useRef(false);

  const requestWorlds = useCallback(() => {
    setLoading(true);
    setError(false);
    setSelected(new Set());
    vscode.postMessage({ type: "listWorlds" });
  }, []);

  useEffect(() => {
    requestWorlds();
  }, [requestWorlds]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === "worldsList") {
        const list: WorldInfo[] = (msg.worlds || []).map((w: any) => ({
          folderName: w.folderName,
          displayName: w.displayName,
          lastModified: w.lastModified,
          size: w.size,
          isCurrent: false,
        }));
        setWorlds(list);
        setLoading(false);
        setError(false);
      } else if (msg.type === "worldsListError") {
        setLoading(false);
        setError(true);
      } else if (
        msg.type === "worldDeleted" ||
        msg.type === "worldRenamed" ||
        msg.type === "worldCopied"
      ) {
        setSelected(new Set());
        setRenamingFolder(null);
        requestWorlds();
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [requestWorlds]);

  const filtered = useMemo(() => {
    let list = worlds.map((w) => ({
      ...w,
      isCurrent: w.folderName === currentWorldFolder,
    }));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (w) =>
          w.displayName.toLowerCase().includes(q) ||
          w.folderName.toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => {
      let cmp =
        sortKey === "name"
          ? a.displayName.localeCompare(b.displayName)
          : a.lastModified - b.lastModified;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [worlds, search, sortKey, sortDir, currentWorldFolder]);

  const allSelected =
    filtered.length > 0 && filtered.every((w) => selected.has(w.folderName));

  const toggleMultiSelect = () => {
    if (multiSelect) {
      setSelected(new Set());
    }
    setMultiSelect((prev) => !prev);
  };

  const toggleSelect = (folderName: string) => {
    if (!multiSelect) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(folderName)) next.delete(folderName);
      else next.add(folderName);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((w) => next.delete(w.folderName));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((w) => next.add(w.folderName));
        return next;
      });
    }
  };

  const handleDeleteSingle = (e: React.MouseEvent, world: WorldInfo) => {
    e.stopPropagation();
    vscode.postMessage({
      type: "deleteWorld",
      folderName: world.folderName,
      displayName: world.displayName,
      isCurrent: world.isCurrent,
    });
  };

  const handleDeleteSelected = () => {
    const toDelete = worlds
      .filter((w) => selected.has(w.folderName))
      .map((w) => ({
        ...w,
        isCurrent: w.folderName === currentWorldFolder,
      }));
    if (toDelete.length === 0) return;
    if (toDelete.length === 1) {
      vscode.postMessage({
        type: "deleteWorld",
        folderName: toDelete[0].folderName,
        displayName: toDelete[0].displayName,
        isCurrent: toDelete[0].isCurrent,
      });
      return;
    }
    vscode.postMessage({
      type: "deleteWorlds",
      worlds: toDelete.map((w) => ({
        folderName: w.folderName,
        displayName: w.displayName,
        isCurrent: w.isCurrent,
      })),
    });
  };

  const handleLoadWorld = (e: React.MouseEvent, world: WorldInfo) => {
    e.stopPropagation();
    onSwitchWorld(world.folderName, world.displayName);
  };

  const startRename = (e: React.MouseEvent, world: WorldInfo) => {
    e.stopPropagation();
    renamingRef.current = false;
    setRenamingFolder(world.folderName);
    setRenameValue(world.displayName);
  };

  const commitRename = () => {
    if (renamingRef.current) return;
    renamingRef.current = true;
    if (renamingFolder && renameValue.trim()) {
      vscode.postMessage({
        type: "renameWorld",
        folderName: renamingFolder,
        newName: renameValue.trim(),
      });
    }
    setRenamingFolder(null);
  };

  const handleCopy = (e: React.MouseEvent, world: WorldInfo) => {
    e.stopPropagation();
    vscode.postMessage({ type: "copyWorld", folderName: world.folderName });
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "date" ? "desc" : "asc");
    }
  };

  const formatDate = (timestamp: number): string => {
    if (!timestamp) return "";
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    const isChinese = t._locale === "zh";

    if (mins < 1) return isChinese ? "刚刚" : "just now";
    if (mins < 60) return isChinese ? `${mins} 分钟前` : `${mins}m ago`;
    if (hours < 24) return isChinese ? `${hours} 小时前` : `${hours}h ago`;
    if (days < 7) return isChinese ? `${days} 天前` : `${days}d ago`;

    const d = new Date(timestamp);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const content = (
    <>
      {loading && <div className="world-status">{t.worldManagerLoading}</div>}
      {error && !loading && (
        <div className="world-status error">{t.worldManagerError}</div>
      )}
      {!loading && !error && worlds.length === 0 && (
        <div className="world-status">{t.worldManagerEmpty}</div>
      )}

      {!loading && !error && worlds.length > 0 && (
        <>
          <div className="world-toolbar">
            <input
              type="text"
              placeholder={t.worldManagerSearch}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              className="btn-icon"
              onClick={() => toggleSort("date")}
              title={t.worldManagerSortDate}
            >
              <span className="codicon codicon-history"></span>
              {sortKey === "date" && (
                <span
                  className={
                    "codicon codicon-arrow-" +
                    (sortDir === "asc" ? "up" : "down")
                  }
                ></span>
              )}
            </button>
            <button
              className="btn-icon"
              onClick={() => toggleSort("name")}
              title={t.worldManagerSortName}
            >
              <span className="codicon codicon-case-sensitive"></span>
              {sortKey === "name" && (
                <span
                  className={
                    "codicon codicon-arrow-" +
                    (sortDir === "asc" ? "up" : "down")
                  }
                ></span>
              )}
            </button>
            <button
              className={"btn-icon" + (multiSelect ? " active" : "")}
              onClick={toggleMultiSelect}
              title={t.worldManagerMultiSelect}
            >
              <span className="codicon codicon-checklist"></span>
            </button>
            <button
              className="btn-icon"
              onClick={requestWorlds}
              title={t.worldManagerRefresh}
            >
              <span className="codicon codicon-refresh"></span>
            </button>
          </div>

          {multiSelect && (
            <div className="world-batch">
              <div className="checkbox-group">
                <input
                  type="checkbox"
                  id="world-select-all"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                />
                <label htmlFor="world-select-all">
                  {allSelected
                    ? t.worldManagerDeselectAll
                    : t.worldManagerSelectAll}
                </label>
              </div>
              {selected.size > 0 && (
                <button
                  className="btn-icon delete"
                  onClick={handleDeleteSelected}
                  title={t.worldManagerDeleteSelected}
                >
                  <span className="codicon codicon-trash"></span>
                  {selected.size}
                </button>
              )}
            </div>
          )}

          <div className="world-list">
            {filtered.length === 0 && (
              <div className="world-status">{t.worldManagerEmpty}</div>
            )}
            {filtered.map((world) => {
              const isSelected = selected.has(world.folderName);
              const isRenaming = renamingFolder === world.folderName;
              return (
                <div
                  key={world.folderName}
                  className={
                    "world-item" +
                    (world.isCurrent ? " current" : "") +
                    (isSelected ? " selected" : "")
                  }
                  onClick={() => toggleSelect(world.folderName)}
                >
                  {multiSelect && (
                    <input
                      type="checkbox"
                      className="world-item-cb"
                      checked={isSelected}
                      onChange={() => toggleSelect(world.folderName)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                  <div className="world-item-info">
                    <div className="world-item-name">
                      {isRenaming ? (
                        <input
                          type="text"
                          className="world-rename-input"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            if (e.key === "Escape") {
                              renamingRef.current = true;
                              setRenamingFolder(null);
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          autoFocus
                        />
                      ) : (
                        <>
                          {world.displayName}
                          {world.isCurrent && (
                            <span
                              className="world-badge"
                              title={t.worldManagerCurrentWarning}
                            >
                              {t.worldManagerCurrent}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    <div className="world-item-meta">
                      {world.folderName} · {formatDate(world.lastModified)} ·{" "}
                      {formatSize(world.size)}
                    </div>
                  </div>
                  <div className="world-item-actions">
                    {!world.isCurrent && (
                      <button
                        className="btn-icon"
                        onClick={(e) => handleLoadWorld(e, world)}
                        title={t.worldManagerLoad}
                      >
                        <span className="codicon codicon-play"></span>
                      </button>
                    )}
                    <button
                      className="btn-icon"
                      onClick={(e) => startRename(e, world)}
                      title={t.worldManagerRename}
                    >
                      <span className="codicon codicon-edit"></span>
                    </button>
                    <button
                      className="btn-icon"
                      onClick={(e) => handleCopy(e, world)}
                      title={t.worldManagerCopy}
                    >
                      <span className="codicon codicon-copy"></span>
                    </button>
                    <button
                      className="btn-icon delete"
                      onClick={(e) => handleDeleteSingle(e, world)}
                      title={t.worldManagerDelete}
                    >
                      <span className="codicon codicon-trash"></span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="section">
      <div className="section-header-plain">
        <span className="section-title">
          <span className="codicon codicon-map"></span>
          {t.worldManager}
          {!loading && !error && worlds.length > 0 && (
            <span className="world-count">{worlds.length}</span>
          )}
        </span>
      </div>
      {content}
    </div>
  );
};
