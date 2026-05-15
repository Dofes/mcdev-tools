import React from 'react';
import { I18nText } from '../i18n';
import { vscode } from '../vscode';

const MCP_ASSISTANT_URL = 'https://github.com/GitHub-Zero123/mcdk-assistant';

interface Props {
  t: I18nText;
}

export const AssistantMcpLink: React.FC<Props> = ({ t }) => {
  const handleOpenAssistant = () => {
    vscode.postMessage({ type: 'openExternal', url: MCP_ASSISTANT_URL });
  };

  return (
    <div className="assistant-mcp-link-section">
      <button
        type="button"
        className="assistant-mcp-link"
        onClick={handleOpenAssistant}
        title={t.mcpAssistantDescription}
      >
        <span className="codicon codicon-book"></span>
        <span className="assistant-mcp-link-text">
          <span className="assistant-mcp-link-title">
            {t.getMcpAssistant}
            <em>{t.mcpAssistantBadge}</em>
          </span>
          <small>{t.mcpAssistantDescription}</small>
        </span>
        <span className="codicon codicon-link-external"></span>
      </button>
    </div>
  );
};
