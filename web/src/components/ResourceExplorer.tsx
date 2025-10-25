import { CSSProperties, useEffect, useMemo, useState } from 'react';
import {
  Card,
  Collapse,
  Empty,
  Image,
  Input,
  List,
  Progress,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type {
  MaterialInfo,
  MeshInfo,
  RenderTextureInfo,
  ShaderInfo,
  ShaderVariantStats,
  ServerConfig,
  TelemetrySnapshot,
  TextureInfo,
} from '../types';
import { formatBytes, formatFps, formatInteger, formatPercentage } from '../utils/format';
import { resolvePreviewSource } from '../utils/preview';
import CollapsibleCard from './CollapsibleCard';
import CollapsibleSection from './CollapsibleSection';

interface ResourceExplorerProps {
  frame: TelemetrySnapshot | null;
  serverBaseUrl: string;
  sessionId: string | null;
  ensureTextures?: (sessionId: string, textureIds: string[]) => Promise<void>;
  serverConfig?: ServerConfig | null;
}

const hotspotGridStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
  width: '100%',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
};

const lifecycleGridStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
  width: '100%',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
};

const unityWrapModeLabels: Record<number, string> = {
  0: 'Repeat',
  1: 'Clamp',
  2: 'Mirror',
  3: 'MirrorOnce',
  4: 'PerAxis',
};

const unityFilterModeLabels: Record<number, string> = {
  0: 'Point',
  1: 'Bilinear',
  2: 'Trilinear',
};

function isRenderTextureLike(texture: TextureInfo): boolean {
  if (texture.isRenderTexture) {
    return true;
  }

  const className = texture.textureClass?.toLowerCase().trim();
  if (className && className.includes('rendertexture')) {
    return true;
  }

  return false;
}

function parseNumeric(value: string | number | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeCount(value: string | number | null | undefined): number {
  const numeric = parseNumeric(value);
  if (numeric == null) {
    return 0;
  }
  const rounded = Math.round(numeric);
  if (!Number.isFinite(rounded)) {
    return 0;
  }
  return Math.max(0, rounded);
}

function getShaderVariantCount(shader: ShaderInfo): number {
  return normalizeCount(shader.totalVariantCount ?? null);
}

function resolveShaderVariantStats(frame: TelemetrySnapshot | null): ShaderVariantStats {
  const base = frame?.shaderVariantStats;
  const normalized: ShaderVariantStats = {
    shaderCount: normalizeCount(base?.shaderCount ?? null),
    totalVariants: normalizeCount(base?.totalVariants ?? null),
  };

  if (
    normalized.shaderCount === 0 &&
    normalized.totalVariants === 0 &&
    Array.isArray(frame?.shaders) &&
    frame.shaders.length > 0
  ) {
    const total = frame.shaders.reduce((acc, shader) => acc + getShaderVariantCount(shader), 0);
    normalized.shaderCount = frame.shaders.length;
    normalized.totalVariants = total;
  }

  return normalized;
}

function formatWrapMode(value: string | number | null | undefined): string {
  const numeric = parseNumeric(value);
  if (numeric != null && numeric in unityWrapModeLabels) {
    return unityWrapModeLabels[numeric];
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return '未知';
}

function formatFilterMode(value: string | number | null | undefined): string {
  const numeric = parseNumeric(value);
  if (numeric != null && numeric in unityFilterModeLabels) {
    return unityFilterModeLabels[numeric];
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return '未知';
}

function isTextureReference(texture: TextureInfo | null | undefined): boolean {
  if (!texture) {
    return false;
  }
  if (texture.__textureRef) {
    return true;
  }
  if (!Number.isFinite(texture.EstimatedBytes ?? Number.NaN)) {
    return true;
  }
  return false;
}

function getTextureDisplayName(texture: TextureInfo): string {
  const name = typeof texture.name === 'string' ? texture.name.trim() : '';
  if (name.length > 0) {
    return name;
  }
  const textureId = typeof texture.textureId === 'string' ? texture.textureId.trim() : '';
  if (textureId.length > 0) {
    return textureId;
  }
  const path = typeof texture.path === 'string' ? texture.path.trim() : '';
  if (path.length > 0) {
    return path;
  }
  return '未命名纹理';
}

function getTextureEstimatedBytes(texture: TextureInfo): number {
  const value = texture.EstimatedBytes;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  return 0;
}

function dedupeTextures(textures: TextureInfo[]): TextureInfo[] {
  const map = new Map<string, TextureInfo>();
  textures.forEach((texture) => {
    if (!texture) {
      return;
    }
    const name = typeof texture.name === 'string' ? texture.name.trim() : '';
    const path = typeof texture.path === 'string' ? texture.path.trim() : '';
    const textureId = typeof texture.textureId === 'string' ? texture.textureId.trim() : '';
    const width = Number.isFinite(texture.width) ? Number(texture.width) : 0;
    const height = Number.isFinite(texture.height) ? Number(texture.height) : 0;
    const key = textureId || name || path || `${width}x${height}`;
    const existing = map.get(key);
    const existingBytes = existing ? getTextureEstimatedBytes(existing) : -1;
    const nextBytes = getTextureEstimatedBytes(texture);
    if (!existing || existingBytes < nextBytes) {
      const clone: TextureInfo = { ...texture };
      delete clone.__textureRef;
      map.set(key, clone);
    }
  });
  return Array.from(map.values());
}

function normalizeInstanceId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const rounded = Math.round(parsed);
  return Number.isInteger(rounded) ? rounded : null;
}

function buildOrderIndexMap<T extends { instanceId?: number | null | undefined }>(
  order: number[] | undefined,
  items: T[] = []
): Map<number, number> {
  const map = new Map<number, number>();
  if (Array.isArray(order)) {
    order.forEach((value, index) => {
      const id = normalizeInstanceId(value);
      if (id != null && !map.has(id)) {
        map.set(id, index);
      }
    });
  }

  let offset = map.size;
  items.forEach((item) => {
    const id = normalizeInstanceId(item?.instanceId);
    if (id != null && !map.has(id)) {
      map.set(id, offset);
      offset += 1;
    }
  });

  return map;
}

interface HotspotEntry {
  key: string;
  name: string;
  bytes: number;
  description?: string;
}

interface LifecycleEntry extends HotspotEntry {
  agePercent: number;
  orderIndex?: number | null;
  totalOrder?: number;
}

interface ResourceSummaryItem {
  key: string;
  title: string;
  count: number;
  totalBytes: number;
  averageBytes: number;
  highlight?: string;
}

type DiagnosticSeverity = 'info' | 'warning' | 'critical';

interface DiagnosticEntry {
  key: string;
  name: string;
  message: string;
  severity: DiagnosticSeverity;
}

const severityTagColor: Record<DiagnosticSeverity, string> = {
  info: 'processing',
  warning: 'warning',
  critical: 'error',
};

const severityDisplayLabel: Record<DiagnosticSeverity, string> = {
  info: '提示',
  warning: '警告',
  critical: '高风险',
};

function resolveHighestSeverity(entries: DiagnosticEntry[]): DiagnosticSeverity {
  if (entries.some((entry) => entry.severity === 'critical')) {
    return 'critical';
  }
  if (entries.some((entry) => entry.severity === 'warning')) {
    return 'warning';
  }
  return 'info';
}

function isPowerOfTwo(value: number | null | undefined): boolean {
  if (!Number.isFinite(value) || !value) {
    return false;
  }
  const numeric = Math.floor(value);
  return numeric > 0 && (numeric & (numeric - 1)) === 0;
}

function computeTextureDiagnostics(textures: TextureInfo[]): DiagnosticEntry[] {
  const entries: DiagnosticEntry[] = [];
  textures.forEach((texture, index) => {
    const width = Number(texture.width) || 0;
    const height = Number(texture.height) || 0;
    const mipCount = texture.mipCount ?? 0;
    const estimatedBytes = getTextureEstimatedBytes(texture);
    const originalBytes = Number.isFinite(texture.originalBytes)
      ? Math.max(0, Number(texture.originalBytes))
      : 0;
    const ratio = originalBytes > 0 ? estimatedBytes / originalBytes : null;
    const keyPrefix = `${texture.instanceId ?? texture.textureId ?? texture.name ?? 'texture'}-${index}`;
    const displayName = getTextureDisplayName(texture);

    if ((!isPowerOfTwo(width) || !isPowerOfTwo(height)) && Math.max(width, height) >= 512) {
      entries.push({
        key: `${keyPrefix}-npot`,
        name: displayName,
        severity: 'warning',
        message: `尺寸 ${width} × ${height} 非二次幂，可能导致额外内存与采样成本`,
      });
    }

    if (Math.max(width, height) >= 1024 && (mipCount ?? 0) <= 1) {
      entries.push({
        key: `${keyPrefix}-mip`,
        name: displayName,
        severity: 'critical',
        message: `高分辨率纹理缺少 MipMap（当前 ${mipCount}），建议开启以降低跳变`,
      });
    } else if (Math.max(width, height) >= 512 && (mipCount ?? 0) <= 1) {
      entries.push({
        key: `${keyPrefix}-mip-warn`,
        name: displayName,
        severity: 'warning',
        message: `较大纹理未启用 MipMap（当前 ${mipCount}），可能带来远景闪烁`,
      });
    }

    if (ratio != null && ratio >= 0.8 && originalBytes > 0) {
      entries.push({
        key: `${keyPrefix}-compression`,
        name: displayName,
        severity: 'info',
        message: `压缩后仍保留 ${formatPercentage(ratio)} 原始大小，考虑换用更高压缩格式`,
      });
    }
  });
  return entries;
}

function computeRenderTextureDiagnostics(renderTextures: RenderTextureInfo[]): DiagnosticEntry[] {
  const entries: DiagnosticEntry[] = [];
  renderTextures.forEach((rt, index) => {
    const width = Number(rt.width) || 0;
    const height = Number(rt.height) || 0;
    const aa = Number(rt.antiAliasing) || 1;
    const resolution = width * height;
    const keyPrefix = `${rt.instanceId ?? rt.name ?? 'renderTexture'}-${index}`;

    if (!rt.useMipMap && Math.max(width, height) >= 1024) {
      entries.push({
        key: `${keyPrefix}-mip`,
        name: rt.name || '未命名 RenderTexture',
        severity: 'warning',
        message: `分辨率 ${width} × ${height} 未启用 MipMap，可能导致模糊采样`,
      });
    }

    if (resolution >= 2_000_000 && aa > 1) {
      entries.push({
        key: `${keyPrefix}-aa`,
        name: rt.name || '未命名 RenderTexture',
        severity: resolution >= 4_000_000 ? 'critical' : 'warning',
        message: `高分辨率 (${width} × ${height}) 仍启用 ${aa}× MSAA，注意 GPU 帧耗`,
      });
    }
  });
  return entries;
}

function computeMaterialDiagnostics(materials: MaterialInfo[]): DiagnosticEntry[] {
  const entries: DiagnosticEntry[] = [];
  materials.forEach((material, index) => {
    const keyPrefix = `${material.instanceId ?? material.name ?? 'material'}-${index}`;
    const keywordCount = material.keywords?.length ?? 0;
    if (!material.shaderName) {
      entries.push({
        key: `${keyPrefix}-shader`,
        name: material.name || '未命名材质',
        severity: 'critical',
        message: '未绑定有效 Shader，渲染时会退化为默认材质',
      });
    }
    if (keywordCount >= 12) {
      entries.push({
        key: `${keyPrefix}-keywords`,
        name: material.name || '未命名材质',
        severity: keywordCount >= 18 ? 'critical' : 'warning',
        message: `启用 ${keywordCount} 个关键字，可能导致 Shader 变体爆炸`,
      });
    }
    const textureSlots = material.textures?.length ?? 0;
    if (textureSlots === 0) {
      entries.push({
        key: `${keyPrefix}-textures`,
        name: material.name || '未命名材质',
        severity: 'info',
        message: '材质未绑定任何纹理资源，确认是否符合预期',
      });
    }
  });
  return entries;
}

function computeMeshDiagnostics(meshes: MeshInfo[]): DiagnosticEntry[] {
  const entries: DiagnosticEntry[] = [];
  meshes.forEach((mesh, index) => {
    const keyPrefix = `${mesh.instanceId ?? mesh.name ?? 'mesh'}-${index}`;
    const vertices = Number(mesh.vertexCount) || 0;
    const subMeshes = Number(mesh.subMeshCount) || 0;

    if (vertices >= 500_000) {
      entries.push({
        key: `${keyPrefix}-vertices-critical`,
        name: mesh.name || '未命名网格',
        severity: 'critical',
        message: `顶点数 ${formatInteger(vertices)} 极高，建议拆分或降模`,
      });
    } else if (vertices >= 200_000) {
      entries.push({
        key: `${keyPrefix}-vertices`,
        name: mesh.name || '未命名网格',
        severity: 'warning',
        message: `顶点数 ${formatInteger(vertices)} 偏高，注意 GPU 负载`,
      });
    }

    if (subMeshes >= 10) {
      entries.push({
        key: `${keyPrefix}-submesh`,
        name: mesh.name || '未命名网格',
        severity: 'info',
        message: `包含 ${subMeshes} 个子网格，注意 DrawCall 与材质拆分`,
      });
    }
  });
  return entries;
}

function sumBy<T>(items: T[], getValue: (item: T) => number): number {
  return items.reduce((total, item) => {
    const value = getValue(item);
    if (!Number.isFinite(value)) {
      return total;
    }
    return total + Math.max(0, value);
  }, 0);
}

function HotspotList({ title, items }: { title: string; items: HotspotEntry[] }) {
  return (
    <Card
      size="small"
      type="inner"
      title={title}
      style={{ minWidth: 0 }}
      bodyStyle={{ padding: '12px 12px 8px' }}
    >
      <List
        size="small"
        dataSource={items}
        split={false}
        locale={{ emptyText: '暂无数据' }}
        renderItem={(item, index) => (
          <List.Item style={{ padding: '6px 0' }}>
            <Space
              align="start"
              style={{ width: '100%', justifyContent: 'space-between', gap: 12 }}
              wrap
            >
              <Space align="start" style={{ flex: '1 1 0', minWidth: 0 }}>
                <Tag color="processing">{index + 1}</Tag>
                <Space direction="vertical" size={2} style={{ minWidth: 0 }}>
                  <Typography.Text strong ellipsis>
                    {item.name}
                  </Typography.Text>
                  {item.description ? (
                    <Typography.Text type="secondary" ellipsis={{ tooltip: item.description }}>
                      {item.description}
                    </Typography.Text>
                  ) : null}
                </Space>
              </Space>
              <Typography.Text strong>{formatBytes(item.bytes)}</Typography.Text>
            </Space>
          </List.Item>
        )}
      />
    </Card>
  );
}

function computeLifecycleEntries<T extends { instanceId?: number | null | undefined }>(
  items: T[],
  orderMap: Map<number, number>,
  getName: (item: T) => string,
  getBytes: (item: T) => number,
  options: { getDescription?: (item: T) => string | undefined; limit?: number } = {}
): LifecycleEntry[] {
  const { getDescription, limit = 10 } = options;
  if (!items.length) {
    return [];
  }

  const orderValues = Array.from(orderMap.values());
  let maxKnownIndex = orderValues.length ? Math.max(...orderValues) : -1;
  if (maxKnownIndex < items.length - 1) {
    maxKnownIndex = items.length - 1;
  }
  const denominator = Math.max(maxKnownIndex, 1);
  const totalOrder = Math.max(maxKnownIndex, 0) + 1;

  return items
    .map((item, index) => {
      const id = normalizeInstanceId(item?.instanceId);
      let orderIndex: number;
      if (id != null && orderMap.has(id)) {
        orderIndex = orderMap.get(id)!;
      } else if (orderValues.length > 0) {
        orderIndex = maxKnownIndex + 1 + index;
      } else {
        orderIndex = index;
      }
      const clampedOrderIndex = Math.min(orderIndex, denominator);
      const agePercent = denominator > 0 ? 1 - clampedOrderIndex / denominator : 1;
      const bytes = getBytes(item);
      return {
        key: `${normalizeInstanceId(item?.instanceId) ?? getName(item)}-${index}`,
        name: getName(item),
        description: getDescription ? getDescription(item) : undefined,
        bytes,
        agePercent,
        orderIndex,
        totalOrder,
      } satisfies LifecycleEntry;
    })
    .filter((entry) => Number.isFinite(entry.bytes) && entry.bytes > 0)
    .sort((a, b) => {
      if (b.agePercent !== a.agePercent) {
        return b.agePercent - a.agePercent;
      }
      return b.bytes - a.bytes;
    })
    .slice(0, limit);
}

function LifecycleList({ title, items }: { title: string; items: LifecycleEntry[] }) {
  return (
    <Card
      size="small"
      type="inner"
      title={title}
      style={{ minWidth: 0 }}
      bodyStyle={{ padding: '12px 12px 8px' }}
    >
      <List
        size="small"
        dataSource={items}
        split={false}
        locale={{ emptyText: '暂无数据' }}
        renderItem={(item, index) => {
          const percent = Math.round(Math.max(0, Math.min(1, item.agePercent)) * 100);
          const orderLabel =
            item.orderIndex != null && Number.isFinite(item.orderIndex)
              ? `加载序号 #${(item.orderIndex ?? 0) + 1}${
                  item.totalOrder && Number.isFinite(item.totalOrder)
                    ? ` / ${item.totalOrder}`
                    : ''
                }`
              : undefined;
          return (
            <List.Item style={{ padding: '6px 0' }}>
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                <Space
                  align="start"
                  style={{ width: '100%', justifyContent: 'space-between', gap: 12 }}
                  wrap
                >
                  <Space align="start" style={{ flex: '1 1 0', minWidth: 0 }}>
                    <Tag color="blue">{index + 1}</Tag>
                    <Space direction="vertical" size={2} style={{ minWidth: 0 }}>
                      <Typography.Text strong ellipsis>
                        {item.name}
                      </Typography.Text>
                      <Typography.Text type="secondary" ellipsis={{ tooltip: item.description }}>
                        内存 {formatBytes(item.bytes)}
                        {orderLabel ? ` · ${orderLabel}` : ''}
                        {item.description ? ` · ${item.description}` : ''}
                      </Typography.Text>
                    </Space>
                  </Space>
                  <Typography.Text type="secondary">生命周期 {percent}%</Typography.Text>
                </Space>
                <Progress
                  percent={percent}
                  size="small"
                  showInfo={false}
                  strokeColor="#52c41a"
                  strokeWidth={8}
                  style={{ marginBottom: 0 }}
                />
              </Space>
            </List.Item>
          );
        }}
      />
    </Card>
  );
}

function ResourceSummaryCard({ item }: { item: ResourceSummaryItem }) {
  const hasAverage = Number.isFinite(item.averageBytes) && item.averageBytes > 0;
  return (
    <Card
      size="small"
      type="inner"
      style={{ flex: 1, minWidth: 220 }}
      bodyStyle={{ paddingTop: 12, paddingBottom: 12 }}
    >
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Typography.Text strong>{item.title}</Typography.Text>
        <Typography.Text type="secondary">
          资源数 {formatInteger(item.count)} · 总内存 {formatBytes(item.totalBytes)}
        </Typography.Text>
        {hasAverage ? (
          <Typography.Text type="secondary">
            平均内存 {formatBytes(item.averageBytes)}
          </Typography.Text>
        ) : null}
        {item.highlight ? (
          <Typography.Text type="secondary">最大资源：{item.highlight}</Typography.Text>
        ) : null}
      </Space>
    </Card>
  );
}

interface ResourceDiagnosticListProps {
  title: string;
  items: DiagnosticEntry[];
  variant?: 'card' | 'plain';
}

function ResourceDiagnosticList({ title, items, variant = 'card' }: ResourceDiagnosticListProps) {
  const content = (
    <List
      size="small"
      dataSource={items}
      locale={{ emptyText: '暂无异常' }}
      renderItem={(item) => (
        <List.Item style={{ paddingInline: 0 }}>
          <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space align="start">
              <Tag color={severityTagColor[item.severity] || 'default'}>
                {item.severity === 'critical'
                  ? '高'
                  : item.severity === 'warning'
                  ? '警'
                  : '提示'}
              </Tag>
              <Space direction="vertical" size={2}>
                <Typography.Text strong>{item.name}</Typography.Text>
                <Typography.Text type="secondary">{item.message}</Typography.Text>
              </Space>
            </Space>
          </Space>
        </List.Item>
      )}
    />
  );

  if (variant === 'plain') {
    return content;
  }

  return (
    <Card
      size="small"
      type="inner"
      title={title}
      style={{ flex: 1, minWidth: 280 }}
      bodyStyle={{ paddingTop: 12, paddingBottom: 0 }}
    >
      {content}
    </Card>
  );
}

function TextureNameCell({ texture, serverBaseUrl }: { texture: TextureInfo; serverBaseUrl: string }) {
  const previewSrc = useMemo(
    () => resolvePreviewSource(texture, serverBaseUrl),
    [texture, serverBaseUrl]
  );
  const hasPreview = Boolean(previewSrc);
  const displayName = getTextureDisplayName(texture);
  const placeholderLabel = displayName.slice(0, 2).toUpperCase();

  return (
    <Space align="start">
      {hasPreview ? (
        <Image
          src={previewSrc ?? undefined}
          width={56}
          height={56}
          style={{ borderRadius: 8, objectFit: 'cover' }}
          alt={displayName}
          preview={{ mask: '预览' }}
        />
      ) : (
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 8,
            background: 'linear-gradient(135deg, #5b8ff9, #1e3a8a)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {placeholderLabel}
        </div>
      )}
      <Typography.Text strong>{displayName}</Typography.Text>
    </Space>
  );
}

function RenderTextureNameCell({
  renderTexture,
  serverBaseUrl,
}: {
  renderTexture: RenderTextureInfo;
  serverBaseUrl: string;
}) {
  const previewSrc = useMemo(
    () => resolvePreviewSource(renderTexture, serverBaseUrl),
    [renderTexture, serverBaseUrl]
  );
  const hasPreview = Boolean(previewSrc);
  const placeholderLabel = (renderTexture.name || 'RT').slice(0, 2).toUpperCase();

  return (
    <Space align="start">
      {hasPreview ? (
        <Image
          src={previewSrc ?? undefined}
          width={56}
          height={56}
          style={{ borderRadius: 8, objectFit: 'cover' }}
          alt={renderTexture.name}
          preview={{ mask: '预览' }}
        />
      ) : (
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 8,
            background: 'linear-gradient(135deg, #f59e0b, #b45309)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {placeholderLabel}
        </div>
      )}
      <Space direction="vertical" size={0}>
        <Typography.Text strong>{renderTexture.name || '未命名 RenderTexture'}</Typography.Text>
        <Typography.Text type="secondary">
          {renderTexture.width} × {renderTexture.height}
        </Typography.Text>
      </Space>
    </Space>
  );
}

function TextureDetails({ texture }: { texture: TextureInfo }) {
  const compressionFormat = texture.compressionFormat ?? texture.formatName ?? texture.format ?? '未知';
  const estimatedBytes = getTextureEstimatedBytes(texture);
  const originalBytes = Number.isFinite(texture.originalBytes)
    ? Math.max(0, Number(texture.originalBytes))
    : 0;
  const compressionRatio = originalBytes > 0 ? formatPercentage(estimatedBytes / originalBytes) : '—';
  const wrapLabel = formatWrapMode(texture.wrapMode);
  const filterLabel = formatFilterMode(texture.filterMode);

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Typography.Text type="secondary">
        资源路径：{texture.path || '未提供资源路径'}
      </Typography.Text>
      <Space wrap size={[8, 6]}>
        <Tag color="blue">
          原始大小 {originalBytes > 0 ? formatBytes(originalBytes) : '未知'}
        </Tag>
        <Tag color="green">压缩后 {formatBytes(estimatedBytes)}</Tag>
        <Tag color="purple">压缩率 {compressionRatio}</Tag>
        <Tag color="magenta">Mip 数 {texture.mipCount ?? 0}</Tag>
      </Space>
      <Space wrap size={[8, 6]}>
        <Tag>压缩格式 {compressionFormat}</Tag>
        {texture.graphicsFormat ? <Tag>GraphicsFormat {texture.graphicsFormat}</Tag> : null}
        <Tag>Wrap {wrapLabel}</Tag>
        <Tag>Filter {filterLabel}</Tag>
      </Space>
    </Space>
  );
}

function MeshSummary({ mesh }: { mesh: MeshInfo }) {
  return <Typography.Text strong>{mesh.name}</Typography.Text>;
}

function MeshDetails({ mesh }: { mesh: MeshInfo }) {
  const boundsLabel = mesh.boundsSizeX != null
    ? `${mesh.boundsSizeX?.toFixed(2)} × ${mesh.boundsSizeY?.toFixed(2)} × ${mesh.boundsSizeZ?.toFixed(2)}`
    : '未知';

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Typography.Text type="secondary">
        资源路径：{mesh.path || '未提供资源路径'}
      </Typography.Text>
      <Space wrap size={[8, 6]}>
        <Tag color="geekblue">资产大小 {mesh.assetBytes != null ? formatBytes(mesh.assetBytes) : '未知'}</Tag>
        <Tag color="cyan">子网格 {mesh.subMeshCount}</Tag>
        <Tag color="gold">包围盒 {boundsLabel}</Tag>
      </Space>
      {mesh.vertexAttributes?.length ? (
        <Space wrap size={[8, 6]}>
          {mesh.vertexAttributes.map((attr) => (
            <Tag key={attr}>{attr}</Tag>
          ))}
        </Space>
      ) : (
        <Typography.Text type="secondary">未提供顶点属性详情</Typography.Text>
      )}
    </Space>
  );
}

function RenderTextureDetails({ renderTexture }: { renderTexture: RenderTextureInfo }) {
  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Space wrap size={[8, 6]}>
        <Tag color="orange">尺寸 {renderTexture.width} × {renderTexture.height}</Tag>
        <Tag color="green">内存 {formatBytes(renderTexture.EstimatedBytes)}</Tag>
        <Tag color="purple">Mip {renderTexture.mipCount}</Tag>
        <Tag color="magenta">AA ×{renderTexture.antiAliasing}</Tag>
        <Tag color="gold">Depth {renderTexture.depth}</Tag>
      </Space>
      <Space wrap size={[8, 6]}>
        <Tag>Dimension {renderTexture.dimension}</Tag>
        <Tag>Format {renderTexture.format}</Tag>
        <Tag>GraphicsFormat {renderTexture.graphicsFormat}</Tag>
        <Tag>使用 MipMap {renderTexture.useMipMap ? '是' : '否'}</Tag>
      </Space>
    </Space>
  );
}

function MaterialSummary({ material }: { material: MaterialInfo }) {
  return (
    <Space direction="vertical" size={0}>
      <Typography.Text strong>{material.name || '未命名材质'}</Typography.Text>
      <Typography.Text type="secondary">{material.shaderName || '未指定 Shader'}</Typography.Text>
    </Space>
  );
}

function MaterialDetails({ material }: { material: MaterialInfo }) {
  const keywords = material.keywords ?? [];
  const textures = material.textures ?? [];

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Typography.Text type="secondary">
        资源路径：{material.path || '未提供资源路径'}
      </Typography.Text>
      <Space wrap size={[8, 6]}>
        <Tag color="blue">Shader {material.shaderName || '未知'}</Tag>
        <Tag color="geekblue">渲染队列 {material.renderQueue}</Tag>
        <Tag color="purple">Instancing {material.enableInstancing ? '开启' : '关闭'}</Tag>
        <Tag color="magenta">双面 GI {material.doubleSidedGI ? '是' : '否'}</Tag>
        <Tag color="gold">内存 {formatBytes(material.memoryBytes ?? 0)}</Tag>
      </Space>
      {keywords.length ? (
        <Space wrap size={[8, 6]}>
          {keywords.map((keyword) => (
            <Tag key={keyword}>{keyword}</Tag>
          ))}
        </Space>
      ) : (
        <Typography.Text type="secondary">该材质未启用关键字</Typography.Text>
      )}
      {textures.length ? (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Typography.Text type="secondary">贴图槽：</Typography.Text>
          <Space wrap size={[8, 6]}>
            {textures.map((slot) => (
              <Tag key={`${slot.propertyName}-${slot.textureName ?? 'none'}`}>
                {slot.propertyName}
                {slot.textureName ? ` → ${slot.textureName}` : ''}
              </Tag>
            ))}
          </Space>
        </Space>
      ) : (
        <Typography.Text type="secondary">该材质未引用贴图</Typography.Text>
      )}
    </Space>
  );
}

function ShaderSummary({ shader }: { shader: ShaderInfo }) {
  const total = getShaderVariantCount(shader);
  return (
    <Space direction="vertical" size={0}>
      <Typography.Text strong>{shader.name}</Typography.Text>
      <Typography.Text type="secondary">
        变体总数 {formatInteger(total)}
      </Typography.Text>
    </Space>
  );
}

function ShaderDetails({ shader }: { shader: ShaderInfo }) {
  const total = getShaderVariantCount(shader);
  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Typography.Text type="secondary">
        资源路径：{shader.path || '未提供资源路径'}
      </Typography.Text>
      <Typography.Text type="secondary">
        变体总数：{formatInteger(total)}
      </Typography.Text>
      {shader.keywords.length ? (
        <Space wrap size={[8, 6]}>
          {shader.keywords.map((keyword) => (
            <Tag key={keyword}>{keyword}</Tag>
          ))}
        </Space>
      ) : (
        <Typography.Text type="secondary">该 Shader 未启用关键字</Typography.Text>
      )}
    </Space>
  );
}

export default function ResourceExplorer({
  frame,
  serverBaseUrl,
  sessionId,
  ensureTextures,
  serverConfig,
}: ResourceExplorerProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [isTextureLoading, setIsTextureLoading] = useState(false);
  const [activeResourceSections, setActiveResourceSections] = useState<string[]>([
    'textures',
    'renderTextures',
    'materials',
  ]);

  const hotspotLimit = useMemo(() => {
    const raw = serverConfig?.clientDefaults?.resourceHotspotTopCount;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return Math.min(Math.max(Math.round(raw), 1), 50);
    }
    return 10;
  }, [serverConfig]);

  const lifecycleLimit = useMemo(() => {
    const raw = serverConfig?.clientDefaults?.lifecycleTopCount;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return Math.min(Math.max(Math.round(raw), 1), 50);
    }
    return 10;
  }, [serverConfig]);

  useEffect(() => {
    if (!frame || !sessionId || !ensureTextures) {
      setIsTextureLoading(false);
      return;
    }
    if (!activeResourceSections.includes('textures')) {
      setIsTextureLoading(false);
      return;
    }
    const textures = Array.isArray(frame.textures) ? frame.textures : [];
    const pendingIds = textures
      .filter((texture) => isTextureReference(texture))
      .map((texture) => texture?.textureId)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    if (pendingIds.length === 0) {
      setIsTextureLoading(false);
      return;
    }

    let cancelled = false;
    setIsTextureLoading(true);
    ensureTextures(sessionId, pendingIds)
      .catch((error) => {
        console.error('Failed to load texture metadata', error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsTextureLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [frame?.frameNumber, frame?.textures, sessionId, ensureTextures, activeResourceSections]);

  const hydratedTextures = useMemo(
    () =>
      (Array.isArray(frame?.textures) ? frame.textures : []).filter(
        (texture): texture is TextureInfo => Boolean(texture) && !isTextureReference(texture)
      ),
    [frame?.textures]
  );

  const hasTextureReferences = useMemo(
    () => (Array.isArray(frame?.textures) ? frame.textures.some((texture) => isTextureReference(texture)) : false),
    [frame?.textures]
  );

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredTextures = useMemo(() => {
    const subset = hydratedTextures
      .filter((texture) => !isRenderTextureLike(texture))
      .filter((texture) => {
        const haystack = `${texture.name ?? ''} ${texture.path ?? ''}`.toLowerCase();
        return haystack.includes(normalizedSearch);
      });
    return dedupeTextures(subset);
  }, [hydratedTextures, normalizedSearch]);

  const filteredRenderTextures = useMemo(() => {
    if (!frame) return [];
    const subset = (frame.renderTextures ?? []).filter((rt) =>
      `${rt.name}`.toLowerCase().includes(normalizedSearch)
    );
    return subset;
  }, [frame, normalizedSearch]);

  const filteredMaterials = useMemo(() => {
    if (!frame) return [];
    const subset = (frame.materials ?? []).filter((material) =>
      `${material.name} ${material.path} ${material.shaderName ?? ''}`.toLowerCase().includes(normalizedSearch)
    );
    return subset;
  }, [frame, normalizedSearch]);

  const filteredMeshes = useMemo(() => {
    if (!frame) return [];
    const subset = (frame.meshes ?? []).filter((mesh) =>
      `${mesh.name} ${mesh.path}`.toLowerCase().includes(normalizedSearch)
    );
    return subset;
  }, [frame, normalizedSearch]);

  const filteredShaders = useMemo(() => {
    if (!frame) return [];
    const subset = (frame.shaders ?? []).filter((shader) =>
      `${shader.name} ${shader.path}`.toLowerCase().includes(normalizedSearch)
    );
    return subset;
  }, [frame, normalizedSearch]);

  const shaderVariantStats = useMemo(() => resolveShaderVariantStats(frame), [frame]);

  const allTextures = useMemo(() => {
    const subset = hydratedTextures.filter((texture) => !isRenderTextureLike(texture));
    return dedupeTextures(subset);
  }, [hydratedTextures]);

  const allRenderTextures = useMemo(() => frame?.renderTextures ?? [], [frame]);
  const allMaterials = useMemo(() => frame?.materials ?? [], [frame]);
  const allMeshes = useMemo(() => frame?.meshes ?? [], [frame]);

  const textureOrderMap = useMemo(
    () => buildOrderIndexMap(frame?.textureOrder, allTextures),
    [frame?.textureOrder, allTextures]
  );
  const renderTextureOrderMap = useMemo(
    () => buildOrderIndexMap(frame?.renderTextureOrder, allRenderTextures),
    [frame?.renderTextureOrder, allRenderTextures]
  );
  const materialOrderMap = useMemo(
    () => buildOrderIndexMap(frame?.materialOrder, allMaterials),
    [frame?.materialOrder, allMaterials]
  );
  const meshOrderMap = useMemo(
    () => buildOrderIndexMap(frame?.meshOrder, allMeshes),
    [frame?.meshOrder, allMeshes]
  );

  const topTextureHotspots = useMemo<HotspotEntry[]>(() => {
    return allTextures
      .map((texture) => ({ texture, bytes: getTextureEstimatedBytes(texture) }))
      .filter((entry) => entry.bytes > 0)
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, hotspotLimit)
      .map(({ texture, bytes }) => ({
        key: `${texture.instanceId ?? texture.textureId ?? texture.name}-${texture.width ?? 0}-${texture.height ?? 0}`,
        name: getTextureDisplayName(texture),
        description: `${texture.width ?? 0} × ${texture.height ?? 0}`,
        bytes,
      }));
  }, [allTextures, hotspotLimit]);

  const topRenderTextureHotspots = useMemo<HotspotEntry[]>(() => {
    return [...allRenderTextures]
      .filter((rt) => Number.isFinite(rt.EstimatedBytes) && rt.EstimatedBytes > 0)
      .sort((a, b) => b.EstimatedBytes - a.EstimatedBytes)
      .slice(0, hotspotLimit)
      .map((rt) => ({
        key: `${rt.textureId ?? rt.instanceId ?? rt.name}-${rt.width}-${rt.height}-${rt.format}`,
        name: rt.name || '未命名 RenderTexture',
        description: `${rt.width} × ${rt.height} · ${rt.format}`,
        bytes: rt.EstimatedBytes,
      }));
  }, [allRenderTextures, hotspotLimit]);

  const topMaterialHotspots = useMemo<HotspotEntry[]>(() => {
    return [...allMaterials]
      .filter((material) => Number.isFinite(material.memoryBytes) && (material.memoryBytes ?? 0) > 0)
      .sort((a, b) => (b.memoryBytes ?? 0) - (a.memoryBytes ?? 0))
      .slice(0, hotspotLimit)
      .map((material) => ({
        key: `${material.instanceId ?? material.name}-${material.shaderName ?? 'shader'}`,
        name: material.name || '未命名材质',
        description: material.shaderName ? `Shader ${material.shaderName}` : undefined,
        bytes: material.memoryBytes ?? 0,
      }));
  }, [allMaterials, hotspotLimit]);

  const topMeshHotspots = useMemo<HotspotEntry[]>(() => {
    return [...allMeshes]
      .filter((mesh) => Number.isFinite(mesh.EstimatedBytes) && mesh.EstimatedBytes > 0)
      .sort((a, b) => b.EstimatedBytes - a.EstimatedBytes)
      .slice(0, hotspotLimit)
      .map((mesh) => ({
        key: `${mesh.instanceId ?? mesh.name}-${mesh.vertexCount}-${mesh.subMeshCount}`,
        name: mesh.name || '未命名网格',
        description: `${formatInteger(mesh.vertexCount)} 顶点 · 子网格 ${mesh.subMeshCount}`,
        bytes: mesh.EstimatedBytes,
      }));
  }, [allMeshes, hotspotLimit]);

  const lifecycleTextures = useMemo(
    () =>
      computeLifecycleEntries(
        allTextures,
        textureOrderMap,
        (texture) => getTextureDisplayName(texture),
        (texture) => getTextureEstimatedBytes(texture),
        {
          getDescription: (texture) => `${texture.width ?? 0} × ${texture.height ?? 0}`,
          limit: lifecycleLimit,
        }
      ),
    [allTextures, textureOrderMap, lifecycleLimit]
  );

  const lifecycleRenderTextures = useMemo(
    () =>
      computeLifecycleEntries(
        allRenderTextures,
        renderTextureOrderMap,
        (rt) => rt.name || '未命名 RenderTexture',
        (rt) => rt.EstimatedBytes,
        {
          getDescription: (rt) => `${rt.width} × ${rt.height} · ${rt.format}`,
          limit: lifecycleLimit,
        }
      ),
    [allRenderTextures, renderTextureOrderMap, lifecycleLimit]
  );

  const lifecycleMaterials = useMemo(
    () =>
      computeLifecycleEntries(
        allMaterials,
        materialOrderMap,
        (material) => material.name || '未命名材质',
        (material) => material.memoryBytes ?? 0,
        {
          getDescription: (material) =>
            material.shaderName ? `Shader ${material.shaderName}` : undefined,
          limit: lifecycleLimit,
        }
      ),
    [allMaterials, materialOrderMap, lifecycleLimit]
  );

  const lifecycleMeshes = useMemo(
    () =>
      computeLifecycleEntries(
        allMeshes,
        meshOrderMap,
        (mesh) => mesh.name || '未命名网格',
        (mesh) => mesh.EstimatedBytes,
        {
          getDescription: (mesh) => `${formatInteger(mesh.vertexCount)} 顶点`,
          limit: lifecycleLimit,
        }
      ),
    [allMeshes, meshOrderMap, lifecycleLimit]
  );

  const hasHotspotData =
    topTextureHotspots.length > 0 ||
    topRenderTextureHotspots.length > 0 ||
    topMaterialHotspots.length > 0 ||
    topMeshHotspots.length > 0;

  const hasLifecycleInsights =
    lifecycleTextures.length > 0 ||
    lifecycleRenderTextures.length > 0 ||
    lifecycleMaterials.length > 0 ||
    lifecycleMeshes.length > 0;

  const resourceSummaryItems = useMemo<ResourceSummaryItem[]>(() => {
    const summaries: ResourceSummaryItem[] = [];

    const topTexture = topTextureHotspots[0];
    if (allTextures.length > 0) {
      const totalBytes = sumBy(allTextures, (texture) => getTextureEstimatedBytes(texture));
      const highlight = topTexture
        ? topTexture.description
          ? `${topTexture.name} · ${topTexture.description}`
          : topTexture.name
        : undefined;
      summaries.push({
        key: 'textures',
        title: '纹理资源',
        count: allTextures.length,
        totalBytes,
        averageBytes: allTextures.length > 0 ? totalBytes / allTextures.length : 0,
        highlight,
      });
    }

    const topRenderTexture = topRenderTextureHotspots[0];
    if (allRenderTextures.length > 0) {
      const totalBytes = sumBy(allRenderTextures, (rt) => rt.EstimatedBytes ?? 0);
      const highlight = topRenderTexture
        ? topRenderTexture.description
          ? `${topRenderTexture.name} · ${topRenderTexture.description}`
          : topRenderTexture.name
        : undefined;
      summaries.push({
        key: 'renderTextures',
        title: 'RenderTexture',
        count: allRenderTextures.length,
        totalBytes,
        averageBytes: allRenderTextures.length > 0 ? totalBytes / allRenderTextures.length : 0,
        highlight,
      });
    }

    const topMaterial = topMaterialHotspots[0];
    if (allMaterials.length > 0) {
      const totalBytes = sumBy(allMaterials, (material) => material.memoryBytes ?? 0);
      const highlight = topMaterial
        ? topMaterial.description
          ? `${topMaterial.name} · ${topMaterial.description}`
          : topMaterial.name
        : undefined;
      summaries.push({
        key: 'materials',
        title: '材质资源',
        count: allMaterials.length,
        totalBytes,
        averageBytes: allMaterials.length > 0 ? totalBytes / allMaterials.length : 0,
        highlight,
      });
    }

    const topMesh = topMeshHotspots[0];
    if (allMeshes.length > 0) {
      const totalBytes = sumBy(allMeshes, (mesh) => mesh.EstimatedBytes ?? mesh.assetBytes ?? 0);
      const highlight = topMesh
        ? topMesh.description
          ? `${topMesh.name} · ${topMesh.description}`
          : topMesh.name
        : undefined;
      summaries.push({
        key: 'meshes',
        title: '网格资源',
        count: allMeshes.length,
        totalBytes,
        averageBytes: allMeshes.length > 0 ? totalBytes / allMeshes.length : 0,
        highlight,
      });
    }

    return summaries;
  }, [
    allMaterials,
    allMeshes,
    allRenderTextures,
    allTextures,
    topMaterialHotspots,
    topMeshHotspots,
    topRenderTextureHotspots,
    topTextureHotspots,
  ]);

  const textureDiagnostics = useMemo(
    () => computeTextureDiagnostics(allTextures),
    [allTextures]
  );
  const renderTextureDiagnostics = useMemo(
    () => computeRenderTextureDiagnostics(allRenderTextures),
    [allRenderTextures]
  );
  const materialDiagnostics = useMemo(
    () => computeMaterialDiagnostics(allMaterials),
    [allMaterials]
  );
  const meshDiagnostics = useMemo(() => computeMeshDiagnostics(allMeshes), [allMeshes]);

  const hasSummaryData = resourceSummaryItems.length > 0;
  const hasDiagnostics =
    textureDiagnostics.length > 0 ||
    renderTextureDiagnostics.length > 0 ||
    materialDiagnostics.length > 0 ||
    meshDiagnostics.length > 0;

  const diagnosticSections = useMemo(
    () =>
      [
        { key: 'textures', title: '纹理质量提醒', items: textureDiagnostics },
        { key: 'renderTextures', title: 'RenderTexture 诊断', items: renderTextureDiagnostics },
        { key: 'materials', title: '材质配置诊断', items: materialDiagnostics },
        { key: 'meshes', title: '网格复杂度提醒', items: meshDiagnostics },
      ].filter((section) => section.items.length > 0),
    [textureDiagnostics, renderTextureDiagnostics, materialDiagnostics, meshDiagnostics]
  );

  const diagnosticCollapseItems = useMemo(
    () =>
      diagnosticSections.map((section) => {
        const highestSeverity = resolveHighestSeverity(section.items);
        const badgeLabel = `共 ${section.items.length} 条 · ${severityDisplayLabel[highestSeverity]}`;
        return {
          key: section.key,
          label: (
            <Space size={8} wrap align="center">
              <Typography.Text>{section.title}</Typography.Text>
              <Tag color={severityTagColor[highestSeverity]}>{badgeLabel}</Tag>
            </Space>
          ),
          children: (
            <ResourceDiagnosticList
              title={section.title}
              items={section.items}
              variant="plain"
            />
          ),
        };
      }),
    [diagnosticSections]
  );

  const textureColumns: ColumnsType<TextureInfo> = [
    {
      title: '纹理',
      key: 'texture',
      render: (_, record) => <TextureNameCell texture={record} serverBaseUrl={serverBaseUrl} />,
      sorter: (a, b) => getTextureDisplayName(a).localeCompare(getTextureDisplayName(b)),
      width: 360,
    },
    {
      title: '压缩大小',
      key: 'estimatedBytes',
      render: (_: number, record) => formatBytes(getTextureEstimatedBytes(record)),
      sorter: (a, b) => getTextureEstimatedBytes(a) - getTextureEstimatedBytes(b),
      defaultSortOrder: 'descend',
    },
    {
      title: '原始大小',
      dataIndex: 'originalBytes',
      key: 'originalBytes',
      render: (value: number | undefined) => (value != null ? formatBytes(value) : '未知'),
      sorter: (a, b) => (a.originalBytes ?? 0) - (b.originalBytes ?? 0),
    },
    {
      title: '分辨率',
      key: 'resolution',
      render: (_, record) => `${record.width ?? 0} × ${record.height ?? 0}`,
      sorter: (a, b) => (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0),
    },
    {
      title: '压缩格式',
      key: 'compression',
      render: (_, record) => record.compressionFormat ?? record.formatName ?? record.format ?? '未知',
      sorter: (a, b) => {
        const valueA = a.compressionFormat ?? a.formatName ?? a.format ?? '';
        const valueB = b.compressionFormat ?? b.formatName ?? b.format ?? '';
        return String(valueA).localeCompare(String(valueB));
      },
    },
  ];

  const meshColumns: ColumnsType<MeshInfo> = [
    {
      title: '网格',
      key: 'mesh',
      render: (_, record) => <MeshSummary mesh={record} />,
      sorter: (a, b) => a.name.localeCompare(b.name),
      width: 320,
    },
    {
      title: '资产大小',
      dataIndex: 'assetBytes',
      key: 'assetBytes',
      render: (value: number | undefined) => (value != null ? formatBytes(value) : '未知'),
      sorter: (a, b) => (a.assetBytes ?? 0) - (b.assetBytes ?? 0),
      defaultSortOrder: 'descend',
    },
    {
      title: '顶点数',
      dataIndex: 'vertexCount',
      key: 'vertexCount',
      sorter: (a, b) => a.vertexCount - b.vertexCount,
    },
    {
      title: '子网格',
      dataIndex: 'subMeshCount',
      key: 'subMeshCount',
      sorter: (a, b) => a.subMeshCount - b.subMeshCount,
    },
  ];

  const renderTextureColumns: ColumnsType<RenderTextureInfo> = [
    {
      title: 'RenderTexture',
      key: 'renderTexture',
      render: (_, record) => (
        <RenderTextureNameCell renderTexture={record} serverBaseUrl={serverBaseUrl} />
      ),
      sorter: (a, b) => a.name.localeCompare(b.name),
      width: 320,
    },
    {
      title: '内存占用',
      dataIndex: 'EstimatedBytes',
      key: 'memory',
      render: (value: number) => formatBytes(value),
      sorter: (a, b) => a.EstimatedBytes - b.EstimatedBytes,
      defaultSortOrder: 'descend',
    },
    {
      title: '格式',
      key: 'format',
      render: (_, record) => record.graphicsFormat || record.format,
      sorter: (a, b) => (a.graphicsFormat || a.format || '').localeCompare(b.graphicsFormat || b.format || ''),
    },
    {
      title: '抗锯齿',
      dataIndex: 'antiAliasing',
      key: 'antiAliasing',
      render: (value: number) => `×${value}`,
      sorter: (a, b) => a.antiAliasing - b.antiAliasing,
    },
    {
      title: '分辨率',
      key: 'rtResolution',
      render: (_, record) => `${record.width} × ${record.height}`,
      sorter: (a, b) => a.width * a.height - b.width * b.height,
    },
  ];

  const materialColumns: ColumnsType<MaterialInfo> = [
    {
      title: '材质',
      key: 'material',
      render: (_, record) => <MaterialSummary material={record} />,
      sorter: (a, b) => (a.name || '').localeCompare(b.name || ''),
      width: 320,
    },
    {
      title: 'Shader',
      dataIndex: 'shaderName',
      key: 'shaderName',
      render: (value: string | undefined) => value || '未知',
      sorter: (a, b) => (a.shaderName || '').localeCompare(b.shaderName || ''),
    },
    {
      title: '渲染队列',
      dataIndex: 'renderQueue',
      key: 'renderQueue',
      sorter: (a, b) => (a.renderQueue ?? 0) - (b.renderQueue ?? 0),
    },
    {
      title: '关键字数',
      key: 'keywordCount',
      render: (_, record) => record.keywords?.length ?? 0,
      sorter: (a, b) => (a.keywords?.length ?? 0) - (b.keywords?.length ?? 0),
    },
    {
      title: '内存占用',
      dataIndex: 'memoryBytes',
      key: 'materialMemory',
      render: (value: number | undefined) => (value != null ? formatBytes(value) : '未知'),
      sorter: (a, b) => (a.memoryBytes ?? 0) - (b.memoryBytes ?? 0),
      defaultSortOrder: 'descend',
    },
  ];

  const shaderColumns: ColumnsType<ShaderInfo> = [
    {
      title: 'Shader',
      key: 'shader',
      render: (_, record) => <ShaderSummary shader={record} />,
      sorter: (a, b) => a.name.localeCompare(b.name),
      width: 360,
    },
    {
      title: '变体总数',
      dataIndex: 'totalVariantCount',
      key: 'totalVariants',
      render: (_: number | undefined, record) => formatInteger(getShaderVariantCount(record)),
      sorter: (a, b) => getShaderVariantCount(a) - getShaderVariantCount(b),
      defaultSortOrder: 'descend',
    },
    {
      title: 'Pass 数量',
      dataIndex: 'passCount',
      key: 'passes',
      sorter: (a, b) => a.passCount - b.passCount,
    },
    {
      title: '关键字数',
      key: 'keywordCount',
      render: (_, record) => record.keywords.length,
      sorter: (a, b) => a.keywords.length - b.keywords.length,
    },
    {
      title: '内存占用',
      dataIndex: 'memoryBytes',
      key: 'shaderMemory',
      render: (value: number | undefined) => (value != null ? formatBytes(value) : '未知'),
      sorter: (a, b) => (a.memoryBytes ?? 0) - (b.memoryBytes ?? 0),
    },
  ];

  if (!frame) {
    return (
      <Card title="资源总览" style={{ flex: 1 }}>
        <Empty description="请在性能趋势图中选择一帧以查看资源详情" />
      </Card>
    );
  }

  const textureTotal = formatBytes(
    frame.totalTextureBytes ?? sumBy(allTextures, (texture) => getTextureEstimatedBytes(texture))
  );
  const meshTotal = formatBytes(frame.totalMeshBytes);
  const renderTextureTotal = formatBytes(frame.totalRenderTextureBytes ?? (frame.renderTextures ?? []).reduce((sum, item) => sum + (item?.EstimatedBytes ?? 0), 0));
  const materialTotal = formatBytes(
    frame.totalMaterialBytes ?? (frame.materials ?? []).reduce((sum, material) => sum + (material.memoryBytes ?? 0), 0)
  );
  const filteredTextureTotal = formatBytes(
    sumBy(filteredTextures, (texture) => getTextureEstimatedBytes(texture))
  );
  const filteredRenderTextureTotal = formatBytes(filteredRenderTextures.reduce((sum, rt) => sum + rt.EstimatedBytes, 0));
  const filteredMaterialTotal = formatBytes(
    filteredMaterials.reduce((sum, material) => sum + (material.memoryBytes ?? 0), 0)
  );
  const filteredMeshTotal = formatBytes(
    filteredMeshes.reduce((sum, mesh) => sum + (mesh.assetBytes ?? mesh.EstimatedBytes ?? 0), 0)
  );
  const shaderKeywordTotal = filteredShaders.reduce((acc, shader) => acc + shader.keywords.length, 0);

  return (
    <CollapsibleCard
      title={
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{`第 ${frame.frameNumber} 帧资源详情`}</Typography.Text>
          <Typography.Text type="secondary">
            捕获时间 {new Date(frame.timestampUtc).toLocaleString()} · {filteredTextures.length} 纹理 ·{' '}
            {filteredRenderTextures.length} RenderTexture · {filteredMaterials.length} 材质 · {filteredMeshes.length} 网格 ·{' '}
            {filteredShaders.length} Shader · 变体总数 {formatInteger(shaderVariantStats.totalVariants)}
          </Typography.Text>
        </Space>
      }
      style={{ flex: 1 }}
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Space wrap size={[16, 12]}>
          <Tag color="geekblue">纹理总大小 {textureTotal}</Tag>
          <Tag color="orange">RenderTexture {renderTextureTotal}</Tag>
          <Tag color="cyan">材质 {materialTotal}</Tag>
          <Tag color="purple">网格总大小 {meshTotal}</Tag>
          <Tag color="magenta">Shader 变体总数 {formatInteger(shaderVariantStats.totalVariants)}</Tag>
          <Tag color="gold">帧率 {formatFps(frame.fps)}</Tag>
        </Space>
        <Space style={{ width: '100%', flexWrap: 'wrap' }} size={12}>
          <Input.Search
            allowClear
            placeholder="根据名称或路径过滤资源"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            style={{ maxWidth: 320 }}
          />
        </Space>
        {hasSummaryData ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Typography.Title level={5} style={{ margin: 0 }}>
              资源类型概览
            </Typography.Title>
            <Space wrap size={16} style={{ width: '100%' }}>
              {resourceSummaryItems.map((item) => (
                <ResourceSummaryCard key={item.key} item={item} />
              ))}
            </Space>
          </Space>
        ) : null}
        {hasDiagnostics ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Typography.Title level={5} style={{ margin: 0 }}>
              资源健康诊断
            </Typography.Title>
            <Typography.Text type="secondary">
              自动巡检纹理、RenderTexture、材质与网格的潜在风险，辅助内容优化。
            </Typography.Text>
            <Collapse
              bordered={false}
              style={{ width: '100%' }}
              items={diagnosticCollapseItems}
              defaultActiveKey={diagnosticCollapseItems.map((item) => item.key)}
            />
          </Space>
        ) : null}
        {hasHotspotData ? (
          <CollapsibleSection title="资源热点榜单" contentStyle={{ width: '100%' }}>
            <div style={hotspotGridStyle}>
              {topTextureHotspots.length ? (
                <HotspotList title={`纹理内存 Top ${hotspotLimit}`} items={topTextureHotspots} />
              ) : null}
              {topRenderTextureHotspots.length ? (
                <HotspotList
                  title={`RenderTexture Top ${hotspotLimit}`}
                  items={topRenderTextureHotspots}
                />
              ) : null}
              {topMaterialHotspots.length ? (
                <HotspotList title={`材质内存 Top ${hotspotLimit}`} items={topMaterialHotspots} />
              ) : null}
              {topMeshHotspots.length ? (
                <HotspotList title={`网格内存 Top ${hotspotLimit}`} items={topMeshHotspots} />
              ) : null}
            </div>
          </CollapsibleSection>
        ) : null}
        {hasLifecycleInsights ? (
          <CollapsibleSection title="生命周期洞察" contentStyle={{ width: '100%' }}>
            <div style={lifecycleGridStyle}>
              {lifecycleTextures.length ? (
                <LifecycleList title={`长驻纹理 Top ${lifecycleLimit}`} items={lifecycleTextures} />
              ) : null}
              {lifecycleRenderTextures.length ? (
                <LifecycleList
                  title={`长驻 RenderTexture Top ${lifecycleLimit}`}
                  items={lifecycleRenderTextures}
                />
              ) : null}
              {lifecycleMaterials.length ? (
                <LifecycleList title={`长驻材质 Top ${lifecycleLimit}`} items={lifecycleMaterials} />
              ) : null}
              {lifecycleMeshes.length ? (
                <LifecycleList title={`长驻网格 Top ${lifecycleLimit}`} items={lifecycleMeshes} />
              ) : null}
            </div>
          </CollapsibleSection>
        ) : null}
        <Collapse
          bordered={false}
          activeKey={activeResourceSections}
          onChange={(keys) =>
            setActiveResourceSections(Array.isArray(keys) ? keys.map((key) => String(key)) : [String(keys)])
          }
          items={[
            {
              key: 'textures',
              label: `纹理 (${filteredTextures.length})`,
              extra: <Typography.Text type="secondary">当前列表大小 {filteredTextureTotal}</Typography.Text>,
              children: (
                <>
                  {hasTextureReferences ? (
                    <Typography.Text type="secondary" style={{ marginBottom: 8, display: 'block' }}>
                      纹理详情按需加载中…
                    </Typography.Text>
                  ) : null}
                  <Table
                    rowKey={(record, index) =>
                      record.textureId ??
                      `${getTextureDisplayName(record)}-${record.width ?? 0}-${record.height ?? 0}-${index}`
                    }
                    dataSource={filteredTextures}
                    columns={textureColumns}
                    pagination={{ pageSize: 8, hideOnSinglePage: true }}
                    size="small"
                    loading={isTextureLoading}
                    expandable={{
                      expandedRowRender: (record) => <TextureDetails texture={record} />,
                      columnWidth: 48,
                    }}
                  />
                </>
              ),
            },
            {
              key: 'renderTextures',
              label: `RenderTexture (${filteredRenderTextures.length})`,
              extra: (
                <Typography.Text type="secondary">当前列表大小 {filteredRenderTextureTotal}</Typography.Text>
              ),
              children: (
                <Table
                  rowKey={(record) => `${record.name}-${record.width}-${record.height}-${record.graphicsFormat}`}
                  dataSource={filteredRenderTextures}
                  columns={renderTextureColumns}
                  pagination={{ pageSize: 8, hideOnSinglePage: true }}
                  size="small"
                  expandable={{
                    expandedRowRender: (record) => <RenderTextureDetails renderTexture={record} />,
                    columnWidth: 48,
                  }}
                />
              ),
            },
            {
              key: 'materials',
              label: `材质 (${filteredMaterials.length})`,
              extra: <Typography.Text type="secondary">当前列表大小 {filteredMaterialTotal}</Typography.Text>,
              children: (
                <Table
                  rowKey={(record) => `${record.name}-${record.shaderName ?? 'unknown'}-${record.renderQueue}`}
                  dataSource={filteredMaterials}
                  columns={materialColumns}
                  pagination={{ pageSize: 8, hideOnSinglePage: true }}
                  size="small"
                  expandable={{
                    expandedRowRender: (record) => <MaterialDetails material={record} />,
                    columnWidth: 48,
                  }}
                />
              ),
            },
            {
              key: 'meshes',
              label: `网格 (${filteredMeshes.length})`,
              extra: <Typography.Text type="secondary">当前列表大小 {filteredMeshTotal}</Typography.Text>,
              children: (
                <Table
                  rowKey={(record) => `${record.name}-${record.vertexCount}`}
                  dataSource={filteredMeshes}
                  columns={meshColumns}
                  pagination={{ pageSize: 8, hideOnSinglePage: true }}
                  size="small"
                  expandable={{
                    expandedRowRender: (record) => <MeshDetails mesh={record} />,
                    columnWidth: 48,
                  }}
                />
              ),
            },
            {
              key: 'shaders',
              label: `Shader (${filteredShaders.length})`,
              extra: (
                <Typography.Text type="secondary">
                  关键词 {shaderKeywordTotal} · 变体总数 {formatInteger(shaderVariantStats.totalVariants)}
                </Typography.Text>
              ),
              children: (
                <Table
                  rowKey={(record) => record.name}
                  dataSource={filteredShaders}
                  columns={shaderColumns}
                  pagination={{ pageSize: 8, hideOnSinglePage: true }}
                  size="small"
                  expandable={{
                    expandedRowRender: (record) => <ShaderDetails shader={record} />,
                    columnWidth: 48,
                  }}
                />
              ),
            },
          ]}
        />
      </Space>
    </CollapsibleCard>
  );
}

