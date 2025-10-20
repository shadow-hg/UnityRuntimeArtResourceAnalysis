import { useEffect, useMemo, useRef } from 'react';
import { Card, Empty, Typography } from 'antd';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsOption } from 'echarts';
import * as echarts from 'echarts/core';
import type { ECharts } from 'echarts/core';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  ToolboxComponent,
  MarkLineComponent,
} from 'echarts/components';
import { LineChart } from 'echarts/charts';
import { CanvasRenderer } from 'echarts/renderers';
import type { TelemetrySnapshot } from '../types';
import { formatFps } from '../utils/format';

echarts.use([
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  ToolboxComponent,
  MarkLineComponent,
  LineChart,
  CanvasRenderer,
]);

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
  const chartRef = useRef<ECharts | null>(null);

  const frameNumbers = useMemo(() => frames.map((frame) => frame.frameNumber), [frames]);

  const timestamps = useMemo(() => frames.map((frame) => frame.timestampUtc), [frames]);

  const fpsValues = useMemo(
    () =>
      frames.map((frame) => {
        const value = ensureFiniteNumber(frame.fps, Number.NaN);
        return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
      }),
    [frames]
  );

  const textureValues = useMemo(
    () =>
      frames.map((frame) => {
        const textureBytes =
          frame.totalTextureBytes ??
          frame.textures.reduce((sum, texture) => sum + ensureFiniteNumber(texture.EstimatedBytes), 0);
        const value = bytesToMegabytes(textureBytes);
        return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
      }),
    [frames]
  );

  const meshValues = useMemo(
    () =>
      frames.map((frame) => {
        const meshBytes =
          frame.totalMeshBytes ??
          frame.meshes.reduce((sum, mesh) => sum + ensureFiniteNumber(mesh.EstimatedBytes), 0);
        const value = bytesToMegabytes(meshBytes);
        return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
      }),
    [frames]
  );

  const option = useMemo<EChartsOption>(() => {
    const latestFrameNumber = frameNumbers[frameNumbers.length - 1];

    return {
      color: ['#5B8FF9', '#F6BD16', '#5AD8A6'],
      grid: { left: 48, right: 32, top: 70, bottom: 80 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) {
            return '';
          }

          const index = params[0]?.dataIndex ?? 0;
          const frameNumber = frameNumbers[index];
          const timestamp = timestamps[index];
          const date = timestamp ? new Date(timestamp) : null;
          const header = [`#${frameNumber ?? '-'}${date ? ` · ${date.toLocaleTimeString()}` : ''}`];

          const rows = params
            .map((item: any) => {
              if (item.seriesName === 'FPS') {
                if (item.data == null) {
                  return `${item.marker}${item.seriesName}: --`;
                }
                return `${item.marker}${item.seriesName}: ${formatFps(Number(item.data))}`;
              }
              if (item.seriesName === '纹理 (MB)' || item.seriesName === '网格 (MB)') {
                if (item.data == null) {
                  return `${item.marker}${item.seriesName}: --`;
                }
                return `${item.marker}${item.seriesName}: ${Number(item.data).toFixed(1)} MB`;
              }
              return `${item.marker}${item.seriesName}: ${item.data}`;
            })
            .filter(Boolean);

          return [...header, ...rows].join('<br />');
        },
      },
      legend: { top: 16 },
      toolbox: {
        feature: {
          dataZoom: { yAxisIndex: 'none' },
          restore: {},
          saveAsImage: {},
        },
        top: 16,
        right: 16,
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        name: '帧编号',
        nameLocation: 'middle',
        nameGap: 35,
        axisLabel: { formatter: (value: number | string) => `#${value}` },
        data: frameNumbers,
      },
      yAxis: [
        {
          type: 'value',
          name: 'FPS',
          min: 0,
          axisLabel: {
            formatter: (value: number) => {
              const numeric = Number(value);
              return Number.isFinite(numeric) ? formatFps(numeric) : '--';
            },
          },
          splitLine: { lineStyle: { type: 'dashed' } },
        },
        {
          type: 'value',
          name: '资源 (MB)',
          min: 0,
          splitLine: { lineStyle: { type: 'dashed' } },
        },
      ],
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          filterMode: 'weakFilter',
        },
        {
          type: 'slider',
          height: 22,
          bottom: 24,
          xAxisIndex: 0,
          labelFormatter: (value: string | number) => `#${value}`,
        },
      ],
      animation: false,
      series: [
        {
          name: 'FPS',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          yAxisIndex: 0,
          connectNulls: false,
          showSymbol: false,
          emphasis: { focus: 'series' },
          lineStyle: { width: 2 },
          data: fpsValues,
          markLine: latestFrameNumber
            ? {
                symbol: 'none',
                lineStyle: { type: 'dashed' },
                data: [{ xAxis: latestFrameNumber, name: '最新帧' }],
                label: { formatter: '最新帧' },
              }
            : undefined,
        },
        {
          name: '纹理 (MB)',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          yAxisIndex: 1,
          connectNulls: false,
          showSymbol: false,
          areaStyle: { opacity: 0.08 },
          emphasis: { focus: 'series' },
          data: textureValues,
        },
        {
          name: '网格 (MB)',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          yAxisIndex: 1,
          connectNulls: false,
          showSymbol: false,
          areaStyle: { opacity: 0.08 },
          emphasis: { focus: 'series' },
          data: meshValues,
        },
      ],
    } satisfies EChartsOption;
  }, [frameNumbers, timestamps, fpsValues, textureValues, meshValues]);

  useEffect(() => {
    if (!chartRef.current) return;

    const instance = chartRef.current;

    const seriesCount = 3;
    for (let index = 0; index < seriesCount; index += 1) {
      instance.dispatchAction({ type: 'downplay', seriesIndex: index });
    }
    instance.dispatchAction({ type: 'hideTip' });

    if (!selectedFrame) return;

    const targetIndex = frameNumbers.findIndex((frameNumber) => frameNumber === selectedFrame.frameNumber);
    if (targetIndex === -1) {
      return;
    }

    for (let index = 0; index < seriesCount; index += 1) {
      instance.dispatchAction({ type: 'highlight', seriesIndex: index, dataIndex: targetIndex });
    }

    instance.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: targetIndex });
    instance.dispatchAction({ type: 'updateAxisPointer', seriesIndex: 0, value: frameNumbers[targetIndex] });
  }, [frameNumbers, selectedFrame]);

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
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        style={{ height: 400 }}
        notMerge
        lazyUpdate
        onChartReady={(instance) => {
          chartRef.current = instance;
        }}
        onEvents={{
          click: (params: { dataIndex?: number }) => {
            if (typeof params.dataIndex !== 'number') {
              return;
            }
            const frameNumber = frameNumbers[params.dataIndex];
            const frame = frames.find((item) => item.frameNumber === frameNumber) ?? null;
            if (!frame) {
              return;
            }
            onSelectFrame(frame, { userInitiated: true });
          },
        }}
      />
    </Card>
  );
}
