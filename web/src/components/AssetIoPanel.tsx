import { Empty, Space, Tag, Typography } from 'antd';
import { useMemo } from 'react';
import type { AssetLoadSample, ResourceInstanceStats, TelemetrySnapshot } from '../types';
import { formatBytes, formatInteger, formatMilliseconds, formatPercentage } from '../utils/format';
import CollapsibleCard from './CollapsibleCard';

interface AssetIoPanelProps {
  frame: TelemetrySnapshot | null;
}

function normalizeRatio(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return Math.min(1, value / 100);
  }
  return value;
}

function formatRatio(value: number | null | undefined): string {
  const normalized = normalizeRatio(value);
  if (normalized == null) {
    return '—';
  }
  return formatPercentage(normalized, 1);
}

function normalizeRecentLoads(loads: AssetLoadSample[] | null | undefined) {
  if (!Array.isArray(loads)) {
    return [];
  }
  return loads
    .filter((load): load is AssetLoadSample => Boolean(load && (load.name || load.durationMs != null)))
    .slice(-5)
    .reverse();
}

function normalizeResourceInstances(instances: ResourceInstanceStats[] | null | undefined) {
  if (!Array.isArray(instances)) {
    return [];
  }
  return instances.filter((instance) => Boolean(instance && (instance.resourceType || instance.activeCount != null)));
}

export default function AssetIoPanel({ frame }: AssetIoPanelProps) {
  const assetIo = frame?.assetIo ?? null;

  const hasPrimaryMetrics =
    typeof assetIo?.assetBundleAverageLoadMs === 'number' ||
    typeof assetIo?.addressableAverageLoadMs === 'number' ||
    typeof assetIo?.asyncQueueLength === 'number' ||
    typeof assetIo?.loadFailureRate === 'number';

  const recentLoads = useMemo(() => normalizeRecentLoads(assetIo?.recentLoads), [assetIo?.recentLoads]);
  const resourceInstances = useMemo(
    () => normalizeResourceInstances(assetIo?.resourceInstances),
    [assetIo?.resourceInstances]
  );
  const streamingStatuses = useMemo(
    () => (Array.isArray(assetIo?.streamingStatuses) ? assetIo.streamingStatuses : []),
    [assetIo?.streamingStatuses]
  );
  const unloadEvents = useMemo(
    () => (Array.isArray(assetIo?.unloadEvents) ? assetIo.unloadEvents.slice(-5).reverse() : []),
    [assetIo?.unloadEvents]
  );

  const hasAnyData =
    hasPrimaryMetrics || recentLoads.length > 0 || resourceInstances.length > 0 || streamingStatuses.length > 0 || unloadEvents.length > 0;

  return (
    <CollapsibleCard
      title={<Typography.Text strong>资产生命周期与 IO</Typography.Text>}
      style={{ flex: 1, minWidth: 320 }}
      bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      {!hasAnyData ? (
        <Empty description="暂无资产 IO 数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {hasPrimaryMetrics ? (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text type="secondary">加载效率</Typography.Text>
              <Space direction="vertical" size={4}>
                {typeof assetIo?.assetBundleAverageLoadMs === 'number' ? (
                  <Typography.Text>
                    AssetBundle 平均加载耗时：
                    <Typography.Text strong style={{ marginLeft: 4 }}>
                      {formatMilliseconds(assetIo.assetBundleAverageLoadMs)}
                    </Typography.Text>
                  </Typography.Text>
                ) : null}
                {typeof assetIo?.addressableAverageLoadMs === 'number' ? (
                  <Typography.Text>
                    Addressables 平均加载耗时：
                    <Typography.Text strong style={{ marginLeft: 4 }}>
                      {formatMilliseconds(assetIo.addressableAverageLoadMs)}
                    </Typography.Text>
                  </Typography.Text>
                ) : null}
                {typeof assetIo?.asyncQueueLength === 'number' ? (
                  <Typography.Text>
                    异步请求队列：
                    <Typography.Text strong style={{ marginLeft: 4 }}>
                      {formatInteger(assetIo.asyncQueueLength)}
                    </Typography.Text>
                  </Typography.Text>
                ) : null}
                {typeof assetIo?.loadFailureRate === 'number' ? (
                  <Typography.Text>
                    加载失败率：
                    <Typography.Text strong style={{ marginLeft: 4 }}>
                      {formatRatio(assetIo.loadFailureRate)}
                    </Typography.Text>
                  </Typography.Text>
                ) : null}
              </Space>
            </Space>
          ) : null}

          {recentLoads.length > 0 ? (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text type="secondary">最近加载记录</Typography.Text>
              <Space direction="vertical" size={6}>
                {recentLoads.map((load, index) => (
                  <Space key={`${load.name ?? 'load'}-${index}`} size={8} wrap>
                    <Tag color={load.status === 'failed' ? 'red' : load.status === 'in-progress' ? 'blue' : 'green'}>
                      {load.status ?? 'success'}
                    </Tag>
                    <Typography.Text strong>{load.name ?? load.type ?? '资源'}</Typography.Text>
                    {typeof load.durationMs === 'number' ? (
                      <Typography.Text type="secondary">
                        {formatMilliseconds(load.durationMs)}
                      </Typography.Text>
                    ) : null}
                    {typeof load.sizeBytes === 'number' ? (
                      <Typography.Text type="secondary">{formatBytes(load.sizeBytes)}</Typography.Text>
                    ) : null}
                    {load.timestampUtc ? (
                      <Typography.Text type="secondary">
                        {new Date(load.timestampUtc).toLocaleTimeString()}
                      </Typography.Text>
                    ) : null}
                  </Space>
                ))}
              </Space>
            </Space>
          ) : null}

          {resourceInstances.length > 0 ? (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text type="secondary">资源实例峰值</Typography.Text>
              <Space direction="vertical" size={6}>
                {resourceInstances.map((instance, index) => (
                  <Space key={`${instance.resourceType ?? 'instance'}-${index}`} size={8} wrap>
                    <Typography.Text strong>{instance.resourceType ?? '资源'}</Typography.Text>
                    {typeof instance.activeCount === 'number' ? (
                      <Typography.Text type="secondary">
                        当前 {formatInteger(instance.activeCount)}
                      </Typography.Text>
                    ) : null}
                    {typeof instance.peakCount === 'number' ? (
                      <Typography.Text type="secondary">
                        峰值 {formatInteger(instance.peakCount)}
                      </Typography.Text>
                    ) : null}
                  </Space>
                ))}
              </Space>
            </Space>
          ) : null}

          {streamingStatuses.length > 0 ? (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text type="secondary">Streaming 状态</Typography.Text>
              <Space direction="vertical" size={6}>
                {streamingStatuses.map((status, index) => (
                  <Space key={`${status.type}-${index}`} size={8} wrap>
                    <Typography.Text strong>{status.type}</Typography.Text>
                    {typeof status.bufferedSeconds === 'number' ? (
                      <Typography.Text type="secondary">
                        缓冲 {status.bufferedSeconds.toFixed(1)} s
                      </Typography.Text>
                    ) : null}
                    {typeof status.droppedFrames === 'number' ? (
                      <Typography.Text type="secondary">
                        丢帧 {formatInteger(status.droppedFrames)}
                      </Typography.Text>
                    ) : null}
                    {status.isStalled ? <Tag color="orange">Stalled</Tag> : null}
                  </Space>
                ))}
              </Space>
            </Space>
          ) : null}

          {unloadEvents.length > 0 ? (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text type="secondary">最近卸载</Typography.Text>
              <Space direction="vertical" size={6}>
                {unloadEvents.map((event, index) => (
                  <Space key={`${event.name ?? 'unload'}-${index}`} size={8} wrap>
                    <Typography.Text strong>{event.name ?? event.resourceType ?? '资源'}</Typography.Text>
                    {event.timestampUtc ? (
                      <Typography.Text type="secondary">
                        {new Date(event.timestampUtc).toLocaleTimeString()}
                      </Typography.Text>
                    ) : null}
                  </Space>
                ))}
              </Space>
            </Space>
          ) : null}
        </Space>
      )}
    </CollapsibleCard>
  );
}
