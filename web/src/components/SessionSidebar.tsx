import { useMemo } from 'react';
import { Avatar, Badge, Empty, List, Space, Tag, Typography } from 'antd';
import type { TelemetrySession } from '../types';
import dayjs from 'dayjs';

interface SessionSidebarProps {
  sessions: TelemetrySession[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  clientIps: { ip: string; sessionCount: number; activeSessionCount: number }[];
  selectedClientIp: string | null;
  onSelectClientIp: (ip: string | null) => void;
}

const { CheckableTag } = Tag;

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
  const platform = session.client?.platform as string | undefined;
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
          <Typography.Text type="secondary" ellipsis style={{ maxWidth: 200 }}>
            {deviceName}
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
}: SessionSidebarProps) {
  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf()),
    [sessions]
  );
  const emptyDescription = selectedClientIp
    ? `IP ${selectedClientIp} 暂无历史记录`
    : '暂无性能数据会话';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ padding: '0 16px' }}>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Typography.Text type="secondary">游戏客户端 IP</Typography.Text>
          <Typography.Text style={{ fontSize: 16, fontWeight: 600 }}>
            {selectedClientIp ?? '全部客户端'}
          </Typography.Text>
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
        {sortedSessions.length === 0 ? (
          <Empty description={emptyDescription} style={{ marginTop: 80 }} />
        ) : (
          <List
            dataSource={sortedSessions}
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
