import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Badge, Empty, Input, Segmented, Select, Space, Tag, Typography } from 'antd';
import VirtualList from 'rc-virtual-list';
import type {
  TelemetrySession,
  SessionSortOrder,
  SessionStatusFilter,
  SessionGrouping,
  SessionGroupingItem,
} from '../types';
import { resolveSessionIp } from '../utils/session';
import dayjs from 'dayjs';
import { SESSION_GROUPING_DISPLAY_META, SESSION_GROUPING_OPTIONS } from '../utils/sessionGrouping';

interface SessionSidebarProps {
  sessions: TelemetrySession[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  groupingKey: SessionGrouping;
  onChangeGroupingKey: (group: SessionGrouping) => void;
  groupingItems: SessionGroupingItem[];
  selectedGroupingValue: string | null;
  onSelectGroupingValue: (value: string | null) => void;
  sortOrder: SessionSortOrder;
  onChangeSortOrder: (order: SessionSortOrder) => void;
  statusFilter: SessionStatusFilter;
  onChangeStatusFilter: (filter: SessionStatusFilter) => void;
  statusCounts: Record<SessionStatusFilter, number>;
  searchValue: string;
  onSearchChange: (value: string) => void;
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

const SESSION_ROW_ESTIMATED_HEIGHT = 136;

interface SessionRowProps {
  session: TelemetrySession;
  isActive: boolean;
  onSelect: (sessionId: string) => void;
}

const SessionRow = memo(function SessionRow({ session, isActive, onSelect }: SessionRowProps) {
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
  const handleClick = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    onSelect(session.id);
  }, [onSelect, session.id]);
  return (
    <div
      role="button"
      onClick={handleClick}
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
    </div>
  );
});

export default function SessionSidebar({
  sessions,
  selectedSessionId,
  onSelectSession,
  groupingKey,
  onChangeGroupingKey,
  groupingItems,
  selectedGroupingValue,
  onSelectGroupingValue,
  sortOrder,
  onChangeSortOrder,
  statusFilter,
  onChangeStatusFilter,
  statusCounts,
  searchValue,
  onSearchChange,
}: SessionSidebarProps) {
  const groupingMeta = SESSION_GROUPING_DISPLAY_META[groupingKey];
  const selectedGroupingLabel = useMemo(() => {
    if (!selectedGroupingValue) {
      return groupingMeta.allLabel;
    }
    const match = groupingItems.find((item) => item.value === selectedGroupingValue);
    return match?.label ?? groupingMeta.allLabel;
  }, [groupingItems, groupingMeta.allLabel, selectedGroupingValue]);
  const statusSegmentOptions = useMemo(
    () => [
      { label: `全部 (${statusCounts.all})`, value: 'all' as const },
      { label: `实时 (${statusCounts.active})`, value: 'active' as const },
      { label: `已结束 (${statusCounts.closed})`, value: 'closed' as const },
    ],
    [statusCounts]
  );
  const emptyDescription = selectedGroupingValue
    ? `${selectedGroupingLabel} 暂无${statusFilterLabels[statusFilter]}`
    : `暂无${statusFilterLabels[statusFilter]}`;

  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const [listHeight, setListHeight] = useState<number>(0);

  useEffect(() => {
    const element = listContainerRef.current;
    if (!element) {
      return;
    }

    const updateHeight = () => {
      setListHeight(element.clientHeight);
    };

    updateHeight();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateHeight();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [sessions.length]);

  const virtualListHeight = listHeight > 0 ? listHeight : Math.min(sessions.length * SESSION_ROW_ESTIMATED_HEIGHT, 480);

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
            <Typography.Text type="secondary">历史记录分组</Typography.Text>
            <Select<SessionGrouping>
              value={groupingKey}
              options={SESSION_GROUPING_OPTIONS}
              onChange={(value) => onChangeGroupingKey(value)}
              size="small"
              style={{ width: '100%' }}
            />
          </Space>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Typography.Text type="secondary">当前{groupingMeta.label}</Typography.Text>
            <Typography.Text style={{ fontSize: 16, fontWeight: 600 }}>
              {selectedGroupingLabel}
            </Typography.Text>
          </Space>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Typography.Text type="secondary">搜索历史会话</Typography.Text>
            <Input
              allowClear
              placeholder="按 IP、设备、账号、产品等搜索"
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
            />
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
            checked={selectedGroupingValue === null}
            onChange={(checked) => {
              if (checked) {
                onSelectGroupingValue(null);
              } else if (selectedGroupingValue === null) {
                onSelectGroupingValue(null);
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
            {groupingMeta.allLabel}
          </CheckableTag>
          {groupingItems.length === 0 ? (
            <Typography.Text type="secondary">暂无分组数据</Typography.Text>
          ) : (
            groupingItems.map((item) => (
              <CheckableTag
                key={item.value}
                checked={selectedGroupingValue === item.value}
                onChange={(checked) => onSelectGroupingValue(checked ? item.value : null)}
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
                  title={item.label}
                >
                  {item.label}
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
      <div ref={listContainerRef} style={{ flex: 1, minHeight: 0 }}>
        {sessions.length === 0 ? (
          <Empty description={emptyDescription} style={{ marginTop: 80 }} />
        ) : (
          <VirtualList
            data={sessions}
            height={Math.max(virtualListHeight, SESSION_ROW_ESTIMATED_HEIGHT)}
            itemKey="id"
            itemHeight={SESSION_ROW_ESTIMATED_HEIGHT}
            style={{ height: '100%', overflow: 'auto', paddingRight: 4 }}
          >
            {(session: TelemetrySession) => (
              <SessionRow
                key={session.id}
                session={session}
                isActive={session.id === selectedSessionId}
                onSelect={onSelectSession}
              />
            )}
          </VirtualList>
        )}
      </div>
    </div>
  );
}
