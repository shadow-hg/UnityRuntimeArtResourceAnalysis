import React, { useEffect, useMemo, useState } from 'react';
import { ConnectionState } from '../hooks/useTelemetry';
import PlaybackControls from './PlaybackControls';

type Props = {
  connectionState: ConnectionState;
  activeUrl?: string | null;
  onConnect: (ip: string, port: string) => void;
  onDisconnect: () => void;
  clients: string[];
  selectedClientId: string | null;
  onSelectClient?: (clientId: string) => void;
  playing: boolean;
  onTogglePlay: () => void;
  onStepForward?: () => void;
  onStepBack?: () => void;
  speed: number;
  onSpeedChange: (value: number) => void;
  className?: string;
  captureControlsExpanded: boolean;
  onToggleCaptureControls?: () => void;
  captureToggleRef?: React.RefObject<HTMLButtonElement>;
};

const stateLabels: Record<ConnectionState, { label: string; tone: 'neutral' | 'warning' | 'success' | 'error' }> = {
  idle: { label: '未连接', tone: 'neutral' },
  connecting: { label: '连接中…', tone: 'warning' },
  open: { label: '已连接', tone: 'success' },
  closed: { label: '连接已关闭', tone: 'warning' },
  error: { label: '连接错误', tone: 'error' }
};

const SessionControls: React.FC<Props> = ({
  connectionState,
  activeUrl,
  onConnect,
  onDisconnect,
  clients,
  selectedClientId,
  onSelectClient,
  playing,
  onTogglePlay,
  onStepForward,
  onStepBack,
  speed,
  onSpeedChange,
  className,
  captureControlsExpanded,
  onToggleCaptureControls,
  captureToggleRef
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

  const state = stateLabels[connectionState];

  const actionLabel = isConnected ? '断开' : isConnecting ? '连接中…' : '连接';
  const actionType = isConnected ? 'button' : 'submit';
  const actionClassName = `button ${isConnected ? 'button--ghost' : 'button--primary'}`;
  const actionDisabled = (!isConnected && (!canSubmit || isConnecting)) || (isConnected && isConnecting);

  return (
    <section className={`session-controls ${className ?? ''}`}>
      <div className="session-controls__connection">
        <form className="session-controls__form" onSubmit={handleSubmit}>
          <div className="session-controls__status">
            <span className={`status-pill status-pill--${state.tone}`}>{state.label}</span>
            {activeUrl && <span className="session-controls__endpoint">{activeUrl}</span>}
          </div>
          <div className="session-controls__inputs">
            <label className="session-controls__field">
              <span>服务器 IP</span>
              <input
                type="text"
                className="input"
                placeholder="192.168.0.100"
                value={ip}
                onChange={(event) => setIp(event.target.value)}
              />
            </label>
            <label className="session-controls__field session-controls__field--small">
              <span>端口</span>
              <input
                type="text"
                className="input"
                placeholder="8080"
                value={port}
                onChange={(event) => setPort(event.target.value)}
              />
            </label>
            <div className="session-controls__actions">
              <button
                type={actionType}
                className={actionClassName}
                disabled={actionDisabled}
                onClick={isConnected ? onDisconnect : undefined}
              >
                {actionLabel}
              </button>
              <button
                type="button"
                className={`button button--ghost session-controls__capture-toggle ${
                  captureControlsExpanded ? 'session-controls__capture-toggle--active' : ''
                }`}
                onClick={() => onToggleCaptureControls && onToggleCaptureControls()}
                aria-pressed={captureControlsExpanded}
                ref={captureToggleRef}
              >
                {captureControlsExpanded ? '收起采集控制' : '展开采集控制'}
              </button>
            </div>
          </div>
        </form>
        <div className="session-controls__clients">
          <span className="session-controls__label">实时客户端</span>
          <div className="chip-list">
            {clients.length === 0 ? (
              <span className="session-controls__empty">等待运行中的 Unity 客户端…</span>
            ) : (
              clients.map((clientId) => {
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
              })
            )}
          </div>
        </div>
      </div>
      <div className="session-controls__playback">
        <PlaybackControls
          appearance="inline"
          playing={playing}
          onPlayPause={onTogglePlay}
          speed={speed}
          setSpeed={onSpeedChange}
          onStepForward={onStepForward}
          onStepBack={onStepBack}
        />
      </div>
    </section>
  );
};

export default SessionControls;
