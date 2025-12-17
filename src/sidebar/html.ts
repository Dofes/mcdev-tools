import { sidebarStyle } from './style';
import { sidebarScript } from './script';
import { i18n } from './i18n';

/**
 * 生成侧边栏 Webview 的 HTML 内容
 */
export function getSidebarHtml(nonce: string, vscodeLanguage?: string): string {
    // Default to English, use Chinese if VS Code is set to Chinese
    const lang = (vscodeLanguage && vscodeLanguage.startsWith('zh')) ? 'zh' : 'en';
    const t = i18n[lang];

    return `<!doctype html>
<html lang="${lang}">
<head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' https:; font-src 'unsafe-inline' https:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mcdev Editor</title>
    <link href="https://unpkg.com/@vscode/codicons/dist/codicon.css" rel="stylesheet" />
    <style>
        ${sidebarStyle}
    </style>
</head>
<body>
    <div class="container">
        <div class="toolbar">
            <button class="btn-primary" id="saveBtn">
                <span class="codicon codicon-save"></span>
                ${t.save}
            </button>
            <button class="btn-secondary" id="reloadBtn" title="${t.reload}">
                <span class="codicon codicon-refresh"></span>
            </button>
        </div>
        <div id="status" class="status-bar" style="margin-bottom: 12px; min-height: 16px;"></div>

        <div class="section">
            <div class="section-header-plain">
                <span class="section-title">
                    <span class="codicon codicon-folder-opened"></span>
                    ${t.modDirectories}
                </span>
            </div>
            <div class="mod-list" id="modDirsList"></div>
            <div style="margin-top: 8px; display: flex; gap: 8px;">
                <button class="btn-secondary" id="addDirBtn">
                    <span class="codicon codicon-add"></span> ${t.addDirectory}
                </button>
                <button class="btn-secondary" id="browseDirBtn">
                    <span class="codicon codicon-folder"></span> ${t.browse}
                </button>
            </div>
        </div>

        <div class="section">
            <div class="section-header-plain">
                <span class="section-title">
                    <span class="codicon codicon-globe"></span>
                    ${t.worldSettings}
                </span>
            </div>
            <div class="control-group">
                <label for="world_name">${t.worldName}</label>
                <input type="text" id="world_name" placeholder="MC_DEV_WORLD" />
            </div>
            <div class="control-group">
                <label for="world_folder_name">${t.worldFolder}</label>
                <input type="text" id="world_folder_name" placeholder="MC_DEV_WORLD" />
            </div>
            <div class="control-group">
                <label for="world_seed">${t.worldSeed}</label>
                <input type="text" id="world_seed" placeholder="${t.worldSeed}" />
            </div>
            <div class="control-group">
                <label for="world_type">${t.worldType}</label>
                <select id="world_type">
                    <option value="0">${t.default}</option>
                    <option value="1">${t.flat}</option>
                    <option value="2">${t.old}</option>
                </select>
            </div>
            <div class="control-group">
                <label for="game_mode">${t.gameMode}</label>
                <select id="game_mode">
                    <option value="0">${t.survival}</option>
                    <option value="1">${t.creative}</option>
                    <option value="2">${t.adventure}</option>
                    <option value="3">${t.spectator}</option>
                </select>
            </div>
        </div>

        <div class="section">
            <div class="section-header-plain">
                <span class="section-title">
                    <span class="codicon codicon-settings-gear"></span>
                    ${t.gameOptions}
                </span>
            </div>
            <div class="checkbox-group">
                <input type="checkbox" id="reset_world" />
                <label for="reset_world">${t.resetWorld}</label>
            </div>
            <div class="checkbox-group">
                <input type="checkbox" id="auto_join_game" />
                <label for="auto_join_game">${t.autoJoin}</label>
            </div>
            <div class="checkbox-group">
                <input type="checkbox" id="include_debug_mod" />
                <label for="include_debug_mod">${t.includeDebug}</label>
            </div>
            <div class="checkbox-group">
                <input type="checkbox" id="auto_hot_reload_mods" />
                <label for="auto_hot_reload_mods">${t.autoHotReload}</label>
            </div>
            <div class="checkbox-group">
                <input type="checkbox" id="enable_cheats" />
                <label for="enable_cheats">${t.enableCheats}</label>
            </div>
            <div class="checkbox-group">
                <input type="checkbox" id="keep_inventory" />
                <label for="keep_inventory">${t.keepInventory}</label>
            </div>
        </div>

        <div class="section">
            <div class="section-header-plain">
                <span class="section-title">
                    <span class="codicon codicon-account"></span>
                    ${t.userSettings}
                </span>
            </div>
            <div class="control-group">
                <label for="user_name">${t.userName}</label>
                <input type="text" id="user_name" placeholder="developer" />
            </div>
        </div>

        <div class="section collapsed">
            <div class="section-header" id="debugToggle">
                <span class="section-title">
                    <span class="codicon codicon-chevron-right"></span>
                    ${t.debugKeybindings}
                </span>
            </div>
            <div class="collapsible-content" id="debugContent">
                <div class="control-group">
                    <label>Reload Scripts</label>
                    <div class="keybind-display" data-key="reload_key"></div>
                </div>
                <div class="control-group">
                    <label>Reload World</label>
                    <div class="keybind-display" data-key="reload_world_key"></div>
                </div>
                <div class="control-group">
                    <label>Reload Addons</label>
                    <div class="keybind-display" data-key="reload_addon_key"></div>
                </div>
                <div class="control-group">
                    <label>Reload Shaders</label>
                    <div class="keybind-display" data-key="reload_shaders_key"></div>
                </div>
                <div class="checkbox-group" style="margin-top: 12px;">
                    <input type="checkbox" id="reload_key_global" />
                    <label for="reload_key_global">${t.globalReloadKey}</label>
                </div>
            </div>
        </div>
    </div>

    <script nonce="${nonce}">
        window.mcdevI18n = ${JSON.stringify(t)};
        ${sidebarScript}
    </script>
</body>
</html>`;
}

