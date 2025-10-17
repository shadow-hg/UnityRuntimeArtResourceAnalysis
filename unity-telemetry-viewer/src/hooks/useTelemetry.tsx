import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TelemetryWS } from '../services/websocket';

export type Frame = {
  clientId: string;
  sessionId: string | null;
  frame: any;
};

export type ResourceEntry = any;

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

type ResourceCatalog = Record<string, Record<string, ResourceEntry>>;

type ResourceIngestMode = 'replace' | 'merge';

const DEFAULT_MAX_FRAMES = 10000;

export type SessionSummary = {
  sessionId: string;
  startedAt: number;
  endedAt?: number | null;
  frameCount: number;
  resourceCount: number;
  origin?: string;
  reason?: string;
};

export type SessionOverview = {
  currentSession: SessionSummary | null;
  history: SessionSummary[];
};

export type ControlState = {
  captureEnabled: boolean;
  captureIntervalMs: number;
  sendThumbnail: boolean;
  sendResourceSnapshots: boolean;
  thumbnailIntervalFrames: number;
  updatedAt: number;
  lastCommand?: string;
};

type UseTelemetryOptions = {
  maxFrames?: number;
};

type FrameBucket = {
  clientId: string;
  sessionId: string | null;
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

function makeFrameKey(clientId: string, sessionId: string | null, frame: any) {
  const index = frame?.frameIndex ?? 'n/a';
  const timestamp = frame?.timestamp ?? 'ts';
  const sessionKey = sessionId ?? 'current';
  return `${clientId}:${sessionKey}:${index}:${timestamp}`;
}

function normaliseAssetUrl(url: unknown, baseUrl: string | null) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^data:/i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!baseUrl) return trimmed;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch (error) {
    console.warn('Failed to resolve asset url', trimmed, error);
    return trimmed;
  }
}

function getResourceSortSize(resource: any): number {
  if (!resource || typeof resource !== 'object') return 0;
  const value =
    resource.sizeAfterCompressionKB ??
    resource.compressedSizeKB ??
    resource.runtimeSizeKB ??
    resource.sizeKB ??
    resource.size;
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normaliseResourceEntry(resource: any, baseUrl: string | null) {
  if (!resource || typeof resource !== 'object') return resource;
  const next = { ...resource };
  const thumbnail = normaliseAssetUrl(resource.thumbnailUrl ?? resource.thumbnail, baseUrl);
  if (thumbnail) {
    next.thumbnailUrl = thumbnail;
    next.thumbnail = thumbnail;
  }
  if (Array.isArray(resource.children)) {
    next.children = resource.children.map((child: any) => normaliseResourceEntry(child, baseUrl));
  }
  return next;
}

function normaliseFramePayload(frame: any, baseUrl: string | null) {
  if (!frame || typeof frame !== 'object') return frame;
  const next = { ...frame };
  const thumbnail = normaliseAssetUrl(frame.thumbnailUrl ?? frame.thumbnail, baseUrl);
  if (thumbnail) {
    next.thumbnailUrl = thumbnail;
    next.thumbnail = thumbnail;
  }

  if (Array.isArray(frame.resourceSnapshot)) {
    next.resourceSnapshot = frame.resourceSnapshot.map((resource: any) => normaliseResourceEntry(resource, baseUrl));
  }

  return next;
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

export function useTelemetry(wsUrl?: string | null, options: UseTelemetryOptions = {}) {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [catalogMap, setCatalogMap] = useState<ResourceCatalog>({});
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [controlStateMap, setControlStateMap] = useState<Record<string, ControlState>>({});
  const [sessionOverviewMap, setSessionOverviewMap] = useState<Record<string, SessionOverview>>({});
  const wsRef = useRef<TelemetryWS | null>(null);
  const frameStoreRef = useRef<FrameStore>(createFrameStore());
  const flushHandleRef = useRef<number | null>(null);
  const assetBaseRef = useRef<string | null>(null);
  const maxFramesRef = useRef<number>(Math.max(1, options.maxFrames ?? DEFAULT_MAX_FRAMES));
  const currentSessionRef = useRef<Record<string, string | null>>({});

  useEffect(() => {
    const nextMax = Math.max(1, options.maxFrames ?? DEFAULT_MAX_FRAMES);
    maxFramesRef.current = nextMax;
    const store = frameStoreRef.current;
    let trimmed = false;
    while (store.order.length > nextMax) {
      const removedKey = store.order.shift();
      if (removedKey) {
        store.entries.delete(removedKey);
        trimmed = true;
      }
    }
    if (trimmed) {
      const nextFrames = store.order
        .map((key) => {
          const bucket = store.entries.get(key);
          return bucket ? { clientId: bucket.clientId, frame: bucket.frame } : null;
        })
        .filter((entry): entry is Frame => entry !== null);
      setFrames(nextFrames);
    }
  }, [options.maxFrames]);

  useEffect(() => {
    // reset when URL changes
    setFrames([]);
    setCatalogMap({});
    setControlStateMap({});
    setSessionOverviewMap({});
    if (flushHandleRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(flushHandleRef.current);
      flushHandleRef.current = null;
    }
    frameStoreRef.current = createFrameStore();
    currentSessionRef.current = {};

    if (!wsUrl) {
      setConnectionState('idle');
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      assetBaseRef.current = null;
      return;
    }

    let isActive = true;

    const ws = new TelemetryWS(wsUrl, { autoReconnect: true });
    wsRef.current = ws;
    setConnectionState('connecting');

    try {
      const httpBase = wsUrl.replace(/^ws/i, wsUrl.startsWith('wss') ? 'https' : 'http');
      assetBaseRef.current = httpBase;
    } catch (error) {
      assetBaseRef.current = null;
    }

    const scheduleFlush = () => {
      if (!isActive) return;
      if (typeof window === 'undefined') {
        const nextFrames = frameStoreRef.current.order
          .map((key) => {
            const bucket = frameStoreRef.current.entries.get(key);
            return bucket
              ? { clientId: bucket.clientId, sessionId: bucket.sessionId ?? null, frame: bucket.frame }
              : null;
          })
          .filter((entry): entry is Frame => entry !== null);
        setFrames(nextFrames);
        return;
      }

      if (flushHandleRef.current !== null) return;

      flushHandleRef.current = window.requestAnimationFrame(() => {
        flushHandleRef.current = null;
        if (!isActive) return;
        const nextFrames = frameStoreRef.current.order
          .map((key) => {
            const bucket = frameStoreRef.current.entries.get(key);
            return bucket
              ? { clientId: bucket.clientId, sessionId: bucket.sessionId ?? null, frame: bucket.frame }
              : null;
          })
          .filter((entry): entry is Frame => entry !== null);
        setFrames(nextFrames);
      });
    };

    const ingestFrame = (clientId: string, frame: any, sessionId?: string | null) => {
      if (!isActive) return;
      if (!clientId || !frame) return;
      const normalisedFrame = normaliseFramePayload(frame, assetBaseRef.current);
      const resolvedSessionId = sessionId ?? normalisedFrame.sessionId ?? currentSessionRef.current[clientId] ?? null;
      if (resolvedSessionId && currentSessionRef.current[clientId] !== resolvedSessionId) {
        currentSessionRef.current[clientId] = resolvedSessionId;
      }
      const key = makeFrameKey(clientId, resolvedSessionId, normalisedFrame);
      const store = frameStoreRef.current;
      const sortValue = getFrameSortValue(normalisedFrame);
      const existing = store.entries.get(key);

      if (existing) {
        const previousSortValue = existing.sortValue;
        existing.frame = normalisedFrame;
        existing.sortValue = sortValue;
        existing.sessionId = resolvedSessionId ?? null;
        if (previousSortValue !== sortValue) {
          const currentIndex = store.order.indexOf(key);
          if (currentIndex >= 0) {
            store.order.splice(currentIndex, 1);
            const insertIndex = findInsertIndex(store, sortValue);
            store.order.splice(insertIndex, 0, key);
          }
        }
      } else {
        store.entries.set(key, { clientId, sessionId: resolvedSessionId ?? null, frame: normalisedFrame, sortValue });
        const insertIndex = findInsertIndex(store, sortValue);
        store.order.splice(insertIndex, 0, key);

        const maxFrames = maxFramesRef.current;
        if (store.order.length > maxFrames) {
          const removedKey = store.order.shift();
          if (removedKey) {
            store.entries.delete(removedKey);
          }
        }
      }

      scheduleFlush();
    };

    const ingestResources = (
      clientId: string,
      resources: ResourceEntry[] | undefined,
      mode: ResourceIngestMode = 'merge'
    ) => {
      if (!isActive) return;
      if (!clientId) return;
      const normalisedResources = Array.isArray(resources)
        ? resources
            .map((resource) => normaliseResourceEntry(resource, assetBaseRef.current))
            .filter((resource): resource is ResourceEntry => Boolean(resource && resource.id))
        : [];
      setCatalogMap((prev) => {
        const next = { ...prev };
        const base = mode === 'replace' ? {} : { ...(next[clientId] || {}) };
        const updated: Record<string, ResourceEntry> = { ...base };
        for (const resource of normalisedResources) {
          const id = resource.id;
          const existing = updated[id] || {};
          updated[id] = { ...existing, ...resource };
        }
        if (mode === 'replace' || normalisedResources.length > 0 || next[clientId]) {
          next[clientId] = updated;
        }
        return next;
      });
    };

    ws.onOpen = () => {
      if (!isActive) return;
      setConnectionState('open');
    };
    ws.onClose = () => {
      if (!isActive) return;
      setConnectionState('closed');
    };
    ws.onError = () => {
      if (!isActive) return;
      setConnectionState('error');
    };
    ws.onMessage = (msg) => {
      if (!isActive) return;
      if (msg.type === 'frame' && msg.clientId && msg.frame) {
        ingestFrame(msg.clientId, msg.frame, msg.sessionId);
        if (msg.frame?.resourceSnapshot) {
          ingestResources(msg.clientId, msg.frame.resourceSnapshot, 'replace');
        }
      } else if (msg.type === 'resource_snapshot' && msg.clientId) {
        const mode: ResourceIngestMode = msg.replace === false ? 'merge' : 'replace';
        ingestResources(msg.clientId, msg.resources, mode);
      } else if (msg.type === 'control_ack' && msg.clientId) {
        const payload = msg.state || {};
        setControlStateMap((prev) => {
          const next = { ...prev };
          const previous = prev[msg.clientId];
          const captureEnabled =
            typeof payload.captureEnabled === 'boolean'
              ? payload.captureEnabled
              : previous?.captureEnabled ?? true;
          const captureIntervalMs =
            typeof payload.captureIntervalMs === 'number'
              ? payload.captureIntervalMs
              : previous?.captureIntervalMs ?? 0;
          const sendThumbnail =
            typeof payload.sendThumbnail === 'boolean'
              ? payload.sendThumbnail
              : previous?.sendThumbnail ?? false;
          const sendResourceSnapshots =
            typeof payload.sendResourceSnapshots === 'boolean'
              ? payload.sendResourceSnapshots
              : previous?.sendResourceSnapshots ?? true;
          const thumbnailIntervalFrames =
            typeof payload.thumbnailIntervalFrames === 'number'
              ? payload.thumbnailIntervalFrames
              : previous?.thumbnailIntervalFrames ?? 30;

          next[msg.clientId] = {
            captureEnabled,
            captureIntervalMs,
            sendThumbnail,
            sendResourceSnapshots,
            thumbnailIntervalFrames,
            updatedAt: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
            lastCommand: typeof msg.command === 'string' ? msg.command : previous?.lastCommand
          };
          return next;
        });
      } else if (msg.type === 'timeline' && msg.clientId && Array.isArray(msg.frames)) {
        for (const frame of msg.frames) {
          ingestFrame(msg.clientId, frame, msg.sessionId);
        }
      } else if (msg.type === 'session_update' && msg.clientId) {
        const overview: SessionOverview = {
          currentSession: msg.currentSession || null,
          history: Array.isArray(msg.history) ? msg.history : []
        };
        const previousSessionId = currentSessionRef.current[msg.clientId] ?? null;
        const nextSessionId = overview.currentSession?.sessionId ?? null;
        currentSessionRef.current[msg.clientId] = nextSessionId;
        setSessionOverviewMap((prev) => ({ ...prev, [msg.clientId]: overview }));
        if (previousSessionId !== nextSessionId) {
          const store = frameStoreRef.current;
          const nextOrder: string[] = [];
          for (const key of store.order) {
            const bucket = store.entries.get(key);
            if (bucket && bucket.clientId === msg.clientId) {
              store.entries.delete(key);
            } else {
              nextOrder.push(key);
            }
          }
          store.order = nextOrder;
          setFrames((prev) => prev.filter((entry) => entry.clientId !== msg.clientId));
          setCatalogMap((prev) => {
            if (!prev[msg.clientId]) return prev;
            const next = { ...prev };
            delete next[msg.clientId];
            return next;
          });
        }
      }
    };

    ws.connect();

    const httpBase = assetBaseRef.current || wsUrl.replace(/^ws/i, wsUrl.startsWith('wss') ? 'https' : 'http');
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

    async function bootstrapFromHttp() {
      try {
        const [clientsResponse, sessionsResponse] = await Promise.all([
          fetch(`${httpBase}/api/clients`, controller ? { signal: controller.signal } : undefined),
          fetch(`${httpBase}/api/sessions`, controller ? { signal: controller.signal } : undefined).catch(() => null)
        ]);
        if (!clientsResponse.ok) return;
        const data = await clientsResponse.json();
        if (!isActive) return;
        const sessionSummaryRaw =
          (data && typeof data === 'object' && data.sessions ? data.sessions : null) ||
          (sessionsResponse && sessionsResponse.ok ? (await sessionsResponse.json()).sessions : null) ||
          {};

        if (!isActive) return;

        if (sessionSummaryRaw && typeof sessionSummaryRaw === 'object') {
          const overview: Record<string, SessionOverview> = {};
          for (const [clientId, value] of Object.entries(sessionSummaryRaw)) {
            if (!clientId) continue;
            const currentSession = value && typeof value === 'object' && 'currentSession' in value ? value.currentSession : null;
            const history = value && typeof value === 'object' && Array.isArray(value.history) ? value.history : [];
            overview[clientId] = {
              currentSession: currentSession || null,
              history
            };
            currentSessionRef.current[clientId] = currentSession?.sessionId ?? null;
          }
          setSessionOverviewMap((prev) => ({ ...prev, ...overview }));
        }

        const clientIdSet = new Set<string>();
        if (Array.isArray(data.timelines)) {
          data.timelines.forEach((id: any) => {
            if (typeof id === 'string') clientIdSet.add(id);
          });
        }
        if (Array.isArray(data.clients)) {
          data.clients.forEach((entry: any) => {
            if (entry && typeof entry.id === 'string') clientIdSet.add(entry.id);
          });
        }
        if (sessionSummaryRaw && typeof sessionSummaryRaw === 'object') {
          Object.keys(sessionSummaryRaw).forEach((id) => {
            if (id) clientIdSet.add(id);
          });
        }
        const clientIds = Array.from(clientIdSet);

        await Promise.all(clientIds.map(async (clientId: string) => {
          try {
            const currentSessionId = currentSessionRef.current[clientId] ?? null;
            const timelineUrl = currentSessionId
              ? `${httpBase}/api/timeline/${clientId}?sessionId=${encodeURIComponent(currentSessionId)}`
              : `${httpBase}/api/timeline/${clientId}`;
            const catalogUrl = currentSessionId
              ? `${httpBase}/api/catalog/${clientId}?sessionId=${encodeURIComponent(currentSessionId)}`
              : `${httpBase}/api/catalog/${clientId}`;
            const [timelineResp, catalogResp] = await Promise.all([
              fetch(timelineUrl, controller ? { signal: controller.signal } : undefined),
              fetch(catalogUrl, controller ? { signal: controller.signal } : undefined)
            ]);
            if (!isActive) return;
            if (timelineResp.ok) {
              const timelineData = await timelineResp.json();
              if (!isActive) return;
              if (Array.isArray(timelineData.frames)) {
                const sessionId = timelineData.sessionId ?? currentSessionRef.current[clientId] ?? null;
                currentSessionRef.current[clientId] = sessionId ?? currentSessionRef.current[clientId] ?? null;
                timelineData.frames.forEach((frame: any) => ingestFrame(clientId, frame, sessionId));
              }
            }
            if (catalogResp.ok) {
              const catalogData = await catalogResp.json();
              if (!isActive) return;
              const resources = catalogData.catalog ? Object.values(catalogData.catalog) : [];
              ingestResources(clientId, resources as ResourceEntry[], 'replace');
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
      isActive = false;
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
        const sizeA = getResourceSortSize(a);
        const sizeB = getResourceSortSize(b);
        return sizeB - sizeA;
      });
      result[clientId] = array;
    }
    return result;
  }, [catalogMap]);

  const sendMessage = useCallback((message: any) => {
    if (!message) return;
    const ws = wsRef.current;
    if (!ws) return;
    try {
      ws.send(message);
    } catch (error) {
      console.warn('telemetry send failed', error);
    }
  }, []);

  const fetchSessionData = useCallback(
    async (clientId: string, sessionId: string) => {
      if (!clientId || !sessionId) {
        return { frames: [] as Frame[], catalog: [] as ResourceEntry[], catalogIndex: {} as Record<string, ResourceEntry> };
      }
      const base = assetBaseRef.current || (wsUrl ? wsUrl.replace(/^ws/i, wsUrl.startsWith('wss') ? 'https' : 'http') : null);
      if (!base) {
        throw new Error('无法确定服务器地址，无法加载历史会话数据');
      }
      if (!assetBaseRef.current) {
        assetBaseRef.current = base;
      }
      const timelineUrl = `${base}/api/timeline/${clientId}?sessionId=${encodeURIComponent(sessionId)}`;
      const catalogUrl = `${base}/api/catalog/${clientId}?sessionId=${encodeURIComponent(sessionId)}`;
      const [timelineResp, catalogResp] = await Promise.all([fetch(timelineUrl), fetch(catalogUrl)]);
      const framesResult: Frame[] = [];
      const catalogIndex: Record<string, ResourceEntry> = {};

      if (timelineResp.ok) {
        try {
          const data = await timelineResp.json();
          if (Array.isArray(data.frames)) {
            for (const frame of data.frames) {
              const normalised = normaliseFramePayload(frame, assetBaseRef.current);
              framesResult.push({ clientId, sessionId, frame: normalised });
            }
          }
        } catch (error) {
          console.warn('解析历史帧数据失败', error);
        }
      }

      if (catalogResp.ok) {
        try {
          const data = await catalogResp.json();
          const resources = data.catalog ? Object.values(data.catalog) : [];
          for (const resource of resources) {
            const normalised = normaliseResourceEntry(resource, assetBaseRef.current);
            if (!normalised || !normalised.id) continue;
            catalogIndex[normalised.id] = normalised;
          }
        } catch (error) {
          console.warn('解析历史资源数据失败', error);
        }
      }

      const catalogArray = Object.values(catalogIndex).sort((a, b) => {
        const sizeA = getResourceSortSize(a);
        const sizeB = getResourceSortSize(b);
        return sizeB - sizeA;
      });

      return { frames: framesResult, catalog: catalogArray, catalogIndex };
    },
    [wsUrl]
  );

  return {
    frames,
    catalog,
    catalogIndex: catalogMap,
    connectionState,
    controlState: controlStateMap,
    sendMessage,
    sessions: sessionOverviewMap,
    fetchSessionData
  };
}
