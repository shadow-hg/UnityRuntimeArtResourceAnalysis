import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './styles/app.css';
import Toolbar from './components/Toolbar';
import FrameViewer from './components/FrameViewer';
import Timeline from './components/Timeline';
import FrameDetails from './components/FrameDetails';
import CaptureControlOverlay from './components/CaptureControlOverlay';
import { ControlState, Frame, useTelemetry } from './hooks/useTelemetry';
import SessionControls from './components/SessionControls';

function frameKey(entry: Frame | null) {
  if (!entry) return '';
  const { clientId, frame } = entry;
  const idx = frame?.frameIndex ?? 'n/a';
  const timestamp = frame?.timestamp ?? 'ts';
  return `${clientId}:${idx}:${timestamp}`;
}

export default function App() {
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [maxFrames, setMaxFrames] = useState(10000);
  const { frames, catalog, catalogIndex, connectionState, controlState, sendMessage } = useTelemetry(wsUrl, { maxFrames });
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedFrame, setSelectedFrame] = useState<Frame | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const playIndexRef = useRef<number>(-1);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const captureToggleRef = useRef<HTMLButtonElement | null>(null);
  const [autoFollow, setAutoFollow] = useState(false);
  const [livePinned, setLivePinned] = useState(false);
  const [displayFrames, setDisplayFrames] = useState<Frame[]>(frames);
  const [displayCatalog, setDisplayCatalog] = useState(catalog);
  const [displayCatalogIndex, setDisplayCatalogIndex] = useState(catalogIndex);
  const [fullscreenPanel, setFullscreenPanel] = useState<'details' | null>(null);
  const [captureControlsExpanded, setCaptureControlsExpanded] = useState(false);
  const selectedControlState = selectedClientId ? controlState[selectedClientId] : undefined;
  const connectionWasOpenRef = useRef(connectionState === 'open');

  useEffect(() => {
    if (!livePinned) {
      setDisplayFrames(frames);
    }
  }, [frames, livePinned]);

  useEffect(() => {
    if (!livePinned) {
      setDisplayCatalog(catalog);
    }
  }, [catalog, livePinned]);

  useEffect(() => {
    if (!livePinned) {
      setDisplayCatalogIndex(catalogIndex);
    }
  }, [catalogIndex, livePinned]);

  const freezeLiveView = useCallback(() => {
    if (livePinned) return;
    setDisplayFrames(frames);
    setDisplayCatalog(catalog);
    setDisplayCatalogIndex(catalogIndex);
    setLivePinned(true);
  }, [livePinned, frames, catalog, catalogIndex]);

  const resumeLiveView = useCallback(() => {
    if (!livePinned) return;
    setLivePinned(false);
  }, [livePinned]);

  useEffect(() => {
    const isOpen = connectionState === 'open';
    if (isOpen && !connectionWasOpenRef.current) {
      setPlaying(true);
      setAutoFollow(true);
      resumeLiveView();
    }
    if (!isOpen && connectionWasOpenRef.current) {
      setPlaying(false);
    }
    connectionWasOpenRef.current = isOpen;
  }, [connectionState, resumeLiveView]);

  const clients = useMemo(() => {
    const ids = new Set<string>();
    displayFrames.forEach((f) => ids.add(f.clientId));
    Object.keys(displayCatalog).forEach((id) => ids.add(id));
    return Array.from(ids).sort();
  }, [displayFrames, displayCatalog]);

  useEffect(() => {
    if (clients.length === 0) {
      setSelectedClientId(null);
      setAutoFollow(false);
      setPlaying(false);
      return;
    }
    if (!selectedClientId || !clients.includes(selectedClientId)) {
      setSelectedClientId(clients[0]);
      setAutoFollow(true);
      setPlaying(true);
    }
  }, [clients, selectedClientId]);

  const visibleFrames = useMemo(() => {
    if (!selectedClientId) return displayFrames;
    return displayFrames.filter((f) => f.clientId === selectedClientId);
  }, [displayFrames, selectedClientId]);

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

  const resourceCatalog = selectedClientId ? displayCatalogIndex[selectedClientId] : undefined;

  const latestFrameTimestamp = useMemo(() => {
    if (visibleFrames.length === 0) return null;
    const latest = visibleFrames[visibleFrames.length - 1]?.frame;
    if (!latest) return null;
    const ts = latest.timestamp;
    if (typeof ts === 'number') return ts;
    if (typeof ts === 'string') {
      const parsed = Date.parse(ts);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  }, [visibleFrames]);

  type ControlPatch = Partial<
    Pick<ControlState, 'captureEnabled' | 'captureIntervalMs' | 'sendThumbnail' | 'sendResourceSnapshots' | 'thumbnailIntervalFrames'>
  >;

  const sendControlPatch = useCallback(
    (patch: ControlPatch) => {
      if (!selectedClientId) return;
      sendMessage({
        type: 'control',
        targetClientId: selectedClientId,
        command: 'configure_capture',
        payload: patch
      });
    },
    [selectedClientId, sendMessage]
  );

  const requestControlState = useCallback(() => {
    if (!selectedClientId) return;
    sendMessage({
      type: 'control',
      targetClientId: selectedClientId,
      command: 'request_state'
    });
  }, [selectedClientId, sendMessage]);

  const handleMaxFramesChange = useCallback(
    (value: number) => {
      if (!Number.isFinite(value)) return;
      const clamped = Math.min(100000, Math.max(100, Math.round(value)));
      setMaxFrames(clamped);
    },
    []
  );

  useEffect(() => {
    if (!selectedClientId) return;
    if (connectionState !== 'open') return;
    requestControlState();
  }, [selectedClientId, connectionState, requestControlState]);

  useEffect(() => {
    if (!captureControlsExpanded) return;
    requestControlState();
  }, [captureControlsExpanded, requestControlState]);

  const handleSeek = (idx: number) => {
    if (idx < 0 || idx >= visibleFrames.length) return;
    setSelectedFrame(visibleFrames[idx]);
    setPlaying(false);
    setAutoFollow(false);
    freezeLiveView();
  };

  const handleStep = (direction: 1 | -1) => {
    if (visibleFrames.length === 0) return;
    const nextIndex = Math.min(visibleFrames.length - 1, Math.max(0, (currentIndex >= 0 ? currentIndex : visibleFrames.length - 1) + direction));
    handleSeek(nextIndex);
  };

  const handleTogglePlay = useCallback(() => {
    setPlaying((prev) => {
      const next = !prev;
      if (next) {
        resumeLiveView();
        setAutoFollow(true);
      } else {
        freezeLiveView();
        setAutoFollow(false);
      }
      return next;
    });
  }, [freezeLiveView, resumeLiveView]);

  return (
    <div className="app-shell">
      <Toolbar
        connectionState={connectionState}
        endpoint={wsUrl}
        onDisconnect={() => {
          setWsUrl(null);
          setPlaying(false);
          setAutoFollow(false);
          setCaptureControlsExpanded(false);
          resumeLiveView();
        }}
      />
      <SessionControls
        className={fullscreenPanel ? 'session-controls--dimmed' : ''}
        connectionState={connectionState}
        activeUrl={wsUrl}
        onConnect={(ip: string, port: string) => {
          setWsUrl(`ws://${ip}:${port}`);
          setPlaying(true);
          setAutoFollow(true);
          setCaptureControlsExpanded(false);
          resumeLiveView();
        }}
        onDisconnect={() => {
          setWsUrl(null);
          setPlaying(false);
          setAutoFollow(false);
          setCaptureControlsExpanded(false);
          resumeLiveView();
        }}
        clients={clients}
        selectedClientId={selectedClientId}
        onSelectClient={(clientId) => {
          setSelectedClientId(clientId);
          setPlaying(true);
          setAutoFollow(true);
          setCaptureControlsExpanded(false);
          resumeLiveView();
        }}
        playing={playing}
        onTogglePlay={handleTogglePlay}
        onStepForward={() => handleStep(1)}
        onStepBack={() => handleStep(-1)}
        speed={speed}
        onSpeedChange={(value) => setSpeed(value)}
        captureControlsExpanded={captureControlsExpanded}
        onToggleCaptureControls={() => setCaptureControlsExpanded((prev) => !prev)}
        captureToggleRef={captureToggleRef}
      />
      <section className={`timeline-section ${fullscreenPanel ? 'timeline-section--dimmed' : ''}`}>
        <Timeline
          telemetryData={visibleFrames.map((entry) => entry.frame)}
          currentIndex={currentIndex}
          playing={playing}
          onSeek={handleSeek}
        />
      </section>
      <div className="app-body">
        <div className="app-body__upper">
          <main className={`main-area ${fullscreenPanel ? 'main-area--dimmed' : ''}`}>
            <FrameDetails
              frame={selectedFrame?.frame || null}
              resourceCatalog={resourceCatalog}
              onRequestFullscreen={() => setFullscreenPanel('details')}
            />
          </main>
        </div>
        <section className={`bottom-panels ${fullscreenPanel ? 'bottom-panels--dimmed' : ''}`}>
          <div className="frame-viewer-container">
            <FrameViewer
              frame={selectedFrame?.frame || null}
              resourceCatalog={resourceCatalog}
              clientId={selectedFrame?.clientId || null}
            />
            <CaptureControlOverlay
              clientId={selectedClientId}
              controlState={selectedControlState}
              onUpdate={sendControlPatch}
              onRequestState={requestControlState}
              maxFrames={maxFrames}
              onMaxFramesChange={handleMaxFramesChange}
              latestFrameTimestamp={latestFrameTimestamp}
              connectionState={connectionState}
              expanded={captureControlsExpanded}
              onExpandChange={setCaptureControlsExpanded}
              anchorRef={captureToggleRef}
            />
          </div>
        </section>
      </div>
      {fullscreenPanel && (
        <div className="fullscreen-overlay">
          <div className="fullscreen-overlay__backdrop" onClick={() => setFullscreenPanel(null)} />
          <div className="fullscreen-overlay__content">
            <button
              type="button"
              className="fullscreen-overlay__close"
              onClick={() => setFullscreenPanel(null)}
            >
              关闭
            </button>
            <div className="fullscreen-overlay__panel">
              {fullscreenPanel === 'details' && (
                <FrameDetails
                  frame={selectedFrame?.frame || null}
                  resourceCatalog={resourceCatalog}
                  isFullscreen
                  onRequestFullscreen={() => setFullscreenPanel(null)}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
