import React from 'react';
import { I18nText } from '../i18n';
import { useNestedDefaultValues } from '../hooks/useDefaultValues';

interface WindowStyleData {
  always_on_top?: boolean;
  hide_title_bar?: boolean;
  title_bar_color?: number[] | null;
  fixed_size?: number[] | null;
  fixed_position?: number[] | null;
  lock_corner?: number | null;
}

interface Props {
  t: I18nText;
  windowStyle: WindowStyleData | undefined;
  onWindowStyleChange: (field: string, value: any) => void;
  markInitialized?: (componentId: string) => void;
}


const DEFAULT_VALUES: WindowStyleData = {
  always_on_top: false,
  hide_title_bar: false,
  title_bar_color: null,
  fixed_size: null,
  fixed_position: null,
  lock_corner: null,
};

export const WindowStyle: React.FC<Props> = ({ t, windowStyle, onWindowStyleChange, markInitialized }) => {
  useNestedDefaultValues(windowStyle, DEFAULT_VALUES, onWindowStyleChange, markInitialized ? () => markInitialized('WindowStyle') : undefined);

  return (
    <div className="section">
      <div className="section-header-plain">
        <span className="section-title">
          <span className="codicon codicon-window"></span>
          {t.windowStyle}
        </span>
      </div>

      <div className="checkbox-group">
        <input
          type="checkbox"
          id="ws_always_on_top"
          checked={windowStyle?.always_on_top ?? DEFAULT_VALUES.always_on_top}
          onChange={(e) => onWindowStyleChange('always_on_top', e.target.checked)}
        />
        <label htmlFor="ws_always_on_top">{t.alwaysOnTop}</label>
      </div>

      <div className="checkbox-group">
        <input
          type="checkbox"
          id="ws_hide_title_bar"
          checked={windowStyle?.hide_title_bar ?? DEFAULT_VALUES.hide_title_bar}
          onChange={(e) => onWindowStyleChange('hide_title_bar', e.target.checked)}
        />
        <label htmlFor="ws_hide_title_bar">{t.hideTitleBar}</label>
      </div>

      <div className="control-group">
        <label>{t.titleBarColor}</label>
        <div className="input-row">
          <label className="color-preview-box" htmlFor="ws_title_bar_color_picker">
            <div 
              className="color-preview"
              style={{ 
                backgroundColor: windowStyle?.title_bar_color ? 
                  `rgb(${windowStyle.title_bar_color.join(',')})` : 
                  'transparent'
              }}
            />
          </label>
          <input
            type="color"
            id="ws_title_bar_color_picker"
            value={windowStyle?.title_bar_color ? 
              `#${windowStyle.title_bar_color.map(n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')}` : 
              '#000000'}
            onChange={(e) => {
              const hex = e.target.value;
              const r = parseInt(hex.slice(1, 3), 16);
              const g = parseInt(hex.slice(3, 5), 16);
              const b = parseInt(hex.slice(5, 7), 16);
              onWindowStyleChange('title_bar_color', [r, g, b]);
            }}
          />
          <span
            className="codicon codicon-close clear-btn"
            title={t.clear}
            onClick={() => onWindowStyleChange('title_bar_color', null)}
          />
        </div>
      </div>

      <div className="control-group">
        <label>{t.fixedSize}</label>
        <div className="input-row">
          <input
            type="text"
            id="ws_fixed_size_width"
            value={windowStyle?.fixed_size?.[0] ?? ''}
            onChange={(e) => {
              const val = e.target.value.trim();
              const width = val === '' ? null : Number(val);
              if (val !== '' && (isNaN(width!) || width! < 0)) return;
              const height = windowStyle?.fixed_size?.[1] ?? null;
              onWindowStyleChange('fixed_size', width !== null || height !== null ? [width ?? 0, height ?? 0] : null);
            }}
            placeholder={t.width}
          />
          <input
            type="text"
            id="ws_fixed_size_height"
            value={windowStyle?.fixed_size?.[1] ?? ''}
            onChange={(e) => {
              const val = e.target.value.trim();
              const height = val === '' ? null : Number(val);
              if (val !== '' && (isNaN(height!) || height! < 0)) return;
              const width = windowStyle?.fixed_size?.[0] ?? null;
              onWindowStyleChange('fixed_size', width !== null || height !== null ? [width ?? 0, height ?? 0] : null);
            }}
            placeholder={t.height}
          />
          <span
            className="codicon codicon-close clear-btn"
            title={t.clear}
            onClick={() => onWindowStyleChange('fixed_size', null)}
          />
        </div>
      </div>

      <div className="control-group">
        <label>{t.fixedPosition}</label>
        <div className="input-row">
          <input
            type="text"
            id="ws_fixed_position_x"
            value={windowStyle?.fixed_position?.[0] ?? ''}
            onChange={(e) => {
              const val = e.target.value.trim();
              const x = val === '' ? null : Number(val);
              if (val !== '' && isNaN(x!)) return;
              const y = windowStyle?.fixed_position?.[1] ?? null;
              onWindowStyleChange('fixed_position', x !== null || y !== null ? [x ?? 0, y ?? 0] : null);
            }}
            placeholder={t.positionX}
          />
          <input
            type="text"
            id="ws_fixed_position_y"
            value={windowStyle?.fixed_position?.[1] ?? ''}
            onChange={(e) => {
              const val = e.target.value.trim();
              const y = val === '' ? null : Number(val);
              if (val !== '' && isNaN(y!)) return;
              const x = windowStyle?.fixed_position?.[0] ?? null;
              onWindowStyleChange('fixed_position', x !== null || y !== null ? [x ?? 0, y ?? 0] : null);
            }}
            placeholder={t.positionY}
          />
          <span
            className="codicon codicon-close clear-btn"
            title={t.clear}
            onClick={() => onWindowStyleChange('fixed_position', null)}
          />
        </div>
      </div>

      <div className="control-group">
        <label htmlFor="ws_lock_corner">{t.lockCorner}</label>
        <select
          id="ws_lock_corner"
          value={windowStyle?.lock_corner ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            onWindowStyleChange('lock_corner', val === '' ? null : Number(val));
          }}
        >
          <option value="">{t.cornerNone}</option>
          <option value="1">{t.cornerTopLeft}</option>
          <option value="2">{t.cornerTopRight}</option>
          <option value="3">{t.cornerBottomLeft}</option>
          <option value="4">{t.cornerBottomRight}</option>
        </select>
      </div>
    </div>
  );
};
