import React, { useEffect, useMemo, useState } from 'react';
import { ConnectionState } from '../hooks/useTelemetry';

type Props = {
  onConnect: (ip: string, port: string) => void;
  onDisconnect: () => void;
  connectionState: ConnectionState;
  activeUrl?: string | null;
  clients: string[];
  selectedClientId: string | null;
  onSelectClient?: (clientId: string) => void;
};

const ConnectionPanel: React.FC<Props> = ({
  onConnect,
  onDisconnect,
  connectionState,
  activeUrl,
  clients,
  selectedClientId,
  onSelectClient
}) => {
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('8080');

  useEffect(() => {
    if (!activeUrl) return;
    try {
      const url = new URL(activeUrl.replace('ws://', 'http://').replace('wss://', 'https://'));
      setIp(url.hostname || '');
      setPort(url.port || '8080');
    } catch (error) {
      // ignore parse errors
    }
  }, [activeUrl]);

  const isConnected = connectionState === 'open';
  const isConnecting = connectionState === 'connecting';

  const canSubmit = useMemo(() => ip.trim().length > 0 && port.trim().length > 0, [ip, port]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    onConnect(ip.trim(), port.trim());
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">连接管理</div>
        <div className={`badge badge--${isConnected ? 'success' : 'neutral'}`}>{isConnected ? '在线' : '离线'}</div>
      </div>
      <form className="form" onSubmit={handleSubmit}>
        <label className="form-label">
          <span>服务器 IP</span>
          <input
            type="text"
            className="input"
            placeholder="例如：192.168.0.100"
            value={ip}
            onChange={(event) => setIp(event.target.value)}
          />
        </label>
        <label className="form-label">
          <span>端口</span>
          <input
            type="text"
            className="input"
            placeholder="8080"
            value={port}
            onChange={(event) => setPort(event.target.value)}
          />
        </label>
        <div className="form-actions">
          <button
            type="submit"
            className="button button--primary"
            disabled={!canSubmit || isConnecting}
          >
            {isConnecting ? '连接中…' : '连接'}
          </button>
          {isConnected && (
            <button type="button" className="button button--ghost" onClick={onDisconnect}>
              断开
            </button>
          )}
        </div>
      </form>
      <div className="panel-divider" />
      <div className="panel-subtitle">实时客户端</div>
      {clients.length === 0 ? (
        <div className="empty-state">等待运行中的 Unity 客户端连接…</div>
      ) : (
        <div className="chip-list">
          {clients.map((clientId) => {
            const active = clientId === selectedClientId;
            return (
              <button
                key={clientId}
                className={`chip ${active ? 'chip--active' : ''}`}
                type="button"
                onClick={() => onSelectClient && onSelectClient(clientId)}
              >
                {clientId}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ConnectionPanel;