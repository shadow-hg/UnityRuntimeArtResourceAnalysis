import { useMemo } from 'react';
import { Avatar, Badge, Empty, List, Space, Typography } from 'antd';
import type { TelemetrySession } from '../types';
import dayjs from 'dayjs';

interface SessionSidebarProps {
  sessions: TelemetrySession[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
}

function SessionItem({ session, isActive, onSelect }: { session: TelemetrySession; isActive: boolean; onSelect: () => void }) {
  const title = (session.client?.productName as string) ?? 'Unknown Product';
  const frameCount = session.frames?.length ?? 0;
  const subtitle = `${dayjs(session.createdAt).format('MMM D HH:mm:ss')} • ${frameCount} frames`;
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
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{title}</Typography.Text>
          <Typography.Text type="secondary">{subtitle}</Typography.Text>
        </Space>
      </Space>
    </List.Item>
  );
}

export default function SessionSidebar({ sessions, selectedSessionId, onSelectSession }: SessionSidebarProps) {
  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf()),
    [sessions]
  );

  if (sortedSessions.length === 0) {
    return <Empty description="No telemetry sessions yet" style={{ marginTop: 80 }} />;
  }

  return (
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
  );
}
