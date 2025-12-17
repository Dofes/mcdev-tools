import React from 'react';
import { I18nText } from '../i18n';

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
}

export const WindowStyle: React.FC<Props> = ({ t, windowStyle, onWindowStyleChange }) => {
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
          checked={windowStyle?.always_on_top || false}
          onChange={(e) => onWindowStyleChange('always_on_top', e.target.checked)}
        />
        <label htmlFor="ws_always_on_top">{t.alwaysOnTop}</label>
      </div>

      <div className="checkbox-group">
        <input
          type="checkbox"
          id="ws_hide_title_bar"
          checked={windowStyle?.hide_title_bar || false}
          onChange={(e) => onWindowStyleChange('hide_title_bar', e.target.checked)}
        />
        <label htmlFor="ws_hide_title_bar">{t.hideTitleBar}</label>
      </div>

      <div className="control-group">
        <label htmlFor="ws_title_bar_color">{t.titleBarColor}</label>
        <div className="color-input-wrapper">
          <input
            type="text"
            id="ws_title_bar_color"
            value={windowStyle?.title_bar_color?.join(',') || ''}
            onChange={(e) => {
              const val = e.target.value.trim();
              const arr = val ? val.split(',').map(v => Number(v.trim())).filter(n => !isNaN(n)) : null;
              onWindowStyleChange('title_bar_color', arr);
            }}
            placeholder={t.titleBarColorPlaceholder}
          />
          <label className="color-swatch" htmlFor="ws_title_bar_color_picker">
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
        </div>
      </div>

      <div className="control-group">
        <label htmlFor="ws_fixed_size">{t.fixedSize}</label>
        <input
          type="text"
          id="ws_fixed_size"
          value={windowStyle?.fixed_size?.join(',') || ''}
          onChange={(e) => {
            const val = e.target.value.trim();
            const arr = val ? val.split(',').map(v => Number(v.trim())).filter(n => !isNaN(n)) : null;
            onWindowStyleChange('fixed_size', arr);
          }}
          placeholder={t.fixedSizePlaceholder}
        />
      </div>

      <div className="control-group">
        <label htmlFor="ws_fixed_position">{t.fixedPosition}</label>
        <input
          type="text"
          id="ws_fixed_position"
          value={windowStyle?.fixed_position?.join(',') || ''}
          onChange={(e) => {
            const val = e.target.value.trim();
            const arr = val ? val.split(',').map(v => Number(v.trim())).filter(n => !isNaN(n)) : null;
            onWindowStyleChange('fixed_position', arr);
          }}
          placeholder={t.fixedPositionPlaceholder}
        />
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
