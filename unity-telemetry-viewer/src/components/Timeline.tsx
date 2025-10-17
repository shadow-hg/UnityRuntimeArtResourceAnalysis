import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { TooltipProps as RechartsTooltipProps } from 'recharts';
import { formatMemoryFromKB, formatNumber } from '../utils/format';
import { getStatDisplaySizeKB } from '../utils/resourceMetadata';

type Props = {
  telemetryData: any[];
  currentIndex?: number;
  onSeek?: (index: number) => void;
};

type TimelineEntry = {
  index: number;
  frameIndex: number | null;
  timestamp: number | null;
  stats: { category: string; count: number; sizeKB: number }[];
  statMap: Record<string, { count: number; sizeKB: number }>;
  totalKB: number;
  totalCount: number;
  fps: number | null;
};

type ChartEntry = {
  index: number;
  frameIndex: number;
  totalKB: number;
  fps: number | null;
} & Record<string, number | null>;

type TimelineTooltipExtraProps = {
  entries: TimelineEntry[];
  colors: Record<string, string>;
  categories: string[];
  showTotal: boolean;
  showFps: boolean;
};

const TimelineTooltip: React.FC<RechartsTooltipProps<number, string> & TimelineTooltipExtraProps> = ({
  active,
  payload,
  label,
  entries,
  colors,
  categories,
  showTotal,
  showFps
}) => {
  if (!active || !payload || payload.length === 0 || typeof label !== 'number') {
    return null;
  }

  const entry = entries[Math.round(label)];
  if (!entry) return null;

  const items: { label: string; value: string; color?: string }[] = [];

  if (showTotal) {
    items.push({ label: '资源内存', value: formatMemoryFromKB(entry.totalKB), color: '#38bdf8' });
  }

  categories.forEach((category) => {
    const stat = entry.statMap[category];
    if (!stat || !Number.isFinite(stat.sizeKB)) return;
    items.push({ label: category, value: formatMemoryFromKB(stat.sizeKB), color: colors[category] || '#94a3b8' });
  });

  if (showFps && entry.fps !== null) {
    items.push({ label: 'FPS', value: entry.fps.toFixed(1), color: '#facc15' });
  }

  return (
    <div className="timeline-panel__tooltip">
      <div className="timeline-panel__tooltip-header">帧 {formatNumber(entry.frameIndex ?? entry.index)}</div>
      <div className="timeline-panel__tooltip-list">
        {items.map((item) => (
          <div key={item.label} className="timeline-panel__tooltip-item">
            <span className="timeline-panel__tooltip-dot" style={{ backgroundColor: item.color || '#94a3b8' }} />
            <span>{item.label}</span>
            <span>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const CATEGORY_COLOR_OVERRIDES: Record<string, string> = {
  Texture: '#38bdf8',
  RenderTexture: '#6366f1',
  Material: '#a855f7',
  Mesh: '#f97316',
  Shader: '#22d3ee',
  ShaderVariant: '#fb7185'
};

const FALLBACK_COLORS = ['#0ea5e9', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#f97316', '#64748b', '#10b981'];

const MAX_STACK_CATEGORIES = 5;

const Timeline: React.FC<Props> = ({ telemetryData, currentIndex = -1, onSeek }) => {
  const [localIndex, setLocalIndex] = useState<number>(currentIndex);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [visibleCategories, setVisibleCategories] = useState<string[]>([]);
  const [showTotal, setShowTotal] = useState(true);
  const [showFps, setShowFps] = useState(true);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const hasInitializedRangeRef = useRef(false);
  const previousMaxRef = useRef(-1);
  const rangeStartRef = useRef(0);
  const rangeEndRef = useRef(0);

  useEffect(() => {
    setLocalIndex(currentIndex);
    setHoverIndex(null);
  }, [currentIndex]);

  const entries = useMemo<TimelineEntry[]>(() => {
    return telemetryData.map((frame, idx) => {
      const statsRaw: any[] = Array.isArray(frame?.resourceStats) ? frame.resourceStats : [];
      const stats = statsRaw
        .map((stat) => ({
          category: stat?.category || '未分类',
          count: Number(stat?.count ?? 0),
          sizeKB: getStatDisplaySizeKB(stat)
        }))
        .sort((a, b) => b.sizeKB - a.sizeKB);

      const statMap: Record<string, { count: number; sizeKB: number }> = {};
      stats.forEach((stat) => {
        statMap[stat.category] = stat;
      });

      const totalKB = typeof frame?.resourceTotalKB === 'number'
        ? frame.resourceTotalKB
        : stats.reduce((sum, stat) => sum + (Number.isFinite(stat.sizeKB) ? stat.sizeKB : 0), 0);

      const totalCount = typeof frame?.resourceCount === 'number'
        ? frame.resourceCount
        : stats.reduce((sum, stat) => sum + (Number.isFinite(stat.count) ? stat.count : 0), 0);

      const fps = typeof frame?.metrics?.fps === 'number'
        ? frame.metrics.fps
        : (typeof frame?.dt === 'number' && frame.dt > 0 ? 1 / frame.dt : null);

      return {
        index: idx,
        frameIndex: typeof frame?.frameIndex === 'number' ? frame.frameIndex : null,
        timestamp: typeof frame?.timestamp === 'number' ? frame.timestamp : null,
        stats,
        statMap,
        totalKB,
        totalCount,
        fps
      };
    });
  }, [telemetryData]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((entry) => entry.stats.forEach((stat) => set.add(stat.category)));
    return Array.from(set);
  }, [entries]);

  const categoryColors = useMemo(() => {
    return categories.reduce<Record<string, string>>((acc, category, index) => {
      acc[category] = CATEGORY_COLOR_OVERRIDES[category] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
      return acc;
    }, {});
  }, [categories]);

  const topCategories = useMemo(() => {
    const totals = new Map<string, number>();
    entries.forEach((entry) => {
      entry.stats.forEach((stat) => {
        totals.set(stat.category, (totals.get(stat.category) || 0) + (Number.isFinite(stat.sizeKB) ? stat.sizeKB : 0));
      });
    });
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_STACK_CATEGORIES)
      .map(([category]) => category);
  }, [entries]);

  useEffect(() => {
    setVisibleCategories((prev) => {
      if (topCategories.length === 0) return [];
      if (prev.length === 0) return topCategories;
      const next = prev.filter((category) => topCategories.includes(category));
      const missing = topCategories.filter((category) => !next.includes(category));
      return [...next, ...missing];
    });
  }, [topCategories]);

  const max = Math.max(0, entries.length - 1);

  useEffect(() => {
    if (max < 0) {
      setRangeStart(0);
      setRangeEnd(0);
      rangeStartRef.current = 0;
      rangeEndRef.current = 0;
      hasInitializedRangeRef.current = false;
      return;
    }

    const prevMax = previousMaxRef.current;
    previousMaxRef.current = max;

    setRangeStart((prev) => {
      const next = Math.min(prev, max);
      rangeStartRef.current = next;
      return next;
    });

    setRangeEnd((prev) => {
      let next = Math.min(Math.max(prev, rangeStartRef.current), max);

      const windowSize = Math.max(0, rangeEndRef.current - rangeStartRef.current);

      if (!hasInitializedRangeRef.current) {
        const start = 0;
        next = max;
        rangeStartRef.current = start;
        rangeEndRef.current = next;
        hasInitializedRangeRef.current = true;
        setRangeStart(start);
        return next;
      }

      if (max > prevMax && rangeEndRef.current === prevMax) {
        next = max;
        if (windowSize <= 0) {
          rangeStartRef.current = 0;
          setRangeStart(0);
        } else {
          const start = Math.max(0, next - windowSize);
          rangeStartRef.current = start;
          setRangeStart(start);
        }
      }

      rangeEndRef.current = next;
      return next;
    });
  }, [max]);

  useEffect(() => {
    rangeStartRef.current = rangeStart;
  }, [rangeStart]);

  useEffect(() => {
    rangeEndRef.current = rangeEnd;
  }, [rangeEnd]);

  const clampToRange = (value: number) => {
    if (rangeEnd < rangeStart) return -1;
    if (value < rangeStart) return rangeStart;
    if (value > rangeEnd) return rangeEnd;
    return value;
  };

  useEffect(() => {
    setLocalIndex((prev) => {
      if (prev < 0) return prev;
      return clampToRange(prev);
    });
    setHoverIndex((prev) => {
      if (prev === null) return prev;
      const clamped = clampToRange(prev);
      return clamped >= 0 ? clamped : null;
    });
  }, [rangeStart, rangeEnd]);

  const clampedIndex = clampToRange(localIndex >= 0 ? localIndex : rangeEnd);
  const effectiveIndex = entries.length === 0 ? -1 : (clampedIndex >= 0 ? clampedIndex : rangeEnd);
  const activeIndex = hoverIndex !== null ? clampToRange(hoverIndex) : effectiveIndex;
  const currentEntry = activeIndex >= 0 ? entries[activeIndex] : null;
  const currentStats = currentEntry ? currentEntry.stats.slice(0, 5) : [];

  const chartEntries = useMemo<ChartEntry[]>(() => {
    return entries.map((entry, idx) => {
      const data: ChartEntry = {
        index: idx,
        frameIndex: typeof entry.frameIndex === 'number' ? entry.frameIndex : idx,
        totalKB: Math.max(0, entry.totalKB),
        fps: entry.fps !== null && Number.isFinite(entry.fps) ? entry.fps : null
      };

      topCategories.forEach((category) => {
        data[category] = Math.max(0, entry.statMap[category]?.sizeKB ?? 0);
      });

      return data;
    });
  }, [entries, topCategories]);

  const windowEntries = useMemo(() => {
    if (chartEntries.length === 0) return [] as ChartEntry[];
    const start = Math.max(0, Math.min(rangeStart, chartEntries.length - 1));
    const end = Math.max(start, Math.min(rangeEnd, chartEntries.length - 1));
    return chartEntries.slice(start, end + 1);
  }, [chartEntries, rangeStart, rangeEnd]);

  const memoryMax = useMemo(() => {
    return windowEntries.reduce((maxValue, entry) => {
      return Math.max(maxValue, Number(entry.totalKB) || 0);
    }, 0);
  }, [windowEntries]);

  const fpsMax = useMemo(() => {
    return windowEntries.reduce((maxValue, entry) => {
      return Math.max(maxValue, typeof entry.fps === 'number' ? entry.fps : 0);
    }, 0);
  }, [windowEntries]);

  const hasFpsData = useMemo(() => fpsMax > 0, [fpsMax]);

  const xTicks = useMemo(() => {
    if (windowEntries.length <= 1) return windowEntries.map((entry) => Number(entry.index));
    const firstIndex = Number(windowEntries[0]?.index ?? 0);
    const lastIndex = Number(windowEntries[windowEntries.length - 1]?.index ?? firstIndex);
    const tickCount = Math.min(6, windowEntries.length);
    const span = Math.max(1, lastIndex - firstIndex);
    const step = Math.max(1, Math.floor(span / Math.max(1, tickCount - 1)));
    const ticks: number[] = [];
    for (let i = firstIndex; i <= lastIndex; i += step) {
      ticks.push(i);
    }
    if (!ticks.includes(lastIndex)) ticks.push(lastIndex);
    return ticks;
  }, [windowEntries]);

  const averageFps = useMemo(() => {
    if (entries.length <= 1) return null;
    let totalDuration = 0;
    let previousTimestamp: number | null = null;

    const rangeMin = Math.max(0, Math.min(rangeStart, entries.length - 1));
    const rangeMax = Math.max(rangeMin, Math.min(rangeEnd, entries.length - 1));

    const entriesInRange = entries.slice(rangeMin, rangeMax + 1);
    if (entriesInRange.length <= 1) return null;

    entriesInRange.forEach((entry, sliceIdx) => {
      const idx = rangeMin + sliceIdx;
      const frame = telemetryData[idx];
      if (entry.timestamp !== null) {
        if (previousTimestamp !== null) {
          totalDuration += Math.max(0, (entry.timestamp - previousTimestamp) / 1000);
        }
        previousTimestamp = entry.timestamp;
      } else if (typeof frame?.dt === 'number' && frame.dt > 0) {
        totalDuration += frame.dt;
      } else if (entry.fps && entry.fps > 0) {
        totalDuration += 1 / entry.fps;
      }
    });

    if (totalDuration <= 0) return null;
    return (entriesInRange.length - 1) / totalDuration;
  }, [entries, telemetryData, rangeStart, rangeEnd]);

  const toggleCategory = (category: string) => {
    setVisibleCategories((prev) => {
      if (prev.includes(category)) {
        return prev.filter((item) => item !== category);
      }
      const next = [...prev, category];
      return topCategories.filter((item) => next.includes(item));
    });
  };

  const handleChartClick = (state: any) => {
    const idx = typeof state?.activeTooltipIndex === 'number' ? state.activeTooltipIndex : null;
    if (idx === null || idx < 0 || idx >= windowEntries.length) return;
    const entry = windowEntries[idx];
    if (!entry) return;
    setLocalIndex(entry.index);
    setHoverIndex(null);
    if (onSeek) onSeek(entry.index);
  };

  const handleChartHover = (state: any) => {
    const idx = typeof state?.activeTooltipIndex === 'number' ? state.activeTooltipIndex : null;
    if (idx === null) {
      setHoverIndex(null);
      return;
    }
    const entry = windowEntries[idx];
    if (!entry) {
      setHoverIndex(null);
      return;
    }
    setHoverIndex(entry.index);
  };

  const handleRangeChange = (type: 'start' | 'end', value: number) => {
    if (!Number.isFinite(value)) return;
    const clampedValue = Math.max(0, Math.min(value, max));
    if (type === 'start') {
      const nextStart = Math.min(clampedValue, rangeEnd);
      rangeStartRef.current = nextStart;
      setRangeStart(nextStart);
      if (localIndex >= 0 && localIndex < nextStart) {
        setLocalIndex(nextStart);
        if (onSeek) onSeek(nextStart);
      }
    } else {
      const nextEnd = Math.max(clampedValue, rangeStart);
      rangeEndRef.current = nextEnd;
      setRangeEnd(nextEnd);
      if (localIndex >= 0 && localIndex > nextEnd) {
        setLocalIndex(nextEnd);
        if (onSeek) onSeek(nextEnd);
      }
    }
  };

  const sliderPercent = (index: number) => {
    if (max <= 0) return 0;
    return (Math.max(0, Math.min(index, max)) / max) * 100;
  };

  const startFrameIndex = entries[rangeStart]?.frameIndex ?? rangeStart;
  const endFrameIndex = entries[rangeEnd]?.frameIndex ?? rangeEnd;

  return (
    <div className="panel timeline-panel">
      <div className="panel-header">
        <div className="panel-title">帧滑轨</div>
        <div className="badge">{entries.length}</div>
      </div>

      <div className="timeline-panel__chart">
        {entries.length === 0 ? (
          <div className="empty-state">等待帧数据</div>
        ) : (
          <div className="timeline-panel__chart-area">
            <ResponsiveContainer>
              <ComposedChart
                data={windowEntries as any[]}
                margin={{ top: 18, right: showFps && hasFpsData ? 48 : 24, bottom: 12, left: 0 }}
                onClick={handleChartClick}
                onMouseMove={handleChartHover}
                onMouseLeave={() => setHoverIndex(null)}
              >
                <defs>
                  <linearGradient id="timeline-area-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(99, 102, 241, 0.45)" />
                    <stop offset="100%" stopColor="rgba(14, 165, 233, 0.05)" />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(148, 163, 184, 0.18)" strokeDasharray="3 6" vertical={false} />
                <XAxis
                  dataKey="index"
                  type="number"
                  domain={[
                    Number(windowEntries[0]?.index ?? 0),
                    Number(windowEntries[windowEntries.length - 1]?.index ?? 0)
                  ]}
                  ticks={xTicks}
                  tickFormatter={(value: number) => {
                    const entry = chartEntries[Math.round(value)];
                    const frameValue = typeof entry?.frameIndex === 'number' ? entry.frameIndex : value;
                    return formatNumber(frameValue);
                  }}
                  stroke="rgba(148, 163, 184, 0.55)"
                  tickLine={false}
                  axisLine={false}
                  padding={{ left: 0, right: 0 }}
                />
                <YAxis
                  yAxisId="memory"
                  stroke="rgba(148, 163, 184, 0.55)"
                  tickFormatter={(value: number) => formatMemoryFromKB(value)}
                  width={86}
                  tickLine={false}
                  axisLine={false}
                />
                {showFps && hasFpsData && (
                  <YAxis
                    yAxisId="fps"
                    orientation="right"
                    stroke="rgba(250, 204, 21, 0.65)"
                    tickFormatter={(value: number) => formatNumber(value)}
                    width={60}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, Math.ceil(fpsMax)]}
                  />
                )}
                <Tooltip
                  cursor={false}
                  content={(
                    <TimelineTooltip
                      entries={entries}
                      colors={categoryColors}
                      categories={visibleCategories}
                      showTotal={showTotal}
                      showFps={showFps && hasFpsData}
                    />
                  )}
                />
                {visibleCategories.map((category) => (
                  <Area
                    key={category}
                    yAxisId="memory"
                    type="monotone"
                    dataKey={category}
                    stackId="memory"
                    stroke="none"
                    fill={categoryColors[category] || 'url(#timeline-area-fill)'}
                    fillOpacity={0.25}
                    isAnimationActive={false}
                  />
                ))}
                {showTotal && (
                  <Line
                    yAxisId="memory"
                    type="monotone"
                    dataKey="totalKB"
                    stroke="#38bdf8"
                    strokeWidth={2.4}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                )}
                {showFps && hasFpsData && (
                  <Line
                    yAxisId="fps"
                    type="monotone"
                    dataKey="fps"
                    stroke="#facc15"
                    strokeWidth={1.8}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                    strokeDasharray="4 3"
                  />
                )}
                {activeIndex >= 0 && showTotal && (
                  <ReferenceDot
                    yAxisId="memory"
                    x={chartEntries[activeIndex]?.index as number}
                    y={chartEntries[activeIndex]?.totalKB as number}
                    r={5}
                    stroke="#0f172a"
                    strokeWidth={1.2}
                    fill="#38bdf8"
                    fillOpacity={0.92}
                    isFront
                  />
                )}
                {activeIndex >= 0 && (
                  <ReferenceLine
                    x={chartEntries[activeIndex]?.index as number}
                    stroke="rgba(56, 189, 248, 0.45)"
                    strokeDasharray="3 3"
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            <div className="timeline-panel__chart-scale">
              <span>0</span>
              <span>{formatMemoryFromKB(memoryMax)}</span>
            </div>
          </div>
        )}
      </div>

      {(topCategories.length > 0 || hasFpsData) && (
        <div className="timeline-panel__legend">
          <button
            type="button"
            className={`timeline-panel__legend-toggle ${showTotal ? 'timeline-panel__legend-toggle--active' : ''}`}
            onClick={() => setShowTotal((prev) => !prev)}
            aria-pressed={showTotal}
          >
            <span className="timeline-panel__legend-swatch timeline-panel__legend-swatch--memory" />
            <span>总内存</span>
          </button>
          {hasFpsData && (
            <button
              type="button"
              className={`timeline-panel__legend-toggle ${showFps ? 'timeline-panel__legend-toggle--active' : ''}`}
              onClick={() => setShowFps((prev) => !prev)}
              aria-pressed={showFps}
            >
              <span className="timeline-panel__legend-swatch timeline-panel__legend-swatch--fps" />
              <span>FPS</span>
            </button>
          )}
          {topCategories.map((category) => {
            const isActive = visibleCategories.includes(category);
            return (
              <button
                key={category}
                type="button"
                className={`timeline-panel__legend-toggle ${isActive ? 'timeline-panel__legend-toggle--active' : ''}`}
                onClick={() => toggleCategory(category)}
                aria-pressed={isActive}
              >
                <span
                  className="timeline-panel__legend-swatch"
                  style={{ backgroundColor: categoryColors[category] || '#94a3b8' }}
                />
                <span>{category}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="timeline-panel__slider">
        <div className="timeline-panel__range">
          <div className="timeline-panel__range-track">
            <div
              className="timeline-panel__range-progress"
              style={{ left: `${sliderPercent(rangeStart)}%`, right: `${100 - sliderPercent(rangeEnd)}%` }}
            />
            {activeIndex >= 0 && (
              <div
                className="timeline-panel__range-marker"
                style={{ left: `${sliderPercent(activeIndex)}%` }}
                aria-hidden
              />
            )}
          </div>
          <input
            type="range"
            min={0}
            max={max}
            value={rangeStart}
            onChange={(event) => handleRangeChange('start', parseInt(event.target.value, 10))}
            className="timeline-panel__range-input timeline-panel__range-input--start"
            aria-label="起始帧"
          />
          <input
            type="range"
            min={0}
            max={max}
            value={rangeEnd}
            onChange={(event) => handleRangeChange('end', parseInt(event.target.value, 10))}
            className="timeline-panel__range-input timeline-panel__range-input--end"
            aria-label="结束帧"
          />
        </div>
        <div className="timeline-panel__scale">
          <span>{formatNumber(startFrameIndex)}</span>
          <span>{formatNumber(endFrameIndex)}</span>
        </div>
        <div className="timeline-panel__stats">
          <div>
            <span className="timeline-panel__stats-label">平均 FPS</span>
            <span className="timeline-panel__stats-value">{averageFps ? averageFps.toFixed(1) : '-'}</span>
          </div>
          {hasFpsData && (
            <div>
              <span className="timeline-panel__stats-label">峰值 FPS</span>
              <span className="timeline-panel__stats-value">{fpsMax.toFixed(1)}</span>
            </div>
          )}
        </div>
      </div>

      {currentEntry && (
        <div className="timeline-panel__details">
          <div className="timeline-panel__details-grid">
            <div>
              <span className="timeline-panel__details-label">帧序号</span>
              <span className="timeline-panel__details-value">{formatNumber(currentEntry.frameIndex)}</span>
            </div>
            <div>
              <span className="timeline-panel__details-label">资源内存</span>
              <span className="timeline-panel__details-value">{formatMemoryFromKB(currentEntry.totalKB)}</span>
            </div>
            <div>
              <span className="timeline-panel__details-label">资源数量</span>
              <span className="timeline-panel__details-value">{formatNumber(currentEntry.totalCount)}</span>
            </div>
            <div>
              <span className="timeline-panel__details-label">FPS</span>
              <span className="timeline-panel__details-value">{currentEntry.fps ? currentEntry.fps.toFixed(1) : '-'}</span>
            </div>
            <div>
              <span className="timeline-panel__details-label">平均 FPS</span>
              <span className="timeline-panel__details-value">{averageFps ? averageFps.toFixed(1) : '-'}</span>
            </div>
          </div>
          <ul className="timeline-panel__details-list">
            {currentStats.map((stat) => (
              <li key={stat.category}>
                <span>{stat.category}</span>
                <span>{formatMemoryFromKB(stat.sizeKB)}</span>
                <span>{formatNumber(stat.count)} 个</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default Timeline;