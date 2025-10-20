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
import type { MeshInfo, ShaderInfo, TelemetrySnapshot, TextureInfo } from '../types';
import { formatBytes, formatFps, formatPercentage } from '../utils/format';

interface ResourceExplorerProps {
  frame: TelemetrySnapshot | null;
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

function TextureNameCell({ texture }: { texture: TextureInfo }) {
  const previewSrc = useMemo(() => {
    if (texture.previewUrl) {
      return texture.previewUrl;
    }
    if (texture.previewBase64) {
      const trimmed = texture.previewBase64.trim();
      return trimmed.startsWith('data:') ? trimmed : `data:image/png;base64,${trimmed}`;
    }
    return null;
  }, [texture.previewUrl, texture.previewBase64]);

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
      <Space direction="vertical" size={2} style={{ maxWidth: 320 }}>
        <Typography.Text strong>{texture.name}</Typography.Text>
        <Typography.Text type="secondary" ellipsis style={{ maxWidth: 320 }}>
          {texture.path || '未提供资源路径'}
        </Typography.Text>
      </Space>
    </Space>
  );
}

export default function ResourceExplorer({ frame }: ResourceExplorerProps) {
  const [sortKey, setSortKey] = useState<SortKey>('size');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [searchTerm, setSearchTerm] = useState('');

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredTextures = useMemo(() => {
    if (!frame) return [];
    const subset = frame.textures.filter((texture) =>
      `${texture.name} ${texture.path}`.toLowerCase().includes(normalizedSearch)
    );
    if (sortKey === 'size') {
      return sortBy(subset, (t) => t.EstimatedBytes, sortOrder);
    }
    return sortBy(subset, (t) => t.name, sortOrder);
  }, [frame, normalizedSearch, sortKey, sortOrder]);

  const filteredMeshes = useMemo(() => {
    if (!frame) return [];
    const subset = frame.meshes.filter((mesh) =>
      `${mesh.name} ${mesh.path}`.toLowerCase().includes(normalizedSearch)
    );
    if (sortKey === 'size') {
      return sortBy(subset, (m) => m.EstimatedBytes, sortOrder);
    }
    return sortBy(subset, (m) => m.name, sortOrder);
  }, [frame, normalizedSearch, sortKey, sortOrder]);

  const filteredShaders = useMemo(() => {
    if (!frame) return [];
    const subset = frame.shaders.filter((shader) =>
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
      render: (_, record) => <TextureNameCell texture={record} />,
      width: 360,
    },
    {
      title: '分辨率',
      key: 'resolution',
      render: (_, record) => `${record.width} × ${record.height}`,
    },
    {
      title: '源图大小',
      dataIndex: 'originalBytes',
      key: 'originalBytes',
      render: (value: number) => (value ? formatBytes(value) : '未知'),
    },
    {
      title: '压缩后大小',
      dataIndex: 'EstimatedBytes',
      key: 'estimatedBytes',
      render: (value: number) => formatBytes(value),
    },
    {
      title: '压缩率',
      key: 'compressionRate',
      render: (_, record) =>
        record.originalBytes > 0 ? formatPercentage(record.EstimatedBytes / record.originalBytes) : '—',
    },
    {
      title: '压缩格式',
      key: 'compression',
      render: (_, record) => record.compressionFormat ?? record.format ?? '未知',
    },
  ];

  const meshColumns: ColumnsType<MeshInfo> = [
    {
      title: '网格',
      key: 'mesh',
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{record.name}</Typography.Text>
          <Typography.Text type="secondary" ellipsis style={{ maxWidth: 320 }}>
            {record.path || '未提供资源路径'}
          </Typography.Text>
        </Space>
      ),
      width: 320,
    },
    { title: '顶点数', dataIndex: 'vertexCount', key: 'vertexCount' },
    { title: '子网格数', dataIndex: 'subMeshCount', key: 'subMeshCount' },
    {
      title: '运行时大小',
      dataIndex: 'EstimatedBytes',
      key: 'runtimeSize',
      render: (value: number) => formatBytes(value),
    },
  ];

  const shaderColumns: ColumnsType<ShaderInfo> = [
    {
      title: 'Shader',
      key: 'shader',
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{record.name}</Typography.Text>
          <Typography.Text type="secondary" ellipsis style={{ maxWidth: 360 }}>
            {record.path || '未提供资源路径'}
          </Typography.Text>
        </Space>
      ),
      width: 360,
    },
    {
      title: 'Pass 数量',
      dataIndex: 'passCount',
      key: 'passes',
    },
    {
      title: '关键字',
      key: 'keywords',
      render: (_, record) => (
        <Space wrap size={[4, 4]}>
          {record.keywords.length === 0 ? <Tag color="default">无</Tag> : null}
          {record.keywords.map((keyword) => (
            <Tag key={keyword}>{keyword}</Tag>
          ))}
        </Space>
      ),
    },
  ];

  if (!frame) {
    return (
      <Card title="资源总览" style={{ flex: 1 }}>
        <Empty description="请选择时间轴上的某一帧查看资源详情" />
      </Card>
    );
  }

  const textureTotal = formatBytes(frame.totalTextureBytes);
  const meshTotal = formatBytes(frame.totalMeshBytes);
  const filteredTextureTotal = formatBytes(
    filteredTextures.reduce((sum, texture) => sum + texture.EstimatedBytes, 0)
  );
  const filteredMeshTotal = formatBytes(filteredMeshes.reduce((sum, mesh) => sum + mesh.EstimatedBytes, 0));
  const shaderKeywordTotal = filteredShaders.reduce((acc, shader) => acc + shader.keywords.length, 0);

  return (
    <Card
      title={
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{`第 ${frame.frameNumber} 帧资源详情`}</Typography.Text>
          <Typography.Text type="secondary">
            捕获时间 {new Date(frame.timestampUtc).toLocaleString()} · {frame.textures.length} 纹理 ·{' '}
            {frame.meshes.length} 网格 · {frame.shaders.length} Shader
          </Typography.Text>
        </Space>
      }
      style={{ flex: 1 }}
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Space wrap size={[16, 12]}>
          <Tag color="geekblue">纹理总大小 {textureTotal}</Tag>
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
          defaultActiveKey={[]}
          items={[
            {
              key: 'textures',
              label: `纹理 (${filteredTextures.length})`,
              extra: <Typography.Text type="secondary">当前列表大小 {filteredTextureTotal}</Typography.Text>,
              children: (
                <Table
                  rowKey={(record) => `${record.name}-${record.width}-${record.height}`}
                  dataSource={filteredTextures}
                  columns={textureColumns}
                  pagination={{ pageSize: 8, hideOnSinglePage: true }}
                  size="small"
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
                />
              ),
            },
          ]}
        />
      </Space>
    </Card>
  );
}
