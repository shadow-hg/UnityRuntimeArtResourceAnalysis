import type { TelemetrySession } from '../types';
import { resolveSessionIp } from './session';
import { normalizeGroupingCandidate } from './sessionGrouping';

function toSearchToken(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim().toLowerCase();
  return normalized;
}

export function buildSessionSearchTokens(session: TelemetrySession): string[] {
  const client = session.client ?? {};
  const rawValues: unknown[] = [
    session.id,
    session.clientIp,
    resolveSessionIp(session),
    normalizeGroupingCandidate(client['accountName']),
    normalizeGroupingCandidate(client['userName']),
    normalizeGroupingCandidate(client['productName']),
    normalizeGroupingCandidate(client['deviceName']),
    normalizeGroupingCandidate(client['platform']),
    normalizeGroupingCandidate(client['version']),
    normalizeGroupingCandidate(client['remoteAddress']),
  ];

  const tokens = rawValues
    .map(toSearchToken)
    .filter((token): token is string => token.length > 0);

  return Array.from(new Set(tokens));
}
