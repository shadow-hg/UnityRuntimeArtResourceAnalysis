import React from 'react';

export default function PlaybackControls({ playing, onPlayPause, speed, setSpeed, onStepForward, onStepBack }: { playing: boolean; onPlayPause: () => void; speed: number; setSpeed: (s:number) => void; onStepForward?: () => void; onStepBack?: () => void }) {
  return (
    <div style={{ padding: 8, display: 'flex', gap: 8, alignItems: 'center' }} className="controls">
      <button className="secondary" onClick={() => onStepBack && onStepBack()} style={{ padding: 10 }}>◀◀</button>
      <button onClick={onPlayPause} style={{ padding: 12 }}>{playing ? '❚❚' : '▶'}</button>
      <button className="secondary" onClick={() => onStepForward && onStepForward()} style={{ padding: 10 }}>▶▶</button>
      <label style={{ marginLeft: 8 }}>Speed:</label>
      <input type="range" min="0.25" max="2" step="0.25" value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} />
      <span>{speed}x</span>
    </div>
  );
}
