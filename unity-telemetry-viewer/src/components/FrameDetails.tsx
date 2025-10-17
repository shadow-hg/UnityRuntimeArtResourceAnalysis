import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

type SortDirection = 'asc' | 'desc';
type SortValueType = 'number' | 'string';

type SortContext = {
  getSummary: (resource: any) => ResourceSummary;
  getMaterialSummary: (resource: any) => ReturnType<typeof buildMaterialSummary>;
};

type ResourceSortOption = {
  id: string;
  label: string;
  direction: SortDirection;
  valueType: SortValueType;
  getValue: (resource: any, context: SortContext) => number | string | null | undefined;
};

function pickPositiveNumber(...values: any[]): number | null {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      return num;
    }
  }
  return null;
}

function parseDimensionString(dimensions: string | null | undefined) {
  if (!dimensions) return null;
  const normalised = dimensions.replace(/[×xX]/g, 'x');
  const parts = normalised.match(/(\d+)/g);
  if (!parts || parts.length < 2) return null;
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  const depth = parts[2] ? Number(parts[2]) : 1;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  const safeDepth = Number.isFinite(depth) && depth > 0 ? depth : 1;
  return { width, height, depth: safeDepth };
}

function computeTexturePixelCount(resource: any, summary: ResourceSummary): number {
  const width =
    pickPositiveNumber(
      resource?.width,
      resource?.textureWidth,
      resource?.pixelWidth,
      resource?.resolution?.width,
      resource?.size?.width,
      resource?.dimensions?.width
    ) ?? null;
  const height =
    pickPositiveNumber(
      resource?.height,
      resource?.textureHeight,
      resource?.pixelHeight,
      resource?.resolution?.height,
      resource?.size?.height,
      resource?.dimensions?.height
    ) ?? null;
  const depth =
    pickPositiveNumber(
      resource?.depth,
      resource?.textureDepth,
      resource?.pixelDepth,
      resource?.resolution?.depth,
      resource?.size?.depth,
      resource?.dimensions?.depth
    ) ?? 1;

  if (width && height) {
    return width * height * (depth || 1);
  }

  const parsed = parseDimensionString(summary.dimensions);
  if (parsed) {
    return parsed.width * parsed.height * parsed.depth;
  }

  return 0;
}

function getShaderPassCount(resource: any): number {
  if (typeof resource?.passCount === 'number') {
    return resource.passCount;
  }
  if (Array.isArray(resource?.passes)) {
    return resource.passes.length;
  }
  if (Array.isArray(resource?.subShaders)) {
    return resource.subShaders.reduce((sum: number, subShader: any) => {
      if (Array.isArray(subShader?.passes)) {
        return sum + subShader.passes.length;
      }
      if (typeof subShader?.passCount === 'number') {
        return sum + subShader.passCount;
      }
      return sum;
    }, 0);
  }
  const numeric = Number(resource?.passes ?? resource?.pass);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getShaderVariantCount(resource: any): number {
  if (typeof resource?.variantCount === 'number') {
    return resource.variantCount;
  }
  if (Array.isArray(resource?.variants)) {
    return resource.variants.length;
  }
  if (Array.isArray(resource?.variantCollection)) {
    return resource.variantCollection.length;
  }
  return 0;
}

function getShaderKeywordCount(resource: any, context: SortContext): number {
  if (typeof resource?.keywordCount === 'number') {
    return resource.keywordCount;
  }
  if (Array.isArray(resource?.keywords)) {
    return resource.keywords.filter(Boolean).length;
  }
  const summary = context.getSummary(resource);
  return summary.keywords.length;
}

function resolveSelectedSortId(options: ResourceSortOption[], preferredSortId?: string) {
  if (!options.length) return undefined;
  if (preferredSortId && options.some((option) => option.id === preferredSortId)) {
    return preferredSortId;
  }
  return options[0]?.id;
}

function compareSortValues(option: ResourceSortOption, aValue: any, bValue: any): number {
  const direction = option.direction === 'asc' ? 1 : -1;
  if (option.valueType === 'string') {
    const normalise = (value: any) => {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.toLowerCase();
      }
      return option.direction === 'asc' ? '\uffff' : '';
    };
    const aStr = normalise(aValue);
    const bStr = normalise(bValue);
    if (aStr === bStr) return 0;
    return aStr.localeCompare(bStr, 'zh-Hans-CN') * direction;
  }

  const normaliseNumber = (value: any) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    return option.direction === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  };

  const aNum = normaliseNumber(aValue);
  const bNum = normaliseNumber(bValue);
  if (aNum === bNum) return 0;
  return (aNum - bNum) * direction;
}

function createComparator(
  options: ResourceSortOption[],
  selectedSortId: string | undefined,
  context: SortContext
) {
  if (!options.length) {
    return () => 0;
  }
  const selectedOption =
    (selectedSortId ? options.find((option) => option.id === selectedSortId) : undefined) || options[0];
  const nameOption = options.find((option) => option.id === 'name');

  return (a: any, b: any) => {
    const aValue = selectedOption.getValue(a, context);
    const bValue = selectedOption.getValue(b, context);
    const primary = compareSortValues(selectedOption, aValue, bValue);
    if (primary !== 0) return primary;

    if (nameOption && nameOption !== selectedOption) {
      const nameComparison = compareSortValues(
        nameOption,
        nameOption.getValue(a, context),
        nameOption.getValue(b, context)
      );
      if (nameComparison !== 0) return nameComparison;
    }

    const aName = String(a?.name ?? a?.id ?? '');
    const bName = String(b?.name ?? b?.id ?? '');
    return aName.localeCompare(bName, 'zh-Hans-CN');
  };
}

function hasSortData(option: ResourceSortOption, resources: any[], context: SortContext) {
  if (!resources.length) return false;
  if (option.id === 'memory' || option.id === 'name') return true;
  return resources.some((resource) => {
    const value = option.getValue(resource, context);
    if (option.valueType === 'number') {
      const num = Number(value);
      return Number.isFinite(num);
    }
    if (option.valueType === 'string') {
      return typeof value === 'string' && value.trim().length > 0;
    }
    return false;
  });
}

function buildResourceSortOptions(
  category: string,
  resources: any[],
  context: SortContext
): ResourceSortOption[] {
  if (!resources || resources.length === 0) {
    return [];
  }

  const options: ResourceSortOption[] = [
    {
      id: 'memory',
      label: '内存占用（大→小）',
      direction: 'desc',
      valueType: 'number',
      getValue: (resource: any) => getDisplayMemoryKB(resource, context.getSummary(resource))
    }
  ];

  const categoryKey = (category || '').toLowerCase();
  const isTextureGroup =
    isTextureCategory(category) ||
    categoryKey.includes('texture') ||
    categoryKey.includes('贴图') ||
    categoryKey.includes('sprite');

  if (isTextureGroup) {
    options.push(
      {
        id: 'texture-resolution',
        label: '分辨率（大→小）',
        direction: 'desc',
        valueType: 'number',
        getValue: (resource: any) => computeTexturePixelCount(resource, context.getSummary(resource))
      },
      {
        id: 'texture-mip-count',
        label: 'MIP 数（多→少）',
        direction: 'desc',
        valueType: 'number',
        getValue: (resource: any) =>
          Number(
            resource?.mipCount ??
              resource?.mipmapCount ??
              resource?.mipmapLevels ??
              resource?.mipmapLevel ??
              0
          )
      }
    );
  }

  const isShaderGroup = categoryKey.includes('shader') || categoryKey.includes('着色');
  if (isShaderGroup) {
    options.push(
      {
        id: 'shader-pass-count',
        label: 'Pass 数（多→少）',
        direction: 'desc',
        valueType: 'number',
        getValue: (resource: any) => getShaderPassCount(resource)
      },
      {
        id: 'shader-keyword-count',
        label: '关键字数量（多→少）',
        direction: 'desc',
        valueType: 'number',
        getValue: (resource: any) => getShaderKeywordCount(resource, context)
      },
      {
        id: 'shader-variant-count',
        label: '变体数量（多→少）',
        direction: 'desc',
        valueType: 'number',
        getValue: (resource: any) => getShaderVariantCount(resource)
      }
    );
  }

  const isMaterialGroup = categoryKey.includes('material') || categoryKey.includes('材质');
  if (isMaterialGroup) {
    options.push(
      {
        id: 'material-texture-count',
        label: '引用纹理（多→少）',
        direction: 'desc',
        valueType: 'number',
        getValue: (resource: any) => context.getMaterialSummary(resource).textureCount
      },
      {
        id: 'material-render-queue',
        label: '渲染队列（低→高）',
        direction: 'asc',
        valueType: 'number',
        getValue: (resource: any) =>
          Number(resource?.renderQueue ?? resource?.queue ?? resource?.renderqueue ?? 0)
      }
    );
  }

  const isMeshGroup = categoryKey.includes('mesh') || categoryKey.includes('网格') || categoryKey.includes('模型');
  if (isMeshGroup) {
    options.push(
      {
        id: 'mesh-triangle-count',
        label: '三角形数（多→少）',
        direction: 'desc',
        valueType: 'number',
        getValue: (resource: any) => Number(resource?.triangleCount ?? resource?.triangles ?? resource?.triCount ?? 0)
      },
      {
        id: 'mesh-vertex-count',
        label: '顶点数（多→少）',
        direction: 'desc',
        valueType: 'number',
        getValue: (resource: any) => Number(resource?.vertexCount ?? resource?.vertices ?? 0)
      },
      {
        id: 'mesh-submesh-count',
        label: '子网格数（多→少）',
        direction: 'desc',
        valueType: 'number',
        getValue: (resource: any) =>
          Number(
            resource?.subMeshCount ??
              resource?.submeshCount ??
              (Array.isArray(resource?.subMeshes) ? resource.subMeshes.length : 0) ??
              (Array.isArray(resource?.submeshes) ? resource.submeshes.length : 0)
          )
      }
    );
  }

  const isAnimationGroup = categoryKey.includes('animation') || categoryKey.includes('anim') || categoryKey.includes('动画');
  if (isAnimationGroup) {
    options.push(
      {
        id: 'animation-length',
        label: '时长（长→短）',
        direction: 'desc',
        valueType: 'number',
        getValue: (resource: any) => Number(resource?.length ?? resource?.duration ?? 0)
      },
      {
        id: 'animation-frame-rate',
        label: '帧率（高→低）',
        direction: 'desc',
        valueType: 'number',
        getValue: (resource: any) => Number(resource?.frameRate ?? resource?.fps ?? 0)
      }
    );
  }

  const isAudioGroup = categoryKey.includes('audio') || categoryKey.includes('sound') || categoryKey.includes('声音');
  if (isAudioGroup) {
    options.push(
      {
        id: 'audio-length',
        label: '时长（长→短）',
        direction: 'desc',
        valueType: 'number',
        getValue: (resource: any) =>
          Number(resource?.length ?? resource?.duration ?? resource?.time ?? 0)
      },
      {
        id: 'audio-sample-rate',
        label: '采样率（高→低）',
        direction: 'desc',
        valueType: 'number',
        getValue: (resource: any) => Number(resource?.sampleRate ?? resource?.frequency ?? resource?.hz ?? 0)
      },
      {
        id: 'audio-channels',
        label: '声道数（多→少）',
        direction: 'desc',
        valueType: 'number',
        getValue: (resource: any) => Number(resource?.channels ?? resource?.channelCount ?? 0)
      }
    );
  }

  const nameOption: ResourceSortOption = {
    id: 'name',
    label: '名称（A→Z）',
    direction: 'asc',
    valueType: 'string',
    getValue: (resource: any) => String(resource?.name ?? resource?.id ?? '')
  };

  options.push(nameOption);

  const unique = new Map<string, ResourceSortOption>();
  options.forEach((option) => {
    if (!unique.has(option.id)) {
      unique.set(option.id, option);
    }
  });

  const uniqueOptions = Array.from(unique.values());
  return uniqueOptions.filter((option) => hasSortData(option, resources, context));
}

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
  const materialSummaryCache = useMemo(
    () => new WeakMap<any, ReturnType<typeof buildMaterialSummary>>(),
    []
  );

  const getResourceSummary = useCallback(
    (resource: any): ResourceSummary => {
      if (!resource || (typeof resource !== 'object' && typeof resource !== 'function')) {
        return buildResourceSummary(resource);
      }
      let summary = summaryCache.get(resource);
      if (!summary) {
        summary = buildResourceSummary(resource);
        summaryCache.set(resource, summary);
      }
      return summary;
    },
    [summaryCache]
  );

  const getMaterialSummaryCached = useCallback(
    (resource: any) => {
      if (!resource || (typeof resource !== 'object' && typeof resource !== 'function')) {
        return buildMaterialSummary(resource);
      }
      let summary = materialSummaryCache.get(resource);
      if (!summary) {
        summary = buildMaterialSummary(resource);
        materialSummaryCache.set(resource, summary);
      }
      return summary;
    },
    [materialSummaryCache]
  );

  const sortContext = useMemo<SortContext>(
    () => ({
      getSummary: getResourceSummary,
      getMaterialSummary: getMaterialSummaryCached
    }),
    [getResourceSummary, getMaterialSummaryCached]
  );

  const getResourceSortOptions = useCallback(
    (category: string, resources: any[]) => buildResourceSortOptions(category, resources, sortContext),
    [sortContext]
  );

  const detailedResourceGroups = useMemo<ResourceGroup[]>(() => {
    if (!activeResources || activeResources.length === 0) return [];
    const groups = new Map<string, ResourceGroup>();
    for (const resource of activeResources) {
      const category = getResourceCategory(resource);
      const group = groups.get(category) || { category, count: 0, sizeKB: 0, resources: [] };
      const summary = getResourceSummary(resource);
      group.count += 1;
      group.sizeKB += getDisplayMemoryKB(resource, summary);
      group.resources.push(resource);
      groups.set(category, group);
    }
    return Array.from(groups.values()).sort((a, b) => b.sizeKB - a.sizeKB);
  }, [activeResources, getResourceSummary]);

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
  const [categorySorts, setCategorySorts] = useState<Record<string, string>>({});
  const [resourceFilter, setResourceFilter] = useState('');

  const applySortingToGroups = useCallback(
    (groups: ResourceGroup[]) => {
      return groups.map((group) => {
        if (!group.resources || group.resources.length === 0) {
          return group;
        }
        const options = getResourceSortOptions(group.category, group.resources);
        if (options.length === 0) {
          return group;
        }
        const selectedSortId = resolveSelectedSortId(options, categorySorts[group.category]);
        const comparator = createComparator(options, selectedSortId, sortContext);
        return {
          ...group,
          resources: [...group.resources].sort(comparator)
        };
      });
    },
    [categorySorts, getResourceSortOptions, sortContext]
  );

  const displayedResourceGroups = useMemo<ResourceGroup[]>(() => {
    const query = resourceFilter.trim().toLowerCase();
    const applySort = (groups: ResourceGroup[]) => applySortingToGroups(groups);

    if (!query) {
      return applySort(resourceGroups);
    }

    if (detailedResourceGroups.length > 0) {
      const filtered = detailedResourceGroups
        .map((group) => {
          const matchingResources = group.resources.filter((resource) => {
            const name = (resource.name || '').toLowerCase();
            const type = (resource.type || '').toLowerCase();
            const category = (resource.category || group.category || '').toLowerCase();
            const id = (resource.id ? String(resource.id) : '').toLowerCase();
            return (
              name.includes(query) || type.includes(query) || category.includes(query) || id.includes(query)
            );
          });

          if (matchingResources.length === 0) {
            return null;
          }

          const sizeKB = matchingResources.reduce((sum, resource) => {
            const summary = getResourceSummary(resource);
            return sum + getDisplayMemoryKB(resource, summary);
          }, 0);

          return {
            category: group.category,
            count: matchingResources.length,
            sizeKB,
            resources: matchingResources
          } as ResourceGroup;
        })
        .filter((group): group is ResourceGroup => Boolean(group));

      return applySort(filtered.sort((a, b) => b.sizeKB - a.sizeKB));
    }

    const filteredFallback = fallbackResourceStats.filter((stat) =>
      stat.category.toLowerCase().includes(query)
    );
    return applySort(filteredFallback);
  }, [
    resourceFilter,
    resourceGroups,
    detailedResourceGroups,
    fallbackResourceStats,
    applySortingToGroups,
    getResourceSummary
  ]);

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

  const displayedResourceTotalKB = useMemo(() => {
    if (!resourceFilter.trim()) {
      return resourceTotalKB;
    }

    if (detailedResourceGroups.length > 0) {
      return displayedResourceGroups.reduce((sum, stat) => sum + stat.sizeKB, 0);
    }

    return displayedResourceGroups.reduce(
      (sum, stat) => sum + (Number.isFinite(stat.sizeKB) ? stat.sizeKB : 0),
      0
    );
  }, [resourceFilter, resourceTotalKB, detailedResourceGroups, displayedResourceGroups]);

  useEffect(() => {
    setCategorySorts((prev) => {
      const next: Record<string, string> = {};
      let changed = false;

      for (const group of resourceGroups) {
        if (!group.resources || group.resources.length === 0) continue;
        const options = getResourceSortOptions(group.category, group.resources);
        if (options.length === 0) continue;
        const resolved = resolveSelectedSortId(options, prev[group.category]);
        if (resolved) {
          next[group.category] = resolved;
        }
        if (resolved !== prev[group.category]) {
          changed = true;
        }
      }

      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (!changed) {
        if (prevKeys.length !== nextKeys.length) {
          changed = true;
        } else {
          for (const key of nextKeys) {
            if (prev[key] !== next[key]) {
              changed = true;
              break;
            }
          }
        }
      }

      return changed ? next : prev;
    });
  }, [resourceGroups, getResourceSortOptions]);

  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [expandedResourceKey, setExpandedResourceKey] = useState<string | null>(null);

  useEffect(() => {
    if (!expandedCategory) return;
    if (!displayedResourceGroups.some((group) => group.category === expandedCategory)) {
      setExpandedCategory(null);
    }
  }, [expandedCategory, displayedResourceGroups]);

  useEffect(() => {
    setExpandedResourceKey(null);
  }, [expandedCategory, frame, resourceFilter]);

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
          <div className="resource-breakdown__filter">
            <input
              className="input"
              placeholder="按名称、类型、ID 或分类过滤"
              value={resourceFilter}
              onChange={(event) => setResourceFilter(event.target.value)}
            />
            {resourceFilter && (
              <button type="button" className="button button--ghost" onClick={() => setResourceFilter('')}>
                清除
              </button>
            )}
          </div>
          {displayedResourceGroups.length === 0 ? (
            <div className="empty-state">没有匹配的资源</div>
          ) : (
            <div className="resource-breakdown">
              {displayedResourceGroups.map((stat) => {
                const isExpanded = expandedCategory === stat.category;
                const resources = stat.resources ?? [];
                const percentage =
                  displayedResourceTotalKB > 0
                    ? Math.max(1.5, (stat.sizeKB / displayedResourceTotalKB) * 100)
                    : 0;
                const labelId = `resource-cat-${stat.category}`;
                const sortOptions = getResourceSortOptions(stat.category, resources);
                const resolvedSortId = resolveSelectedSortId(sortOptions, categorySorts[stat.category]);
                const showSortControl = sortOptions.length > 1;
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
                        <div className="resource-breakdown__bar-fill" style={{ width: `${percentage}%` }} />
                      </div>
                      <div className="resource-breakdown__value">{formatMemoryFromKB(stat.sizeKB)}</div>
                    </button>
                    {isExpanded && resources.length > 0 && (
                      <div className="resource-breakdown__details" id={labelId}>
                        {showSortControl && (
                          <div className="resource-breakdown__sort">
                            <label>
                              <span>排序方式</span>
                              <select
                                className="input"
                                value={resolvedSortId ?? ''}
                                onChange={(event) =>
                                  setCategorySorts((prev) => {
                                    const nextValue = event.target.value;
                                    if (prev[stat.category] === nextValue) {
                                      return prev;
                                    }
                                    return { ...prev, [stat.category]: nextValue };
                                  })
                                }
                              >
                                {sortOptions.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        )}
                        {resources.map((res, index) => {
                          const resourceKey = res.id || `${res.name || stat.category}-${index}`;
                          const summary = getResourceSummary(res);
                          const resourceCategory = getResourceCategory(res);
                          const isMaterialCategory =
                            /material|材质/i.test(stat.category) || /material|材质/i.test(resourceCategory);
                          const materialSummary = isMaterialCategory ? getMaterialSummaryCached(res) : null;
                          const isMeshCategory =
                            /mesh|网格|模型/i.test(stat.category) || /mesh|网格|模型/i.test(resourceCategory);
                          const meshSummary = isMeshCategory ? describeMesh(res) : [];
                          const isResourceExpanded = expandedResourceKey === resourceKey;
                          const displayMemory = getDisplayMemoryKB(res, summary);
                          const runtimeMemory = summary.runtimeKB || summary.originalKB;
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
                              className={`resource-breakdown__item ${
                                isResourceExpanded ? 'resource-breakdown__item--expanded' : ''
                              }`}
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
                                      {summary.originalKB > 0 &&
                                        summary.originalKB !== runtimeMemory &&
                                        summary.originalKB !== compressedMemory && (
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
                                      {res.passCount && (
                                        <div>
                                          <dt>Pass 数</dt>
                                          <dd>{formatNumber(res.passCount)}</dd>
                                        </div>
                                      )}
                                      {res.keywordCount && (
                                        <div>
                                          <dt>关键字</dt>
                                          <dd>{formatNumber(res.keywordCount)}</dd>
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
          )}
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
