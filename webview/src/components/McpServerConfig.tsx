import React from 'react';
import { I18nText } from '../i18n';
import { vscode } from '../vscode';
import { useNestedDefaultValues } from '../hooks/useDefaultValues';

interface McpServerConfigData {
  enabled?: boolean;
  server_ip?: string;
  server_port?: number;
}

interface Props {
  t: I18nText;
  mcpServerConfig?: McpServerConfigData;
  onMcpServerConfigChange: (field: string, value: any) => void;
  markInitialized?: (componentId: string) => void;
}

const DEFAULT_VALUES: McpServerConfigData = {
  enabled: false,
  server_ip: 'localhost',
  server_port: 19133,
};

const MCP_BRIDGE_URL = 'https://github.com/GitHub-Zero123/MCDevTool/tree/main/tools/mcdk_stdio_bridge';

export const McpServerConfig: React.FC<Props> = ({
  t,
  mcpServerConfig,
  onMcpServerConfigChange,
  markInitialized,
}) => {
  useNestedDefaultValues(
    mcpServerConfig,
    DEFAULT_VALUES,
    onMcpServerConfigChange,
    markInitialized ? () => markInitialized('McpServerConfig') : undefined
  );

  const handleOpenBridgeTool = () => {
    vscode.postMessage({ type: 'openExternal', url: MCP_BRIDGE_URL });
  };

  const handlePortChange = (value: string) => {
    const port = Number.parseInt(value, 10);
    onMcpServerConfigChange('server_port', Number.isNaN(port) ? DEFAULT_VALUES.server_port : port);
  };

  return (
    <div className="section">
      <div className="section-header-plain">
        <span className="section-title">
          <span className="codicon codicon-server"></span>
          {t.mcpServerConfig}
        </span>
        <button
          type="button"
          className="btn-link-compact mcp-bridge-btn"
          onClick={handleOpenBridgeTool}
          title={t.getMcpBridgeTool}
        >
          <span className="codicon codicon-link-external"></span>
          {t.getMcpBridgeTool}
        </button>
      </div>

      <div className="section-description">
        {t.mcpServerDescription}
      </div>

      <div className="checkbox-group">
        <input
          type="checkbox"
          id="mcp_server_enabled"
          checked={mcpServerConfig?.enabled ?? DEFAULT_VALUES.enabled}
          onChange={(e) => onMcpServerConfigChange('enabled', e.target.checked)}
        />
        <label htmlFor="mcp_server_enabled">{t.mcpServerEnabled}</label>
      </div>

      <div className="mcp-config-grid">
        <div className="control-group">
          <label htmlFor="mcp_server_ip">{t.mcpServerIp}</label>
          <input
            type="text"
            id="mcp_server_ip"
            value={mcpServerConfig?.server_ip ?? DEFAULT_VALUES.server_ip}
            onChange={(e) => onMcpServerConfigChange('server_ip', e.target.value)}
            placeholder="localhost"
          />
        </div>

        <div className="control-group">
          <label htmlFor="mcp_server_port">{t.mcpServerPort}</label>
          <input
            type="number"
            id="mcp_server_port"
            min={1}
            max={65535}
            value={mcpServerConfig?.server_port ?? DEFAULT_VALUES.server_port}
            onChange={(e) => handlePortChange(e.target.value)}
            placeholder="19133"
          />
        </div>
      </div>
    </div>
  );
};
