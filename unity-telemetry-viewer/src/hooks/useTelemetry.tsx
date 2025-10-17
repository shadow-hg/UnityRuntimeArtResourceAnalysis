import { useEffect, useMemo, useRef, useState } from 'react';
import { TelemetryWS } from '../services/websocket';

export type Frame = {
  clientId: string;
  frame: any;
};

export type ResourceEntry = any;

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

type ResourceCatalog = Record<string, Record<string, ResourceEntry>>;

const MAX_FRAMES = 2000;

function makeFrameKey(clientId: string, frame: any) {
  const index = frame?.frameIndex ?? 'n/a';
  const timestamp = frame?.timestamp ?? 'ts';
  return `${clientId}:${index}:${timestamp}`;
}

export function useTelemetry(wsUrl?: string | null) {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [catalogMap, setCatalogMap] = useState<ResourceCatalog>({});
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const wsRef = useRef<TelemetryWS | null>(null);
  const frameKeySetRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // reset when URL changes
    setFrames([]);
    setCatalogMap({});
    frameKeySetRef.current = new Set();

    if (!wsUrl) {
      setConnectionState('idle');
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    const ws = new TelemetryWS(wsUrl);
    wsRef.current = ws;
    setConnectionState('connecting');

    const ingestFrame = (clientId: string, frame: any) => {
      if (!clientId || !frame) return;
      const key = makeFrameKey(clientId, frame);
      setFrames((prev) => {
        const existingIndex = prev.findIndex((entry) => makeFrameKey(entry.clientId, entry.frame) === key);
        if (existingIndex >= 0) {
          const next = [...prev];
          next[existingIndex] = { clientId, frame };
          return next;
        }

        if (frameKeySetRef.current.has(key)) {
          return prev;
        }

        const next = [...prev, { clientId, frame }];
        next.sort((a, b) => {
          const ta = Number(a.frame?.timestamp ?? 0);
          const tb = Number(b.frame?.timestamp ?? 0);
          return ta - tb;
        });
        frameKeySetRef.current.add(key);
        if (next.length > MAX_FRAMES) {
          const removed = next.shift();
          if (removed) {
            const removedKey = makeFrameKey(removed.clientId, removed.frame);
            frameKeySetRef.current.delete(removedKey);
          }
        }
        return next;
      });
    };

    const ingestResources = (clientId: string, resources: ResourceEntry[] | undefined) => {
      if (!clientId || !Array.isArray(resources)) return;
      setCatalogMap((prev) => {
        const next = { ...prev };
        const current = { ...(next[clientId] || {}) };
        for (const resource of resources) {
          if (!resource || !resource.id) continue;
          current[resource.id] = resource;
        }
        next[clientId] = current;
        return next;
      });
    };

    ws.onOpen = () => {
      setConnectionState('open');
    };
    ws.onClose = () => {
      setConnectionState('closed');
    };
    ws.onError = () => {
      setConnectionState('error');
    };
    ws.onMessage = (msg) => {
      if (msg.type === 'frame' && msg.clientId && msg.frame) {
        ingestFrame(msg.clientId, msg.frame);
        if (msg.frame?.resourceSnapshot) {
          ingestResources(msg.clientId, msg.frame.resourceSnapshot);
        }
      } else if (msg.type === 'resource_snapshot' && msg.clientId) {
        ingestResources(msg.clientId, msg.resources);
      } else if (msg.type === 'timeline' && msg.clientId && Array.isArray(msg.frames)) {
        for (const frame of msg.frames) {
          ingestFrame(msg.clientId, frame);
        }
      }
    };

    ws.connect();

    const httpBase = wsUrl.replace(/^ws/i, 'http');
    let aborted = false;

    async function bootstrapFromHttp() {
      try {
        const clientsResponse = await fetch(`${httpBase}/api/clients`);
        if (!clientsResponse.ok) return;
        const data = await clientsResponse.json();
        if (aborted) return;
        const clientIds: string[] = Array.isArray(data.timelines)
          ? data.timelines
          : Array.isArray(data.clients)
            ? data.clients.map((c: any) => c.id).filter(Boolean)
            : [];

        await Promise.all(clientIds.map(async (clientId: string) => {
          try {
            const [timelineResp, catalogResp] = await Promise.all([
              fetch(`${httpBase}/api/timeline/${clientId}`),
              fetch(`${httpBase}/api/catalog/${clientId}`)
            ]);
            if (aborted) return;
            if (timelineResp.ok) {
              const timelineData = await timelineResp.json();
              if (Array.isArray(timelineData.frames)) {
                timelineData.frames.forEach((frame: any) => ingestFrame(clientId, frame));
              }
            }
            if (catalogResp.ok) {
              const catalogData = await catalogResp.json();
              const resources = catalogData.catalog ? Object.values(catalogData.catalog) : [];
              ingestResources(clientId, resources as ResourceEntry[]);
            }
          } catch (error) {
            console.warn('Bootstrap fetch failed for client', clientId, error);
          }
        }));
      } catch (error) {
        console.warn('Bootstrap fetch failed', error);
      }
    }

    bootstrapFromHttp();

    return () => {
      aborted = true;
      ws.close();
      wsRef.current = null;
    };
  }, [wsUrl]);

  const catalog = useMemo(() => {
    const result: Record<string, ResourceEntry[]> = {};
    for (const [clientId, resources] of Object.entries(catalogMap)) {
      const array = Object.values(resources).sort((a, b) => {
        const sizeA = Number(a?.sizeKB ?? a?.size ?? 0);
        const sizeB = Number(b?.sizeKB ?? b?.size ?? 0);
        return sizeB - sizeA;
      });
      result[clientId] = array;
    }
    return result;
  }, [catalogMap]);

  return { frames, catalog, connectionState };
}
