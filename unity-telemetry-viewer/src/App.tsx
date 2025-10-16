import React, { useState, useEffect, useRef } from 'react';
import './styles/app.css';
import Toolbar from './components/Toolbar';
import ConnectionPanel from './components/ConnectionPanel';
import FrameList from './components/FrameList';
import ResourcePanel from './components/ResourcePanel';
import FrameViewer from './components/FrameViewer';
import Timeline from './components/Timeline';
import { useTelemetry } from './hooks/useTelemetry';
import PlaybackControls from './components/PlaybackControls';

export default function App() {
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const { frames, catalog } = useTelemetry(wsUrl || '');
  const [selectedFrame, setSelectedFrame] = useState<any | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const playIndexRef = useRef<number>(0);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);

  useEffect(() => {
    let timer: any = null;
    if (playing) {
      timer = setInterval(() => {
        if (frames.length === 0) return;
        playIndexRef.current = (playIndexRef.current + 1) % frames.length;
        const f = frames[playIndexRef.current];
        setSelectedFrame(f.frame);
        setCurrentIndex(playIndexRef.current);
      }, 1000 / (30 * speed)); // target 30fps playback scaled by speed
    }
    return () => { if (timer) clearInterval(timer); };
  }, [playing, speed, frames]);

  const firstClient = Object.keys(catalog)[0];
  const resources = firstClient ? catalog[firstClient] : [];

  return (
    <div>
      <Toolbar onConnect={() => {}} onDisconnect={() => {}} isConnected={!!wsUrl} />
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ width: 300 }}>
          <ConnectionPanel onConnect={(ip: string, port: string) => setWsUrl(`ws://${ip}:${port}`)} />
          <FrameList frames={frames} onSelect={(f) => setSelectedFrame(f.frame)} />
        </div>
        <div style={{ flex: 1 }}>
          <PlaybackControls playing={playing} onPlayPause={() => setPlaying(!playing)} speed={speed} setSpeed={setSpeed} />
          <Timeline telemetryData={frames.map((f: any) => f.frame)} currentIndex={currentIndex} onSeek={(idx) => {
            // seek to a frame index (frames array is ordered oldest->newest, our playIndexRef uses that ordering)
            if (idx >= 0 && idx < frames.length) {
              playIndexRef.current = idx;
              setCurrentIndex(idx);
              setSelectedFrame(frames[idx].frame);
              setPlaying(false);
            }
          }} />
          <FrameViewer frame={selectedFrame} />
        </div>
        <div style={{ width: 320 }}>
          <ResourcePanel resources={resources} onSelect={(r) => {
            // try to find first frame that references this resource id
            const rid = r.id;
            const idx = frames.findIndex((f: any) => (f.frame.resources || []).includes(rid));
            if (idx >= 0) {
              playIndexRef.current = idx;
              setCurrentIndex(idx);
              setSelectedFrame(frames[idx].frame);
            }
          }} />
        </div>
      </div>
    </div>
  );
}
// (Remaining implementation is the simple viewer above)