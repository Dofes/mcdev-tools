import React, { useState } from "react";
import { I18nText } from "../i18n";
import { WorldRules } from "../types";
import { useDefaultValues } from "../hooks/useDefaultValues";
import {
  useExperimentDefaults,
  EXPERIMENT_DEFAULT_VALUES,
} from "../hooks/useExperimentDefaults";
import { WorldManager } from "./WorldManager";

interface McdevData {
  world_name?: string;
  world_folder_name?: string;
  world_seed?: number | null;
  game_mode?: number;
  world_type?: number;
  enable_cheats?: boolean;
  keep_inventory?: boolean;
  do_daylight_cycle?: boolean;
  do_weather_cycle?: boolean;
  do_mob_spawning?: boolean;
  do_mob_loot?: boolean;
  mob_griefing?: boolean;
  bonus_chest?: boolean;
  start_time?: number | null;
  experiment_options?: {
    data_driven_biomes?: boolean;
    data_driven_items?: boolean;
    experimental_molang_features?: boolean;
  };
}

const TIME_PRESETS = [
  { labelKey: "timeSunrise" as const, value: 23000 },
  { labelKey: "timeNoon" as const, value: 6000 },
  { labelKey: "timeSunset" as const, value: 12000 },
  { labelKey: "timeMidnight" as const, value: 18000 },
];

export const GAME_RULE_DEFAULTS: WorldRules = {
  enable_cheats: true,
  keep_inventory: true,
  do_daylight_cycle: true,
  do_weather_cycle: true,
  do_mob_spawning: true,
  do_mob_loot: true,
  mob_griefing: true,
  bonus_chest: false,
  game_mode: 1,
};

interface Props {
  t: I18nText;
  data: McdevData;
  onDataChange: (field: string, value: any) => void;
  onExperimentChange: (field: string, checked: boolean) => void;
  markInitialized?: (componentId: string) => void;
  currentWorldFolder?: string;
  currentWorldName?: string;
  onSwitchWorld: (folderName: string, displayName: string) => void;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  worldRules: WorldRules;
  onWorldRuleChange: (field: string, value: any) => void;
  onWorldExperimentChange: (field: string, checked: boolean) => void;
}

export type Tab = "select" | "create";

const DEFAULT_VALUES: McdevData = {
  world_name: "MC_DEV_WORLD",
  world_folder_name: "MC_DEV_WORLD",
  world_seed: null,
  world_type: 1,
  game_mode: 1,
};

export const WorldSettings: React.FC<Props> = ({
  t,
  data,
  onDataChange,
  onExperimentChange,
  markInitialized,
  currentWorldFolder,
  currentWorldName,
  onSwitchWorld,
  tab,
  onTabChange,
  worldRules,
  onWorldRuleChange,
  onWorldExperimentChange,
}) => {
  const [experimentExpanded, setExperimentExpanded] = useState(false);

  useDefaultValues(
    data,
    DEFAULT_VALUES,
    onDataChange,
    markInitialized ? () => markInitialized("WorldSettings") : undefined,
  );
  useExperimentDefaults(
    data.experiment_options,
    onExperimentChange,
    markInitialized ? () => markInitialized("ExperimentOptions") : undefined,
  );

  // Helper to render a game rule checkbox that adapts to the active tab
  const renderCheckbox = (field: keyof WorldRules, label: string) => {
    const val = tab === "select"
      ? (worldRules[field] ?? GAME_RULE_DEFAULTS[field])
      : (data[field] ?? GAME_RULE_DEFAULTS[field]);
    const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (tab === "select") {
        onWorldRuleChange(field, e.target.checked);
      } else {
        onDataChange(field, e.target.checked);
      }
    };
    return (
      <div className="checkbox-group">
        <input type="checkbox" id={field} checked={!!val} onChange={onChange} />
        <label htmlFor={field}>{label}</label>
      </div>
    );
  };

  // Helper to render an experiment option checkbox
  const renderExpCheckbox = (field: string, label: string) => {
    const expOpts = tab === "select"
      ? worldRules.experiment_options
      : data.experiment_options;
    const val = (expOpts as any)?.[field] ?? (EXPERIMENT_DEFAULT_VALUES as any)[field];
    const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (tab === "select") {
        onWorldExperimentChange(field, e.target.checked);
      } else {
        onExperimentChange(field, e.target.checked);
      }
    };
    return (
      <div className="checkbox-group">
        <input type="checkbox" id={`exp_${field}`} checked={!!val} onChange={onChange} />
        <label htmlFor={`exp_${field}`}>{label}</label>
      </div>
    );
  };

  return (
    <div className="section">
      <div className="section-header-plain">
        <span className="section-title">
          <span className="codicon codicon-globe"></span>
          {t.worldSettings}
        </span>
      </div>

      <div className="ws-tabs">
        <button
          className={"ws-tab" + (tab === "select" ? " active" : "")}
          onClick={() => onTabChange("select")}
        >
          <span className="codicon codicon-folder-opened"></span>
          {t.worldTabSelect}
        </button>
        <button
          className={"ws-tab" + (tab === "create" ? " active" : "")}
          onClick={() => onTabChange("create")}
        >
          <span className="codicon codicon-add"></span>
          {t.worldTabCreate}
        </button>
      </div>

      {tab === "select" ? (
        <WorldManager
          t={t}
          currentWorldFolder={currentWorldFolder}
          onSwitchWorld={onSwitchWorld}
          embedded
        />
      ) : (
        <>
          <div className="control-group">
            <label htmlFor="world_name">{t.worldName}</label>
            <input
              type="text"
              id="world_name"
              value={data.world_name ?? DEFAULT_VALUES.world_name ?? ""}
              onChange={(e) => onDataChange("world_name", e.target.value)}
              placeholder="MC_DEV_WORLD"
            />
          </div>

          <div className="control-group">
            <label htmlFor="world_folder_name">{t.worldFolder}</label>
            <input
              type="text"
              id="world_folder_name"
              value={
                data.world_folder_name ?? DEFAULT_VALUES.world_folder_name ?? ""
              }
              onChange={(e) =>
                onDataChange("world_folder_name", e.target.value)
              }
              placeholder="MC_DEV_WORLD"
            />
          </div>

          <div className="control-group">
            <label htmlFor="world_seed">{t.worldSeed}</label>
            <input
              type="text"
              id="world_seed"
              value={
                data.world_seed === null || data.world_seed === undefined
                  ? ""
                  : String(data.world_seed)
              }
              onChange={(e) => {
                const val = e.target.value.trim();
                onDataChange("world_seed", val === "" ? null : Number(val));
              }}
              placeholder={t.worldSeed}
            />
          </div>

          <div className="control-group">
            <label htmlFor="world_type">{t.worldType}</label>
            <select
              id="world_type"
              value={data.world_type ?? DEFAULT_VALUES.world_type}
              onChange={(e) =>
                onDataChange("world_type", Number(e.target.value))
              }
            >
              <option value="1">{t.infinity}</option>
              <option value="2">{t.flat}</option>
              <option value="0">{t.old}</option>
            </select>
          </div>
        </>
      )}

      {/* Game Rules */}
      <div className="section-header-plain" style={{ marginTop: 12 }}>
        <span className="section-title">
          <span className="codicon codicon-law"></span>
          {tab === "select" && currentWorldName
            ? t.gameRulesFor.replace("{0}", currentWorldName)
            : t.gameRulesDefault}
        </span>
      </div>

      <div className="control-group">
        <label htmlFor="rules_game_mode">{t.gameMode}</label>
        <select
          id="rules_game_mode"
          value={
            tab === "select"
              ? (worldRules.game_mode ?? GAME_RULE_DEFAULTS.game_mode)
              : (data.game_mode ?? DEFAULT_VALUES.game_mode)
          }
          onChange={(e) => {
            const val = Number(e.target.value);
            if (tab === "select") {
              onWorldRuleChange("game_mode", val);
            } else {
              onDataChange("game_mode", val);
            }
          }}
        >
          <option value="0">{t.survival}</option>
          <option value="1">{t.creative}</option>
          <option value="2">{t.adventure}</option>
          <option value="3">{t.spectator}</option>
        </select>
      </div>

      {renderCheckbox("enable_cheats", t.enableCheats)}
      {renderCheckbox("keep_inventory", t.keepInventory)}
      {renderCheckbox("do_daylight_cycle", t.doDaylightCycle)}
      {renderCheckbox("do_weather_cycle", t.doWeatherCycle)}
      {renderCheckbox("do_mob_spawning", t.doMobSpawning)}
      {renderCheckbox("do_mob_loot", t.doMobLoot)}
      {renderCheckbox("mob_griefing", t.mobGriefing)}
      {renderCheckbox("bonus_chest", t.bonusChest)}

      <div className="control-group">
        <label htmlFor="start_time">{t.startTime}</label>
        <div className="time-preset-buttons">
          {TIME_PRESETS.map((preset) => {
            const currentVal = tab === "select" ? worldRules.start_time : data.start_time;
            return (
              <button
                key={preset.labelKey}
                type="button"
                className={
                  "btn-secondary time-preset-btn" +
                  (currentVal === preset.value ? " active" : "")
                }
                onClick={() => {
                  const newVal = currentVal === preset.value ? null : preset.value;
                  if (tab === "select") {
                    onWorldRuleChange("start_time", newVal);
                  } else {
                    onDataChange("start_time", newVal);
                  }
                }}
              >
                {t[preset.labelKey]}
              </button>
            );
          })}
        </div>
        <input
          type="text"
          id="start_time"
          value={(tab === "select" ? worldRules.start_time : data.start_time) ?? ""}
          placeholder={t.startTimePlaceholder}
          onChange={(e) => {
            const val = e.target.value.trim();
            const newVal = val === "" ? null : parseInt(val, 10);
            if (val !== "" && isNaN(newVal as number)) return;
            if (tab === "select") {
              onWorldRuleChange("start_time", newVal);
            } else {
              onDataChange("start_time", newVal);
            }
          }}
        />
      </div>

      {/* Experimental Options */}
      <div
        className={`subsection ${experimentExpanded ? "" : "collapsed"}`}
      >
        <div
          className="subsection-header"
          onClick={() => setExperimentExpanded(!experimentExpanded)}
        >
          <span className="subsection-title">
            <span className="codicon codicon-chevron-right"></span>
            {t.experimentOptions}
          </span>
        </div>
        <div className="collapsible-content">
          {renderExpCheckbox("data_driven_biomes", t.dataDrivenBiomes)}
          {renderExpCheckbox("data_driven_items", t.dataDrivenItems)}
          {renderExpCheckbox("experimental_molang_features", t.experimentalMolang)}
        </div>
      </div>
    </div>
  );
};
