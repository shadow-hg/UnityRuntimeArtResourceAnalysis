import { Card, Empty, Flex, Space, Tag, Typography, theme } from 'antd';
import { useMemo } from 'react';
import type { BottleneckHint, PipelineStageTiming, TelemetrySnapshot } from '../types';
import { formatInteger, formatMilliseconds, formatPercentage } from '../utils/format';

interface FrameInsightsPanelProps {
  frame: TelemetrySnapshot | null;
}

function normalizeStagePercentage(value: number | undefined | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  if (value > 1) {
    return Math.min(1, value / 100);
  }
  if (value < 0) {
    return 0;
  }
  return value;
}

function normalizeStage(stage: PipelineStageTiming | null | undefined) {
  if (!stage || typeof stage !== 'object') {
    return null;
  }
  const label = typeof stage.stage === 'string' && stage.stage.trim().length > 0 ? stage.stage : '阶段';
  const timeMs = typeof stage.timeMs === 'number' && Number.isFinite(stage.timeMs) ? Math.max(stage.timeMs, 0) : null;
  const normalizedPercent = normalizeStagePercentage(stage.contributionPercent ?? null);
  return {
    label,
    timeMs,
    percent: normalizedPercent,
  };
}

function normalizeHints(hints: BottleneckHint[] | null | undefined): BottleneckHint[] {
  if (!Array.isArray(hints)) {
    return [];
  }
  return hints.filter((hint): hint is BottleneckHint => Boolean(hint && typeof hint.message === 'string' && hint.message));
}

function getHintColor(severity: BottleneckHint['severity']): string {
  switch (severity) {
    case 'critical':
      return 'red';
    case 'warning':
      return 'orange';
    case 'info':
    default:
      return 'blue';
  }
}

export default function FrameInsightsPanel({ frame }: FrameInsightsPanelProps) {
  const { token } = theme.useToken();
  const timing = frame?.frameTiming ?? null;

  const stages = useMemo(() => {
    if (!timing?.pipelineStages || timing.pipelineStages.length === 0) {
      return [] as Array<{ label: string; timeMs: number | null; percent: number }>;
    }

    const normalized = timing.pipelineStages
      .map((stage) => normalizeStage(stage))
      .filter((stage): stage is { label: string; timeMs: number | null; percent: number } => stage != null);

    if (normalized.length === 0) {
      return [] as Array<{ label: string; timeMs: number | null; percent: number }>;
    }

    const totalTime = normalized.reduce((acc, stage) => acc + (stage.timeMs ?? 0), 0);

    return normalized.map((stage) => {
      const percent = stage.percent > 0 ? stage.percent : totalTime > 0 ? (stage.timeMs ?? 0) / totalTime : 0;
      return {
        ...stage,
        percent: Math.max(0, Math.min(1, percent)),
      };
    });
  }, [timing?.pipelineStages]);

  const hints = useMemo(() => normalizeHints(timing?.bottleneckHints), [timing?.bottleneckHints]);
  const drawCalls = timing?.drawCalls ?? null;

  const drawMetrics = useMemo(
    () =>
      [
        { label: 'Draw Calls', value: drawCalls?.drawCalls },
        { label: 'SetPass Calls', value: drawCalls?.setPassCalls },
        { label: '阴影绘制', value: drawCalls?.shadowDrawCalls },
        { label: '透明队列', value: drawCalls?.transparentDrawCalls },
        { label: '实例批处理', value: drawCalls?.instancedBatches },
        { label: '动态批处理', value: drawCalls?.dynamicBatches },
      ].filter((item) => typeof item.value === 'number' && Number.isFinite(item.value)),
    [drawCalls]
  );

  const hasTimingData =
    typeof timing?.cpuFrameTimeMs === 'number' ||
    typeof timing?.gpuFrameTimeMs === 'number' ||
    stages.length > 0 ||
    drawMetrics.length > 0 ||
    hints.length > 0;

  return (
    <Card
      title={<Typography.Text strong>帧执行明细</Typography.Text>}
      style={{ flex: 1, minWidth: 320 }}
      bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      {!hasTimingData ? (
        <Empty description="暂无帧执行数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Flex gap={24} wrap>
            <Space direction="vertical" size={4}>
              <Typography.Text type="secondary">CPU 帧耗时</Typography.Text>
              <Typography.Text strong style={{ fontSize: 20 }}>
                {formatMilliseconds(timing?.cpuFrameTimeMs)}
              </Typography.Text>
            </Space>
            <Space direction="vertical" size={4}>
              <Typography.Text type="secondary">GPU 帧耗时</Typography.Text>
              <Typography.Text strong style={{ fontSize: 20 }}>
                {formatMilliseconds(timing?.gpuFrameTimeMs)}
              </Typography.Text>
            </Space>
            {typeof timing?.cpuMainThreadTimeMs === 'number' ? (
              <Space direction="vertical" size={4}>
                <Typography.Text type="secondary">主线程</Typography.Text>
                <Typography.Text strong style={{ fontSize: 16 }}>
                  {formatMilliseconds(timing?.cpuMainThreadTimeMs)}
                </Typography.Text>
              </Space>
            ) : null}
            {typeof timing?.cpuRenderThreadTimeMs === 'number' ? (
              <Space direction="vertical" size={4}>
                <Typography.Text type="secondary">渲染线程</Typography.Text>
                <Typography.Text strong style={{ fontSize: 16 }}>
                  {formatMilliseconds(timing?.cpuRenderThreadTimeMs)}
                </Typography.Text>
              </Space>
            ) : null}
          </Flex>

          {stages.length > 0 ? (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Typography.Text type="secondary">渲染管线阶段分布</Typography.Text>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                {stages.map((stage) => {
                  const percent = Math.round(stage.percent * 1000) / 10;
                  return (
                    <Space direction="vertical" size={6} key={stage.label} style={{ width: '100%' }}>
                      <Flex justify="space-between" align="center">
                        <Typography.Text>{stage.label}</Typography.Text>
                        <Space size={12}>
                          {stage.timeMs != null ? (
                            <Typography.Text type="secondary">
                              {formatMilliseconds(stage.timeMs, 2)}
                            </Typography.Text>
                          ) : null}
                          <Typography.Text type="secondary">{formatPercentage(percent / 100, 1)}</Typography.Text>
                        </Space>
                      </Flex>
                      <div
                        style={{
                          height: 6,
                          borderRadius: 999,
                          background: token.colorFillTertiary,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${Math.min(100, Math.max(0, percent))}%`,
                            background: token.colorPrimary,
                          }}
                        />
                      </div>
                    </Space>
                  );
                })}
              </Space>
            </Space>
          ) : null}

          {drawMetrics.length > 0 ? (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text type="secondary">Draw Call 统计</Typography.Text>
              <Flex gap={16} wrap>
                {drawMetrics.map((metric) => (
                  <Space key={metric.label} direction="vertical" size={2}>
                    <Typography.Text type="secondary">{metric.label}</Typography.Text>
                    <Typography.Text strong>{formatInteger(metric.value)}</Typography.Text>
                  </Space>
                ))}
              </Flex>
            </Space>
          ) : null}

          {hints.length > 0 ? (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text type="secondary">GPU 驱动瓶颈提示</Typography.Text>
              <Space wrap>
                {hints.map((hint, index) => (
                  <Tag key={`${hint.message}-${index}`} color={getHintColor(hint.severity)}>
                    {hint.type ? `${hint.type} · ` : ''}
                    {hint.message}
                    {hint.source ? `（${hint.source}）` : ''}
                  </Tag>
                ))}
              </Space>
            </Space>
          ) : null}
        </Space>
      )}
    </Card>
  );
}
