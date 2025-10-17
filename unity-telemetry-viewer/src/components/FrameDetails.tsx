import React, { useEffect, useMemo, useState } from 'react';
import { formatMemoryFromKB, formatNumber, formatSeconds, formatTimestamp } from '../utils/format';

type Props = {
  frame: any | null;
  resourceCatalog?: Record<string, any> | undefined;
};

type ResourceGroup = {
  category: string;
  count: number;
  sizeKB: number;
  resources: any[];
};

function getResourceCategory(resource: any) {
  return resource?.category || resource?.type || '未分类';
}

function coerceSizeKB(value: any) {
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const FrameDetails: React.FC<Props> = ({ frame, resourceCatalog }) => {
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

  const inlineResourceMap = useMemo(() => {
    const map = new Map<string, any>();
    if (Array.isArray(frame.resourceSnapshot)) {
      for (const item of frame.resourceSnapshot) {
        if (!item || !item.id) continue;
        map.set(item.id, item);
      }
    }
    return map;
  }, [frame.resourceSnapshot]);

  const activeResources = useMemo(() => {
    const result: any[] = [];
    const seen = new Set<string>();

    if (Array.isArray(frame.resources)) {
      for (const rid of frame.resources) {
        if (typeof rid !== 'string' || seen.has(rid)) continue;
        seen.add(rid);
        const fromCatalog = resourceCatalog?.[rid];
        const fromSnapshot = inlineResourceMap.get(rid);
        if (fromCatalog || fromSnapshot) {
          result.push({ ...(fromCatalog || {}), ...(fromSnapshot || {}) });
        }
      }
    }

    // fallback: include snapshot entries without ids in the resources array
    if (result.length === 0 && inlineResourceMap.size > 0) {
      result.push(...Array.from(inlineResourceMap.values()));
    }

    return result;
  }, [frame.resources, resourceCatalog, inlineResourceMap]);

  const detailedResourceGroups = useMemo<ResourceGroup[]>(() => {
    if (!activeResources || activeResources.length === 0) return [];
    const groups = new Map<string, ResourceGroup>();
    for (const resource of activeResources) {
      const category = getResourceCategory(resource);
      const group = groups.get(category) || { category, count: 0, sizeKB: 0, resources: [] };
      group.count += 1;
      group.sizeKB += coerceSizeKB(resource.sizeKB ?? resource.size ?? 0);
      group.resources.push(resource);
      groups.set(category, group);
    }
    return Array.from(groups.values()).sort((a, b) => b.sizeKB - a.sizeKB);
  }, [activeResources]);

  const fallbackResourceStats = useMemo(() => {
    if (!Array.isArray(frame.resourceStats)) return [] as ResourceGroup[];
    return (frame.resourceStats as any[])
      .map((stat) => ({
        category: stat?.category || '未分类',
        count: Number(stat?.count ?? 0),
        sizeKB: Number(stat?.sizeKB ?? 0),
        resources: [] as any[]
      }))
      .filter((stat) => Number.isFinite(stat.count) || Number.isFinite(stat.sizeKB));
  }, [frame.resourceStats]);

  const resourceGroups = detailedResourceGroups.length > 0 ? detailedResourceGroups : fallbackResourceStats;

  const resourceTotalKB = useMemo(() => {
    if (detailedResourceGroups.length > 0) {
      return detailedResourceGroups.reduce((sum, stat) => sum + stat.sizeKB, 0);
    }
    if (typeof frame.resourceTotalKB === 'number') return frame.resourceTotalKB;
    return fallbackResourceStats.reduce((sum, stat) => sum + (Number.isFinite(stat.sizeKB) ? stat.sizeKB : 0), 0);
  }, [detailedResourceGroups, frame.resourceTotalKB, fallbackResourceStats]);

  const resourceCount = useMemo(() => {
    if (detailedResourceGroups.length > 0) {
      return detailedResourceGroups.reduce((sum, stat) => sum + stat.count, 0);
    }
    if (typeof frame.resourceCount === 'number') return frame.resourceCount;
    if (Array.isArray(frame.resources)) return frame.resources.length;
    return fallbackResourceStats.reduce((sum, stat) => sum + (Number.isFinite(stat.count) ? stat.count : 0), 0);
  }, [detailedResourceGroups, frame.resourceCount, frame.resources, fallbackResourceStats]);

  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  useEffect(() => {
    if (!expandedCategory) return;
    if (!resourceGroups.some((group) => group.category === expandedCategory)) {
      setExpandedCategory(null);
    }
  }, [expandedCategory, resourceGroups]);

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

      {resourceGroups.length > 0 && (
        <div className="metrics-panel">
          <div className="metrics-panel__title">资源分类</div>
          <div className="resource-breakdown">
            {resourceGroups.map((stat) => {
              const isExpanded = expandedCategory === stat.category;
              const percentage = resourceTotalKB > 0 ? Math.max(1.5, (stat.sizeKB / resourceTotalKB) * 100) : 0;
              const labelId = `resource-cat-${stat.category}`;
              return (
                <div key={stat.category} className="resource-breakdown__group">
                  <button
                    type="button"
                    className={`resource-breakdown__row ${isExpanded ? 'resource-breakdown__row--expanded' : ''}`}
                    onClick={() => setExpandedCategory(isExpanded ? null : stat.category)}
                    aria-expanded={isExpanded}
                    aria-controls={labelId}
                  >
                    <div className="resource-breakdown__info">
                      <span className="resource-breakdown__category">{stat.category}</span>
                      <span className="resource-breakdown__count">{formatNumber(stat.count)} 个</span>
                    </div>
                    <div className="resource-breakdown__bar">
                      <div
                        className="resource-breakdown__bar-fill"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <div className="resource-breakdown__value">{formatMemoryFromKB(stat.sizeKB)}</div>
                  </button>
                  {isExpanded && stat.resources && stat.resources.length > 0 && (
                    <div className="resource-breakdown__details" id={labelId}>
                      <table>
                        <thead>
                          <tr>
                            <th>名称</th>
                            <th>大小</th>
                            <th>信息</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stat.resources.map((res) => {
                            const dimensions = res.width && res.height ? `${res.width}×${res.height}` : null;
                            const extra: string[] = [];
                            if (res.format) extra.push(res.format);
                            if (res.mipCount) extra.push(`MIP×${formatNumber(res.mipCount)}`);
                            if (res.vertexCount) extra.push(`顶点 ${formatNumber(res.vertexCount)}`);
                            if (res.triangleCount) extra.push(`三角 ${formatNumber(res.triangleCount)}`);
                            if (res.variantCount) extra.push(`变体×${formatNumber(res.variantCount)}`);
                            if (res.isReadable === false) extra.push('不可读');
                            const info = [res.type, dimensions, extra.join(' · ')].filter(Boolean).join(' | ');
                            return (
                              <tr key={res.id || res.name}>
                                <td>{res.name || res.id || '未命名资源'}</td>
                                <td>{formatMemoryFromKB(coerceSizeKB(res.sizeKB ?? res.size ?? 0))}</td>
                                <td>{info || '-'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
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
