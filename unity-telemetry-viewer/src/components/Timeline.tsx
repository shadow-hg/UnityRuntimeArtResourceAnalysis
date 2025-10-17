import React, { useEffect, useMemo, useState } from 'react';
import { Frame } from '../hooks/useTelemetry';
import { formatMemoryFromKB, formatNumber } from '../utils/format';
import { accumulateBreakdown, normalizeBreakdown, ResourceCategoryStat } from '../utils/resources';

type Props = {
  frames: Frame[];
  currentIndex?: number;
  onSeek?: (index: number) => void;
};

const PALETTE = ['#60a5fa', '#f87171', '#34d399', '#fbbf24', '#a855f7', '#38bdf8', '#f97316', '#10b981', '#c084fc', '#f472b6'];

type ChartEntry = {
  index: number;
  frameIndex: number | null;
  timestamp: number | null;
  fps: number | null;
  totalKB: number;
  totalCount: number;
  breakdown: ResourceCategoryStat[];
};

function getCategoryColor(category: string, map: Map<string, string>, palette: string[]): string {
  if (map.has(category)) return map.get(category)!;
  const color = palette[map.size % palette.length];
  map.set(category, color);
  return color;
}

const Timeline: React.FC<Props> = ({ frames, currentIndex = -1, onSeek }) => {
  const [localIndex, setLocalIndex] = useState<number>(currentIndex);

  useEffect(() => {
    setLocalIndex(currentIndex);
  }, [currentIndex]);

  const chartData = useMemo<ChartEntry[]>(() => {
    return frames.map((entry, index) => {
      const frame = entry?.frame ?? entry;
      const breakdown = normalizeBreakdown(frame?.resourceBreakdown);
      const totals = accumulateBreakdown(breakdown);
      const dt = typeof frame?.dt === 'number' ? frame.dt : null;
      const fps = typeof frame?.metrics?.fps === 'number' ? frame.metrics.fps : dt && dt > 0 ? 1 / dt : null;
      const frameIndex = typeof frame?.frameIndex === 'number' ? frame.frameIndex : Number(frame?.frameIndex) || null;
      const timestamp = typeof frame?.timestamp === 'number' ? frame.timestamp : null;
      return {
        index,
        frameIndex,
        timestamp,
        fps,
        totalKB: totals.totalKB,
        totalCount: totals.totalCount,
        breakdown
      };
    });
  }, [frames]);

  const max = Math.max(0, chartData.length - 1);
  const maxTotalKB = useMemo(() => {
    return chartData.reduce((acc, item) => Math.max(acc, item.totalKB), 0);
  }, [chartData]);

  const categoryOrder = useMemo(() => {
    const order: string[] = [];
    const seen = new Set<string>();
    chartData.forEach((data) => {
      data.breakdown.forEach((segment) => {
        if (!seen.has(segment.category)) {
          seen.add(segment.category);
          order.push(segment.category);
        }
      });
    });
    return order;
  }, [chartData]);

  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    categoryOrder.forEach((category) => {
      getCategoryColor(category, map, PALETTE);
    });
    return map;
  }, [categoryOrder]);

  const currentData = localIndex >= 0 && localIndex < chartData.length ? chartData[localIndex] : null;

  const currentBreakdown = currentData?.breakdown ?? [];
  const currentTotals = currentData ? accumulateBreakdown(currentBreakdown) : { totalKB: 0, totalCount: 0 };

  return (
    <div className="panel timeline-panel">
      <div className="panel-header">
        <div className="panel-title">帧滑轨</div>
        <div className="badge">{chartData.length}</div>
      </div>
      <div className="timeline-panel__chart">
        {chartData.map((data) => {
          const isActive = data.index === (localIndex < 0 ? chartData.length - 1 : localIndex);
          const heightRatio = maxTotalKB > 0 ? data.totalKB / maxTotalKB : data.totalCount > 0 ? 0.5 : 0.1;
          const columnHeight = Math.max(6, heightRatio * 100);
          const totalBasis = data.totalKB > 0 ? data.totalKB : data.totalCount;
          return (
            <button
              key={`${data.index}-${data.frameIndex ?? 'n'}`}
              type="button"
              className={`timeline-panel__bar ${isActive ? 'timeline-panel__bar--active' : ''}`}
              onClick={() => {
                setLocalIndex(data.index);
                if (onSeek) onSeek(data.index);
              }}
              title={`#${data.frameIndex ?? '-'} • ${formatMemoryFromKB(data.totalKB)}`}
            >
              <div className="timeline-panel__column" style={{ height: `${columnHeight}%` }}>
                {data.breakdown.length === 0 ? (
                  <span className="timeline-panel__segment timeline-panel__segment--empty" />
                ) : (
                  data.breakdown.map((segment) => {
                    const basis = totalBasis > 0 ? totalBasis : 1;
                    const value = data.totalKB > 0 ? segment.sizeKB : segment.count;
                    const percent = Math.max(4, (value / basis) * 100);
                    const color = colorMap.get(segment.category) ?? getCategoryColor(segment.category, colorMap, PALETTE);
                    return (
                      <span
                        key={`${data.index}-${segment.category}`}
                        className="timeline-panel__segment"
                        style={{ height: `${percent}%`, backgroundColor: color }}
                        title={`${segment.category}: ${formatMemoryFromKB(segment.sizeKB)} • ${formatNumber(segment.count)}`}
                      />
                    );
                  })
                )}
              </div>
            </button>
          );
        })}
      </div>
      <div className="timeline-panel__slider">
        <input
          type="range"
          min={0}
          max={max}
          value={localIndex < 0 ? max : localIndex}
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
      {categoryOrder.length > 0 && (
        <div className="timeline-panel__legend">
          {categoryOrder.map((category) => (
            <span key={category} className="timeline-panel__legend-item">
              <span
                className="timeline-panel__legend-swatch"
                style={{ backgroundColor: colorMap.get(category) ?? getCategoryColor(category, colorMap, PALETTE) }}
              />
              {category}
            </span>
          ))}
        </div>
      )}
      {currentData && (
        <div className="timeline-panel__details">
          <div className="timeline-panel__summary">
            <div>
              <span className="timeline-panel__summary-label">帧序号</span>
              <span className="timeline-panel__summary-value">{formatNumber(currentData.frameIndex)}</span>
            </div>
            <div>
              <span className="timeline-panel__summary-label">总内存</span>
              <span className="timeline-panel__summary-value">{formatMemoryFromKB(currentTotals.totalKB)}</span>
            </div>
            <div>
              <span className="timeline-panel__summary-label">资源数</span>
              <span className="timeline-panel__summary-value">{formatNumber(currentTotals.totalCount)}</span>
            </div>
            <div>
              <span className="timeline-panel__summary-label">FPS</span>
              <span className="timeline-panel__summary-value">{currentData.fps ? currentData.fps.toFixed(1) : '-'}</span>
            </div>
          </div>
          <table className="timeline-panel__table">
            <thead>
              <tr>
                <th>类型</th>
                <th>内存</th>
                <th>数量</th>
                <th>占比</th>
              </tr>
            </thead>
            <tbody>
              {currentBreakdown.length === 0 ? (
                <tr>
                  <td colSpan={4} className="timeline-panel__empty">该帧没有资源统计</td>
                </tr>
              ) : (
                currentBreakdown.map((segment) => {
                  const percent = currentTotals.totalKB > 0
                    ? (segment.sizeKB / currentTotals.totalKB) * 100
                    : currentTotals.totalCount > 0
                      ? (segment.count / currentTotals.totalCount) * 100
                      : 0;
                  return (
                    <tr key={segment.category}>
                      <td>
                        <span className="timeline-panel__legend-item">
                          <span
                            className="timeline-panel__legend-swatch"
                            style={{ backgroundColor: colorMap.get(segment.category) ?? getCategoryColor(segment.category, colorMap, PALETTE) }}
                          />
                          {segment.category}
                        </span>
                      </td>
                      <td>{formatMemoryFromKB(segment.sizeKB)}</td>
                      <td>{formatNumber(segment.count)}</td>
                      <td>{percent > 0 ? `${percent.toFixed(percent >= 10 ? 1 : 2)}%` : '-'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Timeline;