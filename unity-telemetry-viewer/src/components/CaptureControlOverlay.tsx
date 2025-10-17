import React, { useEffect, useMemo, useState } from 'react';
import { ControlState, ConnectionState } from '../hooks/useTelemetry';

type ControlPatch = Partial<
  Pick<ControlState, 'captureEnabled' | 'captureIntervalMs' | 'sendThumbnail' | 'sendResourceSnapshots' | 'thumbnailIntervalFrames'>
>;

type Props = {
  clientId: string | null;
  controlState?: ControlState;
  onUpdate: (patch: ControlPatch) => void;
  onRequestState: () => void;
  maxFrames: number;
  onMaxFramesChange: (value: number) => void;
  latestFrameTimestamp: number | null;
  connectionState: ConnectionState;
};

function formatTimeAgo(timestamp: number | null) {
  if (!timestamp) return '未收到数据';
  const now = Date.now();
  const diff = Math.max(0, now - timestamp);
  if (diff < 5000) return '刚刚';
  if (diff < 60_000) return `${Math.floor(diff / 1000)} 秒前`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

const CaptureControlOverlay: React.FC<Props> = ({
  clientId,
  controlState,
  onUpdate,
  onRequestState,
  maxFrames,
  onMaxFramesChange,
  latestFrameTimestamp,
  connectionState
}) => {
  const [expanded, setExpanded] = useState(false);
  const [captureEnabled, setCaptureEnabled] = useState(controlState?.captureEnabled ?? true);
  const initialIntervalUnit: 'ms' | 's' = (controlState?.captureIntervalMs ?? 0) >= 1000 ? 's' : 'ms';
  const [intervalUnit, setIntervalUnit] = useState<'ms' | 's'>(initialIntervalUnit);
  const [intervalValue, setIntervalValue] = useState<number>(() => {
    const ms = Math.max(0, controlState?.captureIntervalMs ?? 0);
    return initialIntervalUnit === 's' ? parseFloat((ms / 1000).toFixed(2)) : ms;
  });
  const [sendThumbnail, setSendThumbnail] = useState(controlState?.sendThumbnail ?? false);
  const [thumbnailInterval, setThumbnailInterval] = useState(controlState?.thumbnailIntervalFrames ?? 30);
  const [sendResourceSnapshots, setSendResourceSnapshots] = useState(controlState?.sendResourceSnapshots ?? true);

  useEffect(() => {
    const enabled = controlState?.captureEnabled ?? true;
    const ms = Math.max(0, controlState?.captureIntervalMs ?? 0);
    const unit = ms >= 1000 ? 's' : 'ms';
    setCaptureEnabled(enabled);
    setIntervalUnit(unit);
    setIntervalValue(unit === 's' ? parseFloat((ms / 1000).toFixed(2)) : ms);
    setSendThumbnail(controlState?.sendThumbnail ?? false);
    setThumbnailInterval(controlState?.thumbnailIntervalFrames ?? 30);
    setSendResourceSnapshots(controlState?.sendResourceSnapshots ?? true);
  }, [controlState]);

  const telemetryDisabled = !clientId || connectionState !== 'open';
  const awaitingState = telemetryDisabled ? false : !controlState;
  const captureStatusLabel = telemetryDisabled ? '等待连接' : captureEnabled ? '进行中' : '已暂停';
  const captureStatusClass = telemetryDisabled
    ? 'capture-overlay__status-text capture-overlay__status-text--warning'
    : captureEnabled
      ? 'capture-overlay__status-text capture-overlay__status-text--active'
      : 'capture-overlay__status-text capture-overlay__status-text--warning';

  const handleToggleCapture = () => {
    const next = !captureEnabled;
    setCaptureEnabled(next);
    if (!telemetryDisabled) {
      onUpdate({ captureEnabled: next });
    }
  };

  const commitInterval = (value: number, unit: 'ms' | 's') => {
    if (telemetryDisabled) return;
    const safeValue = Number.isNaN(value) ? 0 : Math.max(0, value);
    const ms = unit === 's' ? Math.round(safeValue * 1000) : Math.round(safeValue);
    onUpdate({ captureIntervalMs: ms });
  };

  const handleIntervalChange = (value: number) => {
    const safeValue = Number.isNaN(value) ? 0 : Math.max(0, value);
    setIntervalValue(safeValue);
    commitInterval(safeValue, intervalUnit);
  };

  const handleUnitChange = (unit: 'ms' | 's') => {
    if (unit === intervalUnit) return;
    const currentMs = intervalUnit === 's' ? intervalValue * 1000 : intervalValue;
    const nextValue = unit === 's' ? currentMs / 1000 : currentMs;
    setIntervalUnit(unit);
    const displayValue = unit === 's' ? parseFloat(nextValue.toFixed(2)) : Math.round(nextValue);
    setIntervalValue(displayValue);
    commitInterval(displayValue, unit);
  };

  const handleThumbnailToggle = (value: boolean) => {
    setSendThumbnail(value);
    if (!telemetryDisabled) {
      onUpdate({ sendThumbnail: value });
    }
  };

  const handleResourceToggle = (value: boolean) => {
    setSendResourceSnapshots(value);
    if (!telemetryDisabled) {
      onUpdate({ sendResourceSnapshots: value });
    }
  };

  const handleThumbnailInterval = (value: number) => {
    const safeValue = Math.max(1, Math.min(240, Math.round(value)));
    setThumbnailInterval(safeValue);
    if (!telemetryDisabled) {
      onUpdate({ thumbnailIntervalFrames: safeValue });
    }
  };

  const lastUpdatedLabel = useMemo(() => {
    if (!controlState?.updatedAt) return '尚未同步';
    try {
      return new Date(controlState.updatedAt).toLocaleTimeString();
    } catch (error) {
      return '刚刚';
    }
  }, [controlState?.updatedAt]);

  return (
    <div className={`capture-overlay ${expanded ? 'capture-overlay--expanded' : ''}`}>
      <button
        type="button"
        className="capture-overlay__toggle"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? '收起控制面板' : '展开采集控制'}
      </button>
      {expanded && (
        <div className="capture-overlay__panel">
          <div className="capture-overlay__panel-header">
            <div>
              <div className="capture-overlay__title">采集控制</div>
              <div className="capture-overlay__subtitle">{clientId ?? '未选择客户端'}</div>
            </div>
            <button
              type="button"
              className="capture-overlay__close"
              onClick={() => setExpanded(false)}
            >
              ×
            </button>
          </div>
          <div className="capture-overlay__status-row">
            <span
              className={`status-pill status-pill--${connectionState === 'open' ? 'success' : 'neutral'}`}
            >
              {connectionState === 'open' ? '连接正常' : '未连接'}
            </span>
            <span className={captureStatusClass}>采集：{captureStatusLabel}</span>
            <span className="capture-overlay__status-text">
              最新帧：{formatTimeAgo(latestFrameTimestamp)}
            </span>
            <span className="capture-overlay__status-text">状态同步：{lastUpdatedLabel}</span>
          </div>
          {awaitingState && (
            <div className="capture-overlay__hint capture-overlay__hint--inline">等待客户端反馈当前参数…</div>
          )}
          <div className="capture-overlay__group">
            <button
              type="button"
              className={`button ${captureEnabled ? 'button--primary' : 'button--ghost'}`}
              onClick={handleToggleCapture}
              disabled={telemetryDisabled}
            >
              {captureEnabled ? '暂停采集' : '开始采集'}
            </button>
          </div>
          <div className="capture-overlay__group">
            <label className="capture-overlay__label">采集间隔</label>
            <div className="capture-overlay__interval">
              <input
                type="number"
                className="input capture-overlay__interval-input"
                min={0}
                step={intervalUnit === 's' ? 0.1 : 1}
                value={intervalValue}
                onChange={(event) => handleIntervalChange(event.target.valueAsNumber)}
                disabled={telemetryDisabled}
              />
              <div className="capture-overlay__unit-toggle">
                <button
                  type="button"
                  className={`capture-overlay__unit ${intervalUnit === 'ms' ? 'capture-overlay__unit--active' : ''}`}
                  onClick={() => handleUnitChange('ms')}
                  disabled={telemetryDisabled}
                >
                  毫秒
                </button>
                <button
                  type="button"
                  className={`capture-overlay__unit ${intervalUnit === 's' ? 'capture-overlay__unit--active' : ''}`}
                  onClick={() => handleUnitChange('s')}
                  disabled={telemetryDisabled}
                >
                  秒
                </button>
              </div>
            </div>
            <div className="capture-overlay__hint">设置每次采集的间隔时间，0 表示每帧发送。</div>
          </div>
          <div className="capture-overlay__group capture-overlay__group--switches">
            <label className="capture-overlay__label">缩略图上传</label>
            <label className="capture-overlay__switch">
              <input
                type="checkbox"
                checked={sendThumbnail}
                onChange={(event) => handleThumbnailToggle(event.target.checked)}
                disabled={telemetryDisabled}
              />
              <span className="capture-overlay__switch-track" />
              <span>发送缩略图</span>
            </label>
            <div className="capture-overlay__subfield">
              <span className="capture-overlay__subfield-label">间隔</span>
              <input
                type="range"
                min={1}
                max={240}
                step={1}
                value={thumbnailInterval}
                onChange={(event) => handleThumbnailInterval(event.target.valueAsNumber)}
                disabled={telemetryDisabled || !sendThumbnail}
              />
              <span className="capture-overlay__range-value">{thumbnailInterval} 帧</span>
            </div>
          </div>
          <div className="capture-overlay__group capture-overlay__group--switches">
            <label className="capture-overlay__label">资源快照</label>
            <label className="capture-overlay__switch">
              <input
                type="checkbox"
                checked={sendResourceSnapshots}
                onChange={(event) => handleResourceToggle(event.target.checked)}
                disabled={telemetryDisabled}
              />
              <span className="capture-overlay__switch-track" />
              <span>同步资源列表</span>
            </label>
          </div>
          <div className="capture-overlay__group">
            <label className="capture-overlay__label" htmlFor="capture-overlay-max-frames">
              前端保留帧数
            </label>
            <input
              id="capture-overlay-max-frames"
              type="number"
              className="input"
              min={100}
              max={100000}
              step={100}
              value={maxFrames}
              onChange={(event) => onMaxFramesChange(event.target.valueAsNumber)}
            />
            <div className="capture-overlay__hint">控制网页端缓存的帧数量，默认 10000。</div>
          </div>
          <div className="capture-overlay__actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={onRequestState}
              disabled={telemetryDisabled}
            >
              刷新状态
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CaptureControlOverlay;
