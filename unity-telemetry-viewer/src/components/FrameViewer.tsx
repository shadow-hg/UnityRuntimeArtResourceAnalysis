import React from 'react';

export default function FrameViewer({ frame }: { frame: any | null }) {
  if (!frame) return <div style={{ padding: 12 }}>No frame selected</div>;
  return (
    <div style={{ padding: 12 }}>
      <h3>Frame Viewer</h3>
      {frame.thumbnailUrl ? (
        <img src={frame.thumbnailUrl} style={{ maxWidth: '100%' }} />
      ) : (
        <div style={{ height: 160, background: '#111', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No Image</div>
      )}
      <pre style={{ maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(frame, null, 2)}</pre>
    </div>
  );
}