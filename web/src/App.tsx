import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  ConfigProvider,
  Flex,
  Layout,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import { BulbFilled, BulbOutlined, LinkOutlined, ReloadOutlined } from '@ant-design/icons';
import { useTelemetryStream } from './hooks/useTelemetryStream';
import type { TelemetrySession, TelemetrySnapshot } from './types';
import SessionSidebar from './components/SessionSidebar';
import ResourceExplorer from './components/ResourceExplorer';
import PerformanceChart from './components/PerformanceChart';
import FrameTimeline from './components/FrameTimeline';
import { formatBytes, formatFps } from './utils/format';

const { Header, Sider, Content } = Layout;

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:48080';
const UNKNOWN_IP_LABEL = '未知 IP';

function resolveSessionIp(session: TelemetrySession): string {
  const raw = typeof session.clientIp === 'string' ? session.clientIp.trim() : '';
  if (raw && raw.toLowerCase() !== 'unknown') {
    return raw;
  }

  const fallbackSource = session.client?.['remoteAddress'];
  const fallback = typeof fallbackSource === 'string' ? fallbackSource.trim() : '';
  if (fallback) {
    return fallback;
  }

  return UNKNOWN_IP_LABEL;
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
}

function AppShell({ sessions, connectionState, networkInfo, isDarkMode, onToggleDarkMode }: AppShellProps) {
  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [sessions]
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedFrame, setSelectedFrame] = useState<TelemetrySnapshot | null>(null);
  const [isAutoFollowLatest, setIsAutoFollowLatest] = useState(true);
  const [selectedClientIp, setSelectedClientIp] = useState<string | null>(null);
  const { token } = theme.useToken();

  const clientIpOptions = useMemo(
    () => {
      const map = new Map<string, { ip: string; sessionCount: number; activeSessionCount: number }>();
      sortedSessions.forEach((session) => {
        const ip = resolveSessionIp(session);
        const existing = map.get(ip) ?? { ip, sessionCount: 0, activeSessionCount: 0 };
        existing.sessionCount += 1;
        if (!session.closedAt) {
          existing.activeSessionCount += 1;
        }
        map.set(ip, existing);
      });
      return Array.from(map.values()).sort((a, b) => {
        if (b.activeSessionCount !== a.activeSessionCount) {
          return b.activeSessionCount - a.activeSessionCount;
        }
        if (b.sessionCount !== a.sessionCount) {
          return b.sessionCount - a.sessionCount;
        }
        return a.ip.localeCompare(b.ip);
      });
    },
    [sortedSessions]
  );

  const visibleSessions = useMemo(() => {
    if (!selectedClientIp) {
      return sortedSessions;
    }
    return sortedSessions.filter((session) => resolveSessionIp(session) === selectedClientIp);
  }, [sortedSessions, selectedClientIp]);

  useEffect(() => {
    if (clientIpOptions.length === 0) {
      if (selectedClientIp !== null) {
        setSelectedClientIp(null);
      }
      return;
    }

    if (selectedClientIp && !clientIpOptions.some((option) => option.ip === selectedClientIp)) {
      setSelectedClientIp(clientIpOptions[0]?.ip ?? null);
    }
  }, [clientIpOptions, selectedClientIp]);

  useEffect(() => {
    if (visibleSessions.length === 0) {
      setSelectedSessionId(null);
      setSelectedFrame(null);
      return;
    }

    if (!selectedSessionId || !visibleSessions.some((session) => session.id === selectedSessionId)) {
      const newest = visibleSessions[0];
      setSelectedSessionId(newest.id);
      setSelectedFrame(newest.frames[newest.frames.length - 1] ?? null);
      setIsAutoFollowLatest(true);
    }
  }, [visibleSessions, selectedSessionId]);

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

  const headerSubtitle = selectedFrame
    ? `${formatFps(selectedFrame.fps)} • 纹理 ${formatBytes(selectedFrame.totalTextureBytes)} • RenderTexture ${formatBytes(
        selectedFrame.totalRenderTextureBytes ?? 0
      )} • 网格 ${formatBytes(selectedFrame.totalMeshBytes)}`
    : connectionState === 'connected'
    ? '等待采集帧数据…'
    : '等待客户端连接…';

  const badgeMeta = connectionBadgeMeta[connectionState];

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
          <Flex vertical gap={8} style={{ minWidth: 0 }}>
            <Typography.Title level={3} style={{ color: token.colorTextBase, margin: 0 }}>
              UnityProfileV2 仪表盘
            </Typography.Title>
            <Space size={12} wrap>
              <Badge status={badgeMeta.status} text={badgeMeta.text} />
              <Typography.Text type="secondary">{headerSubtitle}</Typography.Text>
            </Space>
            <Space size={[8, 6]} wrap>
              <Typography.Text type="secondary">服务器地址：</Typography.Text>
              <Typography.Text copyable={{ text: SERVER_URL }} style={{ color: token.colorTextBase }}>
                {SERVER_URL}
              </Typography.Text>
              {networkInfo?.hostname ? (
                <Typography.Text type="secondary">主机 {networkInfo.hostname}</Typography.Text>
              ) : null}
              {networkInfo?.addresses?.length ? (
                <>
                  <Typography.Text type="secondary">局域网：</Typography.Text>
                  <Space size={[8, 6]} wrap>
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
                </>
              ) : null}
              <Typography.Text type="secondary">当前客户端：</Typography.Text>
              <Tag color={selectedClientIp ? 'processing' : 'default'}>
                {selectedClientIp ?? '全部客户端'}
              </Tag>
            </Space>
          </Flex>
          <Flex align="center" gap={16} wrap justify="flex-end">
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
          </Flex>
        </Flex>
      </Header>
      <Layout>
        <Sider
          width={320}
          style={{
            background: token.colorBgContainer,
            borderRight: `1px solid ${token.colorBorderSecondary}`,
            padding: '16px 0',
          }}
        >
          <SessionSidebar
            sessions={visibleSessions}
            selectedSessionId={selectedSession?.id ?? null}
            onSelectSession={handleSessionChange}
            clientIps={clientIpOptions}
            selectedClientIp={selectedClientIp}
            onSelectClientIp={setSelectedClientIp}
          />
        </Sider>
        <Content style={{ padding: 24, background: token.colorBgBase }}>
          <Flex vertical gap={16} style={{ height: '100%' }}>
            <PerformanceChart frames={frames} selectedFrame={selectedFrame} onSelectFrame={handleFrameSelect} />
            <FrameTimeline frames={frames} selectedFrame={selectedFrame} onSelectFrame={handleFrameSelect} />
            <ResourceExplorer frame={selectedFrame} serverBaseUrl={SERVER_URL} />
          </Flex>
        </Content>
      </Layout>
    </Layout>
  );
}

export default function App() {
  const { sessions, connectionState, networkInfo } = useTelemetryStream({ serverBaseUrl: SERVER_URL });
  const [isDarkMode, setIsDarkMode] = usePreferredDarkMode();
  const algorithm = isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('unityProfile:theme', isDarkMode ? 'dark' : 'light');
    document.body.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

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
      <AppShell
        sessions={sessions}
        connectionState={connectionState}
        networkInfo={networkInfo}
        isDarkMode={isDarkMode}
        onToggleDarkMode={setIsDarkMode}
      />
    </ConfigProvider>
  );
}
