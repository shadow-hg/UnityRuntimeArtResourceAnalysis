import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  NetworkInfoResponse,
  TelemetrySession,
  TelemetrySnapshot,
  ServerConfig,
  TextureInfo,
} from '../types';

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

function normalizeSession(session: TelemetrySession, maxSessionFrames: number): TelemetrySession {
  const limit = resolveFrameLimit(maxSessionFrames);
  const frames = Array.isArray(session.frames) ? session.frames.filter((frame): frame is TelemetrySnapshot => !!frame) : [];
  const trimmedFrameCount = session.trimmedFrameCount ?? 0;
  const totalFrameCount = session.totalFrameCount ?? trimmedFrameCount + frames.length;

  if (frames.length <= limit) {
    return {
      ...session,
      frames,
      trimmedFrameCount,
      totalFrameCount: Math.max(totalFrameCount, trimmedFrameCount + frames.length),
    };
  }

  const overflow = frames.length - limit;
  const trimmedFrames = frames.slice(overflow);
  const nextTrimmed = trimmedFrameCount + overflow;
  const nextTotal = Math.max(totalFrameCount, nextTrimmed + trimmedFrames.length);

  return {
    ...session,
    frames: trimmedFrames,
    trimmedFrameCount: nextTrimmed,
    totalFrameCount: nextTotal,
  };
}

export function useTelemetryStream({ serverBaseUrl }: UseTelemetryStreamOptions) {
  const [sessions, setSessions] = useState<TelemetrySession[]>([]);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>(
    () => (serverBaseUrl ? 'connecting' : 'disconnected')
  );
  const [networkInfo, setNetworkInfo] = useState<NetworkInfoResponse | null>(null);
  const [serverConfig, setServerConfig] = useState<ServerConfig>(DEFAULT_SERVER_CONFIG);
  const [isConfigLoading, setIsConfigLoading] = useState(false);
  const [isSessionsLoading, setIsSessionsLoading] = useState(false);

  const maxSessionFrames = resolveFrameLimit(serverConfig?.history?.maxSessionFrames);
  const loadedSessionIdsRef = useRef<Set<string>>(new Set());
  const loadSessionAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const sessionTextureCacheRef = useRef<Map<string, Map<string, TextureInfo>>>(new Map());

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
      setSessions([]);
      setNetworkInfo(null);
      setConnectionState('disconnected');
      setIsSessionsLoading(false);
      sessionTextureCacheRef.current.clear();
    }
  }, [serverBaseUrl]);

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
      setSessions((prev) => prev.map((session) => normalizeSession(session, limit)));
    },
    []
  );

  const fetchServerConfig = useCallback(async (): Promise<ServerConfig | null> => {
    if (!serverBaseUrl) {
      return sanitizeServerConfig(DEFAULT_SERVER_CONFIG);
    }

    setIsConfigLoading(true);
    try {
      const response = await fetch(`${serverBaseUrl}/config`);
      if (!response.ok) {
        throw new Error(`Failed to fetch server config: ${response.statusText}`);
      }
      const payload = (await response.json()) as Partial<ServerConfig>;
      return sanitizeServerConfig(payload);
    } catch (error) {
      console.error(error);
      return null;
    } finally {
      setIsConfigLoading(false);
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

      const existingController = loadSessionAbortControllersRef.current.get(sessionId);
      existingController?.abort();

      const controller = new AbortController();
      loadSessionAbortControllersRef.current.set(sessionId, controller);

      try {
        const response = await fetch(
          `${serverBaseUrl}/sessions/${encodeURIComponent(sessionId)}?hydrateTextures=false`,
          { signal: controller.signal }
        );
        if (response.status === 404) {
          loadedSessionIdsRef.current.delete(sessionId);
          if (loadSessionAbortControllersRef.current.get(sessionId) === controller) {
            loadSessionAbortControllersRef.current.delete(sessionId);
          }
          return null;
        }
        if (!response.ok) {
          throw new Error(`Failed to fetch session ${sessionId}: ${response.statusText}`);
        }
        if (controller.signal.aborted) {
          return null;
        }
        const payload = (await response.json()) as TelemetrySession;
        const normalized = normalizeSession(payload, maxSessionFrames);
        const cache = getSessionTextureCache(sessionId);
        const frames = Array.isArray(normalized.frames) ? normalized.frames : [];
        const hydratedFrames = frames.map((frame) => hydrateFrameTexturesFromCache(frame, cache));
        const shouldReplaceFrames = hydratedFrames.some((frame, index) => frame !== frames[index]);
        const nextSession = shouldReplaceFrames
          ? { ...normalized, frames: hydratedFrames }
          : normalized;
        loadedSessionIdsRef.current.add(sessionId);
        setSessions((prev) => {
          const index = prev.findIndex((session) => session.id === nextSession.id);
          if (index === -1) {
            return [...prev, nextSession];
          }

          const current = prev[index];
          const keys = Object.keys(nextSession) as (keyof TelemetrySession)[];
          const hasChanges = keys.some((key) => !Object.is(current[key], nextSession[key]));
          if (!hasChanges) {
            return prev;
          }

          const merged = { ...current, ...nextSession };
          const next = [...prev];
          next[index] = merged;
          return next;
        });
        return nextSession;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return null;
        }
        console.error(error);
        return null;
      } finally {
        const currentController = loadSessionAbortControllersRef.current.get(sessionId);
        if (currentController === controller) {
          loadSessionAbortControllersRef.current.delete(sessionId);
        }
      }
    },
    [serverBaseUrl, maxSessionFrames, getSessionTextureCache]
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
        setSessions([]);
        setIsSessionsLoading(true);
      }
      loadedSessionIdsRef.current.clear();
      try {
        const response = await fetch(`${serverBaseUrl}/sessions`);
        if (!response.ok) {
          throw new Error(`Failed to fetch sessions: ${response.statusText}`);
        }
        const initialSessions: TelemetrySession[] = await response.json();
        if (!cancelled) {
          setSessions(initialSessions.map((session) => normalizeSession(session, maxSessionFrames)));
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
  }, [serverBaseUrl, maxSessionFrames, loadSessionDetails]);

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
      setSessions((prev) => [...prev, normalizeSession(session, maxSessionFrames)]);
    }

    function handleSessionClose(payload: { sessionId: string }) {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === payload.sessionId
            ? { ...session, closedAt: new Date().toISOString() }
            : session
        )
      );
    }

    function handleSessionFrame(payload: {
      sessionId: string;
      frame: TelemetrySnapshot;
      trimmedFrameCount?: number;
      totalFrameCount?: number;
      removedFrameCount?: number;
    }) {
      const limit = resolveFrameLimit(maxSessionFrames);
      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== payload.sessionId) {
            return session;
          }

          const cache = getSessionTextureCache(payload.sessionId);
          const incomingFrame = hydrateFrameTexturesFromCache(payload.frame, cache);
          const previousTrimmed = session.trimmedFrameCount ?? 0;
          let frames = [...(session.frames ?? []), incomingFrame];
          let removed = payload.removedFrameCount;
          let nextTrimmed = payload.trimmedFrameCount ?? previousTrimmed;

          if (removed === undefined) {
            removed = Math.max(0, nextTrimmed - previousTrimmed);
          }

          removed = Math.max(0, removed ?? 0);

          if (removed > 0) {
            frames = frames.slice(removed);
            if (payload.trimmedFrameCount === undefined) {
              nextTrimmed = previousTrimmed + removed;
            }
          }

          if (frames.length > limit) {
            const overflow = frames.length - limit;
            frames = frames.slice(overflow);
            nextTrimmed += overflow;
          }

          const totalFrameCount =
            payload.totalFrameCount ??
            Math.max(nextTrimmed + frames.length, (session.totalFrameCount ?? 0) + 1);

          return {
            ...session,
            frames,
            trimmedFrameCount: nextTrimmed,
            totalFrameCount,
          };
        })
      );
    }

    function handleConfigUpdate(config: Partial<ServerConfig>) {
      applyServerConfig(sanitizeServerConfig(config));
    }

    function handleHistoryCleared() {
      setSessions([]);
      loadedSessionIdsRef.current.clear();
      sessionTextureCacheRef.current.clear();
      loadSessionAbortControllersRef.current.forEach((controller) => controller.abort());
      loadSessionAbortControllersRef.current.clear();
    }

    function handleSessionDeleted(payload: { sessionId?: string } | undefined) {
      const sessionId = payload?.sessionId;
      if (!sessionId) {
        return;
      }
      setSessions((prev) => prev.filter((session) => session.id !== sessionId));
      loadedSessionIdsRef.current.delete(sessionId);
      const controller = loadSessionAbortControllersRef.current.get(sessionId);
      controller?.abort();
      loadSessionAbortControllersRef.current.delete(sessionId);
      sessionTextureCacheRef.current.delete(sessionId);
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
  }, [socket, maxSessionFrames, applyServerConfig]);

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
        const query = missing.map((id) => encodeURIComponent(id)).join(',');
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

      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== sessionId) {
            return session;
          }
          if (!Array.isArray(session.frames) || session.frames.length === 0) {
            return session;
          }
          const hydratedFrames = session.frames.map((frame) => hydrateFrameTexturesFromCache(frame, cache));
          const changed = hydratedFrames.some((frame, index) => frame !== session.frames?.[index]);
          if (!changed) {
            return session;
          }
          return {
            ...session,
            frames: hydratedFrames,
          };
        })
      );
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

    setSessions([]);
    loadedSessionIdsRef.current.clear();
    sessionTextureCacheRef.current.clear();
  }, [serverBaseUrl]);

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

      setSessions((prev) => prev.filter((session) => session.id !== sessionId));
      loadedSessionIdsRef.current.delete(sessionId);
      sessionTextureCacheRef.current.delete(sessionId);
    },
    [serverBaseUrl]
  );

  return {
    sessions,
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
  };
}
