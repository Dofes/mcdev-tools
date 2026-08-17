import type { FC } from 'react';
import { I18nText } from '../i18n';
import { useDefaultValues } from '../hooks/useDefaultValues';
import { vscode } from '../vscode';

interface McdevData {
  log_protocol?: 0 | 1;
  reset_world?: boolean;
  auto_join_game?: boolean;
  include_debug_mod?: boolean;
  auto_hot_reload_mods?: boolean;
  auto_hot_reload_ui?: boolean;
  auto_hot_reload_shaders?: boolean;
  auto_hot_reload_materials?: boolean;
  auto_hot_reload_particles?: boolean;
  enable_cheats?: boolean;
  keep_inventory?: boolean;
  do_daylight_cycle?: boolean;
  do_weather_cycle?: boolean;
  mcdev_tools?: {
    game_debugger?: {
      enabled?: boolean;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

interface Props {
  t: I18nText;
  data: McdevData;
  onDataChange: (field: string, value: any) => void;
  markInitialized?: (componentId: string) => void;
}

const DEFAULT_VALUES: McdevData = {
  log_protocol: 0,
  reset_world: false,
  auto_join_game: true,
  include_debug_mod: true,
  auto_hot_reload_mods: true,
  auto_hot_reload_ui: false,
  auto_hot_reload_shaders: false,
  auto_hot_reload_materials: false,
  auto_hot_reload_particles: false,
  enable_cheats: true,
  keep_inventory: true,
  do_daylight_cycle: true,
  do_weather_cycle: true,
};

export const GameOptions: FC<Props> = ({
  t,
  data,
  onDataChange,
  markInitialized,
}) => {
  useDefaultValues(
    data,
    DEFAULT_VALUES,
    onDataChange,
    markInitialized ? () => markInitialized('GameOptions') : undefined,
  );

  const enabledHotReloadCount = [
    data.auto_hot_reload_mods ?? DEFAULT_VALUES.auto_hot_reload_mods,
    data.auto_hot_reload_ui ?? DEFAULT_VALUES.auto_hot_reload_ui,
    data.auto_hot_reload_shaders ?? DEFAULT_VALUES.auto_hot_reload_shaders,
    data.auto_hot_reload_materials ?? DEFAULT_VALUES.auto_hot_reload_materials,
    data.auto_hot_reload_particles ?? DEFAULT_VALUES.auto_hot_reload_particles,
  ].filter(Boolean).length;
  const gameDebuggerEnabled = data.mcdev_tools?.game_debugger?.enabled === true;
  const logProtocol = data.log_protocol === 1 ? 1 : 0;

  const setGameDebuggerEnabled = (enabled: boolean) => {
    onDataChange('mcdev_tools', {
      ...data.mcdev_tools,
      game_debugger: {
        ...data.mcdev_tools?.game_debugger,
        enabled,
      },
    });
  };

  return (
    <>
      <div className="section">
        <div className="section-header-plain">
          <span className="section-title">
            <span className="codicon codicon-debug-alt"></span>
            {t.startupOptions}
          </span>
        </div>

        <div className="checkbox-grid">
          <div className="checkbox-group">
            <input
              type="checkbox"
              id="reset_world"
              checked={data.reset_world ?? DEFAULT_VALUES.reset_world}
              onChange={(e) => onDataChange('reset_world', e.target.checked)}
            />
            <label htmlFor="reset_world" title={t.resetWorld}>
              {t.resetWorld}
            </label>
          </div>

          <div className="checkbox-group">
            <input
              type="checkbox"
              id="auto_join_game"
              checked={data.auto_join_game ?? DEFAULT_VALUES.auto_join_game}
              onChange={(e) => onDataChange('auto_join_game', e.target.checked)}
            />
            <label htmlFor="auto_join_game" title={t.autoJoin}>
              {t.autoJoin}
            </label>
          </div>

          <div className="checkbox-group">
            <input
              type="checkbox"
              id="include_debug_mod"
              checked={data.include_debug_mod ?? DEFAULT_VALUES.include_debug_mod}
              onChange={(e) =>
                onDataChange('include_debug_mod', e.target.checked)
              }
            />
            <label htmlFor="include_debug_mod" title={t.includeDebug}>
              {t.includeDebug}
            </label>
          </div>

        </div>

        <fieldset className="log-protocol-field">
          <legend>{t.logProtocol}</legend>
          <div className="log-protocol-segments">
            <label className="log-protocol-option">
              <input
                type="radio"
                name="log_protocol"
                value="0"
                checked={logProtocol === 0}
                onChange={() => onDataChange('log_protocol', 0)}
                aria-describedby="log-protocol-default-tooltip"
              />
              <span className="log-protocol-label">
                <span className="codicon codicon-terminal" aria-hidden="true"></span>
                <strong>{t.logProtocolDefault}</strong>
              </span>
              <span
                id="log-protocol-default-tooltip"
                className="log-protocol-tooltip"
                role="tooltip"
              >
                {t.logProtocolDefaultTooltip}
              </span>
            </label>
            <label className="log-protocol-option">
              <input
                type="radio"
                name="log_protocol"
                value="1"
                checked={logProtocol === 1}
                onChange={() => onDataChange('log_protocol', 1)}
                aria-describedby="log-protocol-saf-tooltip"
              />
              <span className="log-protocol-label">
                <span className="codicon codicon-radio-tower" aria-hidden="true"></span>
                <strong>{t.logProtocolSaf}</strong>
              </span>
              <span
                id="log-protocol-saf-tooltip"
                className="log-protocol-tooltip"
                role="tooltip"
              >
                {t.logProtocolSafTooltip}
              </span>
            </label>
          </div>
        </fieldset>

        <details className="settings-cluster">
          <summary>
            <span className="settings-cluster-leading">
              <span className="settings-cluster-icon">
                <span className="codicon codicon-sync"></span>
              </span>
              <span className="settings-cluster-copy">
                <strong>{t.hotReload}</strong>
                <small>
                  {enabledHotReloadCount} / 5 {t.enabled}
                </small>
              </span>
            </span>
            <span className="settings-cluster-expand">
              <span className="codicon codicon-chevron-right"></span>
            </span>
          </summary>

          <div className="checkbox-grid settings-cluster-content">
            <div className="checkbox-group">
              <input
                type="checkbox"
                id="auto_hot_reload_mods"
                checked={
                  data.auto_hot_reload_mods ?? DEFAULT_VALUES.auto_hot_reload_mods
                }
                onChange={(e) =>
                  onDataChange('auto_hot_reload_mods', e.target.checked)
                }
              />
              <label htmlFor="auto_hot_reload_mods" title={t.autoHotReload}>
                {t.autoHotReload}
              </label>
            </div>

            <div className="checkbox-group">
              <input
                type="checkbox"
                id="auto_hot_reload_ui"
                checked={
                  data.auto_hot_reload_ui ?? DEFAULT_VALUES.auto_hot_reload_ui
                }
                onChange={(e) =>
                  onDataChange('auto_hot_reload_ui', e.target.checked)
                }
              />
              <label htmlFor="auto_hot_reload_ui" title={t.autoHotReloadUi}>
                {t.autoHotReloadUi}
              </label>
            </div>

            <div className="checkbox-group">
              <input
                type="checkbox"
                id="auto_hot_reload_shaders"
                checked={
                  data.auto_hot_reload_shaders ??
                  DEFAULT_VALUES.auto_hot_reload_shaders
                }
                onChange={(e) =>
                  onDataChange('auto_hot_reload_shaders', e.target.checked)
                }
              />
              <label
                htmlFor="auto_hot_reload_shaders"
                title={t.autoHotReloadShaders}
              >
                {t.autoHotReloadShaders}
              </label>
            </div>

            <div className="checkbox-group">
              <input
                type="checkbox"
                id="auto_hot_reload_materials"
                checked={
                  data.auto_hot_reload_materials ??
                  DEFAULT_VALUES.auto_hot_reload_materials
                }
                onChange={(e) =>
                  onDataChange('auto_hot_reload_materials', e.target.checked)
                }
              />
              <label
                htmlFor="auto_hot_reload_materials"
                title={t.autoHotReloadMaterials}
              >
                {t.autoHotReloadMaterials}
              </label>
            </div>

            <div className="checkbox-group">
              <input
                type="checkbox"
                id="auto_hot_reload_particles"
                checked={
                  data.auto_hot_reload_particles ??
                  DEFAULT_VALUES.auto_hot_reload_particles
                }
                onChange={(e) =>
                  onDataChange('auto_hot_reload_particles', e.target.checked)
                }
              />
              <label
                htmlFor="auto_hot_reload_particles"
                title={t.autoHotReloadParticles}
              >
                {t.autoHotReloadParticles}
              </label>
            </div>
          </div>
        </details>

        <div className={`game-debugger-entry${gameDebuggerEnabled ? ' enabled' : ''}`}>
          <button
            type="button"
            className="game-debugger-open"
            onClick={() => vscode.postMessage({ type: 'openGameDebugger' })}
            title={t.openGameDebuggerTooltip}
          >
            <span className="game-debugger-entry-icon">
              <span className="codicon codicon-debug-console" aria-hidden="true"></span>
            </span>
            <span className="game-debugger-entry-copy">
              <strong>{t.hostBridgeTitle}</strong>
              <small>
                <span className="game-debugger-status-dot" aria-hidden="true"></span>
                <span className="game-debugger-status-text">
                  {gameDebuggerEnabled ? t.gameDebuggerEnabled : t.gameDebuggerDisabled}
                </span>
              </small>
            </span>
            <span className="game-debugger-open-action" aria-hidden="true">
              <span className="codicon codicon-arrow-right"></span>
            </span>
          </button>
          <span className="game-debugger-toggle-cell">
            <label className="toggle-switch game-debugger-toggle" title={t.gameDebuggerToggle}>
              <input
                type="checkbox"
                checked={gameDebuggerEnabled}
                onChange={(event) => setGameDebuggerEnabled(event.target.checked)}
                aria-label={t.gameDebuggerToggle}
              />
              <span className="toggle-switch-track" aria-hidden="true">
                <span className="toggle-switch-thumb" />
              </span>
            </label>
          </span>
        </div>
      </div>

      <div className="section">
        <div className="section-header-plain">
          <span className="section-title">
            <span className="codicon codicon-law"></span>
            {t.gameRules}
          </span>
        </div>

        <div className="checkbox-grid">
          <div className="checkbox-group">
            <input
              type="checkbox"
              id="enable_cheats"
              checked={data.enable_cheats ?? DEFAULT_VALUES.enable_cheats}
              onChange={(e) => onDataChange('enable_cheats', e.target.checked)}
            />
            <label htmlFor="enable_cheats" title={t.enableCheats}>
              {t.enableCheats}
            </label>
          </div>

          <div className="checkbox-group">
            <input
              type="checkbox"
              id="keep_inventory"
              checked={data.keep_inventory ?? DEFAULT_VALUES.keep_inventory}
              onChange={(e) => onDataChange('keep_inventory', e.target.checked)}
            />
            <label htmlFor="keep_inventory" title={t.keepInventory}>
              {t.keepInventory}
            </label>
          </div>

          <div className="checkbox-group">
            <input
              type="checkbox"
              id="do_daylight_cycle"
              checked={
                data.do_daylight_cycle ?? DEFAULT_VALUES.do_daylight_cycle
              }
              onChange={(e) =>
                onDataChange('do_daylight_cycle', e.target.checked)
              }
            />
            <label htmlFor="do_daylight_cycle" title={t.doDaylightCycle}>
              {t.doDaylightCycle}
            </label>
          </div>

          <div className="checkbox-group">
            <input
              type="checkbox"
              id="do_weather_cycle"
              checked={data.do_weather_cycle ?? DEFAULT_VALUES.do_weather_cycle}
              onChange={(e) =>
                onDataChange('do_weather_cycle', e.target.checked)
              }
            />
            <label htmlFor="do_weather_cycle" title={t.doWeatherCycle}>
              {t.doWeatherCycle}
            </label>
          </div>
        </div>
      </div>
    </>
  );
};
