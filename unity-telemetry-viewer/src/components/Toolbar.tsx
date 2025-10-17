import React from 'react';
import { ConnectionState } from '../hooks/useTelemetry';

type Props = {
  connectionState: ConnectionState;
  endpoint?: string | null;
  onDisconnect?: () => void;
};

const stateLabels: Record<ConnectionState, { label: string; tone: 'neutral' | 'warning' | 'success' | 'error' }> = {
  idle: { label: '未连接', tone: 'neutral' },
  connecting: { label: '连接中…', tone: 'warning' },
  open: { label: '已连接', tone: 'success' },
  closed: { label: '连接已关闭', tone: 'warning' },
  error: { label: '连接错误', tone: 'error' }
};

const Toolbar: React.FC<Props> = ({ connectionState, endpoint, onDisconnect }) => {
  const state = stateLabels[connectionState];

  return (
    <header className="app-header">
      <div className="app-header__brand">
        <span className="app-header__logo">Unity Runtime Insight</span>
        <span className={`status-pill status-pill--${state.tone}`}>{state.label}</span>
      </div>
      <div className="app-header__meta">
        {endpoint ? <span className="endpoint">{endpoint}</span> : <span className="endpoint endpoint--placeholder">ws://ip:port</span>}
        {connectionState === 'open' && (
          <button className="button button--ghost" onClick={() => onDisconnect && onDisconnect()}>
            断开连接
          </button>
        )}
      </div>
    </header>
  );
};

export default Toolbar;