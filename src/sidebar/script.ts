export const sidebarScript = `
(function() {
    const vscode = acquireVsCodeApi();
    const t = window.mcdevI18n || {};
    
    class McdevEditor {
        constructor() {
            this.state = {
                data: {},
                modDirs: [],
                keyBindings: {},
                hasChanges: false,
                originalData: null
            };
            
            this.elements = {
                floatingSaveBtn: document.getElementById('floatingSaveBtn'),
                floatingSaveContainer: document.getElementById('floatingSaveContainer'),
                runGameBtn: document.getElementById('runGameBtn'),
                status: document.getElementById('status'),
                modDirsList: document.getElementById('modDirsList'),
                browseDirBtn: document.getElementById('browseDirBtn'),
                debugToggle: document.getElementById('debugToggle'),
                debugContent: document.getElementById('debugContent')
            };

            this.fields = {
                text: ['world_name', 'world_folder_name', 'world_seed', 'user_name'],
                select: ['world_type', 'game_mode'],
                checkbox: ['reset_world', 'auto_join_game', 'include_debug_mod', 'enable_cheats', 'keep_inventory', 'auto_hot_reload_mods', 'do_weather_cycle', 'reload_key_global'],
                experimentCheckbox: ['exp_data_driven_biomes', 'exp_data_driven_items', 'exp_experimental_molang_features']
            };

            this.keyBindFields = ['reload_key', 'reload_world_key', 'reload_addon_key', 'reload_shaders_key'];
            this.activeKeyListener = null;

            this.init();
        }

        init() {
            this.bindEvents();
            this.setupMessageListener();
            this.setupChangeDetection();
            // Tell extension we are ready
            vscode.postMessage({ type: 'ready' });
        }

        bindEvents() {
            this.elements.floatingSaveBtn.addEventListener('click', () => this.save());
            this.elements.runGameBtn.addEventListener('click', () => vscode.postMessage({ type: 'runGame' }));
            
            this.elements.browseDirBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'browseFolder', index: -1 });
            });

            // Keybinding listeners
            document.addEventListener('keydown', (e) => this.handleGlobalKeydown(e));

            // Collapsible sections (only those with .section-header, not .section-header-plain)
            document.querySelectorAll('.section-header').forEach(header => {
                // Skip if it's section-header-plain
                if (!header.classList.contains('section-header-plain')) {
                    header.addEventListener('click', () => {
                        const section = header.parentElement;
                        section.classList.toggle('collapsed');
                        const icon = header.querySelector('.codicon-chevron-right, .codicon-chevron-down');
                        if (icon) {
                            icon.classList.toggle('codicon-chevron-down');
                            icon.classList.toggle('codicon-chevron-right');
                        }
                    });
                }
            });

            // Collapsible subsections
            document.querySelectorAll('.subsection-header').forEach(header => {
                header.addEventListener('click', () => {
                    const subsection = header.parentElement;
                    subsection.classList.toggle('collapsed');
                    const icon = header.querySelector('.codicon-chevron-right, .codicon-chevron-down');
                    if (icon) {
                        icon.classList.toggle('codicon-chevron-down');
                        icon.classList.toggle('codicon-chevron-right');
                    }
                });
            });

            // Auto-check dependency
            const autoHotReload = document.getElementById('auto_hot_reload_mods');
            if (autoHotReload) {
                autoHotReload.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        const debugMod = document.getElementById('include_debug_mod');
                        if (debugMod) debugMod.checked = true;
                    }
                });
            }
        }

        setupMessageListener() {
            window.addEventListener('message', event => {
                const msg = event.data;
                switch (msg.type) {
                    case 'init':
                        this.loadData(JSON.parse(msg.content || '{}'));
                        this.showStatus(t.loaded || 'Loaded', 'success');
                        this.state.hasChanges = false;
                        this.hideFloatingSaveBtn();
                        if (msg.needsInitialSave) {
                            setTimeout(() => this.save(), 100);
                        }
                        break;
                    case 'saved':
                        this.showStatus(t.savedSuccess || 'Saved successfully', 'success');
                        this.state.hasChanges = false;
                        this.hideFloatingSaveBtn();
                        break;
                    case 'folderSelected':
                        this.handleFolderSelected(msg.index, msg.path);
                        break;
                }
            });
        }

        setupChangeDetection() {
            // Monitor input changes
            this.fields.text.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('input', () => this.markAsChanged());
            });

            this.fields.select.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('change', () => this.markAsChanged());
            });

            this.fields.checkbox.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('change', () => this.markAsChanged());
            });

            this.fields.experimentCheckbox.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('change', () => this.markAsChanged());
            });
        }

        markAsChanged() {
            if (!this.state.hasChanges) {
                this.state.hasChanges = true;
                this.showFloatingSaveBtn();
            }
        }

        showFloatingSaveBtn() {
            if (this.elements.floatingSaveContainer) {
                this.elements.floatingSaveContainer.style.display = 'flex';
            }
        }

        hideFloatingSaveBtn() {
            if (this.elements.floatingSaveContainer) {
                this.elements.floatingSaveContainer.style.display = 'none';
            }
        }

        loadData(data) {
            this.state.data = data;
            this.state.modDirs = this.parseModDirs(data.included_mod_dirs);
            
            // Load text/select fields
            this.fields.text.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = (id === 'world_seed' && data[id] === null) ? '' : (data[id] ?? '');
            });

            this.fields.select.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = String(data[id] ?? (id === 'world_type' ? 1 : 1));
            });

            // Load checkboxes
            const defaultTrue = ['auto_join_game', 'include_debug_mod', 'enable_cheats', 'keep_inventory', 'auto_hot_reload_mods', 'do_weather_cycle'];
            this.fields.checkbox.forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                if (id === 'reload_key_global') {
                    el.checked = !!data.debug_options?.[id];
                } else {
                    el.checked = data[id] === undefined ? defaultTrue.includes(id) : !!data[id];
                }
            });

            // Load experiment_options checkboxes (default false if experiment_options doesn't exist)
            const expData = data.experiment_options || {};
            this.fields.experimentCheckbox.forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                const realKey = id.replace('exp_', '');
                // If experiment_options doesn't exist, default to false; otherwise use the value
                el.checked = data.experiment_options === undefined ? false : !!expData[realKey];
            });

            // Load keybindings
            this.keyBindFields.forEach(key => {
                this.state.keyBindings[key] = data.debug_options?.[key] ?? '';
                this.updateKeyBindDisplay(key);
            });

            this.renderModDirs();
        }

        collectData() {
            const data = { ...this.state.data };

            // Collect fields
            this.fields.text.forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                const val = el.value.trim();
                if (id === 'world_seed') {
                    data[id] = val === '' ? null : (isNaN(Number(val)) ? null : Number(val));
                } else {
                    if (val) data[id] = val;
                    else if (data[id] !== undefined) delete data[id];
                }
            });

            this.fields.select.forEach(id => {
                const el = document.getElementById(id);
                if (el) data[id] = Number(el.value);
            });

            this.fields.checkbox.forEach(id => {
                if (id === 'reload_key_global') return;
                const el = document.getElementById(id);
                if (el) data[id] = el.checked;
            });

            // Collect Mod Dirs
            const allHotReload = this.state.modDirs.every(d => d.hot_reload);
            if (allHotReload) {
                data.included_mod_dirs = this.state.modDirs.map(d => d.path);
            } else {
                data.included_mod_dirs = this.state.modDirs.map(d => ({ path: d.path, hot_reload: d.hot_reload }));
            }

            // Collect Debug Options
            const reloadKeyGlobalEl = document.getElementById('reload_key_global');
            const reloadKeyGlobalChecked = reloadKeyGlobalEl ? reloadKeyGlobalEl.checked : false;

            if (data.debug_options || Object.keys(this.state.keyBindings).length > 0) {
                data.debug_options = { ...(data.debug_options || {}) };
                this.keyBindFields.forEach(key => {
                    data.debug_options[key] = this.state.keyBindings[key];
                });
                data.debug_options.reload_key_global = reloadKeyGlobalChecked;
            }

            // Collect experiment_options
            const expOptions = {};
            this.fields.experimentCheckbox.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    const realKey = id.replace('exp_', '');
                    expOptions[realKey] = el.checked;
                }
            });
            data.experiment_options = expOptions;

            return data;
        }

        save() {
            const data = this.collectData();
            vscode.postMessage({ type: 'save', content: JSON.stringify(data, null, 4) });
        }

        // --- Mod Dirs Logic ---

        parseModDirs(dirs) {
            if (!dirs || !Array.isArray(dirs)) return [{ path: './', hot_reload: true }];
            return dirs.map(item => {
                if (typeof item === 'string') return { path: item, hot_reload: true };
                if (item && typeof item === 'object') return { path: item.path || './', hot_reload: item.hot_reload !== false };
                return { path: './', hot_reload: true };
            });
        }

        renderModDirs() {
            const container = this.elements.modDirsList;
            container.innerHTML = '';

            if (this.state.modDirs.length === 0) {
                container.innerHTML = \`<div class="help-text" style="padding: 10px; text-align: center;">\${t.noModDirs || 'No mod directories configured.'}</div>\`;
                return;
            }

            this.state.modDirs.forEach((dir, idx) => {
                const item = document.createElement('div');
                item.className = 'mod-item';
                item.innerHTML = \`
                    <div class="mod-row">
                        <input type="text" class="mod-path" value="\${this.escapeHtml(dir.path)}" placeholder="\${t.pathPlaceholder || 'Path (e.g. ./ or D:/Mods)'}" />
                        <button class="btn-icon browse" title="\${t.browse || 'Browse...'}">
                            <span class="codicon codicon-folder-opened"></span>
                        </button>
                    </div>
                    <div class="mod-options">
                        <label class="checkbox-group" style="margin:0">
                            <input type="checkbox" class="mod-hotreload" \${dir.hot_reload ? 'checked' : ''} />
                            <span>\${t.hotReload || 'Hot Reload'}</span>
                        </label>
                        <button class="btn-icon delete" title="Remove">
                            <span class="codicon codicon-trash"></span>
                        </button>
                    </div>
                \`;

                item.querySelector('.mod-path').addEventListener('input', (e) => {
                    this.state.modDirs[idx].path = e.target.value;
                    this.markAsChanged();
                });
                item.querySelector('.browse').addEventListener('click', () => vscode.postMessage({ type: 'browseFolder', index: idx }));
                item.querySelector('.mod-hotreload').addEventListener('change', (e) => {
                    this.state.modDirs[idx].hot_reload = e.target.checked;
                    this.markAsChanged();
                });
                item.querySelector('.delete').addEventListener('click', () => {
                    this.state.modDirs.splice(idx, 1);
                    this.renderModDirs();
                    this.markAsChanged();
                });

                container.appendChild(item);
            });
        }

        handleFolderSelected(index, path) {
            if (index === -1) {
                this.state.modDirs.push({ path, hot_reload: true });
            } else if (index >= 0 && index < this.state.modDirs.length) {
                this.state.modDirs[index].path = path;
            }
            this.renderModDirs();
            this.markAsChanged();
        }

        // --- Keybinding Logic ---

        updateKeyBindDisplay(key) {
            const display = document.querySelector(\`.keybind-display[data-key="\${key}"]\`);
            if (!display) return;
            
            const code = this.state.keyBindings[key];
            const name = this.getKeyName(code);
            
            display.innerHTML = code 
                ? \`<span>\${name}</span><span style="opacity:0.6; font-size:0.9em">(\${code})</span><span class="codicon codicon-close clear-btn" title="Clear"></span>\`
                : \`<span style="opacity:0.5; font-style:italic">\${t.clickToSet || 'Click to set...'}</span>\`;
            
            if (code) {
                display.querySelector('.clear-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.state.keyBindings[key] = '';
                    this.updateKeyBindDisplay(key);
                });
            }

            display.onclick = () => this.startKeyListen(key);
        }

        startKeyListen(key) {
            if (this.activeKeyListener) this.stopKeyListen();
            
            this.activeKeyListener = key;
            const display = document.querySelector(\`.keybind-display[data-key="\${key}"]\`);
            if (display) {
                display.classList.add('listening');
                display.innerHTML = \`<span style="color:var(--vscode-focusBorder)">\${t.pressAnyKey || 'Press any key... (ESC to cancel)'}</span>\`;
            }
        }

        stopKeyListen() {
            if (this.activeKeyListener) {
                const display = document.querySelector(\`.keybind-display[data-key="\${this.activeKeyListener}"]\`);
                if (display) display.classList.remove('listening');
                this.updateKeyBindDisplay(this.activeKeyListener);
                this.activeKeyListener = null;
            }
        }

        handleGlobalKeydown(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                e.stopPropagation();
                this.save();
                return;
            }

            if (!this.activeKeyListener) return;

            e.preventDefault();
            e.stopPropagation();

            if (e.keyCode === 27) { // ESC
                this.stopKeyListen();
                return;
            }

            this.state.keyBindings[this.activeKeyListener] = String(e.keyCode);
            this.stopKeyListen();
            this.markAsChanged();
        }

        getKeyName(code) {
            if (!code) return '';
            const num = parseInt(code);
            // Simple map for common keys, can be expanded
            const map = {
                8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'Shift', 17: 'Ctrl', 18: 'Alt', 27: 'Esc', 32: 'Space',
                37: 'Left', 38: 'Up', 39: 'Right', 40: 'Down', 46: 'Del',
                112: 'F1', 113: 'F2', 114: 'F3', 115: 'F4', 116: 'F5', 117: 'F6', 118: 'F7', 119: 'F8', 120: 'F9', 121: 'F10', 122: 'F11', 123: 'F12'
            };
            if (map[num]) return map[num];
            if (num >= 65 && num <= 90) return String.fromCharCode(num); // A-Z
            if (num >= 48 && num <= 57) return String.fromCharCode(num); // 0-9
            return 'Key' + num;
        }

        // --- Utils ---

        showStatus(msg, type = 'info') {
            const el = this.elements.status;
            el.textContent = msg;
            el.className = 'status-bar ' + (type === 'error' ? 'status-error' : 'status-success');
            setTimeout(() => el.textContent = '', 3000);
        }

        escapeHtml(str) {
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }
    }

    new McdevEditor();
})();
`;
