export const UNKNOWN_IP_LABEL = '未知 IP';

export function resolveSessionIp(session: {
  clientIp?: string | null;
  client?: Record<string, unknown> | null;
}): string {
  const raw = typeof session.clientIp === 'string' ? session.clientIp.trim() : '';
  if (raw && raw.toLowerCase() !== 'unknown') {
    return raw;
  }

  const fallbackSource = typeof session.client === 'object' && session.client !== null
    ? (session.client['remoteAddress'] as string | undefined)
    : undefined;
  const fallback = typeof fallbackSource === 'string' ? fallbackSource.trim() : '';
  if (fallback) {
    return fallback;
  }

  return UNKNOWN_IP_LABEL;
}
