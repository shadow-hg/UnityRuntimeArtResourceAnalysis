import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Empty, Slider, Space, Typography } from 'antd';
import { DataSet, Timeline } from 'vis-timeline/standalone';
import type { TelemetrySnapshot, TimelinePoint } from '../types';
import 'vis-timeline/styles/vis-timeline-graph2d.min.css';
import { formatFps } from '../utils/format';

interface TimelinePanelProps {
  frames: TelemetrySnapshot[];
  selectedFrame: TelemetrySnapshot | null;
  onSelectFrame: (frame: TelemetrySnapshot | null) => void;
}

export default function TimelinePanel({ frames, selectedFrame, onSelectFrame }: TimelinePanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const [range, setRange] = useState<[number, number]>([0, Math.max(frames.length - 1, 0)]);

  const items = useMemo(() => {
    return frames.map<TimelinePoint>((frame) => ({
      id: frame.frameNumber,
      content: `<div class="timeline-item">${formatFps(frame.fps)}</div>`,
      start: new Date(frame.timestampUtc),
      frame,
    }));
  }, [frames]);

  useEffect(() => {
    if (!containerRef.current) return;
    const dataset = new DataSet(items);
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
      });
      timelineRef.current.on('select', (properties) => {
        const itemId = properties.items?.[0];
        const frame = frames.find((f) => f.frameNumber === itemId) ?? null;
        onSelectFrame(frame);
      });
    } else {
      timelineRef.current.setItems(dataset);
    }

    return () => {
      dataset.destroy();
    };
  }, [items, frames, onSelectFrame]);

  useEffect(() => {
    if (frames.length === 0) return;
    setRange([0, Math.max(frames.length - 1, 0)]);
  }, [frames.length]);

  useEffect(() => {
    if (!timelineRef.current || frames.length === 0) return;
    const [startIndex, endIndex] = range;
    const clampedStart = Math.max(0, Math.min(startIndex, frames.length - 1));
    const clampedEnd = Math.max(clampedStart + 1, Math.min(endIndex, frames.length - 1));
    const startDate = new Date(frames[clampedStart].timestampUtc);
    const endDate = new Date(frames[clampedEnd].timestampUtc);
    timelineRef.current.setWindow(startDate, endDate, { animation: false });
  }, [range, frames]);

  useEffect(() => {
    if (!timelineRef.current || !selectedFrame) return;
    timelineRef.current.setSelection(selectedFrame.frameNumber);
  }, [selectedFrame]);

  if (frames.length === 0) {
    return (
      <Card title="Timeline" style={{ minHeight: 320 }}>
        <Empty description="No frames yet. Start the Unity client to stream data." />
      </Card>
    );
  }

  return (
    <Card
      title={
        <Space direction="vertical" size={0}>
          <Typography.Text strong>Frame Timeline</Typography.Text>
          <Typography.Text type="secondary">Drag or zoom to inspect frame-by-frame metrics.</Typography.Text>
        </Space>
      }
    >
      <div ref={containerRef} />
      <div style={{ marginTop: 16 }}>
        <Typography.Text type="secondary">Adjust frame range</Typography.Text>
        <Slider
          range
          min={0}
          max={Math.max(frames.length - 1, 1)}
          value={range}
          onChange={(value) => setRange(value as [number, number])}
          tooltip={{ formatter: (value) => `Frame ${frames[value as number]?.frameNumber ?? value}` }}
        />
      </div>
    </Card>
  );
}
