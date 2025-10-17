import React, { useMemo, useState } from 'react';
import { formatMemoryFromKB, formatNumber } from '../utils/format';

type Props = {
  resources?: any[];
  onSelect?: (resource: any) => void;
};

const ResourcePanel: React.FC<Props> = ({ resources, onSelect }) => {
  const [filter, setFilter] = useState('');
  const list = resources || [];

  const filtered = useMemo(() => {
    if (!filter) return list;
    const query = filter.toLowerCase();
    return list.filter((resource) => {
      const name = (resource.name || '').toLowerCase();
      const type = (resource.type || '').toLowerCase();
      return name.includes(query) || type.includes(query);
    });
  }, [list, filter]);

  const summary = useMemo(() => {
    let totalKB = 0;
    const typeCount: Record<string, number> = {};
    for (const resource of filtered) {
      const size = Number(resource.sizeKB ?? resource.size ?? 0);
      if (!Number.isNaN(size)) totalKB += size;
      const type = resource.type || 'Unknown';
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

  return (
    <div className="panel resource-panel">
      <div className="panel-header">
        <div className="panel-title">资源目录</div>
        <div className="badge">{filtered.length}</div>
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
          placeholder="按名称或类型过滤"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      <div className="resource-panel__list">
        {filtered.length === 0 ? (
          <div className="empty-state">没有匹配的资源</div>
        ) : (
          filtered.map((resource) => {
            const key = resource.id || `${resource.name}-${resource.type}`;
            const thumbnail = resource.thumbnailUrl || resource.thumbnail;
            const sizeValue = Number(resource.sizeKB ?? resource.size ?? 0);
            const size = formatMemoryFromKB(sizeValue);
            const dimensions = resource.width && resource.height ? `${resource.width}×${resource.height}` : null;
            const categoryLabel = resource.category || resource.type || '未知类型';
            const typeLabel = resource.type && resource.type !== categoryLabel ? resource.type : null;
            const detailList: string[] = [];

            if (categoryLabel === 'Texture' || categoryLabel === 'RenderTexture') {
              if (resource.dimension) detailList.push(resource.dimension);
              if (resource.colorSpace) detailList.push(resource.colorSpace);
              if (resource.mipCount) detailList.push(`MIP×${formatNumber(resource.mipCount)}`);
              if (resource.filterMode) detailList.push(resource.filterMode);
              if (resource.wrapMode) detailList.push(resource.wrapMode);
              if (resource.anisoLevel) detailList.push(`Aniso×${formatNumber(resource.anisoLevel)}`);
              if (resource.antiAliasing) detailList.push(`MSAA×${formatNumber(resource.antiAliasing)}`);
            } else if (categoryLabel === 'Material') {
              if (resource.shader) detailList.push(resource.shader);
              if (resource.passCount) detailList.push(`Pass ${formatNumber(resource.passCount)}`);
              if (resource.keywordCount) detailList.push(`关键词×${formatNumber(resource.keywordCount)}`);
              if (resource.renderQueue) detailList.push(`队列 ${resource.renderQueue}`);
            } else if (categoryLabel === 'Mesh') {
              if (resource.vertexCount) detailList.push(`顶点 ${formatNumber(resource.vertexCount)}`);
              if (resource.triangleCount) detailList.push(`三角形 ${formatNumber(resource.triangleCount)}`);
              if (resource.subMeshCount) detailList.push(`子网格 ${formatNumber(resource.subMeshCount)}`);
              const bounds = [resource.boundsX, resource.boundsY, resource.boundsZ]
                .map((value: number) => (typeof value === 'number' && Number.isFinite(value) ? value : null));
              if (bounds.every((value) => typeof value === 'number' && (value as number) > 0)) {
                const formatted = (bounds as number[]).map((value) => value.toFixed(1)).join('×');
                detailList.push(`包围盒 ${formatted}`);
              }
            } else if (categoryLabel === 'Shader') {
              if (resource.passCount) detailList.push(`Pass ${formatNumber(resource.passCount)}`);
              if (resource.keywordCount) detailList.push(`关键词×${formatNumber(resource.keywordCount)}`);
              if (resource.variantCount) detailList.push(`变体×${formatNumber(resource.variantCount)}`);
            } else if (categoryLabel === 'ShaderVariant') {
              if (resource.shader) detailList.push(resource.shader);
              if (resource.passCount) detailList.push(`Pass ${formatNumber(resource.passCount)}`);
              if (resource.keywordCount) detailList.push(`关键词×${formatNumber(resource.keywordCount)}`);
            }

            const detailChips = Array.from(new Set(detailList.filter(Boolean)));
            const keywords = Array.isArray(resource.keywords) ? resource.keywords.filter(Boolean) : [];
            const keywordPreview = keywords.slice(0, 4).join(', ');
            const hasMoreKeywords = keywords.length > 4;
            const usageNote = resource.notes || resource.usage;

            return (
              <button
                key={key}
                type="button"
                className="resource-card"
                onClick={() => onSelect && onSelect(resource)}
              >
                <div className="resource-card__thumb">
                  {thumbnail ? (
                    <img src={thumbnail} alt={resource.name || 'Resource'} />
                  ) : (
                    <div className="resource-card__thumb-placeholder">无缩略图</div>
                  )}
                </div>
                <div className="resource-card__body">
                  <div className="resource-card__title">{resource.name || '未命名资源'}</div>
                  <div className="resource-card__meta">
                    <span className="resource-card__badge">{categoryLabel}</span>
                    {typeLabel && <span>{typeLabel}</span>}
                  </div>
                  <div className="resource-card__meta">
                    <span>{size}</span>
                    {dimensions && <span>{dimensions}</span>}
                    {resource.format && <span>{resource.format}</span>}
                  </div>
                  {detailChips.length > 0 && (
                    <div className="resource-card__chips">
                      {detailChips.map((chip) => (
                        <span key={chip} className="resource-card__chip">{chip}</span>
                      ))}
                    </div>
                  )}
                  {keywordPreview && (
                    <div className="resource-card__note" title={keywords.join(', ')}>
                      关键词: {keywordPreview}
                      {hasMoreKeywords ? ' …' : ''}
                    </div>
                  )}
                  {usageNote && (
                    <div className="resource-card__note" title={usageNote}>
                      {usageNote}
                    </div>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ResourcePanel;
