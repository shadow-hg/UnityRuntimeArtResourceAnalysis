import React, { useEffect, useMemo, useState } from 'react';
import { formatMemoryFromKB, formatNumber } from '../utils/format';

type Props = {
  resources?: any[];
  onSelect?: (resource: any) => void;
};

const ResourcePanel: React.FC<Props> = ({ resources, onSelect }) => {
  const [filter, setFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const list = resources || [];

  const categoryStats = useMemo(() => {
    const stats: Record<string, { count: number; sizeKB: number }> = {};
    for (const resource of list) {
      const category = resource?.category || resource?.type || 'Unknown';
      const size = Number(resource?.sizeKB ?? resource?.size ?? 0);
      if (!stats[category]) stats[category] = { count: 0, sizeKB: 0 };
      stats[category].count += 1;
      if (!Number.isNaN(size)) stats[category].sizeKB += size;
    }
    return Object.entries(stats)
      .map(([name, value]) => ({ name, count: value.count, sizeKB: value.sizeKB }))
      .sort((a, b) => b.sizeKB - a.sizeKB || b.count - a.count || a.name.localeCompare(b.name));
  }, [list]);

  const filtered = useMemo(() => {
    let result = list;
    if (categoryFilter !== 'all') {
      result = result.filter((resource) => {
        const category = resource?.category || resource?.type || 'Unknown';
        return category === categoryFilter;
      });
    }
    if (!filter) return result;
    const query = filter.toLowerCase();
    return result.filter((resource) => {
      const name = (resource.name || '').toLowerCase();
      const type = (resource.type || '').toLowerCase();
      return name.includes(query) || type.includes(query);
    });
  }, [list, filter, categoryFilter]);

  const summary = useMemo(() => {
    let totalKB = 0;
    for (const resource of filtered) {
      const size = Number(resource.sizeKB ?? resource.size ?? 0);
      if (!Number.isNaN(size)) totalKB += size;
    }
    return {
      totalKB,
      totalCount: filtered.length
    };
  }, [filtered]);

  const activeCategory = categoryFilter === 'all' ? null : categoryStats.find((item) => item.name === categoryFilter) || null;

  useEffect(() => {
    if (categoryFilter !== 'all' && !categoryStats.some((item) => item.name === categoryFilter)) {
      setCategoryFilter('all');
    }
  }, [categoryFilter, categoryStats]);

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
          <span className="resource-panel__summary-label">数量</span>
          <span className="resource-panel__summary-value">{formatNumber(summary.totalCount)}</span>
        </div>
        {activeCategory && (
          <div>
            <span className="resource-panel__summary-label">{activeCategory.name}</span>
            <span className="resource-panel__summary-value">
              {formatMemoryFromKB(activeCategory.sizeKB)} · {formatNumber(activeCategory.count)}
            </span>
          </div>
        )}
      </div>
      <div className="resource-panel__categories">
        <button
          type="button"
          className={`pill ${categoryFilter === 'all' ? 'pill--active' : ''}`}
          onClick={() => setCategoryFilter('all')}
        >
          全部 · {formatNumber(list.length)}
        </button>
        {categoryStats.map((item) => (
          <button
            key={item.name}
            type="button"
            className={`pill ${categoryFilter === item.name ? 'pill--active' : ''}`}
            onClick={() => setCategoryFilter(item.name)}
          >
            {item.name} · {formatNumber(item.count)}
          </button>
        ))}
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
            const category = resource.category || resource.type || 'Unknown';
            const metrics = Array.isArray(resource.metrics) ? resource.metrics : [];
            const keywords = Array.isArray(resource.keywords) ? resource.keywords : [];

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
                    <span className="resource-card__category">{category}</span>
                    {dimensions && <span>{dimensions}</span>}
                  </div>
                  <div className="resource-card__meta">
                    <span>{size}</span>
                    {resource.format && <span>{resource.format}</span>}
                  </div>
                  {metrics.length > 0 && (
                    <div className="resource-card__metrics">
                      {metrics.slice(0, 4).map((metric: any, metricIndex: number) => (
                        <span key={`${key}-metric-${metricIndex}`} className="chip chip--muted">
                          <span className="chip__label">{metric.label}</span>
                          <span className="chip__value">{metric.value}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {keywords.length > 0 && (
                    <div className="resource-card__keywords">
                      {keywords.slice(0, 6).map((kw: string, kwIndex: number) => (
                        <span key={`${key}-kw-${kwIndex}`} className="tag">
                          {kw}
                        </span>
                      ))}
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
