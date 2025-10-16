import { useEffect, useRef, useState } from 'react';
import { TelemetryWS } from '../services/websocket';

export type Frame = {
  clientId: string;
  frame: any;
};

export type ResourceEntry = any;

export function useTelemetry(wsUrl: string) {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [catalog, setCatalog] = useState<Record<string, ResourceEntry[]>>({});
  const wsRef = useRef<TelemetryWS | null>(null);

  useEffect(() => {
    if (!wsUrl) return;
    const ws = new TelemetryWS(wsUrl);
    ws.onMessage = (msg) => {
      if (msg.type === 'frame' && msg.clientId && msg.frame) {
        setFrames(prev => [...prev, { clientId: msg.clientId, frame: msg.frame }]);
      } else if (msg.type === 'resource_snapshot' && msg.clientId) {
        setCatalog(prev => ({ ...prev, [msg.clientId]: msg.resources }));
      }
    };
    ws.connect();
    wsRef.current = ws;
    return () => { ws.close(); };
  }, [wsUrl]);

  return { frames, catalog };
}
