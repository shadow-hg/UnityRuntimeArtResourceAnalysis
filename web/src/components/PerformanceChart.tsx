import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Card, Empty, InputNumber, Space, Tooltip, Typography } from 'antd';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsOption } from 'echarts';
import * as echarts from 'echarts/core';
import type { EChartsType } from 'echarts/core';
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
  samplingIntervalMs: number;
  onChangeSamplingInterval: (value: number) => void;
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

function findNearestFrameNumber(target: number, candidates: number[]): number | null {
  if (!Number.isFinite(target) || candidates.length === 0) {
    return null;
  }

  let best: number | null = null;
  let smallestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (!Number.isFinite(candidate)) continue;
    const distance = Math.abs(candidate - target);
    if (distance < smallestDistance) {
      smallestDistance = distance;
      best = candidate;
    }
  }

  return best;
}

export default function PerformanceChart({
  frames,
  selectedFrame,
  samplingIntervalMs,
  onChangeSamplingInterval,
  onSelectFrame,
}: PerformanceChartProps) {
  const chartRef = useRef<EChartsType | null>(null);
  const hoveredFrameNumberRef = useRef<number | null>(null);

  const sampledFrames = useMemo(() => {
    if (!Array.isArray(frames) || frames.length === 0) {
      return [] as TelemetrySnapshot[];
    }

    if (samplingIntervalMs <= 0) {
      return frames;
    }

    const result: TelemetrySnapshot[] = [];
    let lastAcceptedTimestamp = Number.NEGATIVE_INFINITY;
    let lastAcceptedFrameNumber = Number.NEGATIVE_INFINITY;

    frames.forEach((frame) => {
      const timestamp = Date.parse(frame.timestampUtc ?? '');
      if (Number.isFinite(timestamp)) {
        if (timestamp - lastAcceptedTimestamp >= samplingIntervalMs) {
          result.push(frame);
          lastAcceptedTimestamp = timestamp;
          lastAcceptedFrameNumber = frame.frameNumber;
        }
        return;
      }

      if (!Number.isFinite(lastAcceptedFrameNumber) || frame.frameNumber - lastAcceptedFrameNumber >= 1) {
        result.push(frame);
        lastAcceptedFrameNumber = frame.frameNumber;
      }
    });

    const latest = frames[frames.length - 1];
    if (latest && !result.some((frame) => frame.frameNumber === latest.frameNumber)) {
      result.push(latest);
    }

    return result.sort((a, b) => a.frameNumber - b.frameNumber);
  }, [frames, samplingIntervalMs]);

  const displayFrames = useMemo(() => {
    if (!selectedFrame) {
      return sampledFrames;
    }

    if (sampledFrames.some((frame) => frame.frameNumber === selectedFrame.frameNumber)) {
      return sampledFrames;
    }

    return [...sampledFrames, selectedFrame].sort((a, b) => a.frameNumber - b.frameNumber);
  }, [sampledFrames, selectedFrame]);

  const frameNumbers = useMemo(() => displayFrames.map((frame) => frame.frameNumber), [displayFrames]);

  const timestamps = useMemo(() => displayFrames.map((frame) => frame.timestampUtc), [displayFrames]);

  const safelyDispatch = useCallback((instance: EChartsType, action: Parameters<EChartsType['dispatchAction']>[0]) => {
    if (typeof instance.isDisposed === 'function' && instance.isDisposed()) {
      return;
    }

    if (typeof instance.dispatchAction !== 'function') {
      return;
    }

    try {
      instance.dispatchAction(action);
    } catch (error) {
      if (!import.meta.env.PROD) {
        // eslint-disable-next-line no-console -- Debugging aid for unexpected lifecycle issues.
        console.debug('Failed to dispatch action on chart instance', error);
      }
    }
  }, []);

  const fpsValues = useMemo(
    () =>
      displayFrames.map((frame) => {
        const value = ensureFiniteNumber(frame.fps, Number.NaN);
        return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
      }),
    [displayFrames]
  );

  const textureValues = useMemo(
    () =>
      displayFrames.map((frame) => {
        const textureBytes =
          frame.totalTextureBytes ??
          frame.textures
            .filter((texture) => !texture.isRenderTexture)
            .reduce((sum, texture) => sum + ensureFiniteNumber(texture.EstimatedBytes), 0);
        const value = bytesToMegabytes(textureBytes);
        return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
      }),
    [displayFrames]
  );

  const meshValues = useMemo(
    () =>
      displayFrames.map((frame) => {
        const meshBytes =
          frame.totalMeshBytes ??
          frame.meshes.reduce((sum, mesh) => sum + ensureFiniteNumber(mesh.EstimatedBytes), 0);
        const value = bytesToMegabytes(meshBytes);
        return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
      }),
    [displayFrames]
  );

  const renderTextureValues = useMemo(
    () =>
      displayFrames.map((frame) => {
        const rtBytes =
          frame.totalRenderTextureBytes ??
          (frame.renderTextures ?? []).reduce((sum, renderTexture) => sum + ensureFiniteNumber(renderTexture?.EstimatedBytes), 0);
        const value = bytesToMegabytes(rtBytes);
        return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
      }),
    [displayFrames]
  );

  const shaderValues = useMemo(
    () =>
      displayFrames.map((frame) => {
        const explicitBytes = ensureFiniteNumber(frame.totalShaderBytes ?? frame.shaderMemoryBytes, 0);
        const aggregatedBytes = frame.shaders?.reduce(
          (sum, shader) => sum + ensureFiniteNumber(shader?.memoryBytes),
          0
        ) ?? 0;
        const shaderBytes = explicitBytes > 0 ? explicitBytes : aggregatedBytes;
        if (shaderBytes <= 0) {
          return null;
        }
        const value = bytesToMegabytes(shaderBytes);
        return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
      }),
    [displayFrames]
  );

  const option = useMemo<EChartsOption>(() => {
    const latestFrameNumber = frameNumbers[frameNumbers.length - 1];

    return {
      color: ['#5B8FF9', '#F6BD16', '#5AD8A6', '#9254DE', '#FF7875'],
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
              if (
                item.seriesName === '纹理 (MB)' ||
                item.seriesName === '网格 (MB)' ||
                item.seriesName === 'RenderTexture (MB)' ||
                item.seriesName === 'Shader (MB)'
              ) {
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
        {
          name: 'RenderTexture (MB)',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          yAxisIndex: 1,
          connectNulls: false,
          showSymbol: false,
          areaStyle: { opacity: 0.08 },
          emphasis: { focus: 'series' },
          data: renderTextureValues,
        },
        {
          name: 'Shader (MB)',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          yAxisIndex: 1,
          connectNulls: false,
          showSymbol: false,
          areaStyle: { opacity: 0.08 },
          emphasis: { focus: 'series' },
          data: shaderValues,
        },
      ],
    } satisfies EChartsOption;
  }, [frameNumbers, timestamps, fpsValues, textureValues, meshValues, renderTextureValues, shaderValues]);

  useEffect(() => {
    return () => {
      if (!chartRef.current) return;
      const instance = chartRef.current;
      chartRef.current = null;

      if (typeof instance.isDisposed === 'function' && instance.isDisposed()) {
        return;
      }

      if (typeof instance.dispose === 'function') {
        instance.dispose();
      }
    };
  }, []);

  useEffect(() => {
    const instance = chartRef.current;
    if (!instance) return;

    // The echarts instance can be disposed while React is rendering, in which case
    // calling dispatchAction will trigger runtime errors (e.g. scheduler pipeline
    // lookups on an undefined map). Guard against this by ensuring the instance is
    // still alive before attempting to control it.
    if (typeof instance.isDisposed === 'function' && instance.isDisposed()) {
      return;
    }

    if (typeof instance.dispatchAction !== 'function') {
      return;
    }

    const seriesCount = 5;
    for (let index = 0; index < seriesCount; index += 1) {
      safelyDispatch(instance, { type: 'downplay', seriesIndex: index });
    }
    safelyDispatch(instance, { type: 'hideTip' });

    if (!selectedFrame) return;

    const targetIndex = frameNumbers.findIndex((frameNumber) => frameNumber === selectedFrame.frameNumber);
    if (targetIndex === -1) {
      return;
    }

    for (let index = 0; index < seriesCount; index += 1) {
      safelyDispatch(instance, { type: 'highlight', seriesIndex: index, dataIndex: targetIndex });
    }

    safelyDispatch(instance, { type: 'showTip', seriesIndex: 0, dataIndex: targetIndex });
    safelyDispatch(instance, {
      type: 'updateAxisPointer',
      seriesIndex: 0,
      value: frameNumbers[targetIndex],
    });
  }, [frameNumbers, safelyDispatch, selectedFrame]);

  const handleAxisPointerUpdate = useCallback(
    (event: { axesInfo?: Array<{ value?: number | string | null | undefined }> } | undefined) => {
      const rawValue = event?.axesInfo?.[0]?.value;
      const numericValue =
        typeof rawValue === 'number'
          ? rawValue
          : typeof rawValue === 'string'
          ? Number(rawValue)
          : Number.NaN;

      if (Number.isFinite(numericValue) && frameNumbers.includes(numericValue)) {
        hoveredFrameNumberRef.current = numericValue;
      } else {
        hoveredFrameNumberRef.current = null;
      }
    },
    [frameNumbers]
  );

  const handleChartClick = useCallback(
    (params: {
      dataIndex?: number;
      value?: number | string | null;
      axisValue?: number | string | null;
      name?: number | string;
    }) => {
      const normalizeFrameNumber = (value: unknown): number | null => {
        if (typeof value === 'number' && Number.isFinite(value)) {
          return value;
        }
        if (typeof value === 'string') {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) {
            return parsed;
          }
        }
        return null;
      };

      let frameNumber: number | null = null;

      if (typeof params.dataIndex === 'number') {
        frameNumber = frameNumbers[params.dataIndex] ?? null;
      }

      if (frameNumber == null) {
        const candidateValues: Array<number | string | null | undefined> = [
          params.value,
          params.axisValue,
          params.name,
        ];

        for (const candidate of candidateValues) {
          frameNumber = normalizeFrameNumber(candidate);
          if (frameNumber != null) {
            break;
          }
        }
      }

      if (frameNumber == null && hoveredFrameNumberRef.current != null) {
        frameNumber = hoveredFrameNumberRef.current;
      }

      if (frameNumber == null) {
        return;
      }

      const frame = frames.find((item) => item.frameNumber === frameNumber) ?? null;
      if (!frame) {
        return;
      }

      onSelectFrame(frame, { userInitiated: true });
    },
    [frameNumbers, frames, onSelectFrame]
  );

  const handleGlobalOut = useCallback(() => {
    hoveredFrameNumberRef.current = null;
  }, []);

  useEffect(() => {
    const instance = chartRef.current;
    if (!instance) {
      return;
    }

    const zr = instance.getZr?.();
    if (!zr || typeof zr.on !== 'function' || typeof zr.off !== 'function') {
      return;
    }

    const handleZrClick = (event: { offsetX: number; offsetY: number }) => {
      const pointInPixel: [number, number] = [event.offsetX, event.offsetY];
      if (typeof instance.containPixel === 'function' && !instance.containPixel('grid', pointInPixel)) {
        return;
      }

      const rawValue = instance.convertFromPixel?.({ xAxisIndex: 0 }, pointInPixel);
      const candidate = Array.isArray(rawValue) ? rawValue[0] : rawValue;

      let numericValue: number | null = null;
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        numericValue = candidate;
      } else if (typeof candidate === 'string') {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed)) {
          numericValue = parsed;
        }
      }

      if (numericValue == null) {
        return;
      }

      const nearestFrameNumber = findNearestFrameNumber(numericValue, frameNumbers);
      if (nearestFrameNumber == null) {
        return;
      }

      const frame = frames.find((item) => item.frameNumber === nearestFrameNumber) ?? null;
      if (!frame) {
        return;
      }

      onSelectFrame(frame, { userInitiated: true });
    };

    zr.on('click', handleZrClick);
    return () => {
      zr.off('click', handleZrClick);
    };
  }, [frameNumbers, frames, onSelectFrame]);

  const latestFrameNumberForTitle =
    frames.length > 0 ? frames[frames.length - 1]?.frameNumber ?? '-' : '-';

  return (
    <Card
      title={
        <Typography.Text strong>
          性能趋势 · {frames.length} 帧 · 最新帧 #{latestFrameNumberForTitle}
        </Typography.Text>
      }
      extra={
        <Space size={8} align="center">
          <Tooltip title="仅展示满足最小时间间隔的帧，0 表示实时显示所有帧。">
            <Typography.Text type="secondary">采样间隔</Typography.Text>
          </Tooltip>
          <InputNumber
            size="small"
            min={0}
            step={50}
            value={samplingIntervalMs}
            style={{ width: 130 }}
            formatter={(value) => `${value ?? 0} ms`}
            parser={(value) => {
              if (typeof value !== 'string') {
                return 0;
              }
              const numeric = Number(value.replace(/\s*ms$/i, ''));
              return Number.isFinite(numeric) ? numeric : 0;
            }}
            onChange={(value) => {
              if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
                onChangeSamplingInterval(value);
                return;
              }
              if (typeof value === 'string') {
                const numeric = Number(value);
                if (Number.isFinite(numeric) && numeric >= 0) {
                  onChangeSamplingInterval(numeric);
                  return;
                }
              }
              if (value === null) {
                onChangeSamplingInterval(0);
              }
            }}
          />
        </Space>
      }
    >
      {frames.length === 0 ? (
        <Empty description="暂无数据" />
      ) : (
        <ReactEChartsCore
          echarts={echarts}
          option={option}
          style={{ height: 400 }}
          notMerge
          lazyUpdate={false}
          onChartReady={(instance) => {
            chartRef.current = instance;
          }}
          onEvents={{
            click: handleChartClick,
            updateAxisPointer: handleAxisPointerUpdate,
            globalout: handleGlobalOut,
          }}
        />
      )}
    </Card>
  );
}
