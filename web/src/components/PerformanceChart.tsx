import { useCallback, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { Empty, Image, InputNumber, Space, Tooltip, Typography, theme } from 'antd';
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
import type { LineSeriesOption } from 'echarts';
import { CanvasRenderer } from 'echarts/renderers';
import type { TelemetrySnapshot } from '../types';
import { formatFps } from '../utils/format';
import { resolvePreviewSource } from '../utils/preview';
import CollapsibleCard from './CollapsibleCard';

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
  serverBaseUrl: string;
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

function mapFramesToMegabytes(
  frames: TelemetrySnapshot[],
  selector: (frame: TelemetrySnapshot) => unknown
) {
  return frames.map((frame) => {
    const raw = selector(frame);
    const numeric = ensureFiniteNumber(raw, Number.NaN);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return null;
    }
    const megabytes = bytesToMegabytes(numeric);
    if (!Number.isFinite(megabytes)) {
      return null;
    }
    return Number(megabytes.toFixed(2));
  });
}

function mapFramesToMilliseconds(
  frames: TelemetrySnapshot[],
  selector: (frame: TelemetrySnapshot) => unknown
) {
  return frames.map((frame) => {
    const raw = selector(frame);
    const numeric = ensureFiniteNumber(raw, Number.NaN);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return null;
    }
    return Number(numeric.toFixed(2));
  });
}

function mapFramesToPercentage(
  frames: TelemetrySnapshot[],
  selector: (frame: TelemetrySnapshot) => unknown
) {
  return frames.map((frame) => {
    const raw = selector(frame);
    const numeric = ensureFiniteNumber(raw, Number.NaN);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return null;
    }
    const normalized = numeric <= 1 ? numeric * 100 : numeric;
    if (!Number.isFinite(normalized)) {
      return null;
    }
    return Number(normalized.toFixed(1));
  });
}

function computeNonNegativeAxisExtent(
  series: Array<Array<number | null>>,
  fallbackMax: number
) {
  const values = series
    .flatMap((items) => items)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  if (values.length === 0) {
    return { min: 0, max: fallbackMax } as const;
  }

  let minValue = Math.min(...values);
  let maxValue = Math.max(...values);

  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    return { min: 0, max: fallbackMax } as const;
  }

  if (minValue < 0) {
    minValue = 0;
  }

  if (minValue === maxValue) {
    if (minValue === 0) {
      maxValue = fallbackMax;
    } else {
      const padding = Math.max(minValue * 0.1, 5);
      minValue = Math.max(0, minValue - padding);
      maxValue += padding;
    }
  } else {
    const range = maxValue - minValue;
    const padding = Math.max(range * 0.1, 5);
    minValue = Math.max(0, minValue - padding);
    maxValue += padding;
  }

  const step = maxValue > 100 ? 10 : 5;
  const roundedMin = Math.max(0, Math.floor(minValue / step) * step);
  const roundedMax = Math.ceil(maxValue / step) * step;

  if (roundedMax <= roundedMin) {
    return { min: Math.max(0, roundedMin - step), max: roundedMin + step } as const;
  }

  return { min: roundedMin, max: roundedMax } as const;
}

function formatMegabyteLabel(value: number) {
  return `${value.toFixed(1)} MB`;
}

function formatMillisecondLabel(value: number) {
  return `${value.toFixed(2)} ms`;
}

function formatPercentageLabel(value: number) {
  return `${value.toFixed(1)} %`;
}

function hasSeriesData(values: Array<number | null>) {
  return values.some((value) => typeof value === 'number' && Number.isFinite(value));
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
  serverBaseUrl,
}: PerformanceChartProps) {
  const chartRef = useRef<EChartsType | null>(null);
  const hoveredFrameNumberRef = useRef<number | null>(null);
  const { token } = theme.useToken();

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

  const previewSrc = useMemo(
    () => resolvePreviewSource(selectedFrame?.framePreview ?? null, serverBaseUrl),
    [selectedFrame, serverBaseUrl]
  );

  const previewInfo = selectedFrame?.framePreview ?? null;
  const previewHasImage = Boolean(previewSrc);
  const previewWidth =
    typeof previewInfo?.width === 'number' && Number.isFinite(previewInfo.width)
      ? previewInfo.width
      : null;
  const previewHeight =
    typeof previewInfo?.height === 'number' && Number.isFinite(previewInfo.height)
      ? previewInfo.height
      : null;
  const previewOrientation = previewInfo?.orientation ?? null;
  const isPortraitPreview = useMemo(() => {
    if (typeof previewOrientation === 'string') {
      const normalized = previewOrientation.toLowerCase();
      if (normalized === 'portrait') {
        return true;
      }
      if (normalized === 'landscape') {
        return false;
      }
    }

    if (previewWidth != null && previewHeight != null) {
      return previewHeight > previewWidth;
    }

    return false;
  }, [previewOrientation, previewWidth, previewHeight]);
  const previewContainerHeight = isPortraitPreview ? 320 : 200;
  const previewContainerMaxHeight = isPortraitPreview ? 480 : 240;
  const previewWrapperStyle = useMemo<CSSProperties>(
    () => ({
      height: '100%',
      width: isPortraitPreview ? 'auto' : '100%',
      maxHeight: '100%',
      maxWidth: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }),
    [isPortraitPreview]
  );
  const previewImageStyle = useMemo<CSSProperties>(
    () => ({
      objectFit: 'contain',
      height: '100%',
      width: isPortraitPreview ? 'auto' : '100%',
      maxHeight: '100%',
      maxWidth: '100%',
      display: 'block',
    }),
    [isPortraitPreview]
  );
  const previewResolution =
    previewWidth != null && previewHeight != null ? `${previewWidth}×${previewHeight}` : null;
  const previewTimestamp = previewInfo?.captureTimestampUtc ?? selectedFrame?.timestampUtc ?? null;
  const previewTimestampLabel = previewTimestamp ? new Date(previewTimestamp).toLocaleString() : null;
  const previewFpsLabel =
    typeof selectedFrame?.fps === 'number' && Number.isFinite(selectedFrame.fps)
      ? formatFps(selectedFrame.fps)
      : null;

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

  const fpsAxisExtent = useMemo(() => {
    const numericValues = fpsValues.filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value)
    );

    if (numericValues.length === 0) {
      return { min: 0, max: 60 } as const;
    }

    let minValue = Math.min(...numericValues);
    let maxValue = Math.max(...numericValues);

    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
      return { min: 0, max: 60 } as const;
    }

    if (minValue === maxValue) {
      if (minValue <= 0) {
        return { min: 0, max: 60 } as const;
      }
      const padding = Math.max(minValue * 0.1, 5);
      minValue = Math.max(0, minValue - padding);
      maxValue += padding;
    } else {
      const range = maxValue - minValue;
      const padding = Math.max(range * 0.1, 5);
      minValue = Math.max(0, minValue - padding);
      maxValue += padding;
    }

    const roundedMin = Math.max(0, Math.floor(minValue / 5) * 5);
    const roundedMax = Math.ceil(maxValue / 5) * 5;

    if (roundedMax <= roundedMin) {
      return { min: Math.max(0, roundedMin - 5), max: roundedMin + 5 } as const;
    }

    return { min: roundedMin, max: roundedMax } as const;
  }, [fpsValues]);

  const textureValues = useMemo(
    () =>
      mapFramesToMegabytes(displayFrames, (frame) => {
        const explicitTotal = ensureFiniteNumber(frame.totalTextureBytes, Number.NaN);
        if (Number.isFinite(explicitTotal) && explicitTotal >= 0) {
          return explicitTotal;
        }
        return frame.textures
          .filter((texture) => !texture.isRenderTexture)
          .reduce((sum, texture) => sum + ensureFiniteNumber(texture.EstimatedBytes, 0), 0);
      }),
    [displayFrames]
  );

  const meshValues = useMemo(
    () =>
      mapFramesToMegabytes(displayFrames, (frame) => {
        const explicitTotal = ensureFiniteNumber(frame.totalMeshBytes, Number.NaN);
        if (Number.isFinite(explicitTotal) && explicitTotal >= 0) {
          return explicitTotal;
        }
        return frame.meshes.reduce(
          (sum, mesh) => sum + ensureFiniteNumber(mesh.EstimatedBytes, 0),
          0
        );
      }),
    [displayFrames]
  );

  const renderTextureValues = useMemo(
    () =>
      mapFramesToMegabytes(displayFrames, (frame) => {
        const explicitTotal = ensureFiniteNumber(frame.totalRenderTextureBytes, Number.NaN);
        if (Number.isFinite(explicitTotal) && explicitTotal >= 0) {
          return explicitTotal;
        }
        return (frame.renderTextures ?? []).reduce(
          (sum, renderTexture) => sum + ensureFiniteNumber(renderTexture?.EstimatedBytes, 0),
          0
        );
      }),
    [displayFrames]
  );

  const shaderValues = useMemo(
    () =>
      mapFramesToMegabytes(displayFrames, (frame) => {
        const explicitBytes = ensureFiniteNumber(frame.totalShaderBytes ?? frame.shaderMemoryBytes, Number.NaN);
        if (Number.isFinite(explicitBytes) && explicitBytes > 0) {
          return explicitBytes;
        }
        const aggregatedBytes =
          frame.shaders?.reduce((sum, shader) => sum + ensureFiniteNumber(shader?.memoryBytes, 0), 0) ?? 0;
        return aggregatedBytes > 0 ? aggregatedBytes : Number.NaN;
      }),
    [displayFrames]
  );

  const materialValues = useMemo(
    () =>
      mapFramesToMegabytes(displayFrames, (frame) => {
        const explicitTotal = ensureFiniteNumber(frame.totalMaterialBytes, Number.NaN);
        if (Number.isFinite(explicitTotal) && explicitTotal > 0) {
          return explicitTotal;
        }
        const aggregated =
          (frame.materials ?? []).reduce(
            (sum, material) => sum + ensureFiniteNumber(material?.memoryBytes, 0),
            0
          ) ?? 0;
        return aggregated > 0 ? aggregated : Number.NaN;
      }),
    [displayFrames]
  );

  const unityHeapValues = useMemo(
    () => mapFramesToMegabytes(displayFrames, (frame) => frame.memoryStats?.unityHeapBytes),
    [displayFrames]
  );

  const nativeMemoryValues = useMemo(
    () => mapFramesToMegabytes(displayFrames, (frame) => frame.memoryStats?.nativeMemoryBytes),
    [displayFrames]
  );

  const gpuMemoryValues = useMemo(
    () => mapFramesToMegabytes(displayFrames, (frame) => frame.memoryStats?.gpuMemoryBytes),
    [displayFrames]
  );

  const texturePoolValues = useMemo(
    () => mapFramesToMegabytes(displayFrames, (frame) => frame.memoryStats?.texturePoolBytes),
    [displayFrames]
  );

  const meshPoolValues = useMemo(
    () => mapFramesToMegabytes(displayFrames, (frame) => frame.memoryStats?.meshPoolBytes),
    [displayFrames]
  );

  const otherMemoryValues = useMemo(
    () => mapFramesToMegabytes(displayFrames, (frame) => frame.memoryStats?.otherMemoryBytes),
    [displayFrames]
  );

  const managedHeapValues = useMemo(
    () => mapFramesToMegabytes(displayFrames, (frame) => frame.memoryStats?.gc?.managedHeapSizeBytes),
    [displayFrames]
  );

  const cpuFrameTimeValues = useMemo(
    () => mapFramesToMilliseconds(displayFrames, (frame) => frame.frameTiming?.cpuFrameTimeMs),
    [displayFrames]
  );

  const gpuFrameTimeValues = useMemo(
    () => mapFramesToMilliseconds(displayFrames, (frame) => frame.frameTiming?.gpuFrameTimeMs),
    [displayFrames]
  );

  const mainThreadFrameTimeValues = useMemo(
    () => mapFramesToMilliseconds(displayFrames, (frame) => frame.frameTiming?.cpuMainThreadTimeMs),
    [displayFrames]
  );

  const renderThreadFrameTimeValues = useMemo(
    () => mapFramesToMilliseconds(displayFrames, (frame) => frame.frameTiming?.cpuRenderThreadTimeMs),
    [displayFrames]
  );

  const mainThreadUtilizationValues = useMemo(
    () => mapFramesToPercentage(displayFrames, (frame) => frame.threadStats?.mainThreadPercent),
    [displayFrames]
  );

  const renderThreadUtilizationValues = useMemo(
    () => mapFramesToPercentage(displayFrames, (frame) => frame.threadStats?.renderThreadPercent),
    [displayFrames]
  );

  const jobWorkerUtilizationValues = useMemo(
    () => mapFramesToPercentage(displayFrames, (frame) => frame.threadStats?.jobWorkerPercent),
    [displayFrames]
  );

  const frameTimeAxisExtent = useMemo(
    () =>
      computeNonNegativeAxisExtent(
        [cpuFrameTimeValues, gpuFrameTimeValues, mainThreadFrameTimeValues, renderThreadFrameTimeValues],
        50
      ),
    [cpuFrameTimeValues, gpuFrameTimeValues, mainThreadFrameTimeValues, renderThreadFrameTimeValues]
  );

  const utilizationAxisExtent = useMemo(
    () =>
      computeNonNegativeAxisExtent(
        [mainThreadUtilizationValues, renderThreadUtilizationValues, jobWorkerUtilizationValues],
        100
      ),
    [jobWorkerUtilizationValues, mainThreadUtilizationValues, renderThreadUtilizationValues]
  );

  const memorySeries = useMemo(
    () =>
      [
        { name: '纹理 (MB)', data: textureValues },
        { name: '网格 (MB)', data: meshValues },
        { name: 'RenderTexture (MB)', data: renderTextureValues },
        { name: 'Shader (MB)', data: shaderValues },
        { name: '材质 (MB)', data: materialValues },
        { name: 'Unity 堆 (MB)', data: unityHeapValues },
        { name: 'Native 内存 (MB)', data: nativeMemoryValues },
        { name: 'GPU 显存 (MB)', data: gpuMemoryValues },
        { name: '纹理池 (MB)', data: texturePoolValues },
        { name: '网格池 (MB)', data: meshPoolValues },
        { name: '其他内存 (MB)', data: otherMemoryValues },
        { name: '托管堆 (MB)', data: managedHeapValues },
      ].filter((series) => hasSeriesData(series.data)),
    [
      gpuMemoryValues,
      managedHeapValues,
      materialValues,
      meshPoolValues,
      meshValues,
      nativeMemoryValues,
      otherMemoryValues,
      renderTextureValues,
      shaderValues,
      texturePoolValues,
      textureValues,
      unityHeapValues,
    ]
  );

  const frameTimeSeries = useMemo(
    () =>
      [
        { name: 'CPU 帧耗时 (ms)', data: cpuFrameTimeValues },
        { name: 'GPU 帧耗时 (ms)', data: gpuFrameTimeValues },
        { name: '主线程耗时 (ms)', data: mainThreadFrameTimeValues },
        { name: '渲染线程耗时 (ms)', data: renderThreadFrameTimeValues },
      ].filter((series) => hasSeriesData(series.data)),
    [cpuFrameTimeValues, gpuFrameTimeValues, mainThreadFrameTimeValues, renderThreadFrameTimeValues]
  );

  const utilizationSeries = useMemo(
    () =>
      [
        { name: '主线程利用率 (%)', data: mainThreadUtilizationValues },
        { name: '渲染线程利用率 (%)', data: renderThreadUtilizationValues },
        { name: 'Job Worker 利用率 (%)', data: jobWorkerUtilizationValues },
      ].filter((series) => hasSeriesData(series.data)),
    [jobWorkerUtilizationValues, mainThreadUtilizationValues, renderThreadUtilizationValues]
  );

  const option = useMemo<EChartsOption>(() => {
    const latestFrameNumber = frameNumbers[frameNumbers.length - 1];
    const tooltipSeriesNames = [
      'FPS',
      ...memorySeries.map((series) => series.name),
      ...frameTimeSeries.map((series) => series.name),
      ...utilizationSeries.map((series) => series.name),
    ];

    const memorySeriesOptions = memorySeries.map<LineSeriesOption>((series) => ({
      name: series.name,
      type: 'line',
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      yAxisIndex: 1,
      connectNulls: false,
      showSymbol: false,
      areaStyle: { opacity: 0.08 },
      emphasis: { focus: 'series' },
      data: series.data,
    }));

    const frameTimeSeriesOptions = frameTimeSeries.map<LineSeriesOption>((series) => ({
      name: series.name,
      type: 'line',
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      yAxisIndex: 2,
      connectNulls: false,
      showSymbol: false,
      emphasis: { focus: 'series' },
      lineStyle: { width: 2 },
      data: series.data,
    }));

    const utilizationSeriesOptions = utilizationSeries.map<LineSeriesOption>((series) => ({
      name: series.name,
      type: 'line',
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      yAxisIndex: 3,
      connectNulls: false,
      showSymbol: false,
      emphasis: { focus: 'series' },
      lineStyle: { width: 2 },
      data: series.data,
    }));

    return {
      color: [
        '#5B8FF9',
        '#F6BD16',
        '#5AD8A6',
        '#9254DE',
        '#FF7875',
        '#FF9F7F',
        '#36CBCB',
        '#4ECB73',
        '#D3ADF7',
        '#FFC53D',
        '#597EF7',
        '#FF85C0',
        '#A0D911',
        '#13C2C2',
        '#FA541C',
        '#D89614',
        '#FFD666',
        '#73D13D',
      ],
      grid: { left: 56, right: 200, top: 70, bottom: 80 },
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
            .filter((item: any) => tooltipSeriesNames.includes(item.seriesName))
            .map((item: any) => {
              const seriesName: string = item.seriesName;
              if (item.data == null) {
                return `${item.marker}${seriesName}: --`;
              }
              const numeric = Number(item.data);
              if (!Number.isFinite(numeric)) {
                return `${item.marker}${seriesName}: --`;
              }
              if (seriesName === 'FPS') {
                return `${item.marker}${seriesName}: ${formatFps(numeric)}`;
              }
              if (seriesName.endsWith('(MB)')) {
                return `${item.marker}${seriesName}: ${formatMegabyteLabel(numeric)}`;
              }
              if (seriesName.endsWith('(ms)')) {
                return `${item.marker}${seriesName}: ${formatMillisecondLabel(numeric)}`;
              }
              if (seriesName.endsWith('(%)')) {
                return `${item.marker}${seriesName}: ${formatPercentageLabel(numeric)}`;
              }
              return `${item.marker}${seriesName}: ${numeric.toFixed(2)}`;
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
        triggerEvent: true,
      },
      yAxis: [
        {
          type: 'value',
          name: 'FPS',
          position: 'left',
          min: fpsAxisExtent.min,
          max: fpsAxisExtent.max,
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
          name: '内存 (MB)',
          position: 'right',
          offset: 0,
          min: 0,
          axisLabel: {
            formatter: (value: number) => {
              const numeric = Number(value);
              if (!Number.isFinite(numeric)) {
                return '--';
              }
              return numeric >= 100 ? `${numeric.toFixed(0)} MB` : `${numeric.toFixed(1)} MB`;
            },
          },
          splitLine: { lineStyle: { type: 'dashed' } },
        },
        {
          type: 'value',
          name: '耗时 (ms)',
          position: 'right',
          offset: 60,
          min: frameTimeAxisExtent.min,
          max: frameTimeAxisExtent.max,
          axisLabel: {
            formatter: (value: number) => {
              const numeric = Number(value);
              if (!Number.isFinite(numeric)) {
                return '--';
              }
              return `${numeric.toFixed(0)} ms`;
            },
          },
          splitLine: { show: false },
        },
        {
          type: 'value',
          name: '利用率 (%)',
          position: 'right',
          offset: 120,
          min: utilizationAxisExtent.min,
          max: utilizationAxisExtent.max,
          axisLabel: {
            formatter: (value: number) => {
              const numeric = Number(value);
              if (!Number.isFinite(numeric)) {
                return '--';
              }
              return `${numeric.toFixed(0)}%`;
            },
          },
          splitLine: { show: false },
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
        ...memorySeriesOptions,
        ...frameTimeSeriesOptions,
        ...utilizationSeriesOptions,
      ],
    } satisfies EChartsOption;
  }, [
    frameNumbers,
    timestamps,
    fpsValues,
    fpsAxisExtent,
    frameTimeAxisExtent,
    utilizationAxisExtent,
    memorySeries,
    frameTimeSeries,
    utilizationSeries,
  ]);


  const totalSeriesCount = 1 + memorySeries.length + frameTimeSeries.length + utilizationSeries.length;

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

    for (let index = 0; index < totalSeriesCount; index += 1) {
      safelyDispatch(instance, { type: 'downplay', seriesIndex: index });
    }
    safelyDispatch(instance, { type: 'hideTip' });

    if (!selectedFrame) return;

    const targetIndex = frameNumbers.findIndex((frameNumber) => frameNumber === selectedFrame.frameNumber);
    if (targetIndex === -1) {
      return;
    }

    for (let index = 0; index < totalSeriesCount; index += 1) {
      safelyDispatch(instance, { type: 'highlight', seriesIndex: index, dataIndex: targetIndex });
    }

    safelyDispatch(instance, { type: 'showTip', seriesIndex: 0, dataIndex: targetIndex });
    safelyDispatch(instance, {
      type: 'updateAxisPointer',
      seriesIndex: 0,
      value: frameNumbers[targetIndex],
    });
  }, [
    frameNumbers,
    safelyDispatch,
    selectedFrame,
    totalSeriesCount,
  ]);

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
      componentType?: string;
      event?: {
        target?: {
          style?: {
            text?: unknown;
          };
        };
      };
    }) => {
      const normalizeFrameNumber = (value: unknown): number | null => {
        if (typeof value === 'number' && Number.isFinite(value)) {
          return value;
        }
        if (typeof value === 'string') {
          const trimmed = value.trim();
          const withoutPrefix = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
          const parsed = Number(withoutPrefix);
          if (Number.isFinite(parsed)) {
            return parsed;
          }
          const match = withoutPrefix.match(/-?\d+(?:\.\d+)?/);
          if (match) {
            const numeric = Number(match[0]);
            if (Number.isFinite(numeric)) {
              return numeric;
            }
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

      if (frameNumber == null) {
        const candidate = params.event?.target?.style?.text;
        frameNumber = normalizeFrameNumber(candidate);
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

  const cardBodyStyle: CSSProperties | undefined =
    frames.length === 0 ? undefined : { display: 'flex', flexDirection: 'column', gap: 16 };

  return (
    <CollapsibleCard
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
      bodyStyle={cardBodyStyle}
    >
      {frames.length === 0 ? (
        <Empty description="暂无数据" />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Typography.Text strong>帧画面预览</Typography.Text>
            <Typography.Text type="secondary">
              {selectedFrame ? `帧 #${selectedFrame.frameNumber}` : '未选择帧'}
            </Typography.Text>
          </div>
          <div
            style={{
              position: 'relative',
              height: previewContainerHeight,
              maxHeight: previewContainerMaxHeight,
              borderRadius: 12,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgLayout,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {previewHasImage ? (
              <div style={previewWrapperStyle}>
                <Image
                  src={previewSrc ?? undefined}
                  alt={selectedFrame ? `Frame #${selectedFrame.frameNumber} Preview` : 'Frame preview'}
                  style={previewImageStyle}
                  preview={previewHasImage ? { mask: '查看原图' } : false}
                />
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={selectedFrame ? '当前帧未提供画面预览' : '请选择一帧查看画面'}
              />
            )}
            {selectedFrame ? (
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  left: 12,
                  padding: '6px 12px',
                  borderRadius: 999,
                  background: 'rgba(0, 0, 0, 0.55)',
                  color: '#fff',
                  display: 'inline-flex',
                  gap: 8,
                  fontWeight: 600,
                  fontSize: 12,
                }}
              >
                <span>帧 #{selectedFrame.frameNumber}</span>
                {previewResolution ? <span>{previewResolution}</span> : null}
                {previewOrientation
                  ? (
                      <span>
                        {previewOrientation === 'portrait'
                          ? '竖屏'
                          : previewOrientation === 'landscape'
                          ? '横屏'
                          : previewOrientation === 'square'
                          ? '方形'
                          : previewOrientation}
                      </span>
                    )
                  : null}
              </div>
            ) : null}
            {(previewTimestampLabel || previewFpsLabel) && (
              <div
                style={{
                  position: 'absolute',
                  left: 12,
                  bottom: 12,
                  borderRadius: 8,
                  background: 'rgba(0, 0, 0, 0.45)',
                  color: '#fff',
                  padding: '8px 12px',
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
              >
                {previewTimestampLabel ? <div>{previewTimestampLabel}</div> : null}
                {previewFpsLabel ? <div>{previewFpsLabel}</div> : null}
              </div>
            )}
          </div>
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
        </>
      )}
    </CollapsibleCard>
  );
}
