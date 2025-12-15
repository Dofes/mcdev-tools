import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as net from 'net';
import * as fs from 'fs';

/** 调试会话信息 */
interface DebugSessionInfo {
    pid: number;
    port: number;
    mcdbgProcess: cp.ChildProcess;
    sessionName: string;
}

// 跟踪所有活动的调试会话（键: 进程 PID）
const activeDebugSessions = new Map<number, DebugSessionInfo>();
let extensionContext: vscode.ExtensionContext;
// 追踪通过 runGame 启动的外部进程，确保在 deactivate 时清理
// const runProcesses = new Set<cp.ChildProcess>();

/** 侧边栏 Webview 提供者，用于可视化编辑 .mcdev.json */
class McdevSidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(webviewView: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
        try {
            console.log('McdevSidebarProvider.resolveWebviewView called');
            this._view = webviewView;
            const webview = webviewView.webview;

            webview.options = {
                enableScripts: true,
                localResourceRoots: [this._extensionUri]
            };

            webviewView.webview.html = this.getHtmlForWebview(webview);

            // 立即通知前端已注册
            try { webview.postMessage({ type: 'providerRegistered' }); } catch (e) { console.error('postMessage(providerRegistered) failed', e); }

            webview.onDidReceiveMessage(async (msg) => {
            if (msg?.type === 'ready') {
                // 读取工作区根目录下的 .mcdev.json，如果不存在则作为 {}
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceFolder) {
                    webview.postMessage({ type: 'init', content: '{}' });
                    return;
                }

                const mcdevPath = path.join(workspaceFolder.uri.fsPath, '.mcdev.json');
                try {
                    if (fs.existsSync(mcdevPath)) {
                        const content = fs.readFileSync(mcdevPath, 'utf8');
                        webview.postMessage({ type: 'init', content });
                    } else {
                        webview.postMessage({ type: 'init', content: '{}' });
                    }
                } catch (e) {
                    webview.postMessage({ type: 'init', content: '{}', error: String(e) });
                }
            } else if (msg?.type === 'save') {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceFolder) {
                    vscode.window.showErrorMessage('请先打开工作区以保存 .mcdev.json');
                    return;
                }
                const mcdevPath = path.join(workspaceFolder.uri.fsPath, '.mcdev.json');
                try {
                    fs.writeFileSync(mcdevPath, msg.content, 'utf8');
                    vscode.window.showInformationMessage('.mcdev.json 已保存');
                } catch (e) {
                    vscode.window.showErrorMessage(`保存 .mcdev.json 失败: ${e}`);
                }
            } else if (msg?.type === 'browseFolder') {
                // 打开文件夹选择对话框
                const result = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: '选择 MOD 目录',
                    title: '选择 MOD 目录'
                });
                if (result && result.length > 0) {
                    webview.postMessage({ 
                        type: 'folderSelected', 
                        index: msg.index,
                        path: result[0].fsPath 
                    });
                }
            }
            });
        } catch (err) {
            console.error('resolveWebviewView top-level error', err);
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = getNonce();
        return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mcdev Editor</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: var(--vscode-font-family); font-size: 13px; padding: 12px; margin: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
    h3 { margin: 0 0 12px 0; font-size: 14px; border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 8px; }
    .section { margin-bottom: 16px; }
    .section-title { font-weight: bold; margin-bottom: 8px; color: var(--vscode-descriptionForeground); font-size: 11px; text-transform: uppercase; }
    .field { margin-bottom: 10px; }
    .field label { display: block; margin-bottom: 4px; font-weight: 500; }
    .field input[type="text"], .field input[type="number"], .field select, .field textarea {
      width: 100%; padding: 6px 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 2px;
    }
    .field input:focus, .field select:focus, .field textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
    .field textarea { resize: vertical; min-height: 60px; font-family: monospace; font-size: 12px; }
    .checkbox-field { display: flex; align-items: center; margin-bottom: 8px; }
    .checkbox-field input { margin-right: 8px; }
    .checkbox-field label { margin: 0; font-weight: normal; }
    .btn { padding: 6px 14px; border: none; cursor: pointer; border-radius: 2px; font-size: 13px; }
    .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
    .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); margin-left: 8px; }
    .toolbar { display: flex; margin-bottom: 16px; }
    .status { margin-left: 12px; font-size: 12px; color: var(--vscode-descriptionForeground); line-height: 28px; }
    .collapsible { cursor: pointer; user-select: none; }
    .collapsible::before { content: '▼ '; font-size: 10px; }
    .collapsible.collapsed::before { content: '▶ '; }
    .collapsible-content { margin-top: 8px; }
    .collapsible.collapsed + .collapsible-content { display: none; }
    
    /* MOD 目录列表样式 */
    .mod-dirs-list { margin-bottom: 8px; }
    .mod-dir-item { 
      display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; 
      padding: 10px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-input-border); border-radius: 4px;
    }
    .mod-dir-row { display: flex; align-items: center; gap: 6px; }
    .mod-dir-item input[type="text"] { 
      flex: 1; margin: 0; padding: 5px 8px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px;
      background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); color: var(--vscode-input-foreground); border-radius: 2px;
    }
    .mod-dir-item input[type="text"]:focus { outline: 1px solid var(--vscode-focusBorder); }
    .mod-dir-options { display: flex; align-items: center; justify-content: space-between; }
    .hot-reload-wrap { display: flex; align-items: center; font-size: 12px; color: var(--vscode-descriptionForeground); }
    .hot-reload-wrap input { margin: 0 6px 0 0; width: 14px; height: 14px; }
    .btn-icon { 
      width: 22px; height: 22px; padding: 0; display: flex; align-items: center; justify-content: center;
      background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
      border: none; border-radius: 3px; cursor: pointer; font-size: 12px; flex-shrink: 0;
    }
    .btn-icon:hover { background: var(--vscode-button-hoverBackground); color: var(--vscode-button-foreground); }
    .btn-icon.delete { color: var(--vscode-errorForeground); }
    .btn-icon.delete:hover { background: var(--vscode-inputValidation-errorBackground); }
    .btn-icon.browse { font-size: 11px; width: auto; padding: 0 6px; }
    .btn-add-row { display: flex; gap: 8px; margin-top: 4px; }
    .btn-add-row .btn { margin: 0; }
    .empty-hint { color: var(--vscode-descriptionForeground); font-style: italic; font-size: 12px; margin: 8px 0; }
    
    /* 键位绑定样式 */
    .keybind-field { margin-bottom: 10px; }
    .keybind-field label { display: block; margin-bottom: 4px; font-weight: 500; font-size: 12px; }
    .keybind-row { display: flex; align-items: center; gap: 6px; }
    .keybind-display {
      flex: 1; padding: 6px 10px; min-height: 28px;
      background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); 
      color: var(--vscode-input-foreground); border-radius: 3px; font-family: monospace; font-size: 12px;
      cursor: pointer; display: flex; align-items: center; justify-content: space-between;
    }
    .keybind-display:hover { border-color: var(--vscode-focusBorder); }
    .keybind-display.listening {
      border-color: var(--vscode-inputValidation-infoBorder); 
      background: var(--vscode-inputValidation-infoBackground);
      animation: pulse 1s infinite;
    }
    .keybind-display .key-name { color: var(--vscode-foreground); }
    .keybind-display .key-code { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .keybind-display .placeholder { color: var(--vscode-descriptionForeground); font-style: italic; }
    .keybind-display .listening-hint { color: var(--vscode-inputValidation-infoForeground, #3794ff); }
    .btn-clear { padding: 4px 8px; font-size: 11px; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
  </style>
</head>
<body>
  <h3>MCDEV游戏配置</h3>
  
  <div class="toolbar">
    <button class="btn btn-primary" id="saveBtn">保存</button>
    <button class="btn btn-secondary" id="reloadBtn">重新加载</button>
    <span class="status" id="status"></span>
  </div>

  <div class="section">
    <div class="section-title">MOD 目录</div>
    <div class="mod-dirs-list" id="modDirsList"></div>
    <div class="btn-add-row">
      <button class="btn btn-secondary" id="addDirBtn">+ 手动添加</button>
      <button class="btn btn-secondary" id="browseDirBtn">📁 浏览文件夹</button>
    </div>
  </div>

  <div class="section">
    <div class="section-title">世界设置</div>
    <div class="field">
      <label>world_name (世界显示名称)</label>
      <input type="text" id="world_name" placeholder="MC_DEV_WORLD" />
    </div>
    <div class="field">
      <label>world_folder_name (存档目录名)</label>
      <input type="text" id="world_folder_name" placeholder="MC_DEV_WORLD" />
    </div>
    <div class="field">
      <label>world_seed (种子，留空随机)</label>
      <input type="text" id="world_seed" placeholder="null 或数字" />
    </div>
    <div class="field">
      <label>world_type (世界类型)</label>
      <select id="world_type">
        <option value="0">0 - 旧版有限世界</option>
        <option value="1">1 - 无限世界</option>
        <option value="2">2 - 超平坦</option>
      </select>
    </div>
    <div class="field">
      <label>game_mode (游戏模式)</label>
      <select id="game_mode">
        <option value="0">0 - 生存</option>
        <option value="1">1 - 创造</option>
        <option value="2">2 - 冒险</option>
      </select>
    </div>
  </div>

  <div class="section">
    <div class="section-title">游戏选项</div>
    <div class="checkbox-field"><input type="checkbox" id="reset_world" /><label for="reset_world">reset_world (启动时重置世界)</label></div>
    <div class="checkbox-field"><input type="checkbox" id="auto_join_game" /><label for="auto_join_game">auto_join_game (自动进入存档)</label></div>
    <div class="checkbox-field"><input type="checkbox" id="include_debug_mod" /><label for="include_debug_mod">include_debug_mod (附加调试MOD)</label></div>
    <div class="checkbox-field" style="margin-left: 20px;"><input type="checkbox" id="auto_hot_reload_mods" /><label for="auto_hot_reload_mods">auto_hot_reload_mods (自动热更新)</label></div>
    <div class="checkbox-field"><input type="checkbox" id="enable_cheats" /><label for="enable_cheats">enable_cheats (启用作弊)</label></div>
    <div class="checkbox-field"><input type="checkbox" id="keep_inventory" /><label for="keep_inventory">keep_inventory (死亡不掉落)</label></div>
  </div>

  <div class="section">
    <div class="section-title">用户设置</div>
    <div class="field">
      <label>user_name (用户名)</label>
      <input type="text" id="user_name" placeholder="developer" />
    </div>
  </div>

  <div class="section">
    <div class="section-title collapsible" id="debugToggle">调试选项 (debug_options)</div>
    <div class="collapsible-content" id="debugContent">
      <div class="keybind-field">
        <label>reload_key (热更新键)</label>
        <div class="keybind-row">
          <div class="keybind-display" data-key="reload_key"><span class="placeholder">点击设置按键...</span></div>
          <button class="btn btn-secondary btn-clear" data-key="reload_key">清除</button>
        </div>
      </div>
      <div class="keybind-field">
        <label>reload_world_key (重载世界键)</label>
        <div class="keybind-row">
          <div class="keybind-display" data-key="reload_world_key"><span class="placeholder">点击设置按键...</span></div>
          <button class="btn btn-secondary btn-clear" data-key="reload_world_key">清除</button>
        </div>
      </div>
      <div class="keybind-field">
        <label>reload_addon_key (重载Addon键)</label>
        <div class="keybind-row">
          <div class="keybind-display" data-key="reload_addon_key"><span class="placeholder">点击设置按键...</span></div>
          <button class="btn btn-secondary btn-clear" data-key="reload_addon_key">清除</button>
        </div>
      </div>
      <div class="keybind-field">
        <label>reload_shaders_key (重载着色器键)</label>
        <div class="keybind-row">
          <div class="keybind-display" data-key="reload_shaders_key"><span class="placeholder">点击设置按键...</span></div>
          <button class="btn btn-secondary btn-clear" data-key="reload_shaders_key">清除</button>
        </div>
      </div>
      <div class="checkbox-field"><input type="checkbox" id="reload_key_global" /><label for="reload_key_global">reload_key_global (全局触发热更新)</label></div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let currentData = {};
    let modDirs = []; // MOD目录列表
    
    // 键位绑定数据
    const keyBindings = {
      reload_key: '',
      reload_world_key: '',
      reload_addon_key: '',
      reload_shaders_key: ''
    };
    let activeKeyListener = null; // 当前正在监听的键位字段

    // 字段映射（移除了键位字段，单独处理）
    const fields = {
      text: ['world_name', 'world_folder_name', 'world_seed', 'user_name'],
      select: ['world_type', 'game_mode'],
      checkbox: ['reset_world', 'auto_join_game', 'include_debug_mod', 'enable_cheats', 'keep_inventory', 'auto_hot_reload_mods', 'reload_key_global']
    };

    // 键码到键名的映射
    const keyCodeMap = {
      8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'Shift', 17: 'Ctrl', 18: 'Alt',
      19: 'Pause', 20: 'CapsLock', 27: 'Escape', 32: 'Space', 33: 'PageUp', 34: 'PageDown',
      35: 'End', 36: 'Home', 37: 'Left', 38: 'Up', 39: 'Right', 40: 'Down',
      45: 'Insert', 46: 'Delete',
      48: '0', 49: '1', 50: '2', 51: '3', 52: '4', 53: '5', 54: '6', 55: '7', 56: '8', 57: '9',
      65: 'A', 66: 'B', 67: 'C', 68: 'D', 69: 'E', 70: 'F', 71: 'G', 72: 'H', 73: 'I',
      74: 'J', 75: 'K', 76: 'L', 77: 'M', 78: 'N', 79: 'O', 80: 'P', 81: 'Q', 82: 'R',
      83: 'S', 84: 'T', 85: 'U', 86: 'V', 87: 'W', 88: 'X', 89: 'Y', 90: 'Z',
      91: 'Win', 93: 'Menu',
      96: 'Num0', 97: 'Num1', 98: 'Num2', 99: 'Num3', 100: 'Num4',
      101: 'Num5', 102: 'Num6', 103: 'Num7', 104: 'Num8', 105: 'Num9',
      106: 'Num*', 107: 'Num+', 109: 'Num-', 110: 'Num.', 111: 'Num/',
      112: 'F1', 113: 'F2', 114: 'F3', 115: 'F4', 116: 'F5', 117: 'F6',
      118: 'F7', 119: 'F8', 120: 'F9', 121: 'F10', 122: 'F11', 123: 'F12',
      144: 'NumLock', 145: 'ScrollLock',
      186: ';', 187: '=', 188: ',', 189: '-', 190: '.', 191: '/', 192: '\`',
      219: '[', 220: '\\\\', 221: ']', 222: \"'\"
    };

    function getKeyName(code) {
      if (!code) return '';
      const num = parseInt(code);
      return keyCodeMap[num] || \`Key\${num}\`;
    }

    function showStatus(msg, isError) {
      const el = document.getElementById('status');
      el.textContent = msg;
      el.style.color = isError ? 'var(--vscode-errorForeground)' : 'var(--vscode-descriptionForeground)';
      setTimeout(() => el.textContent = '', 3000);
    }

    // 更新键位显示
    function updateKeyBindDisplay(key) {
      const display = document.querySelector(\`.keybind-display[data-key=\"\${key}\"]\`);
      if (!display) return;
      
      const code = keyBindings[key];
      if (code) {
        const name = getKeyName(code);
        display.innerHTML = \`<span class=\"key-name\">\${name}</span><span class=\"key-code\">(\${code})</span>\`;
      } else {
        display.innerHTML = '<span class=\"placeholder\">点击设置按键...</span>';
      }
    }

    // 开始监听按键
    function startKeyListen(key) {
      // 取消之前的监听
      if (activeKeyListener) {
        const prevDisplay = document.querySelector(\`.keybind-display[data-key=\"\${activeKeyListener}\"]\`);
        if (prevDisplay) {
          prevDisplay.classList.remove('listening');
          updateKeyBindDisplay(activeKeyListener);
        }
      }
      
      activeKeyListener = key;
      const display = document.querySelector(\`.keybind-display[data-key=\"\${key}\"]\`);
      if (display) {
        display.classList.add('listening');
        display.innerHTML = '<span class=\"listening-hint\">按下任意键... (ESC取消)</span>';
      }
    }

    // 停止监听
    function stopKeyListen() {
      if (activeKeyListener) {
        const display = document.querySelector(\`.keybind-display[data-key=\"\${activeKeyListener}\"]\`);
        if (display) {
          display.classList.remove('listening');
          updateKeyBindDisplay(activeKeyListener);
        }
        activeKeyListener = null;
      }
    }

    // 全局键盘事件监听
    document.addEventListener('keydown', (e) => {
      // Ctrl+S 保存
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('saveBtn').click();
        return;
      }
      
      if (!activeKeyListener) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      if (e.keyCode === 27) { // ESC 取消
        stopKeyListen();
        return;
      }
      
      // 设置键位
      keyBindings[activeKeyListener] = String(e.keyCode);
      updateKeyBindDisplay(activeKeyListener);
      
      const display = document.querySelector(\`.keybind-display[data-key=\"\${activeKeyListener}\"]\`);
      if (display) display.classList.remove('listening');
      activeKeyListener = null;
    });

    // 绑定键位控件事件
    document.querySelectorAll('.keybind-display').forEach(el => {
      el.addEventListener('click', () => {
        startKeyListen(el.dataset.key);
      });
    });

    // 清除按钮
    document.querySelectorAll('.btn-clear').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        keyBindings[key] = '';
        updateKeyBindDisplay(key);
        stopKeyListen();
      });
    });

    // auto_hot_reload_mods 联动逻辑：勾选时自动开启 include_debug_mod
    document.getElementById('auto_hot_reload_mods').addEventListener('change', (e) => {
      if (e.target.checked) {
        document.getElementById('include_debug_mod').checked = true;
      }
    });

    // 解析 included_mod_dirs 为统一格式
    // 纯字符串 => { path: str, hot_reload: true }
    // 对象 => { path, hot_reload }
    function parseModDirs(dirs) {
      if (!dirs || !Array.isArray(dirs)) return [{ path: './', hot_reload: true }];
      return dirs.map(item => {
        if (typeof item === 'string') {
          // 纯字符串默认开启热更新
          return { path: item, hot_reload: true };
        } else if (item && typeof item === 'object') {
          return { path: item.path || './', hot_reload: item.hot_reload !== false };
        }
        return { path: './', hot_reload: true };
      });
    }

    // 渲染 MOD 目录列表
    function renderModDirs() {
      const container = document.getElementById('modDirsList');
      container.innerHTML = '';
      
      if (modDirs.length === 0) {
        container.innerHTML = '<div class="empty-hint">暂无目录，点击下方按钮添加</div>';
        return;
      }

      modDirs.forEach((dir, idx) => {
        const item = document.createElement('div');
        item.className = 'mod-dir-item';
        item.dataset.idx = idx;
        item.innerHTML = \`
          <div class="mod-dir-row">
            <input type="text" class="mod-path" value="\${escapeHtml(dir.path)}" placeholder="路径，如 ./ 或 D:/Mods/MyMod" />
            <button class="btn-icon browse" title="浏览...">📁</button>
          </div>
          <div class="mod-dir-options">
            <label class="hot-reload-wrap">
              <input type="checkbox" class="mod-hotreload" \${dir.hot_reload ? 'checked' : ''} />
              启用热更新
            </label>
            <button class="btn-icon delete" title="删除此目录">✕</button>
          </div>
        \`;
        
        // 路径变更
        item.querySelector('.mod-path').addEventListener('input', (e) => {
          modDirs[idx].path = e.target.value;
        });
        
        // 单项浏览按钮
        item.querySelector('.browse').addEventListener('click', () => {
          vscode.postMessage({ type: 'browseFolder', index: idx });
        });
        
        // 热更新变更
        item.querySelector('.mod-hotreload').addEventListener('change', (e) => {
          modDirs[idx].hot_reload = e.target.checked;
        });
        
        // 删除按钮
        item.querySelector('.delete').addEventListener('click', () => {
          modDirs.splice(idx, 1);
          renderModDirs();
        });
        
        container.appendChild(item);
      });
    }

    function escapeHtml(str) {
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // 添加目录按钮
    document.getElementById('addDirBtn').addEventListener('click', () => {
      modDirs.push({ path: './', hot_reload: true });
      renderModDirs();
    });

    // 浏览文件夹按钮（新增）
    document.getElementById('browseDirBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'browseFolder', index: -1 });
    });

    function loadData(data) {
      currentData = data;
      
      // 加载 MOD 目录
      modDirs = parseModDirs(data.included_mod_dirs);
      renderModDirs();
      
      // 加载键位绑定
      Object.keys(keyBindings).forEach(key => {
        keyBindings[key] = data.debug_options?.[key] ?? '';
        updateKeyBindDisplay(key);
      });
      
      // Text fields
      fields.text.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === 'world_seed') {
          el.value = data[id] === null ? '' : (data[id] ?? '');
        } else {
          el.value = data[id] ?? '';
        }
      });

      // Select fields
      fields.select.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = String(data[id] ?? (id === 'world_type' ? 1 : 1));
      });

      // Checkbox fields - 这些字段默认值是 true
      const defaultTrueCheckboxes = ['auto_join_game', 'include_debug_mod', 'enable_cheats', 'keep_inventory'];
      fields.checkbox.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === 'reload_key_global') {
          el.checked = !!data.debug_options?.[id];
        } else {
          // 如果字段不存在（undefined），使用默认值 true
          el.checked = data[id] === undefined ? defaultTrueCheckboxes.includes(id) : !!data[id];
        }
      });
    }

    function collectData() {
      // 保守合并：只更新插件管理的字段，保留其他未知字段
      const data = { ...currentData };

      // 收集 MOD 目录
      // 判断是否可以简化格式：
      // - 所有都开启热更新 => 纯字符串数组 ["./", "../other"]
      // - 有任何一个关闭热更新 => 对象数组 [{path, hot_reload}, ...]
      const allHotReload = modDirs.every(d => d.hot_reload);
      if (allHotReload) {
        data.included_mod_dirs = modDirs.map(d => d.path);
      } else {
        data.included_mod_dirs = modDirs.map(d => ({ path: d.path, hot_reload: d.hot_reload }));
      }

      // 收集键位绑定（保留 debug_options 中的其他字段）
      const reloadKeyGlobalEl = document.getElementById('reload_key_global');
      const reloadKeyGlobalChecked = reloadKeyGlobalEl ? reloadKeyGlobalEl.checked : false;
      
      // 保留原有的 debug_options（包括 modpc_debugger 等）
      if (data.debug_options || Object.keys(keyBindings).length > 0) {
        const existingDebugOptions = data.debug_options || {};
        data.debug_options = { ...existingDebugOptions };
        
        // 更新我们管理的键位字段（空字符串表示禁用，需要保留）
        Object.keys(keyBindings).forEach(key => {
          data.debug_options[key] = keyBindings[key]; // 空字符串也写入，表示禁用
        });
        
        // reload_key_global
        data.debug_options.reload_key_global = reloadKeyGlobalChecked;
      }

      // Text fields
      fields.text.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const val = el.value.trim();
        if (id === 'world_seed') {
          data[id] = val === '' ? null : (isNaN(Number(val)) ? null : Number(val));
        } else {
          // 只有有值或原本存在时才写入
          if (val) {
            data[id] = val;
          } else if (data[id] !== undefined) {
            delete data[id]; // 如果用户清空了，删除该字段
          }
        }
      });

      // Select fields
      fields.select.forEach(id => {
        const el = document.getElementById(id);
        if (el) data[id] = Number(el.value);
      });

      // Checkbox fields (排除 reload_key_global，已在上面处理)
      fields.checkbox.forEach(id => {
        if (id === 'reload_key_global') return; // 跳过，已处理
        const el = document.getElementById(id);
        if (!el) return;
        data[id] = el.checked;
      });

      return data;
    }

    document.getElementById('saveBtn').addEventListener('click', () => {
      const data = collectData();
      if (data) {
        vscode.postMessage({ type: 'save', content: JSON.stringify(data, null, 4) });
      }
    });

    document.getElementById('reloadBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'ready' });
    });

    document.getElementById('debugToggle').addEventListener('click', function() {
      this.classList.toggle('collapsed');
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'init') {
        try {
          loadData(JSON.parse(msg.content || '{}'));
          showStatus('已加载', false);
        } catch (e) {
          showStatus('解析失败: ' + e, true);
        }
      } else if (msg.type === 'saved') {
        showStatus('已保存', false);
      } else if (msg.type === 'folderSelected') {
        // 处理文件夹选择结果
        const { index, path } = msg;
        if (index === -1) {
          // 新增
          modDirs.push({ path: path, hot_reload: true });
        } else if (index >= 0 && index < modDirs.length) {
          // 更新现有项
          modDirs[index].path = path;
        }
        renderModDirs();
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

/**
 * 简单检测工作区是否为 Minecraft addon/包 的常见结构
 */
function isMinecraftAddonWorkspace(folder: vscode.WorkspaceFolder): boolean {
    try {
        const root = folder.uri.fsPath;

        // 0) 根目录有 .mcdev.json 文件（MCDK 项目标志）
        const mcdevJson = path.join(root, '.mcdev.json');
        if (fs.existsSync(mcdevJson)) {
            return true;
        }

        // 1) 根目录本身就是包根：manifest.json 与 entities/textures 同级
        const rootManifest = path.join(root, 'manifest.json');
        if (fs.existsSync(rootManifest) && (fs.existsSync(path.join(root, 'entities')) || fs.existsSync(path.join(root, 'textures')))) {
            return true;
        }

        // 2) 检查一级子目录：期望结构为 ./xxx/manifest.json 且 ./xxx/entities 或 ./xxx/textures
        let children: fs.Dirent[];
        try {
            children = fs.readdirSync(root, { withFileTypes: true });
        } catch (e) {
            return false;
        }

        for (const child of children) {
            if (!child.isDirectory()) continue;
            const childPath = path.join(root, child.name);

            const manifestPath = path.join(childPath, 'manifest.json');
            const hasEntities = fs.existsSync(path.join(childPath, 'entities')) && fs.statSync(path.join(childPath, 'entities')).isDirectory();
            const hasTextures = fs.existsSync(path.join(childPath, 'textures')) && fs.statSync(path.join(childPath, 'textures')).isDirectory();

            if (fs.existsSync(manifestPath) && (hasEntities || hasTextures)) {
                return true;
            }

            // 3) 有时子目录是容器（例如 behavior_packs 下有多个包），再检查子目录下的一层包目录
            let subEntries: fs.Dirent[];
            try {
                subEntries = fs.readdirSync(childPath, { withFileTypes: true });
            } catch (e) {
                continue;
            }

            for (const sub of subEntries) {
                if (!sub.isDirectory()) continue;
                const packDir = path.join(childPath, sub.name);
                const packManifest = path.join(packDir, 'manifest.json');
                const packHasEntities = fs.existsSync(path.join(packDir, 'entities')) && fs.statSync(path.join(packDir, 'entities')).isDirectory();
                const packHasTextures = fs.existsSync(path.join(packDir, 'textures')) && fs.statSync(path.join(packDir, 'textures')).isDirectory();
                if (fs.existsSync(packManifest) && (packHasEntities || packHasTextures)) {
                    return true;
                }
            }
        }
    } catch (e) {
        // ignore
    }
    return false;
}

/** Minecraft 进程信息 */
interface MinecraftProcess {
    pid: number;
    name: string;
    title: string;
    elevated: boolean;  // 是否是管理员进程
}

/** mcdbg --list 返回的数据结构 */
interface McdbgListResult {
    processes: MinecraftProcess[];
    error?: string;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Minecraft ModPC Debug 插件已激活');
    extensionContext = context;

    // 根据用户设置或项目结构决定是否启用插件功能
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const config = vscode.workspace.getConfiguration('minecraft-modpc-debug');
    const userEnabled = config.get<boolean>('enable', false);
    const isAddon = workspaceFolder ? isMinecraftAddonWorkspace(workspaceFolder) : false;
    const pluginEnabled = userEnabled || isAddon;

    // 设置上下文（用于 keybinding 和 sidebar 显示条件）
    vscode.commands.executeCommand('setContext', 'minecraft-modpc-debug:enabled', pluginEnabled);
    vscode.commands.executeCommand('setContext', 'minecraft-modpc-debug:showSidebar', pluginEnabled);

    // 只有启用时才注册侧边栏提供器
    if (pluginEnabled) {
        const sidebarProvider = new McdevSidebarProvider(context.extensionUri);
        const sidebarDisp = vscode.window.registerWebviewViewProvider('minecraft-modpc.sidebar', sidebarProvider);
        context.subscriptions.push(sidebarDisp);
        console.log('McdevSidebarProvider 已注册');
    }

    // 注册命令（始终注册，避免命令未找到错误）
    const disposable = vscode.commands.registerCommand('minecraft-modpc-debug.startDebug', async () => {
        await startDebugSession();
    });

    // 回退命令：将侧边栏 UI 作为独立面板打开
    const panelCmd = vscode.commands.registerCommand('minecraft-modpc-debug.showSidebarPanel', async () => {
        const wf = vscode.workspace.workspaceFolders?.[0];
        const panel = vscode.window.createWebviewPanel('mcdevSidebarPanel', 'Minecraft (.mcdev.json)', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = (new McdevSidebarProvider(context.extensionUri) as any).getHtmlForWebview(panel.webview);

        panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg?.type === 'ready') {
                if (!wf) {
                    panel.webview.postMessage({ type: 'init', content: '{}' });
                    return;
                }
                const mcdevPath = path.join(wf.uri.fsPath, '.mcdev.json');
                try {
                    if (fs.existsSync(mcdevPath)) {
                        const content = fs.readFileSync(mcdevPath, 'utf8');
                        panel.webview.postMessage({ type: 'init', content });
                    } else {
                        panel.webview.postMessage({ type: 'init', content: '{}' });
                    }
                } catch (e) {
                    panel.webview.postMessage({ type: 'init', content: '{}' });
                }
            } else if (msg?.type === 'save') {
                if (!wf) {
                    vscode.window.showErrorMessage('请先打开工作区以保存 .mcdev.json');
                    return;
                }
                const mcdevPath = path.join(wf.uri.fsPath, '.mcdev.json');
                try {
                    fs.writeFileSync(mcdevPath, msg.content, 'utf8');
                    vscode.window.showInformationMessage('.mcdev.json 已保存');
                } catch (e) {
                    vscode.window.showErrorMessage(`保存 .mcdev.json 失败: ${e}`);
                }
            } else if (msg?.type === 'browseFolder') {
                // 打开文件夹选择对话框
                const result = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: '选择 MOD 目录',
                    title: '选择 MOD 目录'
                });
                if (result && result.length > 0) {
                    panel.webview.postMessage({ 
                        type: 'folderSelected', 
                        index: msg.index,
                        path: result[0].fsPath 
                    });
                }
            }
        }, undefined, context.subscriptions);
    });

    // 注册运行游戏命令（Ctrl+F5）
    const runDisposable = vscode.commands.registerCommand('minecraft-modpc-debug.runGame', async () => {
        await runMcdk();
    });

    // 注册调试配置提供者
    const debugProvider = new MinecraftModPCDebugConfigurationProvider();
    const debugProviderDisposable = vscode.debug.registerDebugConfigurationProvider(
        'minecraft-modpc',
        debugProvider
    );

    // 注册动态调试配置提供者（用于 F5 无配置启动）
    const dynamicProvider = vscode.debug.registerDebugConfigurationProvider(
        'minecraft-modpc',
        {
            provideDebugConfigurations(): vscode.ProviderResult<vscode.DebugConfiguration[]> {
                return [
                    {
                        type: 'minecraft-modpc',
                        request: 'launch',
                        name: 'Minecraft ModPC Debug'
                    }
                ];
            }
        },
        vscode.DebugConfigurationProviderTriggerKind.Dynamic
    );

    // 监听调试会话结束事件
    const debugEndDisposable = vscode.debug.onDidTerminateDebugSession((session) => {
        // 查找对应的调试会话
        for (const [pid, info] of activeDebugSessions.entries()) {
            if (session.name === info.sessionName) {
                // 终止 mcdbg 进程
                if (info.mcdbgProcess) {
                    info.mcdbgProcess.kill();
                }
                activeDebugSessions.delete(pid);
                vscode.window.showInformationMessage(`调试会话已结束 (PID: ${pid})`);
                break;
            }
        }
    });

    context.subscriptions.push(disposable, panelCmd, runDisposable, debugProviderDisposable, dynamicProvider, debugEndDisposable);
}

/**
 * 调试配置提供者 - 处理 F5 启动
 */
class MinecraftModPCDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    
    async resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        _token?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration | null | undefined> {
        
        // 如果是空配置（用户直接按 F5 没有 launch.json）
        if (!config.type && !config.request && !config.name) {
            // 返回我们的默认配置，让 VS Code 继续处理
            return {
                type: 'minecraft-modpc',
                request: 'launch',
                name: 'Minecraft ModPC Debug'
            };
        }
        
        // 不是我们的类型，交给其他处理
        if (config.type !== 'minecraft-modpc') {
            return config;
        }

        // 是我们的类型，在下一阶段处理
        return config;
    }

    async resolveDebugConfigurationWithSubstitutedVariables(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        _token?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration | null | undefined> {
        
        // 只处理我们的类型
        if (config.type !== 'minecraft-modpc') {
            return config;
        }

        // 启动 mcdbg 并获取实际配置
        const result = await startDebugSessionAndGetConfig(config);
        
        // 返回 null 表示用户取消，VS Code 不会显示错误
        // 返回 undefined 表示配置无效，VS Code 会显示错误
        if (result === undefined) {
            return null;  // 静默取消，不显示错误
        }
        
        return result;
    }
}

/**
 * 检查端口是否被占用
 */
function isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();
        
        server.once('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                resolve(true); // 端口被占用
            } else {
                resolve(false);
            }
        });

        server.once('listening', () => {
            server.close();
            resolve(false); // 端口可用
        });

        server.listen(port, '127.0.0.1');
    });
}

/**
 * 获取当前已被调试会话占用的端口
 */
function getUsedPorts(): Set<number> {
    const usedPorts = new Set<number>();
    for (const session of activeDebugSessions.values()) {
        usedPorts.add(session.port);
    }
    return usedPorts;
}

/**
 * 查找可用端口（同时检查系统占用和已分配的调试端口）
 */
async function findAvailablePort(startPort: number, maxAttempts: number = 100): Promise<number> {
    const usedPorts = getUsedPorts();
    
    for (let i = 0; i < maxAttempts; i++) {
        const port = startPort + i;
        
        // 先检查是否已被我们的调试会话占用
        if (usedPorts.has(port)) {
            continue;
        }
        
        // 再检查系统端口是否被占用
        const inUse = await isPortInUse(port);
        if (!inUse) {
            return port;
        }
    }
    throw new Error(`无法在 ${startPort}-${startPort + maxAttempts - 1} 范围内找到可用端口`);
}

/**
 * 获取 mcdbg.exe 路径
 */
function getMcdbgPath(workspaceFolder: vscode.WorkspaceFolder, mcdbgPathConfig: string): string {
    if (mcdbgPathConfig) {
        return path.isAbsolute(mcdbgPathConfig) 
            ? mcdbgPathConfig 
            : path.join(workspaceFolder.uri.fsPath, mcdbgPathConfig);
    }
    return path.join(extensionContext.extensionPath, 'bin', 'mcdbg.exe');
}

/**
 * 调用 mcdbg --list 查询 Minecraft 进程列表
 */
async function listMinecraftProcesses(mcdbgPath: string): Promise<McdbgListResult> {
    return new Promise((resolve) => {
        cp.execFile(mcdbgPath, ['--list'], { timeout: 10000 }, (error, stdout, stderr) => {
            if (error) {
                resolve({ 
                    processes: [], 
                    error: `执行 mcdbg --list 失败: ${error.message}` 
                });
                return;
            }
            
            try {
                const result = JSON.parse(stdout);
                resolve(result);
            } catch (e) {
                resolve({ 
                    processes: [], 
                    error: `解析 mcdbg 输出失败: ${stdout || stderr}` 
                });
            }
        });
    });
}

/**
 * 显示进程选择器，让用户选择要附加的 Minecraft 进程
 */
async function selectMinecraftProcess(mcdbgPath: string): Promise<MinecraftProcess | undefined> {
    // 查询进程列表
    const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: '正在查询目标进程...',
        cancellable: false
    }, async () => {
        return await listMinecraftProcesses(mcdbgPath);
    });

    if (result.error) {
        vscode.window.showErrorMessage(result.error);
        return undefined;
    }

    if (result.processes.length === 0) {
        vscode.window.showWarningMessage('未找到目标进程');
        return undefined;
    }

    // 如果只有一个进程，检查是否已在调试中
    if (result.processes.length === 1) {
        const proc = result.processes[0];
        if (activeDebugSessions.has(proc.pid)) {
            vscode.window.showWarningMessage(`进程 ${proc.pid} 已在调试中`);
            return undefined;
        }
        if (proc.elevated) {
            const choice = await vscode.window.showWarningMessage(
                `目标进程 (PID: ${proc.pid}) 以管理员权限运行，可能需要提权。是否继续？`,
                '继续', '取消'
            );
            if (choice !== '继续') {
                return undefined;
            }
        }
        return proc;
    }

    // 多个进程，显示选择器
    interface ProcessQuickPickItem extends vscode.QuickPickItem {
        process: MinecraftProcess;
    }

    const items: ProcessQuickPickItem[] = result.processes.map(proc => {
        const isBeingDebugged = activeDebugSessions.has(proc.pid);
        let detail = '';
        if (isBeingDebugged) {
            detail = '$(debug) 已在调试中';
        } else if (proc.elevated) {
            detail = '$(shield) 管理员进程 - 可能需要提权';
        }
        return {
            label: `$(window) ${proc.title || proc.name}`,
            description: `PID: ${proc.pid}`,
            detail: detail || undefined,
            process: proc
        };
    });

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: '选择要附加调试的 Minecraft 进程',
        title: 'Minecraft 进程列表'
    });

    if (!selected) {
        return undefined;
    }

    // 警告管理员进程
    if (selected.process.elevated) {
        const choice = await vscode.window.showWarningMessage(
            `目标进程以管理员权限运行，可能需要提权。是否继续？`,
            '继续', '取消'
        );
        if (choice !== '继续') {
            return undefined;
        }
    }

    return selected.process;
}

async function startDebugSession() {
    // 通过命令启动时，使用全局配置
    const config = vscode.workspace.getConfiguration('minecraft-modpc-debug');
    const debugConfig: vscode.DebugConfiguration = {
        type: 'minecraft-modpc',
        request: 'launch',
        name: 'Minecraft ModPC Debug',
        port: config.get<number>('port', 5678),
        timeout: config.get<number>('timeout', 30000),
        mcdbgPath: config.get<string>('mcdbgPath', '')
    };
    
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
        await vscode.debug.startDebugging(workspaceFolder, debugConfig);
    } else {
        vscode.window.showErrorMessage('请先打开工作区');
    }
}

/**
 * 运行 mcdk.exe（无参数）用于 Ctrl+F5 自动化启动游戏
 */
// async function runMcdk(): Promise<void> {
//     const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
//     const config = vscode.workspace.getConfiguration('minecraft-modpc-debug');
//     const mcdkPathConfig = config.get<string>('mcdkPath', '');

//     const mcdkPath = mcdkPathConfig
//         ? (path.isAbsolute(mcdkPathConfig) ? mcdkPathConfig : path.join(workspaceFolder?.uri.fsPath || process.cwd(), mcdkPathConfig))
//         : path.join(extensionContext.extensionPath, 'bin', 'mcdk.exe');

//     if (!fs.existsSync(mcdkPath)) {
//         vscode.window.showErrorMessage(`找不到 mcdk.exe: ${mcdkPath}`);
//         return;
//     }

//     const output = vscode.window.createOutputChannel('mcdk');
//     output.show(true);

//     const proc = cp.spawn(mcdkPath, [], {
//         cwd: workspaceFolder?.uri.fsPath,
//         detached: false,
//         env: {
//             ...process.env,              // 继承当前 VSCode 环境
//             MCDEV_OUTPUT_MODE: '1',      // 使用特殊输出模式
//         }
//     });

//     // 追踪该进程以便在 deactivate 时清理
//     // runProcesses.add(proc);

//     proc.stdout?.on('data', (data: Buffer) => {
//         output.append(data.toString());
//     });

//     proc.stderr?.on('data', (data: Buffer) => {
//         output.append(`[错误] ${data.toString()}`);
//     });

//     proc.on('error', (err: Error) => {
//         // 保持原有输出流处理不变，额外移除追踪并报告
//         // runProcesses.delete(proc);
//         vscode.window.showErrorMessage(`启动 mcdk 失败: ${err.message}`);
//     });

//     proc.on('exit', (code: number | null) => {
//         if (code !== 0 && code !== null) {
//             output.appendLine(`mcdk.exe 退出，退出码: ${code}`);
//         } else {
//             output.appendLine('mcdk.exe 已退出');
//         }
//         // 进程退出后移除追踪
//         // runProcesses.delete(proc);
//     });
// }

async function runMcdk(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('请先打开工作区');
        return;
    }

    const config = vscode.workspace.getConfiguration('minecraft-modpc-debug');
    const mcdkPathConfig = config.get<string>('mcdkPath', '');

    const mcdkPath = mcdkPathConfig
        ? (path.isAbsolute(mcdkPathConfig)
            ? mcdkPathConfig
            : path.join(workspaceFolder.uri.fsPath, mcdkPathConfig))
        : path.join(extensionContext.extensionPath, 'bin', 'mcdk.exe');

    if (!fs.existsSync(mcdkPath)) {
        vscode.window.showErrorMessage(`找不到 mcdk.exe: ${mcdkPath}`);
        return;
    }

    // ⭐ 关键：创建 VS Code 终端
    const terminal = vscode.window.createTerminal({
        name: 'Minecraft ModPC (mcdk)',
        cwd: workspaceFolder.uri.fsPath
    });

    terminal.show(true);

    // ⭐ 关键：让终端自己执行
    terminal.sendText(`cmd /c "${mcdkPath}"`, true);
}


/**
 * 启动 mcdbg 并返回 debugpy 配置（供 F5 调试使用）
 */
async function startDebugSessionAndGetConfig(
    launchConfig: vscode.DebugConfiguration
): Promise<vscode.DebugConfiguration | undefined> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('请先打开工作区');
        return undefined;
    }

    // 从 launch.json 配置或全局设置获取参数
    const globalConfig = vscode.workspace.getConfiguration('minecraft-modpc-debug');
    const preferredPort = launchConfig.port ?? globalConfig.get<number>('port', 5678);
    const timeout = launchConfig.timeout ?? globalConfig.get<number>('timeout', 30000);
    const mcdbgPathConfig = launchConfig.mcdbgPath ?? globalConfig.get<string>('mcdbgPath', '');

    // 获取 mcdbg.exe 路径
    const mcdbgPath = getMcdbgPath(workspaceFolder, mcdbgPathConfig);

    // 选择 Minecraft 进程
    const selectedProcess = await selectMinecraftProcess(mcdbgPath);
    if (!selectedProcess) {
        return undefined;
    }

    // 检查该进程是否已在调试中
    if (activeDebugSessions.has(selectedProcess.pid)) {
        vscode.window.showWarningMessage(`进程 ${selectedProcess.pid} 已在调试中`);
        return undefined;
    }
    
    // 动态查找可用端口
    let port: number;
    try {
        port = await findAvailablePort(preferredPort);
        if (port !== preferredPort) {
            vscode.window.showInformationMessage(`端口 ${preferredPort} 已占用，使用端口: ${port}`);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(errorMessage);
        return undefined;
    }

    // 生成唯一的会话名称
    const sessionName = `Minecraft Debug (PID: ${selectedProcess.pid})`;

    // 启动 mcdbg 并等待端口就绪
    const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Minecraft ModPC Debug',
        cancellable: true
    }, async (progress, token): Promise<vscode.DebugConfiguration | undefined> => {
        // 启动 mcdbg.exe，使用 --pid 参数
        progress.report({ message: `正在初始化调试器 (PID: ${selectedProcess.pid})...` });
        
        const mcdbgProc = cp.spawn(mcdbgPath, ['--pid', selectedProcess.pid.toString(), '-p', port.toString()], {
            cwd: workspaceFolder.uri.fsPath,
            detached: false
        });

        // 创建输出通道显示 mcdbg 输出
        const outputChannel = vscode.window.createOutputChannel(`mcdbg (PID: ${selectedProcess.pid})`);
        outputChannel.show(true);

        mcdbgProc.stdout?.on('data', (data) => {
            outputChannel.append(data.toString());
        });

        mcdbgProc.stderr?.on('data', (data) => {
            outputChannel.append(`[错误] ${data.toString()}`);
        });

        mcdbgProc.on('error', (err) => {
            vscode.window.showErrorMessage(`启动失败: ${err.message}`);
        });

        mcdbgProc.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                outputChannel.appendLine(`mcdbg.exe 退出，退出码: ${code}`);
            }
            // 从活动会话中移除
            activeDebugSessions.delete(selectedProcess.pid);
        });

        // 等待调试端口可用
        progress.report({ message: `等待调试器就绪，端口: ${port}...` });

        const portReady = await waitForPort(port, timeout, token);

        if (token.isCancellationRequested) {
            mcdbgProc.kill();
            vscode.window.showWarningMessage('调试已取消');
            return undefined;
        }

        if (!portReady) {
            vscode.window.showErrorMessage(`等待调试器超时 (${timeout/1000}秒)`);
            mcdbgProc.kill();
            return undefined;
        }

        // 保存会话信息
        activeDebugSessions.set(selectedProcess.pid, {
            pid: selectedProcess.pid,
            port: port,
            mcdbgProcess: mcdbgProc,
            sessionName: sessionName
        });

        progress.report({ message: '调试器初始化完成' });
        
        return {
            name: sessionName,
            type: 'debugpy',
            request: 'attach',
            connect: {
                host: 'localhost',
                port: port
            },
            pathMappings: [
                {
                    localRoot: '${workspaceFolder}',
                    remoteRoot: '${workspaceFolder}'
                }
            ],
            justMyCode: false
        };
    });

    return result;
}

/**
 * 等待端口可用
 */
async function waitForPort(port: number, timeout: number, token: vscode.CancellationToken): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 500; // 每500ms检查一次

    while (Date.now() - startTime < timeout) {
        if (token.isCancellationRequested) {
            return false;
        }

        const isOpen = await checkPort(port);
        if (isOpen) {
            return true;
        }

        await sleep(checkInterval);
    }

    return false;
}

/**
 * 检查端口是否可连接
 */
function checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        
        socket.setTimeout(1000);
        
        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });

        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });

        socket.on('error', () => {
            socket.destroy();
            resolve(false);
        });

        socket.connect(port, 'localhost');
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function deactivate() {
    // 插件停用时清理所有调试会话
    for (const [pid, info] of activeDebugSessions.entries()) {
        if (info.mcdbgProcess) {
            info.mcdbgProcess.kill();
        }
    }
    activeDebugSessions.clear();
    // 清除上下文
    vscode.commands.executeCommand('setContext', 'minecraft-modpc-debug:enabled', false);
    vscode.commands.executeCommand('setContext', 'minecraft-modpc-debug:showSidebar', false);
}
