export const sidebarStyle = `
:root {
    --container-padding: 20px;
    --input-padding-vertical: 6px;
    --input-padding-horizontal: 8px;
    --input-margin-vertical: 4px;
    --label-margin-bottom: 4px;
}

body {
    padding: 0;
    color: var(--vscode-foreground);
    font-size: var(--vscode-font-size);
    font-weight: var(--vscode-font-weight);
    font-family: var(--vscode-font-family);
    background-color: var(--vscode-sideBar-background);
}

.container {
    padding: var(--container-padding);
    max-width: 100%;
    box-sizing: border-box;
}

h3 {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    margin: 0 0 12px 0;
    color: var(--vscode-sideBarTitle-foreground);
    letter-spacing: 0.5px;
}

.section {
    margin-bottom: 24px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
    padding-bottom: 16px;
}

.section:last-child {
    border-bottom: none;
}

.section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
    cursor: pointer;
    user-select: none;
}

.section-header-plain {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
}

.section-title {
    font-weight: 600;
    font-size: 12px;
    color: var(--vscode-sideBarSectionHeader-foreground);
    display: flex;
    align-items: center;
}

.section-title .codicon {
    margin-right: 6px;
    font-size: 14px;
}

.control-group {
    margin-bottom: 12px;
}

label {
    display: block;
    margin-bottom: var(--label-margin-bottom);
    color: var(--vscode-foreground);
    font-size: 12px;
    font-weight: 500;
}

.help-text {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-left: 4px;
    font-weight: normal;
}

input[type="text"],
input[type="number"],
textarea {
    width: 100%;
    box-sizing: border-box;
    padding: var(--input-padding-vertical) var(--input-padding-horizontal);
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 3px;
    font-family: inherit;
    font-size: inherit;
}

select {
    width: 100%;
    box-sizing: border-box;
    padding: var(--input-padding-vertical) var(--input-padding-horizontal);
    background-color: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 3px;
    font-family: inherit;
    font-size: inherit;
    cursor: pointer;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    background-image: url('data:image/svg+xml;charset=UTF-8,<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M11.5 6.5L8 10 4.5 6.5l.707-.707L8 8.586l2.793-2.793.707.707z"/></svg>');
    background-repeat: no-repeat;
    background-position: right 4px center;
    background-size: 16px;
    padding-right: 24px;
}

input[type="text"]:focus,
input[type="number"]:focus,
textarea:focus {
    outline: 1px solid var(--vscode-focusBorder);
    border-color: var(--vscode-focusBorder);
}

select:focus {
    outline: 1px solid var(--vscode-focusBorder);
    border-color: var(--vscode-focusBorder);
}

select:hover {
    background-color: var(--vscode-dropdown-background);
}

input::placeholder {
    color: var(--vscode-input-placeholderForeground);
}

.checkbox-group {
    display: flex;
    align-items: center;
    margin-bottom: 8px;
    cursor: pointer;
}

.checkbox-group input[type="checkbox"] {
    margin: 0 8px 0 0;
    cursor: pointer;
    width: 16px;
    height: 16px;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    background-color: var(--vscode-checkbox-background);
    border: 1px solid var(--vscode-checkbox-border);
    border-radius: 3px;
    outline: none;
    position: relative;
}

.checkbox-group input[type="checkbox"]:hover {
    border-color: var(--vscode-checkbox-border);
    background-color: var(--vscode-checkbox-background);
}

.checkbox-group input[type="checkbox"]:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
}

.checkbox-group input[type="checkbox"]:checked {
    background-color: var(--vscode-checkbox-background);
    border-color: var(--vscode-checkbox-border);
}

.checkbox-group input[type="checkbox"]:checked::before {
    content: '';
    position: absolute;
    left: 3px;
    top: 0px;
    width: 5px;
    height: 9px;
    border: solid var(--vscode-checkbox-foreground);
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
}

.checkbox-group label {
    margin-bottom: 0;
    cursor: pointer;
}

button {
    border: none;
    padding: 6px 12px;
    text-align: center;
    text-decoration: none;
    display: inline-block;
    font-size: 12px;
    cursor: pointer;
    border-radius: 3px;
    transition: background-color 0.1s;
}

.btn-primary {
    background-color: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
}

.btn-primary:hover {
    background-color: var(--vscode-button-hoverBackground);
}

.btn-secondary {
    background-color: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
}

.btn-secondary:hover {
    background-color: var(--vscode-button-secondaryHoverBackground);
}

.btn-icon {
    background: transparent;
    color: var(--vscode-icon-foreground);
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.btn-icon:hover {
    background-color: var(--vscode-toolbar-hoverBackground);
}

.toolbar {
    position: sticky;
    top: 0;
    background-color: var(--vscode-sideBar-background);
    padding: 12px 20px;
    border-bottom: 1px solid var(--vscode-widget-border);
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 10;
    margin: -20px -20px 16px -20px;
}

.toolbar .btn-primary {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
}

.toolbar .btn-secondary {
    padding: 6px 10px;
}

.mod-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.mod-item {
    background-color: var(--vscode-input-background);
    padding: 8px;
    border-radius: 3px;
    border: 1px solid var(--vscode-input-border);
}

.mod-item:hover {
    background-color: var(--vscode-list-hoverBackground);
}

.mod-row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 6px;
}

.mod-options {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
}

.keybind-display {
    background-color: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border);
    color: var(--vscode-input-foreground);
    padding: 4px 8px;
    border-radius: 3px;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 26px;
    font-family: 'Consolas', 'Courier New', monospace;
}

.keybind-display:hover {
    border-color: var(--vscode-focusBorder);
}

.keybind-display.listening {
    border-color: var(--vscode-focusBorder);
    outline: 1px solid var(--vscode-focusBorder);
    background-color: var(--vscode-inputOption-activeBackground);
}

.status-bar {
    margin-left: auto;
    font-size: 11px;
    display: flex;
    align-items: center;
}

.status-success { color: var(--vscode-testing-iconPassed); }
.status-error { color: var(--vscode-testing-iconFailed); }

/* Collapsible */
.collapsible-content {
    overflow: hidden;
    transition: max-height 0.2s ease-out;
}
.collapsed .collapsible-content {
    display: none;
}
.codicon-chevron-right {
    transition: transform 0.2s;
}
.collapsed .codicon-chevron-right {
    transform: rotate(-90deg);
}
`;
