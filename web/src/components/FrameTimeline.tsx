import { useMemo } from 'react';
import { Card, Empty, Tooltip, Typography } from 'antd';
import type { TelemetrySnapshot } from '../types';
import { formatBytes, formatFps } from '../utils/format';

interface FrameTimelineProps {
  frames: TelemetrySnapshot[];
  selectedFrame: TelemetrySnapshot | null;
  onSelectFrame: (frame: TelemetrySnapshot | null, meta?: { userInitiated?: boolean }) => void;
}

const MAX_TIMELINE_ITEMS = 240;

export default function FrameTimeline({ frames, selectedFrame, onSelectFrame }: FrameTimelineProps) {
  const visibleFrames = useMemo(() => {
    if (frames.length <= MAX_TIMELINE_ITEMS) {
      return frames;
    }

    return frames.slice(-MAX_TIMELINE_ITEMS);
  }, [frames]);

  if (visibleFrames.length === 0) {
    return (
      <Card title="帧时间轴" style={{ flex: 1 }}>
        <Empty description="暂无帧数据，等待客户端上报…" />
      </Card>
    );
  }

  const firstVisible = visibleFrames[0];
  const lastVisible = visibleFrames[visibleFrames.length - 1];
  const hasTrimmedFrames = frames.length > visibleFrames.length;

  return (
    <Card
      title={
        <Typography.Text strong>
          帧时间轴 · {frames.length} 帧{hasTrimmedFrames ? `（显示最近 ${visibleFrames.length} 帧）` : ''}
        </Typography.Text>
      }
      style={{ flex: 1 }}
    >
      <div className="timeline-scroll">
        {hasTrimmedFrames ? (
          <div className="timeline-scroll__hint">
            <Typography.Text type="secondary">
              已截取 #{firstVisible.frameNumber} - #{lastVisible.frameNumber} 范围
            </Typography.Text>
          </div>
        ) : null}
        {visibleFrames.map((frame) => {
          const isActive = selectedFrame?.frameNumber === frame.frameNumber;
          const label = `#${frame.frameNumber}`;
          const tooltipTitle = `帧 ${frame.frameNumber}\nFPS ${formatFps(frame.fps)}\n纹理 ${formatBytes(frame.totalTextureBytes)}\nRenderTexture ${formatBytes(
            frame.totalRenderTextureBytes ?? 0
          )}\n网格 ${formatBytes(frame.totalMeshBytes)}`;

          return (
            <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tooltipTitle}</span>} key={frame.frameNumber}>
              <button
                type="button"
                className={`timeline-item${isActive ? ' timeline-item--active' : ''}`}
                onClick={() => onSelectFrame(frame, { userInitiated: true })}
              >
                <span className="timeline-item__frame">{label}</span>
                <span className="timeline-item__metric">{formatFps(frame.fps)}</span>
                <span className="timeline-item__metric">{formatBytes(frame.totalTextureBytes)}</span>
              </button>
            </Tooltip>
          );
        })}
      </div>
    </Card>
  );
}
