import React, { useMemo } from 'react';
import { Frame } from '../hooks/useTelemetry';
import { getStatDisplaySizeKB } from '../utils/resourceMetadata';
import { formatMemoryFromKB, formatNumber } from '../utils/format';

type Props = {
  frames: Frame[];
  selectedFrameKey?: string;
  onSelect?: (entry: Frame) => void;
};

function getFrameKey(entry: Frame) {
  const { clientId, frame } = entry;
  const idx = frame?.frameIndex ?? 'n/a';
  const timestamp = frame?.timestamp ?? 'ts';
  return `${clientId}:${idx}:${timestamp}`;
}

const FrameList: React.FC<Props> = ({ frames, selectedFrameKey, onSelect }) => {
  const items = useMemo(() => frames.slice().reverse(), [frames]);

  return (
    <div className="panel frame-list">
      <div className="panel-header">
        <div className="panel-title">帧时间轴</div>
        <div className="badge">{frames.length}</div>
      </div>
      <div className="frame-list__content">
        {items.length === 0 ? (
          <div className="empty-state">尚未收到帧数据</div>
        ) : (
          items.map((entry) => {
            const key = getFrameKey(entry);
            const frame = entry.frame || {};
            const dt = typeof frame.dt === 'number' ? frame.dt : null;
            const rawFps = dt && dt > 0 ? 1 / dt : frame.metrics?.fps;
            const fps = typeof rawFps === 'number' && Number.isFinite(rawFps) ? rawFps : null;
            const timestamp = frame.timestamp ? new Date(frame.timestamp) : null;
            const statsArray: any[] = Array.isArray(frame.resourceStats) ? frame.resourceStats : [];
            const resourceTotalKB = typeof frame.resourceTotalKB === 'number'
              ? frame.resourceTotalKB
              : statsArray.reduce((sum, stat) => sum + getStatDisplaySizeKB(stat), 0);
            const resourceCountValue = typeof frame.resourceCount === 'number'
              ? frame.resourceCount
              : Array.isArray(frame.resources)
                ? frame.resources.length
                : statsArray.reduce((sum, stat) => sum + Number(stat?.count ?? 0), 0);
            const topCategory = statsArray.length > 0 ? (statsArray[0]?.category || '未分类') : null;
            const isActive = key === selectedFrameKey;

            return (
              <button
                key={key}
                type="button"
                className={`frame-list__item ${isActive ? 'frame-list__item--active' : ''}`}
                onClick={() => onSelect && onSelect(entry)}
              >
                <div className="frame-list__row">
                  <span className="frame-list__scene">{frame.sceneName || '未知场景'}</span>
                  {typeof frame.frameIndex === 'number' && <span className="frame-list__index">#{frame.frameIndex}</span>}
                </div>
                <div className="frame-list__row frame-list__row--meta">
                  <span>{timestamp ? timestamp.toLocaleTimeString() : '未知时间'}</span>
                  {fps !== null && <span>{fps.toFixed(1)} FPS</span>}
                </div>
                <div className="frame-list__row frame-list__row--resource">
                  <span>{formatNumber(resourceCountValue)} 资源</span>
                  <span>{formatMemoryFromKB(resourceTotalKB)}</span>
                  {topCategory && <span className="frame-list__tag">{topCategory}</span>}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

export default FrameList;