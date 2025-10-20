import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  ConfigProvider,
  Flex,
  Layout,
  Space,
  Switch,
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
import { formatBytes, formatFps } from './utils/format';

const { Header, Sider, Content } = Layout;

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:48080';

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
  const { token } = theme.useToken();

  useEffect(() => {
    if (sortedSessions.length === 0) {
      setSelectedSessionId(null);
      setSelectedFrame(null);
      return;
    }

    if (!selectedSessionId || !sortedSessions.some((session) => session.id === selectedSessionId)) {
      const newest = sortedSessions[0];
      setSelectedSessionId(newest.id);
      setSelectedFrame(newest.frames[newest.frames.length - 1] ?? null);
      setIsAutoFollowLatest(true);
    }
  }, [sortedSessions, selectedSessionId]);

  const selectedSession = useMemo<TelemetrySession | null>(() => {
    if (!selectedSessionId) return sortedSessions[0] ?? null;
    return sortedSessions.find((session) => session.id === selectedSessionId) ?? sortedSessions[0] ?? null;
  }, [sortedSessions, selectedSessionId]);

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
      setSelectedSessionId(sessionId);
      const session = sortedSessions.find((s) => s.id === sessionId);
      const lastFrame = session?.frames?.[session.frames.length - 1] ?? null;
      setSelectedFrame(lastFrame ?? null);
      setIsAutoFollowLatest(true);
    },
    [sortedSessions]
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
            </Space>
          </Flex>
          <Space align="center" size={16}>
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
          </Space>
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
            sessions={sortedSessions}
            selectedSessionId={selectedSession?.id ?? null}
            onSelectSession={handleSessionChange}
          />
        </Sider>
        <Content style={{ padding: 24, background: token.colorBgBase }}>
          <Flex vertical gap={16} style={{ height: '100%' }}>
            <PerformanceChart frames={frames} selectedFrame={selectedFrame} onSelectFrame={handleFrameSelect} />
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
