import React, { useMemo, useState } from 'react';
import { formatMemoryFromKB, formatNumber } from '../utils/format';
import {
  buildResourceSummary,
  getDisplayMemoryKB,
  getResourceCategory,
  isTextureCategory,
  ResourceSummary
} from '../utils/resourceMetadata';

type Props = {
  resources?: any[];
  onSelect?: (resource: any) => void;
  onRequestFullscreen?: () => void;
  isFullscreen?: boolean;
};

type ResourceGroup = {
  category: string;
  totalKB: number;
  count: number;
  resources: any[];
};

const ResourcePanel: React.FC<Props> = ({ resources, onSelect, onRequestFullscreen, isFullscreen }) => {
  const [filter, setFilter] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [expandedResourceIds, setExpandedResourceIds] = useState<Record<string, boolean>>({});

  const list = resources || [];

  const summaryCache = useMemo(() => new WeakMap<any, ResourceSummary>(), []);

  const filtered = useMemo(() => {
    if (!filter) return list;
    const query = filter.toLowerCase();
    return list.filter((resource) => {
      const name = (resource.name || '').toLowerCase();
      const type = (resource.type || '').toLowerCase();
      const category = (resource.category || '').toLowerCase();
      return name.includes(query) || type.includes(query) || category.includes(query);
    });
  }, [list, filter]);

  const groups = useMemo<ResourceGroup[]>(() => {
    if (filtered.length === 0) return [];
    const result = new Map<string, ResourceGroup>();
    for (const resource of filtered) {
      const category = getResourceCategory(resource);
      const existing = result.get(category) || { category, totalKB: 0, count: 0, resources: [] };
      const summaryInfo = summaryCache.get(resource) || buildResourceSummary(resource);
      if (!summaryCache.has(resource)) {
        summaryCache.set(resource, summaryInfo);
      }
      existing.totalKB += getDisplayMemoryKB(resource, summaryInfo);
      existing.count += 1;
      existing.resources.push(resource);
      result.set(category, existing);
    }
    return Array.from(result.values()).sort((a, b) => b.totalKB - a.totalKB);
  }, [filtered, summaryCache]);

  const summary = useMemo(() => {
    let totalKB = 0;
    const typeCount: Record<string, number> = {};
    for (const resource of filtered) {
      const summaryInfo = summaryCache.get(resource) || buildResourceSummary(resource);
      if (!summaryCache.has(resource)) {
        summaryCache.set(resource, summaryInfo);
      }
      totalKB += getDisplayMemoryKB(resource, summaryInfo);
      const type = getResourceCategory(resource);
      typeCount[type] = (typeCount[type] || 0) + 1;
    }
    const topTypes = Object.entries(typeCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    return {
      totalKB,
      topTypes
    };
  }, [filtered]);

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  const toggleResource = (key: string) => {
    setExpandedResourceIds((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const isCategoryExpanded = (category: string) => {
    if (expandedCategories[category] !== undefined) return expandedCategories[category];
    return true;
  };

  return (
    <div className={`panel resource-panel ${isFullscreen ? 'resource-panel--fullscreen' : ''}`}>
      <div className="panel-header">
        <div className="panel-title">资源目录</div>
        <div className="panel-header__actions">
          <div className="badge">{filtered.length}</div>
          {onRequestFullscreen && (
            <button type="button" className="panel-button" onClick={onRequestFullscreen}>
              {isFullscreen ? '退出全屏' : '全屏查看'}
            </button>
          )}
        </div>
      </div>
      <div className="resource-panel__summary">
        <div>
          <span className="resource-panel__summary-label">占用</span>
          <span className="resource-panel__summary-value">{formatMemoryFromKB(summary.totalKB)}</span>
        </div>
        <div>
          <span className="resource-panel__summary-label">类型</span>
          <span className="resource-panel__summary-value">
            {summary.topTypes.length === 0
              ? '-'
              : summary.topTypes.map(([type, count]) => `${type}×${formatNumber(count)}`).join(' · ')}
          </span>
        </div>
      </div>
      <div className="form">
        <input
          className="input"
          placeholder="按名称、类型或分类过滤"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      <div className="resource-panel__groups">
        {filtered.length === 0 ? (
          <div className="empty-state">没有匹配的资源</div>
        ) : (
          groups.map((group) => {
            const expanded = isCategoryExpanded(group.category);
            return (
              <div key={group.category} className={`resource-panel__group ${expanded ? 'resource-panel__group--expanded' : ''}`}>
                <button
                  type="button"
                  className="resource-panel__group-header"
                  onClick={() => toggleCategory(group.category)}
                  aria-expanded={expanded}
                >
                  <div className="resource-panel__group-info">
                    <span className="resource-panel__group-title">{group.category}</span>
                    <span className="resource-panel__group-count">{formatNumber(group.count)} 个</span>
                  </div>
                  <span className="resource-panel__group-size">{formatMemoryFromKB(group.totalKB)}</span>
                </button>
                {expanded && (
                  <div className="resource-panel__items">
                    {group.resources.map((resource) => {
                      const key = resource.id || `${resource.name || 'resource'}-${resource.type || 'unknown'}`;
                      const summaryInfo = summaryCache.get(resource) || buildResourceSummary(resource);
                      if (!summaryCache.has(resource)) {
                        summaryCache.set(resource, summaryInfo);
                      }
                      const isExpanded = !!expandedResourceIds[key];
                      const textureCount = summaryInfo.textureRefs.length;
                      const keywordPreview = summaryInfo.keywords.slice(0, 6);
                      const category = getResourceCategory(resource);
                      const displayMemoryKB = getDisplayMemoryKB(resource, summaryInfo);
                      const compressedMemoryKB = summaryInfo.compressedKB;
                      const hasCompressedValue = compressedMemoryKB > 0;
                      const showCompressed = isTextureCategory(category) && hasCompressedValue;
                      const showCompressedMeta = showCompressed && compressedMemoryKB !== displayMemoryKB;
                      const runtimeMemoryKB = summaryInfo.runtimeKB || summaryInfo.originalKB;
                      const showRuntimeDetail = runtimeMemoryKB > 0 && runtimeMemoryKB !== displayMemoryKB;
                      const showOriginalFallback =
                        !showCompressed &&
                        summaryInfo.originalKB > 0 &&
                        summaryInfo.runtimeKB > 0 &&
                        summaryInfo.runtimeKB !== summaryInfo.originalKB;
                      const resourceId =
                        resource.id && resource.id !== resource.name ? String(resource.id) : null;

                      const collapsedMetrics: { key: string; label: string; value: string }[] = [
                        { key: 'memory', label: '内存', value: formatMemoryFromKB(displayMemoryKB) }
                      ];

                      if (showCompressedMeta) {
                        collapsedMetrics.push({
                          key: 'compressed',
                          label: '压缩',
                          value: formatMemoryFromKB(compressedMemoryKB)
                        });
                      } else if (showOriginalFallback) {
                        collapsedMetrics.push({
                          key: 'original',
                          label: '原始',
                          value: formatMemoryFromKB(summaryInfo.originalKB)
                        });
                      }

                      if (showRuntimeDetail) {
                        collapsedMetrics.push({
                          key: 'runtime',
                          label: '运行时',
                          value: formatMemoryFromKB(runtimeMemoryKB)
                        });
                      }

                      if (summaryInfo.dimensions) {
                        collapsedMetrics.push({
                          key: 'dimensions',
                          label: '分辨率',
                          value: summaryInfo.dimensions
                        });
                      }

                      if (summaryInfo.format) {
                        collapsedMetrics.push({
                          key: 'format',
                          label: '格式',
                          value: summaryInfo.format
                        });
                      }

                      return (
                        <div key={key} className={`resource-panel__item ${isExpanded ? 'resource-panel__item--expanded' : ''}`}>
                          <button
                            type="button"
                            className="resource-panel__item-toggle"
                            onClick={() => toggleResource(key)}
                            aria-expanded={isExpanded}
                          >
                            <div className="resource-panel__item-header">
                              <div className="resource-panel__item-primary">
                                <div className="resource-panel__item-title">{resource.name || resource.id || '未命名资源'}</div>
                                {resourceId && <div className="resource-panel__item-subtitle">{resourceId}</div>}
                                <div className="resource-panel__item-tags">
                                  <span className="resource-panel__badge">{category}</span>
                                  {resource.type && resource.type !== category && (
                                    <span className="resource-panel__tag">{resource.type}</span>
                                  )}
                                  {textureCount > 0 && <span className="resource-panel__tag">纹理×{formatNumber(textureCount)}</span>}
                                  {Array.isArray(resource.variants) && resource.variants.length > 0 && (
                                    <span className="resource-panel__tag">变体×{formatNumber(resource.variants.length)}</span>
                                  )}
                                </div>
                              </div>
                              {collapsedMetrics.length > 0 && (
                                <div className="resource-panel__item-metrics">
                                  {collapsedMetrics.map((metric) => (
                                    <div key={`${key}-${metric.key}`} className="resource-panel__metric">
                                      <span className="resource-panel__metric-label">{metric.label}</span>
                                      <span className="resource-panel__metric-value">{metric.value}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            {keywordPreview.length > 0 && (
                              <div className="resource-panel__item-keywords">
                                {keywordPreview.map((keyword) => (
                                  <span key={keyword} className="resource-panel__chip">{keyword}</span>
                                ))}
                              </div>
                            )}
                          </button>
                          {isExpanded && (
                            <div className="resource-panel__item-details">
                              <div className="resource-panel__item-columns">
                                <div className="resource-panel__item-preview">
                                  {summaryInfo.thumbnail ? (
                                    <img src={summaryInfo.thumbnail} alt={resource.name || 'Resource'} />
                                  ) : (
                                    <div className="resource-panel__item-preview--empty">无缩略图</div>
                                  )}
                                </div>
                                <div className="resource-panel__item-info">
                                  <dl>
                                    <div>
                                      <dt>内存占用</dt>
                                      <dd>{formatMemoryFromKB(displayMemoryKB)}</dd>
                                    </div>
                                    {showCompressed && (
                                      <div>
                                        <dt>Unity 压缩</dt>
                                        <dd>{formatMemoryFromKB(compressedMemoryKB)}</dd>
                                      </div>
                                    )}
                                    {showRuntimeDetail && (
                                      <div>
                                        <dt>运行时内存</dt>
                                        <dd>{formatMemoryFromKB(runtimeMemoryKB)}</dd>
                                      </div>
                                    )}
                                    {(!showCompressed && summaryInfo.originalKB > 0 && summaryInfo.runtimeKB > 0 && summaryInfo.runtimeKB !== summaryInfo.originalKB) && (
                                      <div>
                                        <dt>原始大小</dt>
                                        <dd>{formatMemoryFromKB(summaryInfo.originalKB)}</dd>
                                      </div>
                                    )}
                                    {showCompressed && summaryInfo.originalKB > 0 && compressedMemoryKB !== summaryInfo.originalKB && (
                                      <div>
                                        <dt>原始大小</dt>
                                        <dd>{formatMemoryFromKB(summaryInfo.originalKB)}</dd>
                                      </div>
                                    )}
                                    {summaryInfo.dimensions && (
                                      <div>
                                        <dt>分辨率</dt>
                                        <dd>{summaryInfo.dimensions}</dd>
                                      </div>
                                    )}
                                    {summaryInfo.format && (
                                      <div>
                                        <dt>格式</dt>
                                        <dd>{summaryInfo.format}</dd>
                                      </div>
                                    )}
                                    {resource.mipCount && (
                                      <div>
                                        <dt>MIP 数</dt>
                                        <dd>{formatNumber(resource.mipCount)}</dd>
                                      </div>
                                    )}
                                    {resource.vertexCount && (
                                      <div>
                                        <dt>顶点</dt>
                                        <dd>{formatNumber(resource.vertexCount)}</dd>
                                      </div>
                                    )}
                                    {resource.triangleCount && (
                                      <div>
                                        <dt>三角形</dt>
                                        <dd>{formatNumber(resource.triangleCount)}</dd>
                                      </div>
                                    )}
                                    {resource.passCount && (
                                      <div>
                                        <dt>Pass</dt>
                                        <dd>{formatNumber(resource.passCount)}</dd>
                                      </div>
                                    )}
                                    {resource.renderQueue && (
                                      <div>
                                        <dt>渲染队列</dt>
                                        <dd>{resource.renderQueue}</dd>
                                      </div>
                                    )}
                                    {resource.isReadable === false && (
                                      <div>
                                        <dt>可读性</dt>
                                        <dd>不可读</dd>
                                      </div>
                                    )}
                                    {resource.notes && (
                                      <div>
                                        <dt>备注</dt>
                                        <dd>{resource.notes}</dd>
                                      </div>
                                    )}
                                  </dl>
                                  {summaryInfo.keywords.length > 0 && (
                                    <div className="resource-panel__item-section">
                                      <div className="resource-panel__item-section-title">关键词</div>
                                      <div className="resource-panel__chips">
                                        {summaryInfo.keywords.map((keyword: string) => (
                                          <span key={keyword} className="resource-panel__chip">{keyword}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {summaryInfo.textureRefs.length > 0 && (
                                    <div className="resource-panel__item-section">
                                      <div className="resource-panel__item-section-title">引用纹理</div>
                                      <ul className="resource-panel__texture-list">
                                        {summaryInfo.textureRefs.map((tex) => (
                                          <li key={`${tex.id || ''}-${tex.name || ''}`}>
                                            <span>{tex.name || tex.id || '纹理'}</span>
                                            {tex.id && <span className="resource-panel__tag">{tex.id}</span>}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  <div className="resource-panel__item-actions">
                                    {onSelect && (
                                      <button type="button" onClick={() => onSelect(resource)}>
                                        在帧中定位
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                              {resource.description && (
                                <div className="resource-panel__item-description">{resource.description}</div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ResourcePanel;
