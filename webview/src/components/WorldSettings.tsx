import React, { useState } from 'react';
import { I18nText } from '../i18n';
import { useDefaultValues } from '../hooks/useDefaultValues';
import { useExperimentDefaults, EXPERIMENT_DEFAULT_VALUES } from '../hooks/useExperimentDefaults';

interface McdevData {
  world_name?: string;
  world_folder_name?: string;
  world_seed?: number | null;
  game_mode?: number;
  world_type?: number;
  experiment_options?: {
    data_driven_biomes?: boolean;
    data_driven_items?: boolean;
    experimental_molang_features?: boolean;
  };
}

interface Props {
  t: I18nText;
  data: McdevData;
  onDataChange: (field: string, value: any) => void;
  onExperimentChange: (field: string, checked: boolean) => void;
  markInitialized?: (componentId: string) => void;
}


const DEFAULT_VALUES: McdevData = {
  world_name: 'MC_DEV_WORLD',
  world_folder_name: 'MC_DEV_WORLD',
  world_seed: null,
  world_type: 1,
  game_mode: 1,
};

export const WorldSettings: React.FC<Props> = ({ t, data, onDataChange, onExperimentChange, markInitialized }) => {
  const [experimentExpanded, setExperimentExpanded] = useState(false);

  useDefaultValues(data, DEFAULT_VALUES, onDataChange, markInitialized ? () => markInitialized('WorldSettings') : undefined);
  useExperimentDefaults(data.experiment_options, onExperimentChange, markInitialized ? () => markInitialized('ExperimentOptions') : undefined);

  return (
    <div className="section">
      <div className="section-header-plain">
        <span className="section-title">
          <span className="codicon codicon-globe"></span>
          {t.worldSettings}
        </span>
      </div>
      
      <div className="control-group">
        <label htmlFor="world_name">{t.worldName}</label>
        <input
          type="text"
          id="world_name"
          value={data.world_name ?? DEFAULT_VALUES.world_name ?? ''}
          onChange={(e) => onDataChange('world_name', e.target.value)}
          placeholder="MC_DEV_WORLD"
        />
      </div>

      <div className="control-group">
        <label htmlFor="world_folder_name">{t.worldFolder}</label>
        <input
          type="text"
          id="world_folder_name"
          value={data.world_folder_name ?? DEFAULT_VALUES.world_folder_name ?? ''}
          onChange={(e) => onDataChange('world_folder_name', e.target.value)}
          placeholder="MC_DEV_WORLD"
        />
      </div>

      <div className="control-group">
        <label htmlFor="world_seed">{t.worldSeed}</label>
        <input
          type="text"
          id="world_seed"
          value={data.world_seed === null || data.world_seed === undefined ? '' : String(data.world_seed)}
          onChange={(e) => {
            const val = e.target.value.trim();
            onDataChange('world_seed', val === '' ? null : Number(val));
          }}
          placeholder={t.worldSeed}
        />
      </div>

      <div className="control-group">
        <label htmlFor="world_type">{t.worldType}</label>
        <select
          id="world_type"
          value={data.world_type ?? DEFAULT_VALUES.world_type}
          onChange={(e) => onDataChange('world_type', Number(e.target.value))}
        >
          <option value="1">{t.infinity}</option>
          <option value="2">{t.flat}</option>
          <option value="0">{t.old}</option>
        </select>
      </div>

      <div className="control-group">
        <label htmlFor="game_mode">{t.gameMode}</label>
        <select
          id="game_mode"
          value={data.game_mode ?? DEFAULT_VALUES.game_mode}
          onChange={(e) => onDataChange('game_mode', Number(e.target.value))}
        >
          <option value="0">{t.survival}</option>
          <option value="1">{t.creative}</option>
          <option value="2">{t.adventure}</option>
          <option value="3">{t.spectator}</option>
        </select>
      </div>

      {/* Experimental Options Subsection */}
      <div className={`subsection ${experimentExpanded ? '' : 'collapsed'}`}>
        <div className="subsection-header" onClick={() => setExperimentExpanded(!experimentExpanded)}>
          <span className="subsection-title">
            <span className="codicon codicon-chevron-right"></span>
            {t.experimentOptions}
          </span>
        </div>
        <div className="collapsible-content">
          <div className="checkbox-group">
            <input
              type="checkbox"
              id="exp_data_driven_biomes"
              checked={data.experiment_options?.data_driven_biomes ?? EXPERIMENT_DEFAULT_VALUES.data_driven_biomes}
              onChange={(e) => onExperimentChange('data_driven_biomes', e.target.checked)}
            />
            <label htmlFor="exp_data_driven_biomes">{t.dataDrivenBiomes}</label>
          </div>
          <div className="checkbox-group">
            <input
              type="checkbox"
              id="exp_data_driven_items"
              checked={data.experiment_options?.data_driven_items ?? EXPERIMENT_DEFAULT_VALUES.data_driven_items}
              onChange={(e) => onExperimentChange('data_driven_items', e.target.checked)}
            />
            <label htmlFor="exp_data_driven_items">{t.dataDrivenItems}</label>
          </div>
          <div className="checkbox-group">
            <input
              type="checkbox"
              id="exp_experimental_molang_features"
              checked={data.experiment_options?.experimental_molang_features ?? EXPERIMENT_DEFAULT_VALUES.experimental_molang_features}
              onChange={(e) => onExperimentChange('experimental_molang_features', e.target.checked)}
            />
            <label htmlFor="exp_experimental_molang_features">{t.experimentalMolang}</label>
          </div>
        </div>
      </div>
    </div>
  );
};
