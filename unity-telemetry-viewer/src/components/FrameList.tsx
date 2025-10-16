import React from 'react';

type FrameItem = { clientId: string; frame: any };

export default function FrameList({ frames, onSelect }: { frames: FrameItem[]; onSelect?: (f: FrameItem) => void }) {
  return (
    <div style={{ padding: 12 }}>
      <h3>Frames ({frames.length})</h3>
      <div style={{ maxHeight: 300, overflow: 'auto' }}>
        {frames.slice().reverse().map((f, i) => (
          <div
            key={i}
            style={{ padding: 6, borderBottom: '1px solid #eee', cursor: onSelect ? 'pointer' : 'default' }}
            onClick={() => onSelect && onSelect(f)}
          >
            <strong>{f.clientId}</strong> #{f.frame.frameIndex} - {new Date(f.frame.timestamp).toLocaleTimeString()} - {f.frame.sceneName}
          </div>
        ))}
      </div>
    </div>
  );
}