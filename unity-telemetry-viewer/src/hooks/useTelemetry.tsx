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

type FrameBucket = {
  clientId: string;
  frame: any;
  sortValue: number;
};

type FrameStore = {
  order: string[];
  entries: Map<string, FrameBucket>;
};

function createFrameStore(): FrameStore {
  return {
    order: [],
    entries: new Map()
  };
}

function makeFrameKey(clientId: string, frame: any) {
  const index = frame?.frameIndex ?? 'n/a';
  const timestamp = frame?.timestamp ?? 'ts';
  return `${clientId}:${index}:${timestamp}`;
}

function normaliseTimestamp(rawTimestamp: unknown) {
  if (typeof rawTimestamp === 'number') {
    return Number.isFinite(rawTimestamp) ? rawTimestamp : 0;
  }
  if (typeof rawTimestamp === 'string') {
    const parsed = Date.parse(rawTimestamp);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function getFrameSortValue(frame: any) {
  const ts = normaliseTimestamp(frame?.timestamp);
  if (ts !== null) return ts;
  if (typeof frame?.frameIndex === 'number' && Number.isFinite(frame.frameIndex)) {
    return frame.frameIndex;
  }
  if (typeof frame?.dt === 'number' && Number.isFinite(frame.dt)) {
    return Date.now() - frame.dt * 1000;
  }
  return Date.now();
}

function findInsertIndex(store: FrameStore, sortValue: number) {
  const { order, entries } = store;
  let low = 0;
  let high = order.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const midKey = order[mid];
    const midValue = entries.get(midKey)?.sortValue ?? 0;
    if (midValue <= sortValue) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

export function useTelemetry(wsUrl?: string | null) {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [catalogMap, setCatalogMap] = useState<ResourceCatalog>({});
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const wsRef = useRef<TelemetryWS | null>(null);
  const frameStoreRef = useRef<FrameStore>(createFrameStore());
  const flushHandleRef = useRef<number | null>(null);

  useEffect(() => {
    // reset when URL changes
    setFrames([]);
    setCatalogMap({});
    if (flushHandleRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(flushHandleRef.current);
      flushHandleRef.current = null;
    }
    frameStoreRef.current = createFrameStore();

    if (!wsUrl) {
      setConnectionState('idle');
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    const ws = new TelemetryWS(wsUrl, { autoReconnect: true });
    wsRef.current = ws;
    setConnectionState('connecting');

    const scheduleFlush = () => {
      if (typeof window === 'undefined') {
        const nextFrames = frameStoreRef.current.order
          .map((key) => {
            const bucket = frameStoreRef.current.entries.get(key);
            return bucket ? { clientId: bucket.clientId, frame: bucket.frame } : null;
          })
          .filter((entry): entry is Frame => entry !== null);
        setFrames(nextFrames);
        return;
      }

      if (flushHandleRef.current !== null) return;

      flushHandleRef.current = window.requestAnimationFrame(() => {
        flushHandleRef.current = null;
        const nextFrames = frameStoreRef.current.order
          .map((key) => {
            const bucket = frameStoreRef.current.entries.get(key);
            return bucket ? { clientId: bucket.clientId, frame: bucket.frame } : null;
          })
          .filter((entry): entry is Frame => entry !== null);
        setFrames(nextFrames);
      });
    };

    const ingestFrame = (clientId: string, frame: any) => {
      if (!clientId || !frame) return;
      const key = makeFrameKey(clientId, frame);
      const store = frameStoreRef.current;
      const sortValue = getFrameSortValue(frame);
      const existing = store.entries.get(key);

      if (existing) {
        const previousSortValue = existing.sortValue;
        existing.frame = frame;
        existing.sortValue = sortValue;
        if (previousSortValue !== sortValue) {
          const currentIndex = store.order.indexOf(key);
          if (currentIndex >= 0) {
            store.order.splice(currentIndex, 1);
            const insertIndex = findInsertIndex(store, sortValue);
            store.order.splice(insertIndex, 0, key);
          }
        }
      } else {
        store.entries.set(key, { clientId, frame, sortValue });
        const insertIndex = findInsertIndex(store, sortValue);
        store.order.splice(insertIndex, 0, key);

        if (store.order.length > MAX_FRAMES) {
          const removedKey = store.order.shift();
          if (removedKey) {
            store.entries.delete(removedKey);
          }
        }
      }

      scheduleFlush();
    };

    const ingestResources = (clientId: string, resources: ResourceEntry[] | undefined) => {
      if (!clientId || !Array.isArray(resources)) return;
      setCatalogMap((prev) => {
        const next = { ...prev };
        const current = { ...(next[clientId] || {}) };
        for (const resource of resources) {
          if (!resource || !resource.id) continue;
          const existing = current[resource.id] || {};
          current[resource.id] = { ...existing, ...resource };
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

    const httpBase = wsUrl.replace(/^ws/i, wsUrl.startsWith('wss') ? 'https' : 'http');
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

    async function bootstrapFromHttp() {
      try {
        const clientsResponse = await fetch(`${httpBase}/api/clients`, controller ? { signal: controller.signal } : undefined);
        if (!clientsResponse.ok) return;
        const data = await clientsResponse.json();
        const clientIds: string[] = Array.isArray(data.timelines)
          ? data.timelines
          : Array.isArray(data.clients)
            ? data.clients.map((c: any) => c.id).filter(Boolean)
            : [];

        await Promise.all(clientIds.map(async (clientId: string) => {
          try {
            const [timelineResp, catalogResp] = await Promise.all([
              fetch(`${httpBase}/api/timeline/${clientId}`, controller ? { signal: controller.signal } : undefined),
              fetch(`${httpBase}/api/catalog/${clientId}`, controller ? { signal: controller.signal } : undefined)
            ]);
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
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
        console.warn('Bootstrap fetch failed', error);
      }
    }

    bootstrapFromHttp();

    return () => {
      if (controller) controller.abort();
      if (flushHandleRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(flushHandleRef.current);
        flushHandleRef.current = null;
      }
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
