import React from 'react';
import { I18nText } from '../i18n';

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
}

export const GameOptions: React.FC<Props> = ({ t, data, onDataChange }) => {
  return (
    <div className="section">
      <div className="section-header-plain">
        <span className="section-title">
          <span className="codicon codicon-settings-gear"></span>
          {t.gameOptions}
        </span>
      </div>

      <div className="checkbox-group">
        <input
          type="checkbox"
          id="reset_world"
          checked={data.reset_world || false}
          onChange={(e) => onDataChange('reset_world', e.target.checked)}
        />
        <label htmlFor="reset_world">{t.resetWorld}</label>
      </div>

      <div className="checkbox-group">
        <input
          type="checkbox"
          id="auto_join_game"
          checked={data.auto_join_game ?? true}
          onChange={(e) => onDataChange('auto_join_game', e.target.checked)}
        />
        <label htmlFor="auto_join_game">{t.autoJoin}</label>
      </div>

      <div className="checkbox-group">
        <input
          type="checkbox"
          id="include_debug_mod"
          checked={data.include_debug_mod ?? true}
          onChange={(e) => onDataChange('include_debug_mod', e.target.checked)}
        />
        <label htmlFor="include_debug_mod">{t.includeDebug}</label>
      </div>

      <div className="checkbox-group">
        <input
          type="checkbox"
          id="auto_hot_reload_mods"
          checked={data.auto_hot_reload_mods ?? true}
          onChange={(e) => onDataChange('auto_hot_reload_mods', e.target.checked)}
        />
        <label htmlFor="auto_hot_reload_mods">{t.autoHotReload}</label>
      </div>

      <div className="checkbox-group">
        <input
          type="checkbox"
          id="enable_cheats"
          checked={data.enable_cheats ?? true}
          onChange={(e) => onDataChange('enable_cheats', e.target.checked)}
        />
        <label htmlFor="enable_cheats">{t.enableCheats}</label>
      </div>

      <div className="checkbox-group">
        <input
          type="checkbox"
          id="keep_inventory"
          checked={data.keep_inventory ?? true}
          onChange={(e) => onDataChange('keep_inventory', e.target.checked)}
        />
        <label htmlFor="keep_inventory">{t.keepInventory}</label>
      </div>

      <div className="checkbox-group">
        <input
          type="checkbox"
          id="do_weather_cycle"
          checked={data.do_weather_cycle ?? true}
          onChange={(e) => onDataChange('do_weather_cycle', e.target.checked)}
        />
        <label htmlFor="do_weather_cycle">{t.doWeatherCycle}</label>
      </div>
    </div>
  );
};
