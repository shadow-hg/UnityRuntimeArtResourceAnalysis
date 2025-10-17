const numberFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

export function formatNumber(value: number | null | undefined, options?: Intl.NumberFormatOptions) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const formatter = options ? new Intl.NumberFormat('zh-CN', options) : numberFormatter;
  return formatter.format(value);
}

export function formatMemoryFromKB(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const bytes = value * 1024;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let display = value;
  while (display >= 1024 && unitIndex < units.length - 1) {
    display /= 1024;
    unitIndex += 1;
  }
  return `${display.toFixed(display >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function formatSeconds(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '-';
  if (seconds < 0.001) return `${(seconds * 1000).toFixed(2)} ms`;
  if (seconds < 1) return `${(seconds * 1000).toFixed(1)} ms`;
  return `${seconds.toFixed(3)} s`;
}

export function formatTimestamp(value: number | string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}
