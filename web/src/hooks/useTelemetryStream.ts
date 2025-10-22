import { useCallback, useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  NetworkInfoResponse,
  TelemetrySession,
  TelemetrySnapshot,
  ServerConfig,
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
    autoManageSession: true,
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

function sanitizeServerConfig(rawConfig: Partial<ServerConfig> | null | undefined): ServerConfig {
  const base: ServerConfig = {
    clientDefaults: { ...DEFAULT_SERVER_CONFIG.clientDefaults },
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
    base.clientDefaults.autoManageSession = ensureBoolean(
      clientDefaults.autoManageSession,
      base.clientDefaults.autoManageSession
    );
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
    'connecting'
  );
  const [networkInfo, setNetworkInfo] = useState<NetworkInfoResponse | null>(null);
  const [serverConfig, setServerConfig] = useState<ServerConfig>(DEFAULT_SERVER_CONFIG);
  const [isConfigLoading, setIsConfigLoading] = useState(false);

  const maxSessionFrames = resolveFrameLimit(serverConfig?.history?.maxSessionFrames);

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

  useEffect(() => {
    refreshServerConfig();
  }, [refreshServerConfig]);

  useEffect(() => {
    if (!serverBaseUrl) return;
    setConnectionState('connecting');

    async function bootstrapSessions() {
      try {
        const response = await fetch(`${serverBaseUrl}/sessions`);
        if (!response.ok) {
          throw new Error(`Failed to fetch sessions: ${response.statusText}`);
        }
        const initialSessions: TelemetrySession[] = await response.json();
        setSessions(initialSessions.map((session) => normalizeSession(session, maxSessionFrames)));
        setConnectionState((state) => (state === 'connecting' ? 'connected' : state));
      } catch (error) {
        console.error(error);
        setConnectionState('error');
      }
    }

    bootstrapSessions();
  }, [serverBaseUrl, maxSessionFrames]);

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

          const previousTrimmed = session.trimmedFrameCount ?? 0;
          let frames = [...(session.frames ?? []), payload.frame];
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
    }

    function handleSessionDeleted(payload: { sessionId?: string } | undefined) {
      const sessionId = payload?.sessionId;
      if (!sessionId) {
        return;
      }
      setSessions((prev) => prev.filter((session) => session.id !== sessionId));
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
    },
    [serverBaseUrl]
  );

  return {
    sessions,
    connectionState,
    networkInfo,
    serverConfig,
    isConfigLoading,
    updateServerConfig,
    clearServerHistory,
    deleteServerSession,
    refreshServerConfig,
  };
}
