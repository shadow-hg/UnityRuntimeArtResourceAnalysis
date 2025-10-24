import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  ConfigProvider,
  Flex,
  Input,
  Layout,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message,
  theme,
} from 'antd';
import {
  BulbFilled,
  BulbOutlined,
  DownloadOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useTelemetryStream } from './hooks/useTelemetryStream';
import type {
  NetworkInfoResponse,
  ServerConfig,
  TelemetrySession,
  TelemetrySnapshot,
  SessionSortOrder,
  SessionStatusFilter,
  SessionGrouping,
  SessionGroupingItem,
} from './types';
import SessionSidebar from './components/SessionSidebar';
import ResourceExplorer from './components/ResourceExplorer';
import PerformanceChart from './components/PerformanceChart';
import ServerSettingsModal from './components/ServerSettingsModal';
import FrameInsightsPanel from './components/FrameInsightsPanel';
import SystemStatsPanel from './components/SystemStatsPanel';
import AssetIoPanel from './components/AssetIoPanel';
import EnvironmentPanel from './components/EnvironmentPanel';
import { formatBytes, formatFps } from './utils/format';
import { buildGlobalReport } from './utils/report';
import { resolveSessionIp, UNKNOWN_IP_LABEL } from './utils/session';
import { SESSION_GROUPING_DISPLAY_META } from './utils/sessionGrouping';

const { Header, Sider, Content } = Layout;

const DEFAULT_SERVER_PORT = 48080;
const DEFAULT_SERVER_IP = '0.0.0.0';

function stripTrailingSlash(value: string): string {
  if (value.endsWith('/')) {
    return value.slice(0, -1);
  }
  return value;
}

function isLoopbackAddress(value?: string | null): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function sanitizeLoopbackUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (isLoopbackAddress(parsed.hostname)) {
      parsed.hostname = '127.0.0.1';
    }
    return stripTrailingSlash(parsed.toString());
  } catch {
    return rawUrl;
  }
}

function deriveDisplayServerUrl(networkInfo: NetworkInfoResponse | null, fallbackUrl: string): string {
  if (networkInfo?.addresses?.length) {
    const preferred =
      networkInfo.addresses.find((address) => !isLoopbackAddress(address.address)) ||
      networkInfo.addresses[0];
    if (preferred?.url) {
      return stripTrailingSlash(preferred.url);
    }
  }

  if (networkInfo?.hostname) {
    try {
      const parsed = new URL(fallbackUrl);
      parsed.hostname = networkInfo.hostname;
      if (networkInfo.port) {
        parsed.port = String(networkInfo.port);
      }
      if (isLoopbackAddress(parsed.hostname)) {
        parsed.hostname = '127.0.0.1';
      }
      return stripTrailingSlash(parsed.toString());
    } catch {
      const protocol = fallbackUrl.startsWith('https://') ? 'https://' : 'http://';
      const host = isLoopbackAddress(networkInfo.hostname) ? '127.0.0.1' : networkInfo.hostname;
      const portSegment = networkInfo.port ? `:${networkInfo.port}` : '';
      return `${protocol}${host}${portSegment}`;
    }
  }

  return sanitizeLoopbackUrl(fallbackUrl);
}

function resolveTotalFrameCount(session: TelemetrySession): number {
  const trimmed = typeof session.trimmedFrameCount === 'number' && Number.isFinite(session.trimmedFrameCount)
    ? session.trimmedFrameCount
    : 0;
  const visibleFrames = Array.isArray(session.frames) ? session.frames.length : 0;
  const total =
    typeof session.totalFrameCount === 'number' && Number.isFinite(session.totalFrameCount)
      ? session.totalFrameCount
      : trimmed + visibleFrames;
  return total;
}

function resolveSessionTimestamp(session: TelemetrySession): number {
  const timestamp = new Date(session.createdAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

const UNKNOWN_GROUP_VALUE = '__UNKNOWN__';

function normalizeCandidate(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getSessionGroupingValue(session: TelemetrySession, grouping: SessionGrouping): string {
  switch (grouping) {
    case 'ip': {
      const ip = resolveSessionIp(session);
      return !ip || ip === UNKNOWN_IP_LABEL ? UNKNOWN_GROUP_VALUE : ip;
    }
    case 'account': {
      const account = normalizeCandidate(session.client?.['accountName']);
      if (account) return account;
      const userName = normalizeCandidate(session.client?.['userName']);
      return userName || UNKNOWN_GROUP_VALUE;
    }
    case 'device': {
      const device = normalizeCandidate(session.client?.['deviceName']);
      return device || UNKNOWN_GROUP_VALUE;
    }
    case 'product': {
      const product = normalizeCandidate(session.client?.['productName']);
      return product || UNKNOWN_GROUP_VALUE;
    }
    case 'platform': {
      const platform = normalizeCandidate(session.client?.['platform']);
      return platform || UNKNOWN_GROUP_VALUE;
    }
    default:
      return UNKNOWN_GROUP_VALUE;
  }
}

function getSessionGroupingLabel(value: string, grouping: SessionGrouping): string {
  if (value === UNKNOWN_GROUP_VALUE) {
    return SESSION_GROUPING_DISPLAY_META[grouping].unknownLabel;
  }
  return value;
}

function matchesSessionSearch(session: TelemetrySession, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const client = session.client ?? {};
  const fields: (string | undefined | null)[] = [
    session.id,
    session.clientIp,
    resolveSessionIp(session),
    normalizeCandidate(client['accountName'] as string | undefined),
    normalizeCandidate(client['userName'] as string | undefined),
    normalizeCandidate(client['productName'] as string | undefined),
    normalizeCandidate(client['deviceName'] as string | undefined),
    normalizeCandidate(client['platform'] as string | undefined),
    normalizeCandidate(client['version'] as string | undefined),
    normalizeCandidate(client['remoteAddress'] as string | undefined),
  ];

  return fields.some((raw) => {
    if (typeof raw !== 'string') {
      return false;
    }
    return raw.toLowerCase().includes(normalized);
  });
}

const connectionBadgeMeta: Record<
  ReturnType<typeof useTelemetryStream>['connectionState'],
  { status: 'success' | 'processing' | 'default' | 'error'; text: string }
> = {
  connected: { status: 'success', text: '实时连接' },
  connecting: { status: 'processing', text: '正在连接…' },
  disconnected: { status: 'default', text: '已断开' },
  error: { status: 'error', text: '连接异常' },
};

function usePreferredDarkMode() {
  return useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = window.localStorage.getItem('unityProfile:theme');
    if (stored) {
      return stored === 'dark';
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
}

interface AppShellProps {
  sessions: TelemetrySession[];
  connectionState: ReturnType<typeof useTelemetryStream>['connectionState'];
  networkInfo: ReturnType<typeof useTelemetryStream>['networkInfo'];
  isDarkMode: boolean;
  onToggleDarkMode: (value: boolean) => void;
  serverConfig: ServerConfig | null;
  onOpenSettings: () => void;
  isSettingsLoading: boolean;
  serverBaseUrl: string;
  serverIp: string;
  serverPort: string;
  onChangeServerIp: (value: string) => void;
  onChangeServerPort: (value: string) => void;
  onToggleConnection: () => void;
  onExportGlobalReport: () => void;
  onLoadSessionDetails: (sessionId: string) => void;
  ensureSessionTextures?: (sessionId: string, textureIds: string[]) => Promise<void>;
}

function AppShell({
  sessions,
  connectionState,
  networkInfo,
  isDarkMode,
  onToggleDarkMode,
  serverConfig,
  onOpenSettings,
  isSettingsLoading,
  serverBaseUrl,
  serverIp,
  serverPort,
  onChangeServerIp,
  onChangeServerPort,
  onToggleConnection,
  onExportGlobalReport,
  onLoadSessionDetails,
  ensureSessionTextures,
}: AppShellProps) {
  const serverDisplayUrl = useMemo(
    () => (serverBaseUrl ? deriveDisplayServerUrl(networkInfo, serverBaseUrl) : '未连接'),
    [networkInfo, serverBaseUrl]
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedFrame, setSelectedFrame] = useState<TelemetrySnapshot | null>(null);
  const [isAutoFollowLatest, setIsAutoFollowLatest] = useState(true);
  const [sessionGrouping, setSessionGrouping] = useState<SessionGrouping>('ip');
  const [selectedGroupingValue, setSelectedGroupingValue] = useState<string | null>(null);
  const [sessionSearchValue, setSessionSearchValue] = useState('');
  const [sessionSortOrder, setSessionSortOrder] = useState<SessionSortOrder>('newest');
  const [sessionStatusFilter, setSessionStatusFilter] = useState<SessionStatusFilter>('all');
  const [samplingIntervalMs, setSamplingIntervalMs] = useState<number>(
    () => Math.max(0, (serverConfig?.clientDefaults?.sampleIntervalSeconds ?? 0) * 1000)
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { token } = theme.useToken();

  useEffect(() => {
    setSamplingIntervalMs((prev) => {
      const next = Math.max(0, (serverConfig?.clientDefaults?.sampleIntervalSeconds ?? 0) * 1000);
      return Math.abs(prev - next) < 1e-3 ? prev : next;
    });
  }, [serverConfig]);

  const normalizedSearchValue = sessionSearchValue.trim();

  const searchFilteredSessions = useMemo(() => {
    if (!normalizedSearchValue) {
      return sessions;
    }
    return sessions.filter((session) => matchesSessionSearch(session, normalizedSearchValue));
  }, [sessions, normalizedSearchValue]);

  const groupingOptions = useMemo<SessionGroupingItem[]>(() => {
    const map = new Map<string, SessionGroupingItem>();
    searchFilteredSessions.forEach((session) => {
      const value = getSessionGroupingValue(session, sessionGrouping);
      const entry = map.get(value) ?? {
        value,
        label: getSessionGroupingLabel(value, sessionGrouping),
        sessionCount: 0,
        activeSessionCount: 0,
      };
      entry.sessionCount += 1;
      if (!session.closedAt) {
        entry.activeSessionCount += 1;
      }
      map.set(value, entry);
    });
    return Array.from(map.values()).sort((a, b) => {
      if (b.activeSessionCount !== a.activeSessionCount) {
        return b.activeSessionCount - a.activeSessionCount;
      }
      if (b.sessionCount !== a.sessionCount) {
        return b.sessionCount - a.sessionCount;
      }
      return a.label.localeCompare(b.label);
    });
  }, [searchFilteredSessions, sessionGrouping]);

  const groupingMeta = SESSION_GROUPING_DISPLAY_META[sessionGrouping];
  const selectedGroupingLabel = useMemo(() => {
    if (!selectedGroupingValue) {
      return groupingMeta.allLabel;
    }
    const match = groupingOptions.find((item) => item.value === selectedGroupingValue);
    return match?.label ?? groupingMeta.allLabel;
  }, [groupingMeta.allLabel, groupingOptions, selectedGroupingValue]);

  const groupingFilteredSessions = useMemo(() => {
    if (!selectedGroupingValue) {
      return searchFilteredSessions;
    }
    return searchFilteredSessions.filter(
      (session) => getSessionGroupingValue(session, sessionGrouping) === selectedGroupingValue
    );
  }, [searchFilteredSessions, selectedGroupingValue, sessionGrouping]);

  const statusCounts = useMemo<Record<SessionStatusFilter, number>>(() => {
    let active = 0;
    let closed = 0;
    groupingFilteredSessions.forEach((session) => {
      if (session.closedAt) {
        closed += 1;
      } else {
        active += 1;
      }
    });
    return {
      all: groupingFilteredSessions.length,
      active,
      closed,
    };
  }, [groupingFilteredSessions]);

  const statusFilteredSessions = useMemo(() => {
    switch (sessionStatusFilter) {
      case 'active':
        return groupingFilteredSessions.filter((session) => !session.closedAt);
      case 'closed':
        return groupingFilteredSessions.filter((session) => Boolean(session.closedAt));
      default:
        return groupingFilteredSessions;
    }
  }, [groupingFilteredSessions, sessionStatusFilter]);

  const visibleSessions = useMemo(() => {
    const list = [...statusFilteredSessions];
    list.sort((a, b) => {
      switch (sessionSortOrder) {
        case 'oldest':
          return resolveSessionTimestamp(a) - resolveSessionTimestamp(b);
        case 'frames-desc': {
          const diff = resolveTotalFrameCount(b) - resolveTotalFrameCount(a);
          if (diff !== 0) {
            return diff;
          }
          return resolveSessionTimestamp(b) - resolveSessionTimestamp(a);
        }
        case 'frames-asc': {
          const diff = resolveTotalFrameCount(a) - resolveTotalFrameCount(b);
          if (diff !== 0) {
            return diff;
          }
          return resolveSessionTimestamp(a) - resolveSessionTimestamp(b);
        }
        case 'newest':
        default:
          return resolveSessionTimestamp(b) - resolveSessionTimestamp(a);
      }
    });
    return list;
  }, [statusFilteredSessions, sessionSortOrder]);

  useEffect(() => {
    if (selectedGroupingValue === null) {
      return;
    }
    if (!groupingOptions.some((option) => option.value === selectedGroupingValue)) {
      setSelectedGroupingValue(null);
    }
  }, [groupingOptions, selectedGroupingValue]);

  useEffect(() => {
    setSelectedGroupingValue(null);
  }, [sessionGrouping]);

  useEffect(() => {
    if (visibleSessions.length === 0) {
      setSelectedSessionId(null);
      setSelectedFrame(null);
      return;
    }

    if (!selectedSessionId || !visibleSessions.some((session) => session.id === selectedSessionId)) {
      const newest = visibleSessions[0];
      setSelectedSessionId(newest.id);
      const newestFrames = Array.isArray(newest.frames) ? newest.frames : [];
      setSelectedFrame(newestFrames[newestFrames.length - 1] ?? null);
      setIsAutoFollowLatest(true);
    }
  }, [visibleSessions, selectedSessionId]);

  useEffect(() => {
    if (selectedSessionId) {
      onLoadSessionDetails(selectedSessionId);
    }
  }, [selectedSessionId, onLoadSessionDetails]);

  const selectedSession = useMemo<TelemetrySession | null>(() => {
    if (!selectedSessionId) return visibleSessions[0] ?? null;
    return visibleSessions.find((session) => session.id === selectedSessionId) ?? visibleSessions[0] ?? null;
  }, [visibleSessions, selectedSessionId]);

  const frames = useMemo(() => {
    if (!selectedSession) return [];

    const deduped = new Map<number, TelemetrySnapshot>();
    for (const frame of selectedSession.frames ?? []) {
      if (!frame) continue;
      deduped.set(frame.frameNumber, frame);
    }

    return Array.from(deduped.values()).sort((a, b) => a.frameNumber - b.frameNumber);
  }, [selectedSession]);

  useEffect(() => {
    if (!selectedSession) {
      setSelectedFrame(null);
      return;
    }

    const latest = frames[frames.length - 1] ?? null;
    if (!selectedFrame) {
      setSelectedFrame(latest);
      return;
    }

    const stillExists = frames.some((frame) => frame.frameNumber === selectedFrame.frameNumber);
    if (!stillExists) {
      setSelectedFrame(latest);
      setIsAutoFollowLatest(true);
      return;
    }

    if (isAutoFollowLatest && latest && selectedFrame.frameNumber !== latest.frameNumber) {
      setSelectedFrame(latest);
    }
  }, [selectedSession, frames, selectedFrame, isAutoFollowLatest]);

  const handleSessionChange = useCallback(
    (sessionId: string) => {
      const session = visibleSessions.find((s) => s.id === sessionId);
      if (!session) {
        return;
      }
      setSelectedSessionId(sessionId);
      const lastFrame = session.frames?.[session.frames.length - 1] ?? null;
      setSelectedFrame(lastFrame ?? null);
      setIsAutoFollowLatest(true);
    },
    [visibleSessions]
  );

  const handleFrameSelect = useCallback(
    (frame: TelemetrySnapshot | null, meta?: { userInitiated?: boolean }) => {
      setSelectedFrame(frame);
      if (meta?.userInitiated) {
        const latestFrameNumber = frames[frames.length - 1]?.frameNumber;
        setIsAutoFollowLatest(frame ? frame.frameNumber === latestFrameNumber : true);
      }
    },
    [frames]
  );

  const resumeLive = useCallback(() => {
    if (frames.length === 0) return;
    const latest = frames[frames.length - 1];
    setIsAutoFollowLatest(true);
    setSelectedFrame(latest);
  }, [frames]);

  const toggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((prev) => !prev);
  }, []);

  const headerSubtitle = selectedFrame
    ? `${formatFps(selectedFrame.fps)} • 纹理 ${formatBytes(selectedFrame.totalTextureBytes)} • RenderTexture ${formatBytes(
        selectedFrame.totalRenderTextureBytes ?? 0
      )} • 网格 ${formatBytes(selectedFrame.totalMeshBytes)}`
    : connectionState === 'connected'
    ? '等待采集帧数据…'
    : '等待客户端连接…';

  const badgeMeta = connectionBadgeMeta[connectionState];
  const isConnectionActive = Boolean(serverBaseUrl);

  return (
    <Layout style={{ minHeight: '100vh', background: token.colorBgBase }}>
      <Header
        style={{
          background: token.colorBgElevated,
          padding: '0 24px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Flex align="center" justify="space-between" style={{ height: '100%' }}>
          <Flex align="center" gap={16} style={{ minWidth: 0 }}>
            <Tooltip title={isSidebarCollapsed ? '展开服务器与历史记录面板' : '收起服务器与历史记录面板'}>
              <Button
                type="text"
                shape="circle"
                icon={isSidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={toggleSidebar}
                aria-label={isSidebarCollapsed ? '展开侧栏' : '收起侧栏'}
              />
            </Tooltip>
            <Flex vertical gap={8} style={{ minWidth: 0 }}>
              <Typography.Title level={3} style={{ color: token.colorTextBase, margin: 0 }}>
                UnityProfileV2 仪表盘
              </Typography.Title>
              <Space size={12} wrap>
                <Badge status={badgeMeta.status} text={badgeMeta.text} />
                <Typography.Text type="secondary">{headerSubtitle}</Typography.Text>
              </Space>
              <Space size={8} align="center">
                <Typography.Text type="secondary">当前{groupingMeta.label}：</Typography.Text>
                {selectedGroupingValue ? (
                  <Tag color="processing">{selectedGroupingLabel}</Tag>
                ) : (
                  <Typography.Text type="secondary">{groupingMeta.allLabel}</Typography.Text>
                )}
              </Space>
            </Flex>
          </Flex>
          <Flex align="center" gap={16} wrap justify="flex-end">
            <Flex align="center" gap={8} wrap>
              <Input
                value={serverIp}
                onChange={(event) => onChangeServerIp(event.target.value)}
                placeholder="服务器 IP"
                style={{ width: 150 }}
                allowClear
              />
              <Input
                value={serverPort}
                onChange={(event) => onChangeServerPort(event.target.value)}
                placeholder="端口"
                style={{ width: 100 }}
                inputMode="numeric"
              />
              <Button
                type={isConnectionActive ? 'default' : 'primary'}
                onClick={onToggleConnection}
                loading={connectionState === 'connecting' && isConnectionActive}
              >
                {isConnectionActive ? '断开' : '连接'}
              </Button>
            </Flex>
            <Tooltip title="导出当前所有会话的全局报告">
              <Button icon={<DownloadOutlined />} onClick={onExportGlobalReport}>
                导出报告
              </Button>
            </Tooltip>
            {!isAutoFollowLatest && frames.length > 0 ? (
              <Tooltip title="回到实时最新帧">
                <Button icon={<ReloadOutlined />} onClick={resumeLive} type="primary" ghost>
                  追踪最新
                </Button>
              </Tooltip>
            ) : null}
            <Tooltip title={isDarkMode ? '切换到亮色模式' : '切换到暗黑模式'}>
              <Switch
                checked={isDarkMode}
                onChange={onToggleDarkMode}
                checkedChildren={<BulbFilled />}
                unCheckedChildren={<BulbOutlined />}
              />
            </Tooltip>
            <Tooltip title="服务器设置">
              <Button
                type="text"
                shape="circle"
                icon={<SettingOutlined />}
                onClick={onOpenSettings}
                loading={isSettingsLoading}
                aria-label="服务器设置"
              />
            </Tooltip>
          </Flex>
        </Flex>
      </Header>
      <Layout>
        <Sider
          width={320}
          collapsedWidth={0}
          collapsible
          collapsed={isSidebarCollapsed}
          trigger={null}
          style={{
            background: token.colorBgContainer,
            borderRight: isSidebarCollapsed ? 'none' : `1px solid ${token.colorBorderSecondary}`,
            padding: isSidebarCollapsed ? 0 : '16px 0',
            transition: 'all 0.2s ease',
            overflow: 'hidden',
          }}
        >
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Flex
              vertical
              gap={12}
              style={{ padding: '0 16px', color: token.colorTextBase }}
            >
              <Space direction="vertical" size={6}>
                <Space size={4} align="center">
                  <Typography.Text type="secondary">服务器地址</Typography.Text>
                  <Tooltip title="跨设备采集请使用下方局域网地址">
                    <InfoCircleOutlined style={{ color: token.colorTextTertiary || token.colorTextSecondary }} />
                  </Tooltip>
                </Space>
                <Typography.Text
                  copyable={{ text: serverDisplayUrl }}
                  style={{ color: token.colorTextBase }}
                >
                  {serverDisplayUrl}
                </Typography.Text>
              </Space>
              {networkInfo?.hostname ? (
                <Typography.Text type="secondary">主机 {networkInfo.hostname}</Typography.Text>
              ) : null}
              {networkInfo?.addresses?.length ? (
                <Space direction="vertical" size={4}>
                  <Typography.Text type="secondary">局域网</Typography.Text>
                  <Space direction="vertical" size={4}>
                    {networkInfo.addresses.map((address) => (
                      <Typography.Text
                        key={address.url}
                        copyable={{ text: address.url }}
                        style={{
                          color: token.colorPrimary,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <LinkOutlined />[{address.interface}] {address.address}
                      </Typography.Text>
                    ))}
                  </Space>
                </Space>
              ) : null}
            </Flex>
            <div style={{ flex: 1, minHeight: 0 }}>
              <SessionSidebar
                sessions={visibleSessions}
                selectedSessionId={selectedSession?.id ?? null}
                onSelectSession={handleSessionChange}
                groupingKey={sessionGrouping}
                onChangeGroupingKey={setSessionGrouping}
                groupingItems={groupingOptions}
                selectedGroupingValue={selectedGroupingValue}
                onSelectGroupingValue={setSelectedGroupingValue}
                sortOrder={sessionSortOrder}
                onChangeSortOrder={(order) => setSessionSortOrder(order)}
                statusFilter={sessionStatusFilter}
                onChangeStatusFilter={(filter) => setSessionStatusFilter(filter)}
                statusCounts={statusCounts}
                searchValue={sessionSearchValue}
                onSearchChange={setSessionSearchValue}
              />
            </div>
          </div>
        </Sider>
        <Content style={{ padding: 24, background: token.colorBgBase }}>
          <Flex vertical gap={16} style={{ height: '100%' }}>
            <PerformanceChart
              frames={frames}
              selectedFrame={selectedFrame}
              samplingIntervalMs={samplingIntervalMs}
              onChangeSamplingInterval={setSamplingIntervalMs}
              onSelectFrame={handleFrameSelect}
              serverBaseUrl={serverBaseUrl}
            />
            <Flex gap={16} wrap style={{ width: '100%' }}>
              <FrameInsightsPanel frame={selectedFrame} />
              <SystemStatsPanel frame={selectedFrame} />
            </Flex>
            <Flex gap={16} wrap style={{ width: '100%' }}>
              <AssetIoPanel frame={selectedFrame} />
              <EnvironmentPanel frame={selectedFrame} />
            </Flex>
            <ResourceExplorer
              frame={selectedFrame}
              serverBaseUrl={serverBaseUrl}
              sessionId={selectedSession?.id ?? null}
              ensureTextures={ensureSessionTextures}
            />
          </Flex>
        </Content>
      </Layout>
    </Layout>
  );
}

export default function App() {
  const [serverIp, setServerIp] = useState(DEFAULT_SERVER_IP);
  const [serverPort, setServerPort] = useState(String(DEFAULT_SERVER_PORT));
  const [serverBaseUrl, setServerBaseUrl] = useState<string>('');

  const {
    sessions,
    connectionState,
    networkInfo,
    serverConfig,
    isConfigLoading,
    isSessionsLoading,
    updateServerConfig,
    clearServerHistory,
    deleteServerSession,
    refreshServerConfig,
    loadSessionDetails,
    ensureSessionTextures,
  } = useTelemetryStream({ serverBaseUrl });
  const [isDarkMode, setIsDarkMode] = usePreferredDarkMode();
  const algorithm = isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm;
  const [messageApi, contextHolder] = message.useMessage();
  const loadingMessageKeyRef = useRef('telemetry-sessions-loading');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  const handleLoadSessionDetails = useCallback(
    (sessionId: string) => {
      if (!sessionId) return;
      loadSessionDetails(sessionId);
    },
    [loadSessionDetails]
  );

  const handleExportGlobalReport = useCallback(() => {
    if (typeof window === 'undefined') {
      messageApi.error('当前环境不支持导出');
      return;
    }

    const report = buildGlobalReport({ sessions, serverConfig, networkInfo });
    const serialized = JSON.stringify(report, null, 2);
    const blob = new Blob([serialized], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `unity-profile-report-${timestamp}.json`;
    anchor.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    messageApi.success('全局报告已导出');
  }, [sessions, serverConfig, networkInfo, messageApi]);

  const handleServerIpChange = useCallback((value: string) => {
    setServerIp(value);
  }, []);

  const handleServerPortChange = useCallback((value: string) => {
    const normalized = value.replace(/[^0-9]/g, '');
    setServerPort(normalized);
  }, []);

  const handleToggleConnection = useCallback(() => {
    if (serverBaseUrl) {
      setServerBaseUrl('');
      return;
    }

    const trimmedIp = serverIp.trim() || DEFAULT_SERVER_IP;
    const parsedPort = Number.parseInt(serverPort, 10);
    if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      messageApi.error('请输入有效的端口号');
      return;
    }

    setServerBaseUrl(`http://${trimmedIp}:${parsedPort}`);
  }, [serverBaseUrl, serverIp, serverPort, messageApi]);

  const handleOpenSettings = useCallback(() => {
    setIsSettingsOpen(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  const handleSaveSettings = useCallback(
    async (config: Partial<ServerConfig>) => {
      try {
        setIsSavingSettings(true);
        await updateServerConfig(config);
        messageApi.success('服务器配置已保存');
        setIsSettingsOpen(false);
      } catch (error) {
        console.error(error);
        const description = error instanceof Error ? error.message : '保存配置失败';
        messageApi.error(`保存配置失败：${description}`);
      } finally {
        setIsSavingSettings(false);
      }
    },
    [updateServerConfig, messageApi]
  );

  const handleClearHistory = useCallback(async () => {
    try {
      setIsClearingHistory(true);
      await clearServerHistory();
      messageApi.success('历史记录已清空');
    } catch (error) {
      console.error(error);
      const description = error instanceof Error ? error.message : '清空历史记录失败';
      messageApi.error(`清空历史记录失败：${description}`);
    } finally {
      setIsClearingHistory(false);
    }
  }, [clearServerHistory, messageApi]);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      try {
        setDeletingSessionId(sessionId);
        await deleteServerSession(sessionId);
        messageApi.success('已删除选定会话');
      } catch (error) {
        console.error(error);
        const description = error instanceof Error ? error.message : '删除会话失败';
        messageApi.error(`删除会话失败：${description}`);
      } finally {
        setDeletingSessionId(null);
      }
    },
    [deleteServerSession, messageApi]
  );

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const config = await refreshServerConfig();
        if (!config && !cancelled) {
          messageApi.error('读取服务器配置失败');
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error(error);
        const description = error instanceof Error ? error.message : '读取服务器配置失败';
        messageApi.error(`读取服务器配置失败：${description}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isSettingsOpen, refreshServerConfig, messageApi]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('unityProfile:theme', isDarkMode ? 'dark' : 'light');
    document.body.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    const key = loadingMessageKeyRef.current;
    if (isSessionsLoading) {
      messageApi.open({
        type: 'loading',
        content: '历史数据库加载中，请稍候…',
        key,
        duration: 0,
      });
    } else {
      messageApi.destroy(key);
    }

    return () => {
      messageApi.destroy(key);
    };
  }, [isSessionsLoading, messageApi]);

  return (
    <ConfigProvider
      theme={{
        algorithm,
        token: {
          borderRadiusLG: 12,
          fontFamily: `'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`,
        },
      }}
    >
      {contextHolder}
      <AppShell
        sessions={sessions}
        connectionState={connectionState}
        networkInfo={networkInfo}
        isDarkMode={isDarkMode}
        onToggleDarkMode={setIsDarkMode}
        serverConfig={serverConfig}
        onOpenSettings={handleOpenSettings}
        isSettingsLoading={isConfigLoading}
        serverBaseUrl={serverBaseUrl}
        serverIp={serverIp}
        serverPort={serverPort}
        onChangeServerIp={handleServerIpChange}
        onChangeServerPort={handleServerPortChange}
        onToggleConnection={handleToggleConnection}
        onExportGlobalReport={handleExportGlobalReport}
        onLoadSessionDetails={handleLoadSessionDetails}
        ensureSessionTextures={ensureSessionTextures}
      />
      <ServerSettingsModal
        open={isSettingsOpen}
        config={serverConfig}
        loading={isConfigLoading}
        saving={isSavingSettings}
        clearing={isClearingHistory}
        sessions={sessions}
        deletingSessionId={deletingSessionId}
        onCancel={handleCloseSettings}
        onSubmit={handleSaveSettings}
        onClearHistory={handleClearHistory}
        onDeleteSession={handleDeleteSession}
      />
    </ConfigProvider>
  );
}
