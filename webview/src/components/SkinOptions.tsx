import React from 'react';
import { I18nText } from '../i18n';
import { useNestedDefaultValues } from '../hooks/useDefaultValues';
import { McdevData } from '../types';
import { vscode } from '../vscode';

interface Props {
  t: I18nText;
  skinInfo: McdevData['skin_info'];
  previewUrl: string | null;
  onSkinInfoChange: (field: string, value: any) => void;
  markInitialized?: (componentId: string) => void;
}

interface SkinInfoDefaults {
  slim: boolean;
  skin: string;
}

const DEFAULT_VALUES: SkinInfoDefaults = {
  slim: false,
  skin: '',
};

export const SkinOptions: React.FC<Props> = ({ t, skinInfo, previewUrl, onSkinInfoChange, markInitialized }) => {
  useNestedDefaultValues(skinInfo as any, DEFAULT_VALUES, onSkinInfoChange, markInitialized ? () => markInitialized('SkinOptions') : undefined);

  const effectiveSkin = skinInfo?.skin ?? DEFAULT_VALUES.skin;
  const effectiveSlim = skinInfo?.slim ?? DEFAULT_VALUES.slim;

  const handleBrowse = () => {
    vscode.postMessage({ type: 'browseSkin' });
  };

  return (
    <div className="section">
      <div className="section-header-plain">
        <span className="section-title">
          <span className="codicon codicon-person"></span>
          {t.skinOptions}
        </span>
      </div>

      <div className="checkbox-group">
        <input
          type="checkbox"
          id="skin_slim"
          checked={effectiveSlim}
          onChange={(e) => onSkinInfoChange('slim', e.target.checked)}
        />
        <label htmlFor="skin_slim">{t.skinSlim}</label>
      </div>

      <div className="control-group">
        <label htmlFor="skin_path">{t.skinPath}</label>
        <div className="input-row">
          <input
            type="text"
            id="skin_path"
            value={effectiveSkin}
            onChange={(e) => onSkinInfoChange('skin', e.target.value)}
            placeholder="default"
          />
          <button
            type="button"
            className="btn-icon browse"
            onClick={handleBrowse}
            title={t.browseSkin}
          >
            <span className="codicon codicon-file-media"></span>
          </button>
        </div>
      </div>

      {previewUrl && (
        <div className="control-group">
          <label>{t.currentSkin}</label>
          <div className="skin-preview-container">
            <img
              className="skin-preview"
              src={previewUrl}
              alt={t.skinPath}
            />
          </div>
        </div>
      )}
    </div>
  );
};
