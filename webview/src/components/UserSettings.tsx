import React from 'react';
import { I18nText } from '../i18n';

interface McdevData {
  user_name?: string;
}

interface Props {
  t: I18nText;
  data: McdevData;
  onDataChange: (field: string, value: any) => void;
}

export const UserSettings: React.FC<Props> = ({ t, data, onDataChange }) => {
  return (
    <div className="section">
      <div className="section-header-plain">
        <span className="section-title">
          <span className="codicon codicon-account"></span>
          {t.userSettings}
        </span>
      </div>

      <div className="control-group">
        <label htmlFor="user_name">{t.userName}</label>
        <input
          type="text"
          id="user_name"
          value={data.user_name || ''}
          onChange={(e) => onDataChange('user_name', e.target.value)}
          placeholder="developer"
        />
      </div>
    </div>
  );
};
