import { useMemo, useState } from 'react';
import { Card, Empty, Input, Segmented, Space, Table, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MeshInfo, ShaderInfo, TelemetrySnapshot, TextureInfo } from '../types';
import { formatBytes } from '../utils/format';

interface ResourceExplorerProps {
  frame: TelemetrySnapshot | null;
}

type SortKey = 'size' | 'name';

function sortBy<T>(items: T[], selector: (item: T) => number | string, order: 'asc' | 'desc'): T[] {
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

export default function ResourceExplorer({ frame }: ResourceExplorerProps) {
  const [sortKey, setSortKey] = useState<SortKey>('size');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredTextures = useMemo(() => {
    if (!frame) return [];
    const subset = frame.textures.filter((texture) => texture.name.toLowerCase().includes(searchTerm.toLowerCase()));
    if (sortKey === 'size') {
      return sortBy(subset, (t) => t.EstimatedBytes, sortOrder);
    }
    return sortBy(subset, (t) => t.name, sortOrder);
  }, [frame, searchTerm, sortKey, sortOrder]);

  const filteredMeshes = useMemo(() => {
    if (!frame) return [];
    const subset = frame.meshes.filter((mesh) => mesh.name.toLowerCase().includes(searchTerm.toLowerCase()));
    if (sortKey === 'size') {
      return sortBy(subset, (m) => m.EstimatedBytes, sortOrder);
    }
    return sortBy(subset, (m) => m.name, sortOrder);
  }, [frame, searchTerm, sortKey, sortOrder]);

  const filteredShaders = useMemo(() => {
    if (!frame) return [];
    const subset = frame.shaders.filter((shader) => shader.name.toLowerCase().includes(searchTerm.toLowerCase()));
    if (sortKey === 'size') {
      return sortBy(subset, (s) => s.passCount, sortOrder);
    }
    return sortBy(subset, (s) => s.name, sortOrder);
  }, [frame, searchTerm, sortKey, sortOrder]);

  const textureColumns: ColumnsType<TextureInfo> = [
    { title: 'Texture', dataIndex: 'name', key: 'name', width: 240 },
    {
      title: 'Resolution',
      key: 'resolution',
      render: (_, record) => `${record.width}×${record.height}`,
    },
    {
      title: 'Runtime Size',
      dataIndex: 'EstimatedBytes',
      key: 'runtimeSize',
      render: (value: number) => formatBytes(value),
    },
    {
      title: 'Original Size',
      dataIndex: 'originalBytes',
      key: 'originalSize',
      render: (value: number) => formatBytes(value),
    },
    {
      title: 'Format',
      dataIndex: 'format',
      key: 'format',
    },
  ];

  const meshColumns: ColumnsType<MeshInfo> = [
    { title: 'Mesh', dataIndex: 'name', key: 'name', width: 240 },
    { title: 'Vertices', dataIndex: 'vertexCount', key: 'vertices' },
    { title: 'Sub Meshes', dataIndex: 'subMeshCount', key: 'subMeshes' },
    {
      title: 'Runtime Size',
      dataIndex: 'EstimatedBytes',
      key: 'runtimeSize',
      render: (value: number) => formatBytes(value),
    },
  ];

  const shaderColumns: ColumnsType<ShaderInfo> = [
    { title: 'Shader', dataIndex: 'name', key: 'name', width: 260 },
    {
      title: 'Passes',
      dataIndex: 'passCount',
      key: 'passes',
    },
    {
      title: 'Keywords',
      key: 'keywords',
      render: (_, record) => (
        <Space wrap size={[4, 4]}>
          {record.keywords.map((keyword) => (
            <Tag key={keyword}>{keyword}</Tag>
          ))}
        </Space>
      ),
    },
  ];

  if (!frame) {
    return (
      <Card title="Resource Browser" style={{ flex: 1 }}>
        <Empty description="Select a frame from the timeline to inspect resources" />
      </Card>
    );
  }

  return (
    <Card
      title={
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{`Frame #${frame.frameNumber}`}</Typography.Text>
          <Typography.Text type="secondary">Captured at {new Date(frame.timestampUtc).toLocaleString()}</Typography.Text>
        </Space>
      }
      style={{ flex: 1 }}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space style={{ width: '100%' }}>
          <Input.Search
            allowClear
            placeholder="Search resources by name"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            style={{ maxWidth: 320 }}
          />
          <Segmented
            options={[
              { label: 'Size', value: 'size' },
              { label: 'Name', value: 'name' },
            ]}
            value={sortKey}
            onChange={(value) => setSortKey(value as SortKey)}
          />
          <Segmented
            options={[
              { label: 'Desc', value: 'desc' },
              { label: 'Asc', value: 'asc' },
            ]}
            value={sortOrder}
            onChange={(value) => setSortOrder(value as 'asc' | 'desc')}
          />
        </Space>
        <Tabs
          defaultActiveKey="textures"
          items={[
            {
              key: 'textures',
              label: `Textures (${filteredTextures.length})`,
              children: <Table rowKey={(record) => record.name + record.width} dataSource={filteredTextures} columns={textureColumns} pagination={false} size="small" />, 
            },
            {
              key: 'meshes',
              label: `Meshes (${filteredMeshes.length})`,
              children: <Table rowKey={(record) => record.name + record.vertexCount} dataSource={filteredMeshes} columns={meshColumns} pagination={false} size="small" />, 
            },
            {
              key: 'shaders',
              label: `Shaders (${filteredShaders.length})`,
              children: <Table rowKey={(record) => record.name} dataSource={filteredShaders} columns={shaderColumns} pagination={false} size="small" />, 
            },
          ]}
        />
      </Space>
    </Card>
  );
}
