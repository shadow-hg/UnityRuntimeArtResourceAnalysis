import { useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { TelemetrySession, TelemetrySnapshot } from '../types';

interface UseTelemetryStreamOptions {
  serverBaseUrl: string;
}

export function useTelemetryStream({ serverBaseUrl }: UseTelemetryStreamOptions) {
  const [sessions, setSessions] = useState<TelemetrySession[]>([]);
  const socket = useMemo<Socket | null>(() => {
    if (!serverBaseUrl) return null;
    return io(serverBaseUrl, {
      transports: ['websocket'],
    });
  }, [serverBaseUrl]);

  useEffect(() => {
    async function bootstrap() {
      try {
        const response = await fetch(`${serverBaseUrl}/sessions`);
        if (!response.ok) {
          throw new Error(`Failed to fetch sessions: ${response.statusText}`);
        }
        const initialSessions: TelemetrySession[] = await response.json();
        setSessions(initialSessions.map((session) => ({ ...session, frames: session.frames ?? [] })));
      } catch (error) {
        console.error(error);
      }
    }

    if (serverBaseUrl) {
      bootstrap();
    }
  }, [serverBaseUrl]);

  useEffect(() => {
    if (!socket) return;

    function handleSessionCreate(session: TelemetrySession) {
      setSessions((prev) => [...prev, { ...session, frames: session.frames ?? [] }]);
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

    function handleSessionFrame(payload: { sessionId: string; frame: TelemetrySnapshot }) {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === payload.sessionId
            ? { ...session, frames: [...(session.frames ?? []), payload.frame] }
            : session
        )
      );
    }

    socket.on('session:create', handleSessionCreate);
    socket.on('session:close', handleSessionClose);
    socket.on('session:frame', handleSessionFrame);

    return () => {
      socket.off('session:create', handleSessionCreate);
      socket.off('session:close', handleSessionClose);
      socket.off('session:frame', handleSessionFrame);
      socket.disconnect();
    };
  }, [socket]);

  return { sessions };
}
