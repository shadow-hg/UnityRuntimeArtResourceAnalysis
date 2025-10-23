import { Empty, Flex, Space, Typography } from 'antd';
import { useMemo } from 'react';
import type { TelemetrySnapshot, ThreadUtilizationSample } from '../types';
import { formatBytes, formatInteger, formatMilliseconds, formatPercentage } from '../utils/format';
import CollapsibleCard from './CollapsibleCard';

interface SystemStatsPanelProps {
  frame: TelemetrySnapshot | null;
}

function normalizePercent(value: number | null | undefined): number | null {
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

function formatUtilization(value: number | null | undefined): string {
  const normalized = normalizePercent(value);
  if (normalized == null) {
    return '—';
  }
  return formatPercentage(normalized, 1);
}

function normalizeThreadSamples(samples: ThreadUtilizationSample[] | null | undefined) {
  if (!Array.isArray(samples)) {
    return [];
  }
  return samples
    .filter((sample): sample is ThreadUtilizationSample => Boolean(sample && typeof sample.threadName === 'string'))
    .map((sample) => ({
      ...sample,
      utilizationPercent:
        typeof sample.utilizationPercent === 'number' && Number.isFinite(sample.utilizationPercent)
          ? sample.utilizationPercent
          : undefined,
      frameTimeMs:
        typeof sample.frameTimeMs === 'number' && Number.isFinite(sample.frameTimeMs) ? sample.frameTimeMs : undefined,
    }));
}

export default function SystemStatsPanel({ frame }: SystemStatsPanelProps) {
  const memory = frame?.memoryStats ?? null;
  const threadStats = frame?.threadStats ?? null;

  const memoryItems = useMemo(
    () =>
      [
        { label: 'Unity 堆', value: memory?.unityHeapBytes },
        { label: 'Native 内存', value: memory?.nativeMemoryBytes },
        { label: 'GPU 显存', value: memory?.gpuMemoryBytes },
        { label: '纹理池', value: memory?.texturePoolBytes },
        { label: '网格池', value: memory?.meshPoolBytes },
        { label: '其他', value: memory?.otherMemoryBytes },
      ].filter((item) => typeof item.value === 'number' && Number.isFinite(item.value) && item.value >= 0),
    [memory]
  );

  const gcStats = memory?.gc ?? null;
  const threadSamples = useMemo(() => {
    const normalized = normalizeThreadSamples(threadStats?.utilization);
    if (normalized.length === 0) {
      return [];
    }
    const sorted = [...normalized].sort((a, b) => {
      const aValue = typeof a.utilizationPercent === 'number' ? a.utilizationPercent : -Infinity;
      const bValue = typeof b.utilizationPercent === 'number' ? b.utilizationPercent : -Infinity;
      return bValue - aValue;
    });
    return sorted.slice(0, 5);
  }, [threadStats?.utilization]);

  const hasMemoryData = memoryItems.length > 0;
  const hasGcData =
    typeof gcStats?.totalCollections === 'number' ||
    typeof gcStats?.lastCollectionDurationMs === 'number' ||
    typeof gcStats?.managedHeapSizeBytes === 'number' ||
    typeof gcStats?.recentCollectionDurationMs === 'number';
  const hasThreadData =
    threadSamples.length > 0 ||
    normalizePercent(threadStats?.mainThreadPercent) != null ||
    normalizePercent(threadStats?.renderThreadPercent) != null ||
    normalizePercent(threadStats?.jobWorkerPercent) != null;

  const hasAnyData = hasMemoryData || hasGcData || hasThreadData;

  return (
    <CollapsibleCard
      title={<Typography.Text strong>系统与资源占用</Typography.Text>}
      style={{ flex: 1, minWidth: 320 }}
      bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 16 }}
      collapseMode="compact"
    >
      {!hasAnyData ? (
        <Empty description="暂无系统占用数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {hasMemoryData ? (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text type="secondary">内存使用</Typography.Text>
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                {memoryItems.map((item) => (
                  <Flex key={item.label} justify="space-between">
                    <Typography.Text type="secondary">{item.label}</Typography.Text>
                    <Typography.Text strong>{formatBytes(item.value ?? 0)}</Typography.Text>
                  </Flex>
                ))}
              </Space>
            </Space>
          ) : null}

          {hasGcData ? (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text type="secondary">垃圾回收</Typography.Text>
              <Flex gap={24} wrap>
                {typeof gcStats?.totalCollections === 'number' ? (
                  <Space direction="vertical" size={2}>
                    <Typography.Text type="secondary">触发次数</Typography.Text>
                    <Typography.Text strong>{formatInteger(gcStats.totalCollections)}</Typography.Text>
                  </Space>
                ) : null}
                {typeof gcStats?.lastCollectionDurationMs === 'number' ? (
                  <Space direction="vertical" size={2}>
                    <Typography.Text type="secondary">最近耗时</Typography.Text>
                    <Typography.Text strong>{formatMilliseconds(gcStats.lastCollectionDurationMs)}</Typography.Text>
                  </Space>
                ) : null}
                {typeof gcStats?.recentCollectionDurationMs === 'number' ? (
                  <Space direction="vertical" size={2}>
                    <Typography.Text type="secondary">平均耗时</Typography.Text>
                    <Typography.Text strong>{formatMilliseconds(gcStats.recentCollectionDurationMs)}</Typography.Text>
                  </Space>
                ) : null}
                {typeof gcStats?.managedHeapSizeBytes === 'number' ? (
                  <Space direction="vertical" size={2}>
                    <Typography.Text type="secondary">托管堆大小</Typography.Text>
                    <Typography.Text strong>{formatBytes(gcStats.managedHeapSizeBytes)}</Typography.Text>
                  </Space>
                ) : null}
              </Flex>
            </Space>
          ) : null}

          {hasThreadData ? (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text type="secondary">CPU 线程利用率</Typography.Text>
              <Flex gap={24} wrap>
                {normalizePercent(threadStats?.mainThreadPercent) != null ? (
                  <Space direction="vertical" size={2}>
                    <Typography.Text type="secondary">主线程</Typography.Text>
                    <Typography.Text strong>{formatUtilization(threadStats?.mainThreadPercent)}</Typography.Text>
                  </Space>
                ) : null}
                {normalizePercent(threadStats?.renderThreadPercent) != null ? (
                  <Space direction="vertical" size={2}>
                    <Typography.Text type="secondary">渲染线程</Typography.Text>
                    <Typography.Text strong>{formatUtilization(threadStats?.renderThreadPercent)}</Typography.Text>
                  </Space>
                ) : null}
                {normalizePercent(threadStats?.jobWorkerPercent) != null ? (
                  <Space direction="vertical" size={2}>
                    <Typography.Text type="secondary">Job Worker</Typography.Text>
                    <Typography.Text strong>{formatUtilization(threadStats?.jobWorkerPercent)}</Typography.Text>
                  </Space>
                ) : null}
              </Flex>
              {threadSamples.length > 0 ? (
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  {threadSamples.map((sample) => (
                    <Flex key={sample.threadName} justify="space-between">
                      <Typography.Text>{sample.threadName}</Typography.Text>
                      <Space size={12}>
                        {typeof sample.frameTimeMs === 'number' ? (
                          <Typography.Text type="secondary">
                            {formatMilliseconds(sample.frameTimeMs, 2)}
                          </Typography.Text>
                        ) : null}
                        <Typography.Text type="secondary">
                          {formatUtilization(sample.utilizationPercent)}
                        </Typography.Text>
                      </Space>
                    </Flex>
                  ))}
                </Space>
              ) : null}
            </Space>
          ) : null}
        </Space>
      )}
    </CollapsibleCard>
  );
}
