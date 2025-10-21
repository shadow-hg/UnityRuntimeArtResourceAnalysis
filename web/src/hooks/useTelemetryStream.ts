import { useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { NetworkInfoResponse, TelemetrySession, TelemetrySnapshot } from '../types';

interface UseTelemetryStreamOptions {
  serverBaseUrl: string;
}

const MAX_SESSION_FRAMES = 10000;

function normalizeSession(session: TelemetrySession): TelemetrySession {
  const frames = session.frames ?? [];
  const trimmedFrameCount = session.trimmedFrameCount ?? 0;
  const totalFrameCount = session.totalFrameCount ?? trimmedFrameCount + frames.length;
  return {
    ...session,
    frames,
    trimmedFrameCount,
    totalFrameCount,
  };
}

export function useTelemetryStream({ serverBaseUrl }: UseTelemetryStreamOptions) {
  const [sessions, setSessions] = useState<TelemetrySession[]>([]);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>(
    'connecting'
  );
  const [networkInfo, setNetworkInfo] = useState<NetworkInfoResponse | null>(null);
  const socket = useMemo<Socket | null>(() => {
    if (!serverBaseUrl) return null;
    return io(serverBaseUrl, {
      transports: ['websocket'],
      autoConnect: true,
    });
  }, [serverBaseUrl]);

  useEffect(() => {
    if (!serverBaseUrl) return;
    setConnectionState('connecting');

    async function bootstrap() {
      try {
        const response = await fetch(`${serverBaseUrl}/sessions`);
        if (!response.ok) {
          throw new Error(`Failed to fetch sessions: ${response.statusText}`);
        }
        const initialSessions: TelemetrySession[] = await response.json();
        setSessions(initialSessions.map((session) => normalizeSession(session)));
        setConnectionState((state) => (state === 'connecting' ? 'connected' : state));
      } catch (error) {
        console.error(error);
        setConnectionState('error');
      }
    }

    bootstrap();
  }, [serverBaseUrl]);

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
      setSessions((prev) => [...prev, normalizeSession(session)]);
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
      setSessions((prev) =>
        prev.map((session) =>
          {
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

            if (frames.length > MAX_SESSION_FRAMES) {
              const overflow = frames.length - MAX_SESSION_FRAMES;
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
          }
        )
      );
    }

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleError);
    socket.on('session:create', handleSessionCreate);
    socket.on('session:close', handleSessionClose);
    socket.on('session:frame', handleSessionFrame);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleError);
      socket.off('session:create', handleSessionCreate);
      socket.off('session:close', handleSessionClose);
      socket.off('session:frame', handleSessionFrame);
      socket.disconnect();
    };
  }, [socket]);

  return { sessions, connectionState, networkInfo };
}
