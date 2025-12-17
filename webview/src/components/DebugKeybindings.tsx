import React from 'react';
import { I18nText } from '../i18n';
import { useNestedDefaultValues } from '../hooks/useDefaultValues';

interface DebugOptions {
  reload_key?: string;
  reload_world_key?: string;
  reload_addon_key?: string;
  reload_shaders_key?: string;
  reload_key_global?: boolean;
}

interface Props {
  t: I18nText;
  debugOptions: DebugOptions | undefined;
  debugExpanded: boolean;
  setDebugExpanded: (expanded: boolean) => void;
  activeKeyListener: string | null;
  setActiveKeyListener: (key: string | null) => void;
  onDebugOptionChange: (field: string, value: any) => void;
  getKeyName: (code?: string) => string;
  markInitialized?: (componentId: string) => void;
}


const DEFAULT_VALUES: DebugOptions = {
  reload_key: '',
  reload_world_key: '',
  reload_addon_key: '',
  reload_shaders_key: '',
  reload_key_global: false,
};

export const DebugKeybindings: React.FC<Props> = ({
  t,
  debugOptions,
  debugExpanded,
  setDebugExpanded,
  activeKeyListener,
  setActiveKeyListener,
  onDebugOptionChange,
  getKeyName,
  markInitialized,
}) => {
  useNestedDefaultValues(debugOptions, DEFAULT_VALUES, onDebugOptionChange, markInitialized ? () => markInitialized('DebugKeybindings') : undefined);

  const renderKeybindDisplay = (key: string, label: string) => {
    const keyValue = debugOptions?.[key as keyof DebugOptions] as string | undefined;
    const isListening = activeKeyListener === key;

    return (
      <div className="control-group">
        <label>{label}</label>
        <div
          className={`keybind-display ${isListening ? 'listening' : ''}`}
          onClick={() => setActiveKeyListener(key)}
        >
          {isListening ? (
            <span style={{ color: 'var(--vscode-focusBorder)' }}>
              {t.pressAnyKey}
            </span>
          ) : keyValue ? (
            <>
              <span>{getKeyName(keyValue)}</span>
              <span style={{ opacity: 0.6, fontSize: '0.9em' }}>({keyValue})</span>
              <span
                className="codicon codicon-close clear-btn"
                title={t.clear}
                onClick={(e) => {
                  e.stopPropagation();
                  onDebugOptionChange(key, '');
                }}
              ></span>
            </>
          ) : (
            <span style={{ opacity: 0.5, fontStyle: 'italic' }}>{t.clickToSet}</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`section ${debugExpanded ? '' : 'collapsed'}`}>
      <div className="section-header" onClick={() => setDebugExpanded(!debugExpanded)}>
        <span className="section-title">
          <span className="codicon codicon-chevron-right"></span>
          {t.debugKeybindings}
        </span>
      </div>
      <div className="collapsible-content">
        {renderKeybindDisplay('reload_key', t.reloadScripts)}
        {renderKeybindDisplay('reload_world_key', t.reloadWorld)}
        {renderKeybindDisplay('reload_addon_key', t.reloadAddons)}
        {renderKeybindDisplay('reload_shaders_key', t.reloadShaders)}

        <div className="checkbox-group" style={{ marginTop: '12px' }}>
          <input
            type="checkbox"
            id="reload_key_global"
            checked={debugOptions?.reload_key_global ?? DEFAULT_VALUES.reload_key_global}
            onChange={(e) => onDebugOptionChange('reload_key_global', e.target.checked)}
          />
          <label htmlFor="reload_key_global">{t.globalReloadKey}</label>
        </div>
      </div>
    </div>
  );
};
