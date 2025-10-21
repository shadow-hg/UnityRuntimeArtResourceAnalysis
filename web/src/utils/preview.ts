import type { FramePreviewInfo } from '../types';

export type PreviewSourceLike =
  | FramePreviewInfo
  | { previewBase64?: string | null; imageBase64?: string | null; previewUrl?: string | null };

function normalizeBase64(data: string): string {
  const trimmed = data.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  if (trimmed.startsWith('data:')) {
    return trimmed;
  }
  return `data:image/png;base64,${trimmed}`;
}

function joinUrl(base: string, relative: string): string {
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const normalizedRelative = relative.startsWith('/') ? relative : `/${relative}`;
  return `${normalizedBase}${normalizedRelative}`;
}

export function resolvePreviewSource(
  resource: PreviewSourceLike | null | undefined,
  serverBaseUrl: string
): string | null {
  if (!resource) {
    return null;
  }

  if (typeof resource.previewBase64 === 'string' && resource.previewBase64.trim().length > 0) {
    return normalizeBase64(resource.previewBase64);
  }

  if (typeof resource.imageBase64 === 'string' && resource.imageBase64.trim().length > 0) {
    return normalizeBase64(resource.imageBase64);
  }

  if (typeof resource.previewUrl === 'string' && resource.previewUrl.trim().length > 0) {
    if (/^https?:/i.test(resource.previewUrl)) {
      return resource.previewUrl;
    }
    return joinUrl(serverBaseUrl, resource.previewUrl);
  }

  return null;
}
