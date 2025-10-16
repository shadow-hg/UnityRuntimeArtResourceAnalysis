// src/utils/time.ts

export function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString() + '.' + String(date.getMilliseconds()).padStart(3, '0');
}

export function getCurrentTimestamp(): number {
    return Date.now();
}

export function calculateElapsedTime(start: number, end: number): number {
    return end - start;
}