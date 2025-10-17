import React, { useEffect, useMemo, useRef, useState } from 'react';
import './styles/app.css';
import Toolbar from './components/Toolbar';
import ConnectionPanel from './components/ConnectionPanel';
import FrameList from './components/FrameList';
import ResourcePanel from './components/ResourcePanel';
import FrameViewer from './components/FrameViewer';
import Timeline from './components/Timeline';
import PlaybackControls from './components/PlaybackControls';
import FrameDetails from './components/FrameDetails';
import { Frame, useTelemetry } from './hooks/useTelemetry';

function frameKey(entry: Frame | null) {
  if (!entry) return '';
  const { clientId, frame } = entry;
  const idx = frame?.frameIndex ?? 'n/a';
  const timestamp = frame?.timestamp ?? 'ts';
  return `${clientId}:${idx}:${timestamp}`;
}

export default function App() {
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const { frames, catalog, connectionState } = useTelemetry(wsUrl);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedFrame, setSelectedFrame] = useState<Frame | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const playIndexRef = useRef<number>(-1);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [autoFollow, setAutoFollow] = useState(true);

  const clients = useMemo(() => {
    const ids = new Set<string>();
    frames.forEach((f) => ids.add(f.clientId));
    Object.keys(catalog).forEach((id) => ids.add(id));
    return Array.from(ids).sort();
  }, [frames, catalog]);

  useEffect(() => {
    if (clients.length === 0) {
      setSelectedClientId(null);
      return;
    }
    if (!selectedClientId || !clients.includes(selectedClientId)) {
      setSelectedClientId(clients[0]);
      setAutoFollow(true);
    }
  }, [clients, selectedClientId]);

  const visibleFrames = useMemo(() => {
    if (!selectedClientId) return frames;
    return frames.filter((f) => f.clientId === selectedClientId);
  }, [frames, selectedClientId]);

  useEffect(() => {
    if (visibleFrames.length === 0) {
      setSelectedFrame(null);
      setCurrentIndex(-1);
      playIndexRef.current = -1;
      return;
    }
    if (autoFollow || !selectedFrame || !visibleFrames.some((entry) => frameKey(entry) === frameKey(selectedFrame))) {
      const latest = visibleFrames[visibleFrames.length - 1];
      setSelectedFrame(latest);
      setCurrentIndex(visibleFrames.length - 1);
      playIndexRef.current = visibleFrames.length - 1;
    }
  }, [visibleFrames, selectedFrame, autoFollow]);

  useEffect(() => {
    if (!playing) return;
    if (visibleFrames.length === 0) return;

    const interval = window.setInterval(() => {
      if (visibleFrames.length === 0) return;
      playIndexRef.current = (playIndexRef.current + 1) % visibleFrames.length;
      const entry = visibleFrames[playIndexRef.current];
      setSelectedFrame(entry);
    }, Math.max(50, 1000 / (30 * speed)));

    return () => window.clearInterval(interval);
  }, [playing, speed, visibleFrames]);

  useEffect(() => {
    if (!selectedFrame) {
      setCurrentIndex(-1);
      playIndexRef.current = -1;
      return;
    }
    const idx = visibleFrames.findIndex((entry) => frameKey(entry) === frameKey(selectedFrame));
    setCurrentIndex(idx);
    playIndexRef.current = idx;
  }, [selectedFrame, visibleFrames]);

  const resources = selectedClientId ? catalog[selectedClientId] : [];

  const handleSeek = (idx: number) => {
    if (idx < 0 || idx >= visibleFrames.length) return;
    setSelectedFrame(visibleFrames[idx]);
    setPlaying(false);
    setAutoFollow(false);
  };

  const handleStep = (direction: 1 | -1) => {
    if (visibleFrames.length === 0) return;
    const nextIndex = Math.min(visibleFrames.length - 1, Math.max(0, (currentIndex >= 0 ? currentIndex : visibleFrames.length - 1) + direction));
    handleSeek(nextIndex);
  };

  return (
    <div className="app-shell">
      <Toolbar connectionState={connectionState} endpoint={wsUrl} onDisconnect={() => setWsUrl(null)} />
      <div className="app-body">
        <aside className="sidebar sidebar--left">
          <ConnectionPanel
            onConnect={(ip: string, port: string) => {
              setWsUrl(`ws://${ip}:${port}`);
              setAutoFollow(true);
            }}
            onDisconnect={() => {
              setWsUrl(null);
              setAutoFollow(true);
            }}
            connectionState={connectionState}
            activeUrl={wsUrl}
            clients={clients}
            selectedClientId={selectedClientId}
            onSelectClient={(clientId) => {
              setSelectedClientId(clientId);
              setAutoFollow(true);
            }}
          />
          <FrameList
            frames={visibleFrames}
            selectedFrameKey={frameKey(selectedFrame)}
            onSelect={(entry) => {
              setSelectedFrame(entry);
              setPlaying(false);
              setAutoFollow(false);
            }}
          />
        </aside>
        <main className="main-area">
          <section className="main-top">
            <FrameViewer frame={selectedFrame?.frame || null} />
            <div className="main-top__right">
              <PlaybackControls
                playing={playing}
                onPlayPause={() => {
                  setPlaying((prev) => !prev);
                  setAutoFollow(false);
                }}
                speed={speed}
                setSpeed={setSpeed}
                onStepForward={() => handleStep(1)}
                onStepBack={() => handleStep(-1)}
              />
              <Timeline
                telemetryData={visibleFrames.map((entry) => entry.frame)}
                currentIndex={currentIndex}
                onSeek={handleSeek}
              />
            </div>
          </section>
          <section className="main-bottom">
            <FrameDetails frame={selectedFrame?.frame || null} />
          </section>
        </main>
        <aside className="sidebar sidebar--right">
          <ResourcePanel
            resources={resources}
            onSelect={(resource) => {
              const rid = resource?.id;
              if (!rid) return;
              const idx = visibleFrames.findIndex((entry) => Array.isArray(entry.frame?.resources) && entry.frame.resources.includes(rid));
              if (idx >= 0) {
                handleSeek(idx);
              }
            }}
          />
        </aside>
      </div>
    </div>
  );
}