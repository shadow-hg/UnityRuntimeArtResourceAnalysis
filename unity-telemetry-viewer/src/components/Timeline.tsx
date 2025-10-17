import React, { useEffect, useMemo, useState } from 'react';
import { formatMemoryFromKB, formatNumber } from '../utils/format';

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
          sizeKB: Number(stat?.sizeKB ?? 0)
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

  const max = Math.max(0, entries.length - 1);
  const clampedIndex = Math.min(localIndex, max);
  const effectiveIndex = entries.length === 0 ? -1 : (clampedIndex >= 0 ? clampedIndex : max);
  const activeIndex = hoverIndex !== null ? hoverIndex : effectiveIndex;
  const currentEntry = activeIndex >= 0 ? entries[activeIndex] : null;
  const currentStats = currentEntry ? currentEntry.stats.slice(0, 5) : [];

  const chartData = useMemo(() => {
    if (entries.length === 0) {
      return {
        totalPath: '',
        areas: [] as { category: string; path: string }[],
        points: [] as { x: number; y: number }[],
        maxValue: 0
      };
    }

    const step = entries.length > 1 ? 100 / (entries.length - 1) : 0;
    const totals = entries.map((entry) => Math.max(0, entry.totalKB));
    const base = new Array(entries.length).fill(0);

    const stackedData = topCategories.map((category) => {
      const areaPoints = entries.map((entry, idx) => {
        const value = Math.max(0, entry.statMap[category]?.sizeKB ?? 0);
        const start = base[idx];
        const end = start + value;
        base[idx] = end;
        return { idx, start, end };
      });
      return { category, areaPoints };
    });

    const chartMax = Math.max(1, ...totals, ...base);

    const points = entries.map((entry, idx) => {
      const x = idx === 0 ? 0 : step * idx;
      const y = 100 - (Math.max(0, entry.totalKB) / chartMax) * 100;
      return { x, y };
    });

    const totalPath = points
      .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(3)} ${pt.y.toFixed(3)}`)
      .join(' ');

    const areas = stackedData.map(({ category, areaPoints }) => {
      const pointsTop = areaPoints.map((pt) => {
        const x = pt.idx === 0 ? 0 : step * pt.idx;
        return { x, y: 100 - (pt.end / chartMax) * 100 };
      });
      const pointsBottom = areaPoints.map((pt) => {
        const x = pt.idx === 0 ? 0 : step * pt.idx;
        return { x, y: 100 - (pt.start / chartMax) * 100 };
      });

      const topSegment = pointsTop
        .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(3)} ${pt.y.toFixed(3)}`)
        .join(' ');
      const bottomSegment = pointsBottom
        .slice()
        .reverse()
        .map((pt, idx) => {
          const originalIdx = pointsBottom.length - 1 - idx;
          const x = originalIdx === 0 ? 0 : step * originalIdx;
          return `L ${x.toFixed(3)} ${pt.y.toFixed(3)}`;
        })
        .join(' ');

      return { category, path: `${topSegment} ${bottomSegment} Z` };
    });

    return { totalPath, areas, points, maxValue: chartMax };
  }, [entries, topCategories]);

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
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id="timeline-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(99, 102, 241, 0.45)" />
                <stop offset="100%" stopColor="rgba(14, 165, 233, 0.05)" />
              </linearGradient>
            </defs>
            <g className="timeline-panel__grid">
              {[0, 25, 50, 75, 100].map((y) => (
                <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="rgba(148, 163, 184, 0.14)" strokeWidth="0.4" />
              ))}
            </g>
            {chartData.areas.map((area) => (
              <path
                key={area.category}
                d={area.path}
                fill={categoryColors[area.category] || 'url(#timeline-fill)'}
                fillOpacity={0.18}
                stroke="none"
              />
            ))}
            <path d={chartData.totalPath} fill="none" stroke="url(#timeline-fill)" strokeWidth="2.2" />
            {chartData.points.map((pt, idx) => (
              <circle
                key={`pt-${idx}`}
                cx={pt.x}
                cy={pt.y}
                r={idx === activeIndex ? 2.8 : 1.6}
                fill="#38bdf8"
                fillOpacity={idx === activeIndex ? 1 : 0.5}
                stroke="rgba(15, 23, 42, 0.6)"
                strokeWidth={0.6}
              />
            ))}
          </svg>
            <div
              className="timeline-panel__chart-overlay"
              onMouseLeave={() => setHoverIndex(null)}
            >
            {chartData.points.map((pt, idx) => {
              const left = pt.x;
              const isActive = idx === activeIndex;
              const entry = entries[idx];
              return (
                <button
                  key={entry.index}
                  type="button"
                  className={`timeline-panel__chart-hit ${isActive ? 'timeline-panel__chart-hit--active' : ''}`}
                  style={{ left: `${left}%` }}
                  onClick={() => {
                    setLocalIndex(idx);
                    setHoverIndex(null);
                    if (onSeek) onSeek(idx);
                  }}
                  onMouseEnter={() => setHoverIndex(idx)}
                  onMouseLeave={() => setHoverIndex(null)}
                  onFocus={() => setHoverIndex(idx)}
                  onBlur={() => setHoverIndex(null)}
                  title={`#${entry.frameIndex ?? idx} · ${formatMemoryFromKB(entry.totalKB)} · ${formatNumber(entry.totalCount)} 资源`}
                >
                  <span className="sr-only">跳转到帧 {entry.frameIndex ?? idx}</span>
                </button>
              );
            })}
            </div>
            <div className="timeline-panel__chart-scale">
              <span>0</span>
              <span>{formatMemoryFromKB(chartData.maxValue)}</span>
            </div>
          </div>
        )}
      </div>

      {topCategories.length > 0 && (
        <div className="timeline-panel__legend">
          {topCategories.map((category) => (
            <div key={category} className="timeline-panel__legend-item">
              <span className="timeline-panel__legend-swatch" style={{ backgroundColor: categoryColors[category] || '#94a3b8' }} />
              <span>{category}</span>
            </div>
          ))}
        </div>
      )}

      <div className="timeline-panel__slider">
        <input
          type="range"
          min={0}
          max={max}
          value={effectiveIndex >= 0 ? effectiveIndex : 0}
          onChange={(event) => {
            const idx = parseInt(event.target.value, 10);
            setLocalIndex(idx);
            setHoverIndex(null);
            if (onSeek) onSeek(idx);
          }}
        />
        <div className="timeline-panel__scale">
          <span>0</span>
          <span>{max}</span>
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