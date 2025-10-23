import { useMemo } from 'react';
import { Avatar, Badge, Empty, List, Segmented, Select, Space, Tag, Typography } from 'antd';
import type { TelemetrySession, SessionSortOrder, SessionStatusFilter } from '../types';
import { resolveSessionIp } from '../utils/session';
import dayjs from 'dayjs';

interface SessionSidebarProps {
  sessions: TelemetrySession[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  clientIps: { ip: string; sessionCount: number; activeSessionCount: number }[];
  selectedClientIp: string | null;
  onSelectClientIp: (ip: string | null) => void;
  sortOrder: SessionSortOrder;
  onChangeSortOrder: (order: SessionSortOrder) => void;
  statusFilter: SessionStatusFilter;
  onChangeStatusFilter: (filter: SessionStatusFilter) => void;
  statusCounts: Record<SessionStatusFilter, number>;
}

const { CheckableTag } = Tag;

const statusFilterLabels: Record<SessionStatusFilter, string> = {
  all: '性能数据会话',
  active: '实时会话',
  closed: '已结束会话',
};

const sortSelectOptions: { label: string; value: SessionSortOrder }[] = [
  { label: '按最新时间 (降序)', value: 'newest' },
  { label: '按最早时间 (升序)', value: 'oldest' },
  { label: '帧数最多优先', value: 'frames-desc' },
  { label: '帧数最少优先', value: 'frames-asc' },
];

function SessionItem({ session, isActive, onSelect }: { session: TelemetrySession; isActive: boolean; onSelect: () => void }) {
  const title = (session.client?.productName as string) ?? 'Unknown Product';
  const frameCount = session.frames?.length ?? 0;
  const trimmedFrameCount = session.trimmedFrameCount ?? 0;
  const totalFrameCount = session.totalFrameCount ?? trimmedFrameCount + frameCount;
  const frameSummary =
    trimmedFrameCount > 0
      ? `${totalFrameCount} 帧 (显示最近 ${frameCount} 帧)`
      : `${totalFrameCount} 帧`;
  const deviceName = (session.client?.deviceName as string) ?? 'Unknown Device';
  const accountName = useMemo(() => {
    const fromAccount = typeof session.client?.accountName === 'string' ? session.client?.accountName : null;
    const fallback = typeof session.client?.userName === 'string' ? session.client?.userName : null;
    const candidate = (fromAccount ?? fallback)?.trim();
    return candidate && candidate.length > 0 ? candidate : null;
  }, [session.client?.accountName, session.client?.userName]);
  const platform = session.client?.platform as string | undefined;
  const clientIp = resolveSessionIp(session);
  const subtitle = `${dayjs(session.createdAt).format('MMM D HH:mm:ss')} • ${frameSummary}`;
  return (
    <List.Item
      onClick={() => {
        window.getSelection()?.removeAllRanges();
        onSelect();
      }}
      style={{
        padding: '12px 16px',
        cursor: 'pointer',
        background: isActive ? 'rgba(11, 27, 43, 0.08)' : 'transparent',
        borderLeft: isActive ? '3px solid #1677ff' : '3px solid transparent',
      }}
    >
      <Space align="start">
        <Badge dot={!session.closedAt} offset={[-2, 6]}>
          <Avatar shape="square">{title.slice(0, 2).toUpperCase()}</Avatar>
        </Badge>
        <Space direction="vertical" size={2} style={{ maxWidth: 200 }}>
          <Space align="center" size={8}>
            <Typography.Text strong ellipsis style={{ maxWidth: 140 }}>
              {title}
            </Typography.Text>
            <Tag color={session.closedAt ? 'default' : 'success'}>
              {session.closedAt ? '已结束' : '实时'}
            </Tag>
          </Space>
          <Typography.Text type="secondary">{subtitle}</Typography.Text>
          {accountName ? (
            <Typography.Text type="secondary" ellipsis style={{ maxWidth: 200 }}>
              账户：{accountName}
            </Typography.Text>
          ) : null}
          <Typography.Text type="secondary" ellipsis style={{ maxWidth: 200 }}>
            设备：{deviceName}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ maxWidth: 200 }}>
            IP：{clientIp}
          </Typography.Text>
          {platform ? <Tag color="blue">{platform}</Tag> : null}
        </Space>
      </Space>
    </List.Item>
  );
}

export default function SessionSidebar({
  sessions,
  selectedSessionId,
  onSelectSession,
  clientIps,
  selectedClientIp,
  onSelectClientIp,
  sortOrder,
  onChangeSortOrder,
  statusFilter,
  onChangeStatusFilter,
  statusCounts,
}: SessionSidebarProps) {
  const statusSegmentOptions = useMemo(
    () => [
      { label: `全部 (${statusCounts.all})`, value: 'all' as const },
      { label: `实时 (${statusCounts.active})`, value: 'active' as const },
      { label: `已结束 (${statusCounts.closed})`, value: 'closed' as const },
    ],
    [statusCounts]
  );
  const emptyDescription = selectedClientIp
    ? `IP ${selectedClientIp} 暂无${statusFilterLabels[statusFilter]}`
    : `暂无${statusFilterLabels[statusFilter]}`;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ padding: '0 16px' }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Typography.Text type="secondary">历史记录分类</Typography.Text>
            <Segmented
              block
              value={statusFilter}
              options={statusSegmentOptions}
              onChange={(value) => onChangeStatusFilter(value as SessionStatusFilter)}
            />
          </Space>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Typography.Text type="secondary">排序方式</Typography.Text>
            <Select<SessionSortOrder>
              value={sortOrder}
              options={sortSelectOptions}
              onChange={(value) => onChangeSortOrder(value)}
              size="small"
              style={{ width: '100%' }}
            />
          </Space>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Typography.Text type="secondary">游戏客户端 IP</Typography.Text>
            <Typography.Text style={{ fontSize: 16, fontWeight: 600 }}>
              {selectedClientIp ?? '全部客户端'}
            </Typography.Text>
          </Space>
        </Space>
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center',
            overflow: 'visible',
          }}
        >
          <CheckableTag
            key="__all__"
            checked={selectedClientIp === null}
            onChange={(checked) => {
              if (checked) {
                onSelectClientIp(null);
              } else if (selectedClientIp === null) {
                onSelectClientIp(null);
              }
            }}
            style={{
              borderRadius: 999,
              padding: '2px 12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              maxWidth: '100%',
              whiteSpace: 'nowrap',
            }}
          >
            全部客户端
          </CheckableTag>
          {clientIps.length === 0 ? (
            <Typography.Text type="secondary">暂无客户端连接</Typography.Text>
          ) : (
            clientIps.map((item) => (
              <CheckableTag
                key={item.ip}
                checked={selectedClientIp === item.ip}
                onChange={(checked) => onSelectClientIp(checked ? item.ip : null)}
                style={{
                  borderRadius: 999,
                  padding: '2px 12px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  minWidth: 0,
                  maxWidth: '100%',
                  whiteSpace: 'normal',
                  lineHeight: 1.4,
                }}
              >
                <span
                  style={{
                    flex: '1 1 auto',
                    minWidth: 0,
                    overflow: 'visible',
                    wordBreak: 'break-all',
                  }}
                  title={item.ip}
                >
                  {item.ip}
                </span>
                <span style={{ color: 'rgba(0, 0, 0, 0.45)', fontSize: 12, flexShrink: 0 }}>({item.sessionCount})</span>
                {item.activeSessionCount > 0 ? (
                  <span style={{ color: '#52c41a', fontSize: 12, flexShrink: 0 }}>实时 {item.activeSessionCount}</span>
                ) : null}
              </CheckableTag>
            ))
          )}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sessions.length === 0 ? (
          <Empty description={emptyDescription} style={{ marginTop: 80 }} />
        ) : (
          <List
            dataSource={sessions}
            renderItem={(session) => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={session.id === selectedSessionId}
                onSelect={() => onSelectSession(session.id)}
              />
            )}
          />
        )}
      </div>
    </div>
  );
}
