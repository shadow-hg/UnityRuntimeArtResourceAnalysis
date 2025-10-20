import { useEffect, useMemo, useState } from 'react';
import { Layout, Typography, Flex } from 'antd';
import { useTelemetryStream } from './hooks/useTelemetryStream';
import type { TelemetrySession, TelemetrySnapshot } from './types';
import SessionSidebar from './components/SessionSidebar';
import TimelinePanel from './components/TimelinePanel';
import ResourceExplorer from './components/ResourceExplorer';
import { formatBytes, formatFps } from './utils/format';

const { Header, Sider, Content } = Layout;

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:48080';

export default function App() {
  const { sessions } = useTelemetryStream({ serverBaseUrl: SERVER_URL });
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedFrame, setSelectedFrame] = useState<TelemetrySnapshot | null>(null);

  const selectedSession = useMemo<TelemetrySession | null>(() => {
    if (!selectedSessionId) return sessions[0] ?? null;
    return sessions.find((s) => s.id === selectedSessionId) ?? null;
  }, [sessions, selectedSessionId]);

  useEffect(() => {
    if (!selectedSession) {
      setSelectedFrame(null);
      return;
    }

    if (!selectedFrame || !selectedSession.frames.includes(selectedFrame)) {
      const lastFrame = selectedSession.frames[selectedSession.frames.length - 1] ?? null;
      setSelectedFrame(lastFrame);
    }
  }, [selectedSession, selectedFrame]);

  const frames = selectedSession?.frames ?? [];

  const handleSessionChange = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    const session = sessions.find((s) => s.id === sessionId);
    setSelectedFrame(session && session.frames.length > 0 ? session.frames[session.frames.length - 1] : null);
  };

  const headerSubtitle = selectedFrame
    ? `${formatFps(selectedFrame.fps)} • ${formatBytes(selectedFrame.totalTextureBytes)} textures • ${formatBytes(
        selectedFrame.totalMeshBytes
      )} meshes`
    : 'Awaiting telemetry frames';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#0b1b2b', padding: '0 24px' }}>
        <Flex align="center" justify="space-between" style={{ height: '100%' }}>
          <div>
            <Typography.Title level={3} style={{ color: '#fff', margin: 0 }}>
              UnityProfileV2 Dashboard
            </Typography.Title>
            <Typography.Text style={{ color: 'rgba(255,255,255,0.65)' }}>{headerSubtitle}</Typography.Text>
          </div>
        </Flex>
      </Header>
      <Layout>
        <Sider width={320} theme="light" style={{ borderRight: '1px solid #e0e6ed' }}>
          <SessionSidebar
            sessions={sessions}
            selectedSessionId={selectedSession?.id ?? null}
            onSelectSession={handleSessionChange}
          />
        </Sider>
        <Content style={{ padding: 24 }}>
          <Flex vertical gap={16} style={{ height: '100%' }}>
            <TimelinePanel frames={frames} onSelectFrame={setSelectedFrame} selectedFrame={selectedFrame} />
            <ResourceExplorer frame={selectedFrame} />
          </Flex>
        </Content>
      </Layout>
    </Layout>
  );
}
