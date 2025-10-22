import { useMemo, useState } from 'react';
import {
  Card,
  Collapse,
  Empty,
  Image,
  Input,
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
  TelemetrySnapshot,
  TextureInfo,
} from '../types';
import { formatBytes, formatFps, formatInteger, formatPercentage } from '../utils/format';
import { resolvePreviewSource } from '../utils/preview';

interface ResourceExplorerProps {
  frame: TelemetrySnapshot | null;
  serverBaseUrl: string;
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

function TextureNameCell({ texture, serverBaseUrl }: { texture: TextureInfo; serverBaseUrl: string }) {
  const previewSrc = useMemo(
    () => resolvePreviewSource(texture, serverBaseUrl),
    [texture, serverBaseUrl]
  );
  const hasPreview = Boolean(previewSrc);
  const placeholderLabel = (texture.name || 'TX').slice(0, 2).toUpperCase();

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
        <Tag color="blue">
          原始大小 {texture.originalBytes != null ? formatBytes(texture.originalBytes) : '未知'}
        </Tag>
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
  return (
    <Space direction="vertical" size={0}>
      <Typography.Text strong>{shader.name}</Typography.Text>
      <Typography.Text type="secondary">
        Pass 数量 {shader.passCount} · 关键字 {formatInteger(shader.keywords.length)}
      </Typography.Text>
    </Space>
  );
}

function ShaderDetails({ shader }: { shader: ShaderInfo }) {
  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Typography.Text type="secondary">
        资源路径：{shader.path || '未提供资源路径'}
      </Typography.Text>
      <Typography.Text type="secondary">
        Pass 数量：{formatInteger(shader.passCount)} · 关键字：{formatInteger(shader.keywords.length)}
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
  const [searchTerm, setSearchTerm] = useState('');

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredTextures = useMemo(() => {
    if (!frame) return [];
    const subset = (frame.textures ?? [])
      .filter((texture) => !isRenderTextureLike(texture))
      .filter((texture) => `${texture.name} ${texture.path}`.toLowerCase().includes(normalizedSearch));
    const unique = dedupeTextures(subset);
    return unique;
  }, [frame, normalizedSearch]);

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

  const textureColumns: ColumnsType<TextureInfo> = [
    {
      title: '纹理',
      key: 'texture',
      render: (_, record) => <TextureNameCell texture={record} serverBaseUrl={serverBaseUrl} />,
      sorter: (a, b) => a.name.localeCompare(b.name),
      width: 360,
    },
    {
      title: '压缩大小',
      dataIndex: 'EstimatedBytes',
      key: 'estimatedBytes',
      render: (value: number) => formatBytes(value),
      sorter: (a, b) => a.EstimatedBytes - b.EstimatedBytes,
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
      render: (_, record) => `${record.width} × ${record.height}`,
      sorter: (a, b) => a.width * a.height - b.width * b.height,
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
      defaultSortOrder: 'descend',
    },
  ];

  if (!frame) {
    return (
      <Card title="资源总览" style={{ flex: 1 }}>
        <Empty description="请在性能趋势图中选择一帧以查看资源详情" />
      </Card>
    );
  }

  const textureTotal = formatBytes(frame.totalTextureBytes ?? filteredTextures.reduce((sum, texture) => sum + texture.EstimatedBytes, 0));
  const meshTotal = formatBytes(frame.totalMeshBytes);
  const renderTextureTotal = formatBytes(frame.totalRenderTextureBytes ?? (frame.renderTextures ?? []).reduce((sum, item) => sum + (item?.EstimatedBytes ?? 0), 0));
  const materialTotal = formatBytes(
    frame.totalMaterialBytes ?? (frame.materials ?? []).reduce((sum, material) => sum + (material.memoryBytes ?? 0), 0)
  );
  const filteredTextureTotal = formatBytes(filteredTextures.reduce((sum, texture) => sum + texture.EstimatedBytes, 0));
  const filteredRenderTextureTotal = formatBytes(filteredRenderTextures.reduce((sum, rt) => sum + rt.EstimatedBytes, 0));
  const filteredMaterialTotal = formatBytes(
    filteredMaterials.reduce((sum, material) => sum + (material.memoryBytes ?? 0), 0)
  );
  const filteredMeshTotal = formatBytes(
    filteredMeshes.reduce((sum, mesh) => sum + (mesh.assetBytes ?? mesh.EstimatedBytes ?? 0), 0)
  );
  const shaderKeywordTotal = filteredShaders.reduce((acc, shader) => acc + shader.keywords.length, 0);

  return (
    <Card
      title={
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{`第 ${frame.frameNumber} 帧资源详情`}</Typography.Text>
          <Typography.Text type="secondary">
            捕获时间 {new Date(frame.timestampUtc).toLocaleString()} · {filteredTextures.length} 纹理 ·{' '}
            {filteredRenderTextures.length} RenderTexture · {filteredMaterials.length} 材质 · {filteredMeshes.length} 网格 ·{' '}
            {filteredShaders.length} Shader · 关键字总数 {formatInteger(shaderKeywordTotal)}
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
          <Tag color="magenta">Shader 关键字总数 {formatInteger(shaderKeywordTotal)}</Tag>
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
        <Collapse
          bordered={false}
          defaultActiveKey={['textures', 'renderTextures', 'materials']}
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
                  关键词总数 {shaderKeywordTotal}
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
    </Card>
  );
}

