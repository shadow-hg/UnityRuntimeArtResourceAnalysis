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
import { MAX_TIMELINE_FRAME_COUNT, type PerformanceSeriesSnapshot } from '../utils/performanceSeries';
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
  series: PerformanceSeriesSnapshot | null;
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
  series,
}: PerformanceChartProps) {
  const chartRef = useRef<EChartsType | null>(null);
  const hoveredFrameNumberRef = useRef<number | null>(null);
  const { token } = theme.useToken();

  const seriesData = series ?? null;

  const allFrameNumbers = seriesData?.frameNumbers ?? [];
  const allTimestamps = seriesData?.timestamps ?? [];

  const sampledIndices = useMemo(() => {
    if (!seriesData || allFrameNumbers.length === 0) {
      return [] as number[];
    }

    if (samplingIntervalMs <= 0) {
      return allFrameNumbers.map((_, index) => index);
    }

    const result: number[] = [];
    let lastAcceptedTimestamp = Number.NEGATIVE_INFINITY;
    let lastAcceptedFrameNumber = Number.NEGATIVE_INFINITY;

    allFrameNumbers.forEach((frameNumber, index) => {
      const timestamp = allTimestamps[index];
      const parsedTimestamp = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN;
      if (Number.isFinite(parsedTimestamp)) {
        if (parsedTimestamp - lastAcceptedTimestamp >= samplingIntervalMs) {
          result.push(index);
          lastAcceptedTimestamp = parsedTimestamp;
          lastAcceptedFrameNumber = frameNumber;
        }
        return;
      }

      if (!Number.isFinite(lastAcceptedFrameNumber) || frameNumber - lastAcceptedFrameNumber >= 1) {
        result.push(index);
        lastAcceptedFrameNumber = frameNumber;
      }
    });

    const latestIndex = allFrameNumbers.length - 1;
    if (latestIndex >= 0 && !result.includes(latestIndex)) {
      result.push(latestIndex);
    }

    return result.sort((a, b) => allFrameNumbers[a] - allFrameNumbers[b]);
  }, [seriesData, allFrameNumbers, allTimestamps, samplingIntervalMs]);

  const selectedIndex = useMemo(() => {
    if (!seriesData || !selectedFrame) {
      return -1;
    }
    return allFrameNumbers.findIndex((frameNumber) => frameNumber === selectedFrame.frameNumber);
  }, [seriesData, allFrameNumbers, selectedFrame]);

  const visibleFrameNumberSet = useMemo(() => {
    if (frames.length === 0) {
      return null;
    }
    const set = new Set<number>();
    frames.forEach((frame) => {
      if (typeof frame.frameNumber === 'number' && Number.isFinite(frame.frameNumber)) {
        set.add(frame.frameNumber);
      }
    });
    return set;
  }, [frames]);

  const visibleIndices = useMemo(() => {
    if (!seriesData) {
      return [] as number[];
    }

    const combined =
      selectedIndex >= 0 && !sampledIndices.includes(selectedIndex)
        ? [...sampledIndices, selectedIndex]
        : [...sampledIndices];

    combined.sort((a, b) => allFrameNumbers[a] - allFrameNumbers[b]);

    const uniqueCombined = combined.filter((index, position, array) => array.indexOf(index) === position);

    const aligned =
      visibleFrameNumberSet && visibleFrameNumberSet.size > 0
        ? uniqueCombined.filter((index) => visibleFrameNumberSet.has(allFrameNumbers[index]))
        : uniqueCombined;

    const basis = aligned.length > 0 ? aligned : uniqueCombined;

    const ensureSelectedIncluded = (source: number[]) => {
      if (selectedIndex < 0 || source.includes(selectedIndex)) {
        return source;
      }
      const next = [...source, selectedIndex];
      next.sort((a, b) => allFrameNumbers[a] - allFrameNumbers[b]);
      return next.filter((index, position, array) => array.indexOf(index) === position);
    };

    const prepared = ensureSelectedIncluded(basis);

    if (prepared.length <= MAX_TIMELINE_FRAME_COUNT) {
      return prepared;
    }

    return prepared.slice(-MAX_TIMELINE_FRAME_COUNT);
  }, [
    seriesData,
    sampledIndices,
    selectedIndex,
    allFrameNumbers,
    visibleFrameNumberSet,
  ]);

  const visibleFrameNumbers = useMemo(() => {
    if (!seriesData) {
      return [] as number[];
    }
    return visibleIndices.map((index) => allFrameNumbers[index]);
  }, [seriesData, visibleIndices, allFrameNumbers]);

  const visibleTimestamps = useMemo(() => {
    if (!seriesData) {
      return [] as (string | null)[];
    }
    return visibleIndices.map((index) => {
      const value = allTimestamps[index];
      return typeof value === 'string' ? value : value ?? null;
    });
  }, [seriesData, visibleIndices, allTimestamps]);

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

  const fpsValues = useMemo(() => {
    if (!seriesData) {
      return [] as Array<number | null>;
    }
    return visibleIndices.map((index) => seriesData.fps[index] ?? null);
  }, [seriesData, visibleIndices]);

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

  const mapSeriesData = useCallback(
    (source: ReadonlyArray<number | null>) =>
      visibleIndices.map((index) => {
        const value = source[index];
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
      }),
    [visibleIndices]
  );

  const memorySeries = useMemo(() => {
    if (!seriesData) {
      return [] as Array<{ name: string; data: Array<number | null> }>;
    }

    const seriesList = [
      { name: '纹理 (MB)', data: mapSeriesData(seriesData.memory.textures) },
      { name: '网格 (MB)', data: mapSeriesData(seriesData.memory.meshes) },
      { name: 'RenderTexture (MB)', data: mapSeriesData(seriesData.memory.renderTextures) },
      { name: 'Shader (MB)', data: mapSeriesData(seriesData.memory.shaders) },
      { name: '材质 (MB)', data: mapSeriesData(seriesData.memory.materials) },
      { name: 'Unity 堆 (MB)', data: mapSeriesData(seriesData.memory.unityHeap) },
      { name: 'Native 内存 (MB)', data: mapSeriesData(seriesData.memory.nativeMemory) },
      { name: 'GPU 显存 (MB)', data: mapSeriesData(seriesData.memory.gpuMemory) },
      { name: '纹理池 (MB)', data: mapSeriesData(seriesData.memory.texturePool) },
      { name: '网格池 (MB)', data: mapSeriesData(seriesData.memory.meshPool) },
      { name: '其他内存 (MB)', data: mapSeriesData(seriesData.memory.otherMemory) },
      { name: '托管堆 (MB)', data: mapSeriesData(seriesData.memory.managedHeap) },
    ];

    return seriesList.filter((item) => hasSeriesData(item.data));
  }, [seriesData, mapSeriesData]);

  const frameTimeSeries = useMemo(() => {
    if (!seriesData) {
      return [] as Array<{ name: string; data: Array<number | null> }>;
    }

    const seriesList = [
      { name: 'CPU 帧耗时 (ms)', data: mapSeriesData(seriesData.frameTiming.cpu) },
      { name: 'GPU 帧耗时 (ms)', data: mapSeriesData(seriesData.frameTiming.gpu) },
      { name: '主线程耗时 (ms)', data: mapSeriesData(seriesData.frameTiming.mainThread) },
      { name: '渲染线程耗时 (ms)', data: mapSeriesData(seriesData.frameTiming.renderThread) },
    ];

    return seriesList.filter((item) => hasSeriesData(item.data));
  }, [seriesData, mapSeriesData]);

  const utilizationSeries = useMemo(() => {
    if (!seriesData) {
      return [] as Array<{ name: string; data: Array<number | null> }>;
    }

    const seriesList = [
      { name: '主线程利用率 (%)', data: mapSeriesData(seriesData.threadUtilization.mainThread) },
      { name: '渲染线程利用率 (%)', data: mapSeriesData(seriesData.threadUtilization.renderThread) },
      { name: 'Job Worker 利用率 (%)', data: mapSeriesData(seriesData.threadUtilization.jobWorker) },
    ];

    return seriesList.filter((item) => hasSeriesData(item.data));
  }, [seriesData, mapSeriesData]);

  const frameTimeAxisExtent = useMemo(
    () =>
      computeNonNegativeAxisExtent(
        frameTimeSeries.map((item) => item.data),
        50
      ),
    [frameTimeSeries]
  );

  const utilizationAxisExtent = useMemo(
    () =>
      computeNonNegativeAxisExtent(
        utilizationSeries.map((item) => item.data),
        100
      ),
    [utilizationSeries]
  );

  const option = useMemo<EChartsOption>(() => {
    const latestFrameNumber = visibleFrameNumbers[visibleFrameNumbers.length - 1];
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
          const frameNumber = visibleFrameNumbers[index];
          const timestamp = visibleTimestamps[index];
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
        data: visibleFrameNumbers,
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
    visibleFrameNumbers,
    visibleTimestamps,
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

    const targetIndex = visibleFrameNumbers.findIndex(
      (frameNumber) => frameNumber === selectedFrame.frameNumber
    );
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
      value: visibleFrameNumbers[targetIndex],
    });
  }, [
    visibleFrameNumbers,
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

      if (Number.isFinite(numericValue) && visibleFrameNumbers.includes(numericValue)) {
        hoveredFrameNumberRef.current = numericValue;
      } else {
        hoveredFrameNumberRef.current = null;
      }
    },
    [visibleFrameNumbers]
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
        frameNumber = visibleFrameNumbers[params.dataIndex] ?? null;
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
    [visibleFrameNumbers, frames, onSelectFrame]
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

      const nearestFrameNumber = findNearestFrameNumber(numericValue, visibleFrameNumbers);
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
  }, [visibleFrameNumbers, frames, onSelectFrame]);

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
