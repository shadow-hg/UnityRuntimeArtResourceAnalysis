import { useEffect, useMemo, useRef } from 'react';
import { Card, Empty, Typography } from 'antd';
import { DualAxes, type DualAxesInstance } from '@ant-design/plots';
import type { TelemetrySnapshot } from '../types';
import { formatFps } from '../utils/format';

interface PerformanceChartProps {
  frames: TelemetrySnapshot[];
  selectedFrame: TelemetrySnapshot | null;
  onSelectFrame: (frame: TelemetrySnapshot | null, meta?: { userInitiated?: boolean }) => void;
}

function ensureFiniteNumber(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function bytesToMegabytes(value: unknown) {
  const finite = ensureFiniteNumber(value);
  return finite / (1024 * 1024);
}

export default function PerformanceChart({ frames, selectedFrame, onSelectFrame }: PerformanceChartProps) {
  const chartRef = useRef<DualAxesInstance | null>(null);

  const fpsSeries = useMemo(
    () =>
      frames
        .map((frame) => ({
          frameNumber: frame.frameNumber,
          timestamp: frame.timestampUtc,
          fps: ensureFiniteNumber(frame.fps),
        }))
        .filter((point) => Number.isFinite(point.fps)),
    [frames]
  );

  const resourceSeries = useMemo(
    () =>
      frames.flatMap((frame) => [
        {
          frameNumber: frame.frameNumber,
          timestamp: frame.timestampUtc,
          metric: '纹理 (MB)',
          value: bytesToMegabytes(
            frame.totalTextureBytes ??
              frame.textures.reduce((sum, texture) => sum + ensureFiniteNumber(texture.EstimatedBytes), 0)
          ),
        },
        {
          frameNumber: frame.frameNumber,
          timestamp: frame.timestampUtc,
          metric: '网格 (MB)',
          value: bytesToMegabytes(
            frame.totalMeshBytes ??
              frame.meshes.reduce((sum, mesh) => sum + ensureFiniteNumber(mesh.EstimatedBytes), 0)
          ),
        },
      ])
        .filter((point) => Number.isFinite(point.value)),
    [frames]
  );

  useEffect(() => {
    if (!chartRef.current) return;

    const plot = chartRef.current;
    const targetFrameNumber = selectedFrame?.frameNumber;

    plot.chart?.geometries?.forEach((geometry) => {
      geometry.elements?.forEach((element) => {
        const frameNumber = element.data?.frameNumber as number | undefined;
        element.setState('active', targetFrameNumber != null && frameNumber === targetFrameNumber);
      });
    });
  }, [frames, selectedFrame]);

  if (frames.length === 0) {
    return (
      <Card title="性能趋势">
        <Empty description="暂无数据" />
      </Card>
    );
  }

  return (
    <Card
      title={
        <Typography.Text strong>
          性能趋势 · {frames.length} 帧 · 最新帧 #{frames[frames.length - 1]?.frameNumber ?? '-'}
        </Typography.Text>
      }
    >
      <DualAxes
        data={[fpsSeries, resourceSeries]}
        xField="frameNumber"
        yField={['fps', 'value']}
        geometryOptions={[
          {
            geometry: 'line',
            color: '#5B8FF9',
            smooth: true,
            point: { size: 3, shape: 'circle' },
            state: {
              active: { lineWidth: 3 },
            },
          },
          {
            geometry: 'line',
            color: ['#F6BD16', '#5AD8A6'],
            seriesField: 'metric',
            smooth: true,
            point: { size: 3, shape: 'circle' },
            state: {
              active: { lineWidth: 3 },
            },
          },
        ]}
        xAxis={{
          title: { text: '帧编号' },
          label: { formatter: (value: string) => `#${value}` },
        }}
        yAxis={{
          fps: {
            title: { text: 'FPS' },
            min: 0,
          },
          value: {
            title: { text: '资源 (MB)' },
            min: 0,
          },
        }}
        tooltip={{
          shared: true,
          showCrosshairs: true,
          title: (title: string) => {
            const frame = frames.find((item) => item.frameNumber === Number(title));
            if (!frame) return `#${title}`;
            return `#${frame.frameNumber} · ${new Date(frame.timestampUtc).toLocaleTimeString()}`;
          },
          customItems: (items: Array<{ name: string; data: any }>) =>
            items.map((item) => {
              if (item.name === 'fps') {
                return {
                  ...item,
                  name: 'FPS',
                  value: formatFps(item.data.fps),
                };
              }
              return {
                ...item,
                name: item.data.metric,
                value: `${item.data.value.toFixed(1)} MB`,
              };
            }),
        }}
        legend={{ position: 'top' }}
        animation={false}
        interactions={[{ type: 'element-highlight' }, { type: 'element-active' }]}
        onReady={(plot: DualAxesInstance) => {
          chartRef.current = plot;
          plot.on?.('element:click', (event: any) => {
            const frameNumber = event.data?.data?.frameNumber;
            if (!frameNumber) return;
            const frame = frames.find((item) => item.frameNumber === frameNumber) ?? null;
            onSelectFrame(frame, { userInitiated: true });
          });
        }}
      />
    </Card>
  );
}
