import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  NetworkInfoResponse,
  TelemetrySession,
  TelemetrySnapshot,
  ServerConfig,
  TextureInfo,
  SessionGrouping,
} from '../types';
import { resolveSessionGroupingValue, SESSION_GROUPINGS } from '../utils/sessionGrouping';
import { buildSessionSearchTokens } from '../utils/sessionSearch';
import {
  createPerformanceSeriesStore,
  rebuildSeriesStore,
  trimSeries,
  updateSeriesWithFrame,
  type PerformanceSeriesSnapshot,
  type PerformanceSeriesStore,
} from '../utils/performanceSeries';

interface UseTelemetryStreamOptions {
  serverBaseUrl: string;
}

const DEFAULT_SERVER_CONFIG: ServerConfig = {
  clientDefaults: {
    sampleIntervalSeconds: 0,
    framePreviewScale: 0.2,
    disableFramePreview: false,
    maxAssetsPerCategory: 200,
    resourceHotspotTopCount: 10,
    lifecycleTopCount: 10,
    autoManageSession: true,
    assetCategoryVersion: 1,
    assetCategories: {
      includeTextures: true,
      includeMeshes: true,
      includeRenderTextures: true,
      includeMaterials: true,
      includeShaders: true,
    },
    telemetrySections: {
      includeFrameInsights: true,
      includeSystemStats: true,
      includeAssetIo: true,
      includeEnvironment: true,
    },
  },
  history: {
    maxSessionFrames: 10000,
  },
};

// Limit the number of texture identifiers in a single request to avoid exceeding URL length limits.
const TEXTURE_REQUEST_BATCH_SIZE = 25;

function ensureNumber(
  value: unknown,
  fallback: number,
  { min, max, integer }: { min?: number; max?: number; integer?: boolean } = {}
): number {
  let result: number;
  if (typeof value === 'number' && Number.isFinite(value)) {
    result = value;
  } else if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    result = Number.isFinite(parsed) ? parsed : fallback;
  } else {
    result = fallback;
  }

  if (integer) {
    result = Math.round(result);
  }
  if (typeof min === 'number') {
    result = Math.max(result, min);
  }
  if (typeof max === 'number') {
    result = Math.min(result, max);
  }
  return result;
}

function ensureBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return fallback;
}

function getTextureId(texture: TextureInfo | null | undefined): string | null {
  if (!texture) {
    return null;
  }
  const id = typeof texture.textureId === 'string' ? texture.textureId.trim() : '';
  if (id.length > 0) {
    return id;
  }
  return null;
}

function isTextureReference(texture: TextureInfo | null | undefined): boolean {
  if (!texture) {
    return false;
  }
  if ((texture as { __textureRef?: boolean }).__textureRef) {
    return true;
  }
  if (!Number.isFinite(texture.EstimatedBytes ?? Number.NaN)) {
    return true;
  }
  return false;
}

function hydrateTextureFromCache(
  texture: TextureInfo,
  cache: Map<string, TextureInfo>
): TextureInfo {
  if (!isTextureReference(texture)) {
    const id = getTextureId(texture);
    if (id && !cache.has(id)) {
      cache.set(id, { ...texture, textureId: texture.textureId ?? id });
    }
    return texture;
  }
  const textureId = getTextureId(texture);
  if (!textureId) {
    return texture;
  }
  const cached = cache.get(textureId);
  if (!cached) {
    return texture;
  }
  const next: TextureInfo = {
    ...cached,
    textureId: cached.textureId ?? textureId,
  };
  if (texture.instanceId != null) {
    next.instanceId = texture.instanceId;
  }
  return next;
}

function hydrateFrameTexturesFromCache(
  frame: TelemetrySnapshot,
  cache: Map<string, TextureInfo>
): TelemetrySnapshot {
  if (!Array.isArray(frame.textures) || frame.textures.length === 0) {
    return frame;
  }
  let changed = false;
  const hydratedTextures = frame.textures.map((texture) => {
    const source = texture ?? ({} as TextureInfo);
    const hydrated = hydrateTextureFromCache(source, cache);
    if (hydrated !== source) {
      changed = true;
    }
    return hydrated;
  });
  if (!changed) {
    return frame;
  }
  return {
    ...frame,
    textures: hydratedTextures,
  };
}

function sanitizeServerConfig(rawConfig: Partial<ServerConfig> | null | undefined): ServerConfig {
  const base: ServerConfig = {
    clientDefaults: {
      ...DEFAULT_SERVER_CONFIG.clientDefaults,
      assetCategories: { ...DEFAULT_SERVER_CONFIG.clientDefaults.assetCategories },
      telemetrySections: { ...DEFAULT_SERVER_CONFIG.clientDefaults.telemetrySections },
    },
    history: { ...DEFAULT_SERVER_CONFIG.history },
  };

  const clientDefaults = rawConfig?.clientDefaults;
  if (clientDefaults && typeof clientDefaults === 'object') {
    base.clientDefaults.sampleIntervalSeconds = ensureNumber(clientDefaults.sampleIntervalSeconds, base.clientDefaults.sampleIntervalSeconds, {
      min: 0,
    });
    base.clientDefaults.framePreviewScale = ensureNumber(clientDefaults.framePreviewScale, base.clientDefaults.framePreviewScale, {
      min: 0,
      max: 1,
    });
    base.clientDefaults.disableFramePreview = ensureBoolean(
      clientDefaults.disableFramePreview,
      base.clientDefaults.disableFramePreview
    );
    base.clientDefaults.maxAssetsPerCategory = ensureNumber(
      clientDefaults.maxAssetsPerCategory,
      base.clientDefaults.maxAssetsPerCategory,
      { min: 1, integer: true }
    );
    base.clientDefaults.resourceHotspotTopCount = ensureNumber(
      clientDefaults.resourceHotspotTopCount,
      base.clientDefaults.resourceHotspotTopCount,
      { min: 1, max: 50, integer: true }
    );
    base.clientDefaults.lifecycleTopCount = ensureNumber(
      clientDefaults.lifecycleTopCount,
      base.clientDefaults.lifecycleTopCount,
      { min: 1, max: 50, integer: true }
    );
    base.clientDefaults.autoManageSession = ensureBoolean(
      clientDefaults.autoManageSession,
      base.clientDefaults.autoManageSession
    );
    base.clientDefaults.assetCategoryVersion = ensureNumber(
      clientDefaults.assetCategoryVersion,
      base.clientDefaults.assetCategoryVersion,
      { min: 0, integer: true }
    );

    const assetCategories = clientDefaults.assetCategories;
    if (assetCategories && typeof assetCategories === 'object') {
      base.clientDefaults.assetCategories = {
        includeTextures: ensureBoolean(
          assetCategories.includeTextures,
          base.clientDefaults.assetCategories.includeTextures
        ),
        includeMeshes: ensureBoolean(
          assetCategories.includeMeshes,
          base.clientDefaults.assetCategories.includeMeshes
        ),
        includeRenderTextures: ensureBoolean(
          assetCategories.includeRenderTextures,
          base.clientDefaults.assetCategories.includeRenderTextures
        ),
        includeMaterials: ensureBoolean(
          assetCategories.includeMaterials,
          base.clientDefaults.assetCategories.includeMaterials
        ),
        includeShaders: ensureBoolean(
          assetCategories.includeShaders,
          base.clientDefaults.assetCategories.includeShaders
        ),
      };
    }

    const telemetrySections = clientDefaults.telemetrySections;
    if (telemetrySections && typeof telemetrySections === 'object') {
      base.clientDefaults.telemetrySections = {
        includeFrameInsights: ensureBoolean(
          telemetrySections.includeFrameInsights,
          base.clientDefaults.telemetrySections.includeFrameInsights
        ),
        includeSystemStats: ensureBoolean(
          telemetrySections.includeSystemStats,
          base.clientDefaults.telemetrySections.includeSystemStats
        ),
        includeAssetIo: ensureBoolean(
          telemetrySections.includeAssetIo,
          base.clientDefaults.telemetrySections.includeAssetIo
        ),
        includeEnvironment: ensureBoolean(
          telemetrySections.includeEnvironment,
          base.clientDefaults.telemetrySections.includeEnvironment
        ),
      };
    }
  }

  const history = rawConfig?.history;
  if (history && typeof history === 'object') {
    base.history.maxSessionFrames = ensureNumber(history.maxSessionFrames, base.history.maxSessionFrames, {
      min: 100,
      integer: true,
    });
  }

  return base;
}

function resolveFrameLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_SERVER_CONFIG.history.maxSessionFrames;
  }
  return Math.max(100, Math.round(limit));
}

function attachSessionComputedFields(session: TelemetrySession): TelemetrySession {
  const searchTokens = buildSessionSearchTokens(session);
  const groupKeys = SESSION_GROUPINGS.reduce((acc, grouping) => {
    acc[grouping] = resolveSessionGroupingValue(session, grouping);
    return acc;
  }, {} as Record<SessionGrouping, string>);

  Object.defineProperty(session, 'searchTokens', {
    value: searchTokens,
    enumerable: false,
    configurable: true,
    writable: true,
  });

  Object.defineProperty(session, 'groupKeys', {
    value: groupKeys,
    enumerable: false,
    configurable: true,
    writable: true,
  });

  return session;
}

function mergeSessionWithUpdates(
  session: TelemetrySession,
  updates: Partial<TelemetrySession>
): TelemetrySession {
  return attachSessionComputedFields({
    ...session,
    ...updates,
  });
}

function hasSessionTimelineChanged(
  previous: TelemetrySession,
  next: TelemetrySession
): boolean {
  const prevFrames = Array.isArray(previous.frames) ? previous.frames : [];
  const nextFrames = Array.isArray(next.frames) ? next.frames : [];
  if (prevFrames.length !== nextFrames.length) {
    return true;
  }
  for (let index = 0; index < prevFrames.length; index += 1) {
    if (prevFrames[index] !== nextFrames[index]) {
      return true;
    }
  }
  const prevTrimmed = previous.trimmedFrameCount ?? 0;
  const nextTrimmed = next.trimmedFrameCount ?? 0;
  if (prevTrimmed !== nextTrimmed) {
    return true;
  }
  const prevTotal = previous.totalFrameCount ?? prevTrimmed + prevFrames.length;
  const nextTotal = next.totalFrameCount ?? nextTrimmed + nextFrames.length;
  return prevTotal !== nextTotal;
}

function normalizeSession(session: TelemetrySession, maxSessionFrames: number): TelemetrySession {
  const limit = resolveFrameLimit(maxSessionFrames);
  const frames = Array.isArray(session.frames) ? session.frames.filter((frame): frame is TelemetrySnapshot => !!frame) : [];
  const trimmedFrameCount = session.trimmedFrameCount ?? 0;
  const totalFrameCount = session.totalFrameCount ?? trimmedFrameCount + frames.length;

  if (frames.length <= limit) {
    return attachSessionComputedFields({
      ...session,
      frames,
      trimmedFrameCount,
      totalFrameCount: Math.max(totalFrameCount, trimmedFrameCount + frames.length),
    });
  }

  const overflow = frames.length - limit;
  const trimmedFrames = frames.slice(overflow);
  const nextTrimmed = trimmedFrameCount + overflow;
  const nextTotal = Math.max(totalFrameCount, nextTrimmed + trimmedFrames.length);

  return attachSessionComputedFields({
    ...session,
    frames: trimmedFrames,
    trimmedFrameCount: nextTrimmed,
    totalFrameCount: nextTotal,
  });
}

export function useTelemetryStream({ serverBaseUrl }: UseTelemetryStreamOptions) {
  const [sessionsMap, setSessionsMap] = useState<Map<string, TelemetrySession>>(
    () => new Map()
  );
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>(
    () => (serverBaseUrl ? 'connecting' : 'disconnected')
  );
  const [networkInfo, setNetworkInfo] = useState<NetworkInfoResponse | null>(null);
  const [serverConfig, setServerConfig] = useState<ServerConfig>(DEFAULT_SERVER_CONFIG);
  const [isConfigLoading, setIsConfigLoading] = useState(false);
  const [isSessionsLoading, setIsSessionsLoading] = useState(false);

  const performanceSeriesStoreRef = useRef<Map<string, PerformanceSeriesStore>>(new Map());
  const performanceSeriesSnapshotRef = useRef<Map<string, PerformanceSeriesSnapshot>>(new Map());
  const [performanceSeriesVersion, setPerformanceSeriesVersion] = useState(0);

  const sessions = useMemo(() => Array.from(sessionsMap.values()), [sessionsMap]);

  const notifyPerformanceSeriesUpdate = useCallback(() => {
    setPerformanceSeriesVersion((prev) => prev + 1);
  }, []);

  const setPerformanceSeriesForSession = useCallback(
    (sessionId: string, frames: TelemetrySnapshot[]) => {
      if (!sessionId) {
        return;
      }
      const store = rebuildSeriesStore(frames);
      performanceSeriesStoreRef.current.set(sessionId, store);
      performanceSeriesSnapshotRef.current.set(sessionId, store.snapshot);
      notifyPerformanceSeriesUpdate();
    },
    [notifyPerformanceSeriesUpdate]
  );

  const updatePerformanceSeriesForFrame = useCallback(
    (sessionId: string, frame: TelemetrySnapshot, trimmedCount: number) => {
      if (!sessionId) {
        return;
      }
      let store = performanceSeriesStoreRef.current.get(sessionId);
      if (!store) {
        store = createPerformanceSeriesStore();
        performanceSeriesStoreRef.current.set(sessionId, store);
        performanceSeriesSnapshotRef.current.set(sessionId, store.snapshot);
      }
      const { mutable } = store;
      if (trimmedCount > 0) {
        trimSeries(mutable, trimmedCount);
      }
      updateSeriesWithFrame(mutable, frame);
      notifyPerformanceSeriesUpdate();
    },
    [notifyPerformanceSeriesUpdate]
  );

  const clearPerformanceSeries = useCallback(() => {
    if (
      performanceSeriesStoreRef.current.size === 0 &&
      performanceSeriesSnapshotRef.current.size === 0
    ) {
      return;
    }
    performanceSeriesStoreRef.current.clear();
    performanceSeriesSnapshotRef.current.clear();
    notifyPerformanceSeriesUpdate();
  }, [notifyPerformanceSeriesUpdate]);

  const deletePerformanceSeries = useCallback(
    (sessionId: string) => {
      if (!sessionId) {
        return;
      }
      const deletedStore = performanceSeriesStoreRef.current.delete(sessionId);
      const deletedSnapshot = performanceSeriesSnapshotRef.current.delete(sessionId);
      if (deletedStore || deletedSnapshot) {
        notifyPerformanceSeriesUpdate();
      }
    },
    [notifyPerformanceSeriesUpdate]
  );

  const maxSessionFrames = resolveFrameLimit(serverConfig?.history?.maxSessionFrames);
  const loadedSessionIdsRef = useRef<Set<string>>(new Set());
  const pendingSessionRequestsRef = useRef<Map<string, AbortController>>(new Map());
  const sessionTextureCacheRef = useRef<Map<string, Map<string, TextureInfo>>>(new Map());
  const cachedConfigRef = useRef<ServerConfig | null>(null);
  const hasLoadedConfigRef = useRef(false);

  const abortSessionRequest = useCallback((sessionId?: string) => {
    if (typeof sessionId === 'string') {
      const controller = pendingSessionRequestsRef.current.get(sessionId);
      if (controller) {
        controller.abort();
        pendingSessionRequestsRef.current.delete(sessionId);
      }
      return;
    }
    pendingSessionRequestsRef.current.forEach((controller) => controller.abort());
    pendingSessionRequestsRef.current.clear();
  }, []);

  const getSessionTextureCache = useCallback(
    (sessionId: string): Map<string, TextureInfo> => {
      let cache = sessionTextureCacheRef.current.get(sessionId);
      if (!cache) {
        cache = new Map<string, TextureInfo>();
        sessionTextureCacheRef.current.set(sessionId, cache);
      }
      return cache;
    },
    []
  );

  useEffect(() => {
    if (!serverBaseUrl) {
      abortSessionRequest();
      setSessionsMap(() => new Map());
      setNetworkInfo(null);
      setConnectionState('disconnected');
      setIsSessionsLoading(false);
      sessionTextureCacheRef.current.clear();
      clearPerformanceSeries();
      cachedConfigRef.current = sanitizeServerConfig(DEFAULT_SERVER_CONFIG);
      hasLoadedConfigRef.current = false;
    } else {
      cachedConfigRef.current = null;
      hasLoadedConfigRef.current = false;
    }
  }, [serverBaseUrl, clearPerformanceSeries, abortSessionRequest]);

  const socket = useMemo<Socket | null>(() => {
    if (!serverBaseUrl) return null;
    return io(serverBaseUrl, {
      transports: ['websocket'],
      autoConnect: true,
    });
  }, [serverBaseUrl]);

  const applyServerConfig = useCallback(
    (config: ServerConfig | null) => {
      if (!config) {
        return;
      }
      setServerConfig(config);
      const limit = resolveFrameLimit(config?.history?.maxSessionFrames);
      setSessionsMap((prev) => {
        if (prev.size === 0) {
          return prev;
        }
        let changed = false;
        const next = new Map<string, TelemetrySession>();
        prev.forEach((session, id) => {
          const normalized = normalizeSession(session, limit);
          if (hasSessionTimelineChanged(session, normalized)) {
            next.set(id, normalized);
            changed = true;
            setPerformanceSeriesForSession(id, normalized.frames ?? []);
          } else {
            next.set(id, session);
            setPerformanceSeriesForSession(id, session.frames ?? []);
          }
        });
        return changed ? next : prev;
      });
    },
    [setPerformanceSeriesForSession]
  );

  const fetchServerConfig = useCallback(async (): Promise<ServerConfig | null> => {
    if (!serverBaseUrl) {
      const sanitized = sanitizeServerConfig(DEFAULT_SERVER_CONFIG);
      cachedConfigRef.current = sanitized;
      hasLoadedConfigRef.current = true;
      return sanitized;
    }

    const shouldToggleLoading = !hasLoadedConfigRef.current;
    if (shouldToggleLoading) {
      setIsConfigLoading(true);
    }
    try {
      const response = await fetch(`${serverBaseUrl}/config`);
      if (!response.ok) {
        throw new Error(`Failed to fetch server config: ${response.statusText}`);
      }
      const payload = (await response.json()) as Partial<ServerConfig>;
      const sanitized = sanitizeServerConfig(payload);
      cachedConfigRef.current = sanitized;
      hasLoadedConfigRef.current = true;
      return sanitized;
    } catch (error) {
      console.error(error);
      if (cachedConfigRef.current) {
        return cachedConfigRef.current;
      }
      return null;
    } finally {
      if (shouldToggleLoading) {
        setIsConfigLoading(false);
      }
    }
  }, [serverBaseUrl]);

  const refreshServerConfig = useCallback(async () => {
    const config = await fetchServerConfig();
    if (config) {
      applyServerConfig(config);
    }
    return config;
  }, [fetchServerConfig, applyServerConfig]);

  const loadSessionDetails = useCallback(
    async (sessionId: string, options: { force?: boolean } = {}) => {
      if (!serverBaseUrl || !sessionId) {
        return null;
      }

      const shouldForce = Boolean(options.force);
      if (!shouldForce && loadedSessionIdsRef.current.has(sessionId)) {
        return null;
      }

      abortSessionRequest(sessionId);
      const controller = new AbortController();
      pendingSessionRequestsRef.current.set(sessionId, controller);

      try {
        const response = await fetch(
          `${serverBaseUrl}/sessions/${encodeURIComponent(sessionId)}?hydrateTextures=false`,
          { signal: controller.signal }
        );
        if (response.status === 404) {
          loadedSessionIdsRef.current.delete(sessionId);
          return null;
        }
        if (!response.ok) {
          throw new Error(`Failed to fetch session ${sessionId}: ${response.statusText}`);
        }
        const payload = (await response.json()) as TelemetrySession;
        if (controller.signal.aborted) {
          return null;
        }
        const normalized = normalizeSession(payload, maxSessionFrames);
        const cache = getSessionTextureCache(sessionId);
        const frames = Array.isArray(normalized.frames) ? normalized.frames : [];
        const hydratedFrames = frames.map((frame) => hydrateFrameTexturesFromCache(frame, cache));
        const shouldReplaceFrames = hydratedFrames.some((frame, index) => frame !== frames[index]);
        const nextSession = shouldReplaceFrames
          ? attachSessionComputedFields({ ...normalized, frames: hydratedFrames })
          : normalized;
        let storedSession: TelemetrySession | null = nextSession;
        let didUpdate = false;
        setSessionsMap((prev) => {
          const current = prev.get(nextSession.id);
          if (!current) {
            const next = new Map(prev);
            next.set(nextSession.id, nextSession);
            storedSession = nextSession;
            didUpdate = true;
            return next;
          }
          const merged = mergeSessionWithUpdates(current, nextSession);
          const shouldUpdate =
            hasSessionTimelineChanged(current, merged) ||
            current.closedAt !== merged.closedAt ||
            current.client !== merged.client ||
            current.clientIp !== merged.clientIp;
          if (!shouldUpdate) {
            storedSession = current;
            return prev;
          }
          const next = new Map(prev);
          next.set(nextSession.id, merged);
          storedSession = merged;
          didUpdate = true;
          return next;
        });
        if (controller.signal.aborted) {
          return null;
        }
        if (storedSession) {
          loadedSessionIdsRef.current.add(sessionId);
          if (didUpdate) {
            setPerformanceSeriesForSession(sessionId, storedSession.frames ?? []);
          }
        }
        return storedSession;
      } catch (error) {
        if ((error as Error)?.name !== 'AbortError') {
          console.error(error);
        }
        return null;
      } finally {
        const current = pendingSessionRequestsRef.current.get(sessionId);
        if (current === controller) {
          pendingSessionRequestsRef.current.delete(sessionId);
        }
      }
    },
    [
      serverBaseUrl,
      maxSessionFrames,
      getSessionTextureCache,
      setPerformanceSeriesForSession,
      abortSessionRequest,
    ]
  );

  useEffect(() => {
    refreshServerConfig();
  }, [refreshServerConfig]);

  useEffect(() => {
    if (!serverBaseUrl) return;
    setConnectionState('connecting');

    let cancelled = false;

    async function bootstrapSessions() {
      if (!cancelled) {
        abortSessionRequest();
      }
      if (!cancelled) {
        setSessionsMap(() => new Map());
        setIsSessionsLoading(true);
        clearPerformanceSeries();
      }
      loadedSessionIdsRef.current.clear();
      try {
        const response = await fetch(`${serverBaseUrl}/sessions`);
        if (!response.ok) {
          throw new Error(`Failed to fetch sessions: ${response.statusText}`);
        }
        const initialSessions: TelemetrySession[] = await response.json();
        const normalizedSessions = initialSessions.map((session) => normalizeSession(session, maxSessionFrames));
        if (!cancelled) {
          setSessionsMap(() => {
            const next = new Map<string, TelemetrySession>();
            normalizedSessions.forEach((session) => {
              next.set(session.id, session);
            });
            return next;
          });
          normalizedSessions.forEach((session) => {
            setPerformanceSeriesForSession(session.id, session.frames ?? []);
          });
        }
        if (initialSessions.length > 0) {
          const newest = initialSessions[initialSessions.length - 1];
          loadSessionDetails(newest.id).catch((error) => console.error(error));
        }
        if (!cancelled) {
          setConnectionState((state) => (state === 'connecting' ? 'connected' : state));
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setConnectionState('error');
        }
      } finally {
        if (!cancelled) {
          setIsSessionsLoading(false);
        }
      }
    }

    bootstrapSessions();

    return () => {
      cancelled = true;
    };
  }, [
    serverBaseUrl,
    maxSessionFrames,
    loadSessionDetails,
    clearPerformanceSeries,
    setPerformanceSeriesForSession,
    abortSessionRequest,
  ]);

  useEffect(() => {
    if (!serverBaseUrl) return;

    async function fetchNetworkInfo() {
      try {
        const response = await fetch(`${serverBaseUrl}/network-info`);
        if (!response.ok) {
          throw new Error(`Failed to fetch network info: ${response.statusText}`);
        }
        const payload: NetworkInfoResponse = await response.json();
        setNetworkInfo(payload);
      } catch (error) {
        console.error(error);
        setNetworkInfo(null);
      }
    }

    fetchNetworkInfo();
  }, [serverBaseUrl]);

  useEffect(() => {
    if (!socket) {
      setConnectionState('disconnected');
      return;
    }

    if (!socket.connected) {
      socket.connect();
    }

    const handleConnect = () => setConnectionState('connected');
    const handleDisconnect = () => setConnectionState('disconnected');
    const handleError = () => setConnectionState('error');

    function handleSessionCreate(session: TelemetrySession) {
      const normalized = normalizeSession(session, maxSessionFrames);
      let shouldUpdateSeries = true;
      setSessionsMap((prev) => {
        const existing = prev.get(normalized.id);
        if (existing) {
          const unchanged =
            !hasSessionTimelineChanged(existing, normalized) &&
            existing.closedAt === normalized.closedAt &&
            existing.client === normalized.client &&
            existing.clientIp === normalized.clientIp;
          if (unchanged) {
            shouldUpdateSeries = false;
            return prev;
          }
        }
        const next = new Map(prev);
        next.set(normalized.id, normalized);
        return next;
      });
      if (shouldUpdateSeries) {
        setPerformanceSeriesForSession(normalized.id, normalized.frames ?? []);
      }
    }

    function handleSessionClose(payload: { sessionId: string }) {
      setSessionsMap((prev) => {
        const current = prev.get(payload.sessionId);
        if (!current || current.closedAt) {
          return prev;
        }
        const next = new Map(prev);
        next.set(
          payload.sessionId,
          mergeSessionWithUpdates(current, { closedAt: new Date().toISOString() })
        );
        return next;
      });
    }

    function handleSessionFrame(payload: {
      sessionId: string;
      frame: TelemetrySnapshot;
      trimmedFrameCount?: number;
      totalFrameCount?: number;
      removedFrameCount?: number;
    }) {
      const limit = resolveFrameLimit(maxSessionFrames);
      let processedFrame: TelemetrySnapshot | null = null;
      let trimmedForSeries = 0;
      let matched = false;
      setSessionsMap((prev) => {
        const session = prev.get(payload.sessionId);
        if (!session) {
          return prev;
        }
        matched = true;

        const cache = getSessionTextureCache(payload.sessionId);
        const incomingFrame = hydrateFrameTexturesFromCache(payload.frame, cache);
        processedFrame = incomingFrame;
        const previousTrimmed = session.trimmedFrameCount ?? 0;
        const previousFrames = session.frames ?? [];
        const previousLength = previousFrames.length;
        let removed = payload.removedFrameCount;
        let nextTrimmed = payload.trimmedFrameCount ?? previousTrimmed;

        if (removed === undefined) {
          removed = Math.max(0, nextTrimmed - previousTrimmed);
        }

        removed = Math.max(0, removed ?? 0);

        if (payload.trimmedFrameCount === undefined) {
          nextTrimmed = previousTrimmed + removed;
        }

        const maxStored = Math.max(0, limit - 1);
        const startIndex = Math.min(
          previousLength,
          Math.max(previousLength - maxStored, removed)
        );
        const copyCount = Math.max(0, previousLength - startIndex);
        const frames = new Array<TelemetrySnapshot>(copyCount + 1);
        for (let index = 0; index < copyCount; index += 1) {
          frames[index] = previousFrames[startIndex + index];
        }
        frames[copyCount] = incomingFrame;

        const extraTrimmed = Math.max(0, startIndex - removed);
        nextTrimmed += extraTrimmed;

        const totalFrameCount =
          payload.totalFrameCount ??
          Math.max(nextTrimmed + frames.length, (session.totalFrameCount ?? 0) + 1);

        trimmedForSeries = Math.max(0, previousFrames.length + 1 - frames.length);

        const nextSession = mergeSessionWithUpdates(session, {
          frames,
          trimmedFrameCount: nextTrimmed,
          totalFrameCount,
        });

        if (!hasSessionTimelineChanged(session, nextSession)) {
          return prev;
        }

        const next = new Map(prev);
        next.set(payload.sessionId, nextSession);
        return next;
      });
      if (matched && processedFrame) {
        updatePerformanceSeriesForFrame(payload.sessionId, processedFrame, trimmedForSeries);
      }
    }

    function handleConfigUpdate(config: Partial<ServerConfig>) {
      applyServerConfig(sanitizeServerConfig(config));
    }

    function handleHistoryCleared() {
      abortSessionRequest();
      setSessionsMap(() => new Map());
      loadedSessionIdsRef.current.clear();
      sessionTextureCacheRef.current.clear();
      clearPerformanceSeries();
    }

    function handleSessionDeleted(payload: { sessionId?: string } | undefined) {
      const sessionId = payload?.sessionId;
      if (!sessionId) {
        return;
      }
      abortSessionRequest(sessionId);
      setSessionsMap((prev) => {
        if (!prev.has(sessionId)) {
          return prev;
        }
        const next = new Map(prev);
        next.delete(sessionId);
        return next;
      });
      loadedSessionIdsRef.current.delete(sessionId);
      sessionTextureCacheRef.current.delete(sessionId);
      deletePerformanceSeries(sessionId);
    }

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleError);
    socket.on('session:create', handleSessionCreate);
    socket.on('session:close', handleSessionClose);
    socket.on('session:frame', handleSessionFrame);
    socket.on('config:update', handleConfigUpdate);
    socket.on('history:cleared', handleHistoryCleared);
    socket.on('session:deleted', handleSessionDeleted);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleError);
      socket.off('session:create', handleSessionCreate);
      socket.off('session:close', handleSessionClose);
      socket.off('session:frame', handleSessionFrame);
      socket.off('config:update', handleConfigUpdate);
      socket.off('history:cleared', handleHistoryCleared);
      socket.off('session:deleted', handleSessionDeleted);
      socket.disconnect();
    };
  }, [
    socket,
    maxSessionFrames,
    applyServerConfig,
    getSessionTextureCache,
    setPerformanceSeriesForSession,
    updatePerformanceSeriesForFrame,
    clearPerformanceSeries,
    deletePerformanceSeries,
    abortSessionRequest,
  ]);

  const ensureSessionTextures = useCallback(
    async (sessionId: string, textureIds: string[]) => {
      if (!serverBaseUrl || !sessionId || !Array.isArray(textureIds) || textureIds.length === 0) {
        return;
      }

      const cache = getSessionTextureCache(sessionId);
      const normalizedIds = Array.from(
        new Set(
          textureIds
            .map((id) => (typeof id === 'string' ? id.trim() : ''))
            .filter((id) => id.length > 0)
        )
      );

      const missing = normalizedIds.filter((id) => !cache.has(id));

      if (missing.length > 0) {
        for (let index = 0; index < missing.length; index += TEXTURE_REQUEST_BATCH_SIZE) {
          const batch = missing.slice(index, index + TEXTURE_REQUEST_BATCH_SIZE);
          if (batch.length === 0) {
            continue;
          }
          const query = batch.map((id) => encodeURIComponent(id)).join(',');
          const response = await fetch(
            `${serverBaseUrl}/sessions/${encodeURIComponent(sessionId)}/textures?ids=${query}`
          );
          if (!response.ok) {
            throw new Error(`Failed to load textures for session ${sessionId}: ${response.statusText}`);
          }
          const payload = (await response.json()) as { textures?: TextureInfo[] };
          const textures = Array.isArray(payload?.textures) ? payload.textures : [];
          textures.forEach((texture) => {
            const id = getTextureId(texture);
            if (!id) {
              return;
            }
            cache.set(id, { ...texture, textureId: texture.textureId ?? id });
          });
        }
      }

      setSessionsMap((prev) => {
        const session = prev.get(sessionId);
        if (!session) {
          return prev;
        }
        if (!Array.isArray(session.frames) || session.frames.length === 0) {
          return prev;
        }
        const hydratedFrames = session.frames.map((frame) => hydrateFrameTexturesFromCache(frame, cache));
        const changed = hydratedFrames.some((frame, index) => frame !== session.frames?.[index]);
        if (!changed) {
          return prev;
        }
        const next = new Map(prev);
        next.set(
          sessionId,
          mergeSessionWithUpdates(session, {
            frames: hydratedFrames,
          })
        );
        return next;
      });
    },
    [serverBaseUrl, getSessionTextureCache]
  );

  const updateServerConfig = useCallback(
    async (partialConfig: Partial<ServerConfig>) => {
      if (!serverBaseUrl) {
        throw new Error('Server base URL is not configured');
      }

      const response = await fetch(`${serverBaseUrl}/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(partialConfig),
      });

      if (!response.ok) {
        throw new Error(`Failed to update server config: ${response.statusText}`);
      }

      const payload = (await response.json()) as Partial<ServerConfig>;
      const config = sanitizeServerConfig(payload);
      applyServerConfig(config);
      return config;
    },
    [serverBaseUrl, applyServerConfig]
  );

  const clearServerHistory = useCallback(async () => {
    if (!serverBaseUrl) {
      throw new Error('Server base URL is not configured');
    }

    const response = await fetch(`${serverBaseUrl}/sessions`, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(`Failed to clear telemetry history: ${response.statusText}`);
    }

    abortSessionRequest();
    setSessionsMap(() => new Map());
    loadedSessionIdsRef.current.clear();
    sessionTextureCacheRef.current.clear();
    clearPerformanceSeries();
  }, [serverBaseUrl, clearPerformanceSeries, abortSessionRequest]);

  const deleteServerSession = useCallback(
    async (sessionId: string) => {
      if (!serverBaseUrl) {
        throw new Error('Server base URL is not configured');
      }

      const response = await fetch(`${serverBaseUrl}/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      });

      if (response.status === 404) {
        throw new Error('指定的会话不存在');
      }

      if (!response.ok) {
        throw new Error(`Failed to delete telemetry session: ${response.statusText}`);
      }

      abortSessionRequest(sessionId);
      setSessionsMap((prev) => {
        if (!prev.has(sessionId)) {
          return prev;
        }
        const next = new Map(prev);
        next.delete(sessionId);
        return next;
      });
      loadedSessionIdsRef.current.delete(sessionId);
      sessionTextureCacheRef.current.delete(sessionId);
      deletePerformanceSeries(sessionId);
    },
    [serverBaseUrl, deletePerformanceSeries, abortSessionRequest]
  );

  return {
    sessions,
    sessionsMap: sessionsMap as ReadonlyMap<string, TelemetrySession>,
    connectionState,
    networkInfo,
    serverConfig,
    isConfigLoading,
    isSessionsLoading,
    updateServerConfig,
    clearServerHistory,
    deleteServerSession,
    refreshServerConfig,
    loadSessionDetails,
    ensureSessionTextures,
    performanceSeries: performanceSeriesSnapshotRef.current as ReadonlyMap<
      string,
      PerformanceSeriesSnapshot
    >,
    performanceSeriesVersion,
  };
}
