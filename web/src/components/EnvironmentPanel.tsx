import { Empty, Space, Typography } from 'antd';
import type { EnvironmentInfo, TelemetrySnapshot } from '../types';
import { formatInteger } from '../utils/format';
import CollapsibleCard from './CollapsibleCard';

interface EnvironmentPanelProps {
  frame: TelemetrySnapshot | null;
}

function formatPosition(position: EnvironmentInfo['playerPosition']): string | null {
  if (!position) {
    return null;
  }
  const { x, y, z } = position;
  if ([x, y, z].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return `(${x?.toFixed(1)}, ${y?.toFixed(1)}, ${z?.toFixed(1)})`;
  }
  return null;
}

function normalizeExtra(extra: EnvironmentInfo['extra']) {
  if (!extra) {
    return [] as Array<{ key: string; value: unknown }>;
  }

  if (Array.isArray(extra)) {
    return extra
      .filter((entry) => Boolean(entry && typeof entry.key === 'string' && entry.key.length > 0))
      .map((entry) => ({ key: entry.key, value: entry.value }));
  }

  if (typeof extra === 'object') {
    return Object.entries(extra)
      .filter(([key]) => typeof key === 'string' && key.length > 0)
      .map(([key, value]) => ({ key, value }));
  }

  return [];
}

export default function EnvironmentPanel({ frame }: EnvironmentPanelProps) {
  const environment = frame?.environment ?? null;
  const extraEntries = normalizeExtra(environment?.extra);

  const hasAnyData = Boolean(
    environment?.gpuModel ||
      environment?.cpuModel ||
      environment?.screenResolution ||
      environment?.qualitySetting ||
      environment?.sceneName ||
      environment?.sceneId ||
      environment?.playerPosition ||
      environment?.cameraHeight ||
      extraEntries.length > 0
  );

  return (
    <CollapsibleCard
      title={<Typography.Text strong>运行环境指标</Typography.Text>}
      style={{ flex: 1, minWidth: 320 }}
      bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      {!hasAnyData ? (
        <Empty description="暂无环境信息" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Space direction="vertical" size={8}>
          {environment?.gpuModel ? (
            <Typography.Text>
              GPU：<Typography.Text strong>{environment.gpuModel}</Typography.Text>
              {environment.gpuDriverVersion ? ` · 驱动 ${environment.gpuDriverVersion}` : ''}
            </Typography.Text>
          ) : null}
          {environment?.cpuModel ? (
            <Typography.Text>
              CPU：<Typography.Text strong>{environment.cpuModel}</Typography.Text>
              {typeof environment.cpuCoreCount === 'number'
                ? ` · ${formatInteger(environment.cpuCoreCount)} 核`
                : ''}
            </Typography.Text>
          ) : null}
          {environment?.platform ? (
            <Typography.Text>
              平台：<Typography.Text strong>{environment.platform}</Typography.Text>
            </Typography.Text>
          ) : null}
          {environment?.screenResolution || environment?.screenRefreshRate ? (
            <Typography.Text>
              分辨率：
              <Typography.Text strong>{environment.screenResolution ?? '未知'}</Typography.Text>
              {typeof environment.screenRefreshRate === 'number'
                ? ` @ ${environment.screenRefreshRate}Hz`
                : ''}
            </Typography.Text>
          ) : null}
          {environment?.qualitySetting ? (
            <Typography.Text>
              画质：<Typography.Text strong>{environment.qualitySetting}</Typography.Text>
            </Typography.Text>
          ) : null}
          {environment?.sceneName || environment?.sceneId ? (
            <Typography.Text>
              场景：<Typography.Text strong>{environment.sceneName ?? '未知场景'}</Typography.Text>
              {environment.sceneId ? `（ID: ${environment.sceneId}）` : ''}
            </Typography.Text>
          ) : null}
          {environment?.playerPosition ? (
            <Typography.Text>
              玩家位置：<Typography.Text strong>{formatPosition(environment.playerPosition) ?? '未知'}</Typography.Text>
            </Typography.Text>
          ) : null}
          {typeof environment?.cameraHeight === 'number' ? (
            <Typography.Text>
              相机高度：<Typography.Text strong>{environment.cameraHeight.toFixed(2)} m</Typography.Text>
            </Typography.Text>
          ) : null}
          {extraEntries.length > 0 ? (
            <Space direction="vertical" size={4}>
              <Typography.Text type="secondary">其他</Typography.Text>
              {extraEntries.map((entry) => (
                <Typography.Text key={entry.key}>
                  {entry.key}：<Typography.Text strong>{String(entry.value)}</Typography.Text>
                </Typography.Text>
              ))}
            </Space>
          ) : null}
        </Space>
      )}
    </CollapsibleCard>
  );
}
