import React, { useEffect, useMemo, useState } from 'react';
import { ConnectionState, SessionOverview } from '../hooks/useTelemetry';
import PlaybackControls from './PlaybackControls';

type SessionViewState = {
  mode: 'live' | 'history';
  sessionId?: string;
};

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
  sessionOverview?: SessionOverview;
  sessionView?: SessionViewState;
  onChangeSessionView?: (mode: 'live' | 'history', sessionId?: string) => void;
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
  captureToggleRef,
  sessionOverview,
  sessionView,
  onChangeSessionView
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

  const sessionSelectValue = sessionView?.mode === 'history' ? sessionView.sessionId ?? '' : 'live';
  const historySessions = sessionOverview?.history ?? [];

  const formatSessionLabel = (session: { startedAt: number; endedAt?: number | null }) => {
    const start = new Date(session.startedAt || 0);
    const end = session.endedAt ? new Date(session.endedAt) : null;
    const startLabel = Number.isFinite(start.getTime()) ? start.toLocaleString() : '未知时间';
    if (!end) return `${startLabel}`;
    const endLabel = Number.isFinite(end.getTime()) ? end.toLocaleString() : '进行中';
    return `${startLabel} - ${endLabel}`;
  };

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
              <div className="session-controls__action-buttons">
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
              <PlaybackControls
                appearance="inline"
                playing={playing}
                onPlayPause={onTogglePlay}
                speed={speed}
                setSpeed={onSpeedChange}
                onStepForward={onStepForward}
                onStepBack={onStepBack}
                className="session-controls__playback-inline"
              />
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
        <div className="session-controls__history">
          <span className="session-controls__label">数据来源</span>
          <div className="session-controls__field session-controls__field--full">
            <select
              className="input"
              value={sessionSelectValue}
              onChange={(event) => {
                const value = event.target.value;
                if (value === 'live') {
                  onChangeSessionView && onChangeSessionView('live');
                } else {
                  onChangeSessionView && onChangeSessionView('history', value);
                }
              }}
              disabled={!sessionOverview}
            >
              <option value="live">
                {sessionOverview?.currentSession ? '实时记录（当前会话）' : '实时记录（等待新会话）'}
              </option>
              <optgroup label="历史记录">
                {historySessions.length === 0 && <option value="" disabled>暂无历史记录</option>}
                {historySessions.map((session) => (
                  <option key={session.sessionId} value={session.sessionId}>
                    {formatSessionLabel(session)}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        </div>
      </div>
    </section>
  );
};

export default SessionControls;
