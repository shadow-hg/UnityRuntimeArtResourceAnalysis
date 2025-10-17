import React, { useMemo } from 'react';
import { formatMemoryFromKB, formatNumber, formatSeconds, formatTimestamp } from '../utils/format';

type Props = {
  frame: any | null;
};

const FrameDetails: React.FC<Props> = ({ frame }) => {
  if (!frame) {
    return (
      <div className="panel frame-details">
        <div className="panel-header">
          <div className="panel-title">帧洞察</div>
        </div>
        <div className="empty-state">选择左侧的帧查看详细指标</div>
      </div>
    );
  }

  const fps = useMemo(() => {
    if (typeof frame.metrics?.fps === 'number') return frame.metrics.fps;
    if (typeof frame.dt === 'number' && frame.dt > 0) {
      return 1 / frame.dt;
    }
    return null;
  }, [frame]);

  const frameIndex = useMemo(() => {
    if (typeof frame.frameIndex === 'number') return frame.frameIndex;
    const parsed = Number(frame.frameIndex);
    return Number.isFinite(parsed) ? parsed : null;
  }, [frame.frameIndex]);

  const resourceStats = useMemo(() => {
    if (!Array.isArray(frame.resourceStats)) return [] as { category: string; count: number; sizeKB: number }[];
    return (frame.resourceStats as any[])
      .map((stat) => ({
        category: stat?.category || '未分类',
        count: Number(stat?.count ?? 0),
        sizeKB: Number(stat?.sizeKB ?? 0)
      }))
      .filter((stat) => Number.isFinite(stat.count) || Number.isFinite(stat.sizeKB));
  }, [frame]);

  const resourceTotalKB = useMemo(() => {
    if (typeof frame.resourceTotalKB === 'number') return frame.resourceTotalKB;
    return resourceStats.reduce((sum, stat) => sum + (Number.isFinite(stat.sizeKB) ? stat.sizeKB : 0), 0);
  }, [frame.resourceTotalKB, resourceStats]);

  const resourceCount = useMemo(() => {
    if (typeof frame.resourceCount === 'number') return frame.resourceCount;
    if (Array.isArray(frame.resources)) return frame.resources.length;
    return resourceStats.reduce((sum, stat) => sum + (Number.isFinite(stat.count) ? stat.count : 0), 0);
  }, [frame.resourceCount, frame.resources, resourceStats]);

  const topResourceStats = useMemo(() => resourceStats.slice(0, 6), [resourceStats]);

  const metricsEntries = useMemo(() => {
    if (!frame.metrics || typeof frame.metrics !== 'object') return [] as [string, any][];
    return Object.entries(frame.metrics)
      .filter(([, value]) => typeof value === 'number')
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 6);
  }, [frame]);

  const memorySummary = useMemo(() => {
    if (!frame.memory || typeof frame.memory !== 'object') return null;
    const totalKB = frame.memory.totalKB ?? frame.memory.total ?? frame.memory.totalAllocatedKB;
    const texturesKB = frame.memory.textureKB ?? frame.memory.texturesKB;
    const meshesKB = frame.memory.meshKB ?? frame.memory.meshesKB;

    if (totalKB === undefined && texturesKB === undefined && meshesKB === undefined) return null;
    return {
      total: totalKB,
      textures: texturesKB,
      meshes: meshesKB
    };
  }, [frame]);

  return (
    <div className="panel frame-details">
      <div className="panel-header">
        <div className="panel-title">帧洞察</div>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-card__label">帧序号</span>
          <span className="stat-card__value">{formatNumber(frameIndex)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__label">FPS</span>
          <span className="stat-card__value">{fps ? fps.toFixed(1) : '-'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__label">Δt</span>
          <span className="stat-card__value">{formatSeconds(frame.dt)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__label">资源引用</span>
          <span className="stat-card__value">{formatNumber(resourceCount)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__label">资源内存</span>
          <span className="stat-card__value">{formatMemoryFromKB(resourceTotalKB)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__label">场景</span>
          <span className="stat-card__value">{frame.sceneName || frame.state || '未知场景'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__label">采样时间</span>
          <span className="stat-card__value">{formatTimestamp(frame.timestamp)}</span>
        </div>
      </div>

      {memorySummary && (
        <div className="metrics-panel">
          <div className="metrics-panel__title">内存占用</div>
          <div className="metrics-panel__grid">
            <div>
              <span className="metrics-panel__label">总计</span>
              <span className="metrics-panel__value">{formatMemoryFromKB(memorySummary.total)}</span>
            </div>
            {memorySummary.textures !== undefined && (
              <div>
                <span className="metrics-panel__label">纹理</span>
                <span className="metrics-panel__value">{formatMemoryFromKB(memorySummary.textures)}</span>
              </div>
            )}
            {memorySummary.meshes !== undefined && (
              <div>
                <span className="metrics-panel__label">网格</span>
                <span className="metrics-panel__value">{formatMemoryFromKB(memorySummary.meshes)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {metricsEntries.length > 0 && (
        <div className="metrics-list">
          <div className="metrics-list__title">关键指标</div>
          <ul>
            {metricsEntries.map(([key, value]) => (
              <li key={key}>
                <span>{key}</span>
                <span>{formatNumber(value as number)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {topResourceStats.length > 0 && (
        <div className="metrics-panel">
          <div className="metrics-panel__title">资源分类</div>
          <div className="resource-breakdown">
            {topResourceStats.map((stat) => (
              <div key={stat.category} className="resource-breakdown__row">
                <div className="resource-breakdown__info">
                  <span className="resource-breakdown__category">{stat.category}</span>
                  <span className="resource-breakdown__count">{formatNumber(stat.count)} 个</span>
                </div>
                <div className="resource-breakdown__bar">
                  <div
                    className="resource-breakdown__bar-fill"
                    style={{ width: resourceTotalKB > 0 ? `${Math.max(2, (stat.sizeKB / resourceTotalKB) * 100)}%` : '0%' }}
                  />
                </div>
                <div className="resource-breakdown__value">{formatMemoryFromKB(stat.sizeKB)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {frame.device && (
        <div className="metrics-panel">
          <div className="metrics-panel__title">设备信息</div>
          <div className="metrics-panel__grid">
            {frame.device.model && (
              <div>
                <span className="metrics-panel__label">型号</span>
                <span className="metrics-panel__value">{frame.device.model}</span>
              </div>
            )}
            {frame.device.gpu && (
              <div>
                <span className="metrics-panel__label">GPU</span>
                <span className="metrics-panel__value">{frame.device.gpu}</span>
              </div>
            )}
            {frame.device.cpu && (
              <div>
                <span className="metrics-panel__label">CPU</span>
                <span className="metrics-panel__value">{frame.device.cpu}</span>
              </div>
            )}
            {frame.device.memory && (
              <div>
                <span className="metrics-panel__label">内存</span>
                <span className="metrics-panel__value">{frame.device.memory}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FrameDetails;
