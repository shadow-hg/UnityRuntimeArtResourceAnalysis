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

const Timeline: React.FC<Props> = ({ telemetryData, currentIndex = -1, onSeek }) => {
  const [localIndex, setLocalIndex] = useState<number>(currentIndex);

  useEffect(() => {
    setLocalIndex(currentIndex);
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

  const max = Math.max(0, entries.length - 1);
  const clampedIndex = Math.min(localIndex, max);
  const effectiveIndex = entries.length === 0 ? -1 : (clampedIndex >= 0 ? clampedIndex : max);
  const currentEntry = effectiveIndex >= 0 ? entries[effectiveIndex] : null;
  const currentStats = currentEntry ? currentEntry.stats.slice(0, 5) : [];

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
          <div className="timeline-panel__chart-bars">
            {entries.map((entry, idx) => {
              const isActive = idx === effectiveIndex;
              return (
                <button
                  key={entry.index}
                  type="button"
                  className={`timeline-panel__bar ${isActive ? 'timeline-panel__bar--active' : ''}`}
                  onClick={() => {
                    setLocalIndex(idx);
                    if (onSeek) onSeek(idx);
                  }}
                  title={`#${entry.frameIndex ?? idx} · ${formatMemoryFromKB(entry.totalKB)} · ${formatNumber(entry.totalCount)} 资源`}
                >
                  <div className="timeline-panel__bar-stack">
                    {categories.map((category) => {
                      const stat = entry.statMap[category];
                      if (!stat || stat.sizeKB <= 0) return null;
                      const weight = Math.max(0.0001, stat.sizeKB);
                      return (
                        <span
                          key={category}
                          className="timeline-panel__segment"
                          style={{ flexGrow: weight, minHeight: stat.sizeKB > 0 ? 4 : 0, backgroundColor: categoryColors[category] || '#94a3b8' }}
                          title={`${category}: ${formatMemoryFromKB(stat.sizeKB)} · ${formatNumber(stat.count)} 个`}
                        />
                      );
                    })}
                  </div>
                  <div className="timeline-panel__bar-meta">
                    <span className="timeline-panel__bar-index">{typeof entry.frameIndex === 'number' ? `#${entry.frameIndex}` : `#${idx}`}</span>
                    <span className="timeline-panel__bar-value">{formatMemoryFromKB(entry.totalKB)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {categories.length > 0 && (
        <div className="timeline-panel__legend">
          {categories.map((category) => (
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