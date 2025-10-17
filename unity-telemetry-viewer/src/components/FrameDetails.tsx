import React, { useEffect, useMemo, useState } from 'react';
import { formatMemoryFromKB, formatNumber, formatSeconds, formatTimestamp } from '../utils/format';
import {
  buildMaterialSummary,
  buildResourceSummary,
  describeMesh,
  getDisplayMemoryKB,
  getResourceCategory,
  getStatDisplaySizeKB,
  isTextureCategory,
  ResourceSummary
} from '../utils/resourceMetadata';
import { collectActiveFrameResources } from '../utils/frameResources';

type Props = {
  frame: any | null;
  resourceCatalog?: Record<string, any> | undefined;
  onRequestFullscreen?: () => void;
  isFullscreen?: boolean;
};

type ResourceGroup = {
  category: string;
  count: number;
  sizeKB: number;
  resources: any[];
};

const FrameDetails: React.FC<Props> = ({ frame, resourceCatalog, onRequestFullscreen, isFullscreen }) => {
  if (!frame) {
    return (
      <div className={`panel frame-details ${isFullscreen ? 'frame-details--fullscreen' : ''}`}>
        <div className="panel-header">
          <div className="panel-title">帧洞察</div>
          {onRequestFullscreen && (
            <div className="panel-header__actions">
              <button type="button" className="panel-button" onClick={onRequestFullscreen}>
                {isFullscreen ? '退出全屏' : '全屏查看'}
              </button>
            </div>
          )}
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

  const activeResources = useMemo(
    () => collectActiveFrameResources(frame, resourceCatalog),
    [frame, resourceCatalog]
  );

  const summaryCache = useMemo(() => new WeakMap<any, ResourceSummary>(), []);

  const detailedResourceGroups = useMemo<ResourceGroup[]>(() => {
    if (!activeResources || activeResources.length === 0) return [];
    const groups = new Map<string, ResourceGroup>();
    for (const resource of activeResources) {
      const category = getResourceCategory(resource);
      const group = groups.get(category) || { category, count: 0, sizeKB: 0, resources: [] };
      const summary = summaryCache.get(resource) || buildResourceSummary(resource);
      if (!summaryCache.has(resource)) {
        summaryCache.set(resource, summary);
      }
      group.count += 1;
      group.sizeKB += getDisplayMemoryKB(resource, summary);
      group.resources.push(resource);
      groups.set(category, group);
    }
    return Array.from(groups.values()).sort((a, b) => b.sizeKB - a.sizeKB);
  }, [activeResources, summaryCache]);

  const fallbackResourceStats = useMemo(() => {
    if (!Array.isArray(frame.resourceStats)) return [] as ResourceGroup[];
    return (frame.resourceStats as any[])
      .map((stat) => ({
        category: stat?.category || '未分类',
        count: Number(stat?.count ?? 0),
        sizeKB: getStatDisplaySizeKB(stat),
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
  const [expandedResourceKey, setExpandedResourceKey] = useState<string | null>(null);

  useEffect(() => {
    if (!expandedCategory) return;
    if (!resourceGroups.some((group) => group.category === expandedCategory)) {
      setExpandedCategory(null);
    }
  }, [expandedCategory, resourceGroups]);

  useEffect(() => {
    setExpandedResourceKey(null);
  }, [expandedCategory, frame]);

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
    <div className={`panel frame-details ${isFullscreen ? 'frame-details--fullscreen' : ''}`}>
      <div className="panel-header">
        <div className="panel-title">帧洞察</div>
        {onRequestFullscreen && (
          <div className="panel-header__actions">
            <button type="button" className="panel-button" onClick={onRequestFullscreen}>
              {isFullscreen ? '退出全屏' : '全屏查看'}
            </button>
          </div>
        )}
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
                    onClick={() => {
                      setExpandedCategory(isExpanded ? null : stat.category);
                      setExpandedResourceKey(null);
                    }}
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
                      {stat.resources.map((res, index) => {
                        const resourceKey = res.id || `${res.name || stat.category}-${index}`;
                        const summary = summaryCache.get(res) || buildResourceSummary(res);
                        if (!summaryCache.has(res)) {
                          summaryCache.set(res, summary);
                        }
                        const materialSummary = stat.category === 'Material' ? buildMaterialSummary(res) : null;
                        const isResourceExpanded = expandedResourceKey === resourceKey;
                        const displayMemory = getDisplayMemoryKB(res, summary);
                        const runtimeMemory = summary.runtimeKB || summary.originalKB;
                        const meshSummary = stat.category === 'Mesh' ? describeMesh(res) : [];
                        const resourceCategory = getResourceCategory(res);
                        const isTextureResource =
                          isTextureCategory(resourceCategory) || (!resourceCategory && isTextureCategory(stat.category));
                        const compressedMemory = summary.compressedKB;
                        const showCompressed = isTextureResource && compressedMemory > 0;
                        const showCompressedSummary = showCompressed && compressedMemory !== displayMemory;
                        const infoChips = new Set<string>();
                        if (res.shader) infoChips.add(res.shader);
                        if (res.renderQueue) infoChips.add(`队列 ${res.renderQueue}`);
                        if (res.passCount) infoChips.add(`Pass ${formatNumber(res.passCount)}`);
                        if (res.dimension) infoChips.add(res.dimension);
                        if (res.colorSpace) infoChips.add(res.colorSpace);
                        if (res.mipCount) infoChips.add(`MIP×${formatNumber(res.mipCount)}`);
                        if (res.antiAliasing) infoChips.add(`MSAA×${formatNumber(res.antiAliasing)}`);
                        if (res.isReadable === false) infoChips.add('不可读');
                        if (res.compression) infoChips.add(res.compression);
                        meshSummary.forEach((chip) => infoChips.add(chip));
                        const chips = Array.from(infoChips).filter(Boolean);

                        return (
                          <div
                            key={resourceKey}
                            className={`resource-breakdown__item ${isResourceExpanded ? 'resource-breakdown__item--expanded' : ''}`}
                          >
                            <button
                              type="button"
                              className="resource-breakdown__item-header"
                              onClick={() => setExpandedResourceKey(isResourceExpanded ? null : resourceKey)}
                              aria-expanded={isResourceExpanded}
                            >
                              <div className="resource-breakdown__item-main">
                                <div className="resource-breakdown__item-title">{res.name || res.id || '未命名资源'}</div>
                                <div className="resource-breakdown__item-summary">
                                  <span>{formatMemoryFromKB(displayMemory)}</span>
                                  {showCompressedSummary && <span>压缩 {formatMemoryFromKB(compressedMemory)}</span>}
                                  {summary.dimensions && <span>{summary.dimensions}</span>}
                                  {summary.format && <span>{summary.format}</span>}
                                </div>
                              </div>
                              <div className="resource-breakdown__item-badges">
                                <span className="resource-panel__badge">{resourceCategory}</span>
                                {summary.textureRefs.length > 0 && (
                                  <span className="resource-panel__tag">纹理×{formatNumber(summary.textureRefs.length)}</span>
                                )}
                                {materialSummary && materialSummary.textureCount > 0 && (
                                  <span className="resource-panel__tag">引用纹理×{formatNumber(materialSummary.textureCount)}</span>
                                )}
                              </div>
                            </button>
                            {isResourceExpanded && (
                              <div className="resource-breakdown__item-body">
                                <div className="resource-breakdown__item-preview">
                                  {summary.thumbnail ? (
                                    <img src={summary.thumbnail} alt={res.name || 'Resource'} />
                                  ) : (
                                    <div className="resource-breakdown__item-preview--empty">无缩略图</div>
                                  )}
                                </div>
                                <div className="resource-breakdown__item-info">
                                  <dl>
                                    <div>
                                      <dt>内存占用</dt>
                                      <dd>{formatMemoryFromKB(displayMemory)}</dd>
                                    </div>
                                    {showCompressed && (
                                      <div>
                                        <dt>Unity 压缩</dt>
                                        <dd>{formatMemoryFromKB(compressedMemory)}</dd>
                                      </div>
                                    )}
                                    {runtimeMemory > 0 && runtimeMemory !== displayMemory && (
                                      <div>
                                        <dt>运行时内存</dt>
                                        <dd>{formatMemoryFromKB(runtimeMemory)}</dd>
                                      </div>
                                    )}
                                    {summary.originalKB > 0 && summary.originalKB !== runtimeMemory && summary.originalKB !== compressedMemory && (
                                      <div>
                                        <dt>原始大小</dt>
                                        <dd>{formatMemoryFromKB(summary.originalKB)}</dd>
                                      </div>
                                    )}
                                    {summary.dimensions && (
                                      <div>
                                        <dt>分辨率</dt>
                                        <dd>{summary.dimensions}</dd>
                                      </div>
                                    )}
                                    {summary.format && (
                                      <div>
                                        <dt>格式</dt>
                                        <dd>{summary.format}</dd>
                                      </div>
                                    )}
                                    {res.vertexCount && (
                                      <div>
                                        <dt>顶点</dt>
                                        <dd>{formatNumber(res.vertexCount)}</dd>
                                      </div>
                                    )}
                                    {res.triangleCount && (
                                      <div>
                                        <dt>三角形</dt>
                                        <dd>{formatNumber(res.triangleCount)}</dd>
                                      </div>
                                    )}
                                    {res.mipCount && (
                                      <div>
                                        <dt>MIP 数</dt>
                                        <dd>{formatNumber(res.mipCount)}</dd>
                                      </div>
                                    )}
                                    {res.variantCount && (
                                      <div>
                                        <dt>变体</dt>
                                        <dd>{formatNumber(res.variantCount)}</dd>
                                      </div>
                                    )}
                                    {res.isReadable === false && (
                                      <div>
                                        <dt>可读性</dt>
                                        <dd>不可读</dd>
                                      </div>
                                    )}
                                    {res.notes && (
                                      <div>
                                        <dt>备注</dt>
                                        <dd>{res.notes}</dd>
                                      </div>
                                    )}
                                  </dl>
                                  {chips.length > 0 && (
                                    <div className="resource-breakdown__section">
                                      <div className="resource-breakdown__section-title">关键信息</div>
                                      <div className="resource-panel__chips">
                                        {chips.map((chip) => (
                                          <span key={chip} className="resource-panel__chip">{chip}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {summary.keywords.length > 0 && (
                                    <div className="resource-breakdown__section">
                                      <div className="resource-breakdown__section-title">关键词</div>
                                      <div className="resource-panel__chips">
                                        {summary.keywords.map((keyword: string) => (
                                          <span key={keyword} className="resource-panel__chip">{keyword}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {summary.textureRefs.length > 0 && (
                                    <div className="resource-breakdown__section">
                                      <div className="resource-breakdown__section-title">引用纹理</div>
                                      <ul className="resource-panel__texture-list">
                                        {summary.textureRefs.map((tex) => (
                                          <li key={`${tex.id || ''}-${tex.name || ''}`}>
                                            <span>{tex.name || tex.id || '纹理'}</span>
                                            {tex.id && <span className="resource-panel__tag">{tex.id}</span>}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  {materialSummary && materialSummary.textureNames.length > 0 && (
                                    <div className="resource-breakdown__section">
                                      <div className="resource-breakdown__section-title">材质引用</div>
                                      <div className="resource-panel__chips">
                                        {materialSummary.textureNames.map((name) => (
                                          <span key={name} className="resource-panel__chip">{name}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
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
