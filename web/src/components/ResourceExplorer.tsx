import { useMemo, useState } from 'react';
import {
  Card,
  Collapse,
  Empty,
  Image,
  Input,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type {
  MeshInfo,
  RenderTextureInfo,
  ShaderInfo,
  TelemetrySnapshot,
  TextureInfo,
} from '../types';
import { formatBytes, formatFps, formatPercentage } from '../utils/format';

interface ResourceExplorerProps {
  frame: TelemetrySnapshot | null;
  serverBaseUrl: string;
}

type SortKey = 'size' | 'name';

type SortOrder = 'asc' | 'desc';

function sortBy<T>(items: T[], selector: (item: T) => number | string, order: SortOrder): T[] {
  return [...items].sort((a, b) => {
    const valueA = selector(a);
    const valueB = selector(b);
    if (typeof valueA === 'number' && typeof valueB === 'number') {
      return order === 'asc' ? valueA - valueB : valueB - valueA;
    }
    return order === 'asc'
      ? String(valueA).localeCompare(String(valueB))
      : String(valueB).localeCompare(String(valueA));
  });
}

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

function dedupeTextures(textures: TextureInfo[]): TextureInfo[] {
  const map = new Map<string, TextureInfo>();
  textures.forEach((texture) => {
    const name = typeof texture.name === 'string' ? texture.name.trim() : '';
    const path = typeof texture.path === 'string' ? texture.path.trim() : '';
    const key = name || path || `${texture.width}x${texture.height}`;
    const existing = map.get(key);
    if (!existing || existing.EstimatedBytes < texture.EstimatedBytes) {
      map.set(key, texture);
    }
  });
  return Array.from(map.values());
}

function resolvePreviewSource(texture: TextureInfo, serverBaseUrl: string): string | null {
  if (texture.previewBase64) {
    const trimmed = texture.previewBase64.trim();
    if (trimmed.length > 0) {
      return trimmed.startsWith('data:') ? trimmed : `data:image/png;base64,${trimmed}`;
    }
  }

  if (texture.previewUrl) {
    if (/^https?:/i.test(texture.previewUrl)) {
      return texture.previewUrl;
    }

    const base = serverBaseUrl.endsWith('/') ? serverBaseUrl.slice(0, -1) : serverBaseUrl;
    const relative = texture.previewUrl.startsWith('/') ? texture.previewUrl : `/${texture.previewUrl}`;
    return `${base}${relative}`;
  }

  return null;
}

function TextureNameCell({ texture, serverBaseUrl }: { texture: TextureInfo; serverBaseUrl: string }) {
  const previewSrc = useMemo(
    () => resolvePreviewSource(texture, serverBaseUrl),
    [texture, serverBaseUrl]
  );
  const hasPreview = Boolean(previewSrc);
  const placeholderLabel = texture.name.slice(0, 2).toUpperCase();

  return (
    <Space align="start">
      {hasPreview ? (
        <Image
          src={previewSrc ?? undefined}
          width={56}
          height={56}
          style={{ borderRadius: 8, objectFit: 'cover' }}
          alt={texture.name}
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
      <Typography.Text strong>{texture.name}</Typography.Text>
    </Space>
  );
}

function TextureDetails({ texture }: { texture: TextureInfo }) {
  const compressionFormat = texture.compressionFormat ?? texture.formatName ?? texture.format ?? '未知';
  const compressionRatio = texture.originalBytes > 0
    ? formatPercentage(texture.EstimatedBytes / texture.originalBytes)
    : '—';
  const wrapLabel = formatWrapMode(texture.wrapMode);
  const filterLabel = formatFilterMode(texture.filterMode);

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Typography.Text type="secondary">
        资源路径：{texture.path || '未提供资源路径'}
      </Typography.Text>
      <Space wrap size={[8, 6]}>
        <Tag color="blue">原始大小 {texture.originalBytes ? formatBytes(texture.originalBytes) : '未知'}</Tag>
        <Tag color="green">压缩后 {formatBytes(texture.EstimatedBytes)}</Tag>
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
        <Tag color="geekblue">资产大小 {mesh.assetBytes ? formatBytes(mesh.assetBytes) : '未知'}</Tag>
        <Tag color="purple">运行时 {formatBytes(mesh.EstimatedBytes)}</Tag>
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

function ShaderSummary({ shader }: { shader: ShaderInfo }) {
  return <Typography.Text strong>{shader.name}</Typography.Text>;
}

function ShaderDetails({ shader }: { shader: ShaderInfo }) {
  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Typography.Text type="secondary">
        资源路径：{shader.path || '未提供资源路径'}
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

export default function ResourceExplorer({ frame, serverBaseUrl }: ResourceExplorerProps) {
  const [sortKey, setSortKey] = useState<SortKey>('size');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [searchTerm, setSearchTerm] = useState('');

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredTextures = useMemo(() => {
    if (!frame) return [];
    const subset = (frame.textures ?? []).filter((texture) =>
      `${texture.name} ${texture.path}`.toLowerCase().includes(normalizedSearch)
    );
    const unique = dedupeTextures(subset);
    if (sortKey === 'size') {
      return sortBy(unique, (t) => t.EstimatedBytes, sortOrder);
    }
    return sortBy(unique, (t) => t.name, sortOrder);
  }, [frame, normalizedSearch, sortKey, sortOrder]);

  const filteredRenderTextures = useMemo(() => {
    if (!frame) return [];
    const subset = (frame.renderTextures ?? []).filter((rt) =>
      `${rt.name}`.toLowerCase().includes(normalizedSearch)
    );
    if (sortKey === 'size') {
      return sortBy(subset, (rt) => rt.EstimatedBytes, sortOrder);
    }
    return sortBy(subset, (rt) => rt.name, sortOrder);
  }, [frame, normalizedSearch, sortKey, sortOrder]);

  const filteredMeshes = useMemo(() => {
    if (!frame) return [];
    const subset = (frame.meshes ?? []).filter((mesh) =>
      `${mesh.name} ${mesh.path}`.toLowerCase().includes(normalizedSearch)
    );
    if (sortKey === 'size') {
      return sortBy(subset, (m) => m.EstimatedBytes, sortOrder);
    }
    return sortBy(subset, (m) => m.name, sortOrder);
  }, [frame, normalizedSearch, sortKey, sortOrder]);

  const filteredShaders = useMemo(() => {
    if (!frame) return [];
    const subset = (frame.shaders ?? []).filter((shader) =>
      `${shader.name} ${shader.path}`.toLowerCase().includes(normalizedSearch)
    );
    if (sortKey === 'size') {
      return sortBy(subset, (s) => s.passCount, sortOrder);
    }
    return sortBy(subset, (s) => s.name, sortOrder);
  }, [frame, normalizedSearch, sortKey, sortOrder]);

  const textureColumns: ColumnsType<TextureInfo> = [
    {
      title: '纹理',
      key: 'texture',
      render: (_, record) => <TextureNameCell texture={record} serverBaseUrl={serverBaseUrl} />,
      width: 360,
    },
    {
      title: '压缩大小',
      dataIndex: 'EstimatedBytes',
      key: 'estimatedBytes',
      render: (value: number) => formatBytes(value),
    },
    {
      title: '分辨率',
      key: 'resolution',
      render: (_, record) => `${record.width} × ${record.height}`,
    },
    {
      title: '压缩格式',
      key: 'compression',
      render: (_, record) => record.compressionFormat ?? record.formatName ?? record.format ?? '未知',
    },
  ];

  const meshColumns: ColumnsType<MeshInfo> = [
    {
      title: '网格',
      key: 'mesh',
      render: (_, record) => <MeshSummary mesh={record} />,
      width: 320,
    },
    {
      title: '资产大小',
      dataIndex: 'assetBytes',
      key: 'assetBytes',
      render: (value: number | undefined) => (value ? formatBytes(value) : '未知'),
    },
    {
      title: '运行时大小',
      dataIndex: 'EstimatedBytes',
      key: 'runtimeSize',
      render: (value: number) => formatBytes(value),
    },
    {
      title: '顶点数',
      dataIndex: 'vertexCount',
      key: 'vertexCount',
    },
  ];

  const renderTextureColumns: ColumnsType<RenderTextureInfo> = [
    {
      title: 'RenderTexture',
      key: 'renderTexture',
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{record.name || '未命名 RenderTexture'}</Typography.Text>
          <Typography.Text type="secondary">{record.width} × {record.height}</Typography.Text>
        </Space>
      ),
      width: 280,
    },
    {
      title: '内存占用',
      dataIndex: 'EstimatedBytes',
      key: 'memory',
      render: (value: number) => formatBytes(value),
    },
    {
      title: '格式',
      key: 'format',
      render: (_, record) => record.graphicsFormat || record.format,
    },
    {
      title: '抗锯齿',
      dataIndex: 'antiAliasing',
      key: 'antiAliasing',
      render: (value: number) => `×${value}`,
    },
  ];

  const shaderColumns: ColumnsType<ShaderInfo> = [
    {
      title: 'Shader',
      key: 'shader',
      render: (_, record) => <ShaderSummary shader={record} />,
      width: 360,
    },
    {
      title: 'Pass 数量',
      dataIndex: 'passCount',
      key: 'passes',
    },
    {
      title: '关键字数',
      key: 'keywordCount',
      render: (_, record) => record.keywords.length,
    },
  ];

  if (!frame) {
    return (
      <Card title="资源总览" style={{ flex: 1 }}>
        <Empty description="请选择性能趋势图中的某一帧以查看资源详情" />
      </Card>
    );
  }

  const textureTotal = formatBytes(frame.totalTextureBytes);
  const meshTotal = formatBytes(frame.totalMeshBytes);
  const renderTextureTotal = formatBytes(frame.totalRenderTextureBytes ?? (frame.renderTextures ?? []).reduce((sum, item) => sum + (item?.EstimatedBytes ?? 0), 0));
  const filteredTextureTotal = formatBytes(filteredTextures.reduce((sum, texture) => sum + texture.EstimatedBytes, 0));
  const filteredRenderTextureTotal = formatBytes(filteredRenderTextures.reduce((sum, rt) => sum + rt.EstimatedBytes, 0));
  const filteredMeshTotal = formatBytes(filteredMeshes.reduce((sum, mesh) => sum + mesh.EstimatedBytes, 0));
  const shaderKeywordTotal = filteredShaders.reduce((acc, shader) => acc + shader.keywords.length, 0);

  return (
    <Card
      title={
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{`第 ${frame.frameNumber} 帧资源详情`}</Typography.Text>
          <Typography.Text type="secondary">
            捕获时间 {new Date(frame.timestampUtc).toLocaleString()} · {frame.textures.length} 纹理 ·{' '}
            {frame.renderTextures?.length ?? 0} RenderTexture · {frame.meshes.length} 网格 · {frame.shaders.length} Shader
          </Typography.Text>
        </Space>
      }
      style={{ flex: 1 }}
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Space wrap size={[16, 12]}>
          <Tag color="geekblue">纹理总大小 {textureTotal}</Tag>
          <Tag color="orange">RenderTexture {renderTextureTotal}</Tag>
          <Tag color="purple">网格总大小 {meshTotal}</Tag>
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
          <Segmented
            options={[
              { label: '按大小', value: 'size' },
              { label: '按名称', value: 'name' },
            ]}
            value={sortKey}
            onChange={(value) => setSortKey(value as SortKey)}
          />
          <Segmented
            options={[
              { label: '降序', value: 'desc' },
              { label: '升序', value: 'asc' },
            ]}
            value={sortOrder}
            onChange={(value) => setSortOrder(value as SortOrder)}
          />
        </Space>
        <Collapse
          bordered={false}
          defaultActiveKey={['textures', 'renderTextures']}
          items={[
            {
              key: 'textures',
              label: `纹理 (${filteredTextures.length})`,
              extra: <Typography.Text type="secondary">当前列表大小 {filteredTextureTotal}</Typography.Text>,
              children: (
                <Table
                  rowKey={(record) => `${record.name}-${record.width}-${record.height}-${record.format}`}
                  dataSource={filteredTextures}
                  columns={textureColumns}
                  pagination={{ pageSize: 8, hideOnSinglePage: true }}
                  size="small"
                  expandable={{
                    expandedRowRender: (record) => <TextureDetails texture={record} />,
                    columnWidth: 48,
                  }}
                />
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
              extra: <Typography.Text type="secondary">关键词 {shaderKeywordTotal}</Typography.Text>,
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
    </Card>
  );
}

