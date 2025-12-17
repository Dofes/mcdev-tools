import React from 'react';
import { I18nText } from '../i18n';
import { useDefaultValues } from '../hooks/useDefaultValues';

interface McdevData {
  reset_world?: boolean;
  auto_join_game?: boolean;
  include_debug_mod?: boolean;
  auto_hot_reload_mods?: boolean;
  enable_cheats?: boolean;
  keep_inventory?: boolean;
  do_weather_cycle?: boolean;
}

interface Props {
  t: I18nText;
  data: McdevData;
  onDataChange: (field: string, value: any) => void;
  markInitialized?: (componentId: string) => void;
}


const DEFAULT_VALUES: McdevData = {
  reset_world: false,
  auto_join_game: true,
  include_debug_mod: true,
  auto_hot_reload_mods: true,
  enable_cheats: true,
  keep_inventory: true,
  do_weather_cycle: true,
};

export const GameOptions: React.FC<Props> = ({ t, data, onDataChange, markInitialized }) => {
  useDefaultValues(data, DEFAULT_VALUES, onDataChange, markInitialized ? () => markInitialized('GameOptions') : undefined);

  return (
    <>
      <div className="section">
        <div className="section-header-plain">
          <span className="section-title">
            <span className="codicon codicon-debug-alt"></span>
            {t.startupOptions}
          </span>
        </div>

        <div className="checkbox-group">
          <input
            type="checkbox"
            id="reset_world"
            checked={data.reset_world ?? DEFAULT_VALUES.reset_world}
            onChange={(e) => onDataChange('reset_world', e.target.checked)}
          />
          <label htmlFor="reset_world">{t.resetWorld}</label>
        </div>

        <div className="checkbox-group">
          <input
            type="checkbox"
            id="auto_join_game"
            checked={data.auto_join_game ?? DEFAULT_VALUES.auto_join_game}
            onChange={(e) => onDataChange('auto_join_game', e.target.checked)}
          />
          <label htmlFor="auto_join_game">{t.autoJoin}</label>
        </div>

        <div className="checkbox-group">
          <input
            type="checkbox"
            id="include_debug_mod"
            checked={data.include_debug_mod ?? DEFAULT_VALUES.include_debug_mod}
            onChange={(e) => onDataChange('include_debug_mod', e.target.checked)}
          />
          <label htmlFor="include_debug_mod">{t.includeDebug}</label>
        </div>

        <div className="checkbox-group">
          <input
            type="checkbox"
            id="auto_hot_reload_mods"
            checked={data.auto_hot_reload_mods ?? DEFAULT_VALUES.auto_hot_reload_mods}
            onChange={(e) => onDataChange('auto_hot_reload_mods', e.target.checked)}
          />
          <label htmlFor="auto_hot_reload_mods">{t.autoHotReload}</label>
        </div>
      </div>

      <div className="section">
        <div className="section-header-plain">
          <span className="section-title">
            <span className="codicon codicon-law"></span>
            {t.gameRules}
          </span>
        </div>

        <div className="checkbox-group">
          <input
            type="checkbox"
            id="enable_cheats"
            checked={data.enable_cheats ?? DEFAULT_VALUES.enable_cheats}
            onChange={(e) => onDataChange('enable_cheats', e.target.checked)}
          />
          <label htmlFor="enable_cheats">{t.enableCheats}</label>
        </div>

      <div className="checkbox-group">
        <input
          type="checkbox"
          id="keep_inventory"
          checked={data.keep_inventory ?? DEFAULT_VALUES.keep_inventory}
          onChange={(e) => onDataChange('keep_inventory', e.target.checked)}
        />
        <label htmlFor="keep_inventory">{t.keepInventory}</label>
      </div>

      <div className="checkbox-group">
        <input
          type="checkbox"
          id="do_weather_cycle"
          checked={data.do_weather_cycle ?? DEFAULT_VALUES.do_weather_cycle}
          onChange={(e) => onDataChange('do_weather_cycle', e.target.checked)}
        />
        <label htmlFor="do_weather_cycle">{t.doWeatherCycle}</label>
      </div>
    </div>
    </>
  );
};
