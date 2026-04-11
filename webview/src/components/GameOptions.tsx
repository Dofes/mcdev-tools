import React from "react";
import { I18nText } from "../i18n";
import { useDefaultValues } from "../hooks/useDefaultValues";

interface McdevData {
  reset_world?: boolean;
  auto_join_game?: boolean;
  include_debug_mod?: boolean;
  auto_hot_reload_mods?: boolean;
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
};

export const GameOptions: React.FC<Props> = ({
  t,
  data,
  onDataChange,
  markInitialized,
}) => {
  useDefaultValues(
    data,
    DEFAULT_VALUES,
    onDataChange,
    markInitialized ? () => markInitialized("GameOptions") : undefined,
  );

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
            onChange={(e) => onDataChange("reset_world", e.target.checked)}
          />
          <label htmlFor="reset_world">{t.resetWorld}</label>
        </div>

        <div className="checkbox-group">
          <input
            type="checkbox"
            id="auto_join_game"
            checked={data.auto_join_game ?? DEFAULT_VALUES.auto_join_game}
            onChange={(e) => onDataChange("auto_join_game", e.target.checked)}
          />
          <label htmlFor="auto_join_game">{t.autoJoin}</label>
        </div>

        <div className="checkbox-group">
          <input
            type="checkbox"
            id="include_debug_mod"
            checked={data.include_debug_mod ?? DEFAULT_VALUES.include_debug_mod}
            onChange={(e) =>
              onDataChange("include_debug_mod", e.target.checked)
            }
          />
          <label htmlFor="include_debug_mod">{t.includeDebug}</label>
        </div>

        <div className="checkbox-group">
          <input
            type="checkbox"
            id="auto_hot_reload_mods"
            checked={
              data.auto_hot_reload_mods ?? DEFAULT_VALUES.auto_hot_reload_mods
            }
            onChange={(e) =>
              onDataChange("auto_hot_reload_mods", e.target.checked)
            }
          />
          <label htmlFor="auto_hot_reload_mods">{t.autoHotReload}</label>
        </div>
      </div>
    </>
  );
};
