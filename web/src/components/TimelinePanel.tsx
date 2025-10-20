import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Empty, Slider, Space, Tooltip, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { DataSet, Timeline } from 'vis-timeline/standalone';
import type { TelemetrySnapshot, TimelinePoint } from '../types';
import 'vis-timeline/styles/vis-timeline-graph2d.min.css';
import { formatFps } from '../utils/format';

interface TimelinePanelProps {
  frames: TelemetrySnapshot[];
  selectedFrame: TelemetrySnapshot | null;
  onSelectFrame: (frame: TelemetrySnapshot | null, meta?: { userInitiated?: boolean }) => void;
  isAutoFollowing: boolean;
  onResumeLive: () => void;
}

export default function TimelinePanel({
  frames,
  selectedFrame,
  onSelectFrame,
  isAutoFollowing,
  onResumeLive,
}: TimelinePanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const [range, setRange] = useState<[number, number]>([0, Math.max(frames.length - 1, 0)]);

  const items = useMemo(() => {
    return frames.map<TimelinePoint>((frame) => ({
      id: frame.frameNumber,
      content: `<div class="timeline-item"><span class="timeline-item__frame">#${frame.frameNumber}</span><span class="timeline-item__metric">${formatFps(
        frame.fps
      )}</span></div>`,
      start: new Date(frame.timestampUtc),
      frame,
    }));
  }, [frames]);

  useEffect(() => {
    if (!containerRef.current) return;
    const dataset = new DataSet(items);
    const handleSelect = (properties: any) => {
      const itemId = properties.items?.[0];
      const frame = frames.find((f) => f.frameNumber === itemId) ?? null;
      onSelectFrame(frame, { userInitiated: true });
    };

    if (!timelineRef.current) {
      timelineRef.current = new Timeline(containerRef.current, dataset, {
        height: '260px',
        selectable: true,
        zoomable: true,
        moveable: true,
        margin: {
          item: 10,
          axis: 10,
        },
        orientation: 'top',
      });
      timelineRef.current.on('select', handleSelect);
    } else {
      timelineRef.current.setItems(dataset);
      timelineRef.current.off('select', handleSelect);
      timelineRef.current.on('select', handleSelect);
    }

    return () => {
      if (timelineRef.current) {
        timelineRef.current.off('select', handleSelect);
      }
    };
  }, [items, frames, onSelectFrame]);

  useEffect(() => {
    if (frames.length === 0) {
      setRange([0, 0]);
      return;
    }
    const end = frames.length - 1;
    const start = Math.max(end - 59, 0);
    setRange([start, end]);
  }, [frames.length]);

  useEffect(() => {
    if (!timelineRef.current || frames.length === 0) return;
    const [startIndex, endIndex] = range;
    const clampedStart = Math.max(0, Math.min(startIndex, frames.length - 1));
    const clampedEnd = Math.max(clampedStart, Math.min(endIndex, frames.length - 1));
    const startDate = new Date(frames[clampedStart].timestampUtc);
    const endDate = clampedEnd === clampedStart
      ? new Date(new Date(frames[clampedStart].timestampUtc).getTime() + 16)
      : new Date(frames[clampedEnd].timestampUtc);
    timelineRef.current.setWindow(startDate, endDate, { animation: false });
  }, [range, frames]);

  useEffect(() => {
    if (!timelineRef.current || !selectedFrame) return;
    timelineRef.current.setSelection(selectedFrame.frameNumber);
  }, [selectedFrame]);

  if (frames.length === 0) {
    return (
      <Card title="帧时间轴" style={{ minHeight: 320 }}>
        <Empty description="暂未收到帧数据，请启动 Unity 客户端" />
      </Card>
    );
  }

  const [startIndex, endIndex] = range;
  const startFrame = frames[startIndex]?.frameNumber;
  const endFrame = frames[endIndex]?.frameNumber;
  const subtitle = `共 ${frames.length} 帧 · 范围 #${startFrame ?? 0} - #${endFrame ?? 0}`;

  return (
    <Card
      title={
        <Space direction="vertical" size={0}>
          <Typography.Text strong>帧时间轴</Typography.Text>
          <Typography.Text type="secondary">{subtitle}</Typography.Text>
        </Space>
      }
      extra={
        !isAutoFollowing ? (
          <Tooltip title="回到最新帧">
            <Button size="small" type="link" icon={<ReloadOutlined />} onClick={onResumeLive}>
              追踪最新
            </Button>
          </Tooltip>
        ) : null
      }
    >
      <div ref={containerRef} />
      <div style={{ marginTop: 16 }}>
        <Typography.Text type="secondary">拖动或缩放以查看指定时间段</Typography.Text>
        <Slider
          range
          min={0}
          max={Math.max(frames.length - 1, 0)}
          value={range}
          onChange={(value) => setRange(value as [number, number])}
          tooltip={{
            formatter: (value) =>
              `Frame #${frames[value as number]?.frameNumber ?? value} · ${formatFps(
                frames[value as number]?.fps ?? 0
              )}`,
          }}
        />
      </div>
    </Card>
  );
}
