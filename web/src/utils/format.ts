export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[exponent]}`;
}

export function formatFps(fps: number): string {
  return `${fps.toFixed(1)} FPS`;
}

export function formatPercentage(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

export function formatInteger(value: number | null | undefined, fallback = '0'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) {
    return fallback;
  }
  return rounded.toLocaleString();
}
