import type { FramePreviewInfo } from '../types';

export type PreviewSourceLike =
  | FramePreviewInfo
  | {
      previewBase64?: string | null;
      imageBase64?: string | null;
      previewUrl?: string | null;
      previewMimeType?: string | null;
      mimeType?: string | null;
    };

function resolveMimeType(resource: PreviewSourceLike | null | undefined): string | null {
  if (!resource || typeof resource !== 'object') {
    return null;
  }

  const previewMimeType =
    typeof (resource as { previewMimeType?: unknown }).previewMimeType === 'string'
      ? (resource as { previewMimeType?: string }).previewMimeType?.trim()
      : null;
  if (previewMimeType) {
    return previewMimeType;
  }

  const mimeType =
    typeof (resource as { mimeType?: unknown }).mimeType === 'string'
      ? (resource as { mimeType?: string }).mimeType?.trim()
      : null;
  if (mimeType) {
    return mimeType;
  }

  return null;
}

function normalizeBase64(data: string, mimeType: string | null): string {
  const trimmed = data.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  if (trimmed.startsWith('data:')) {
    return trimmed;
  }
  const safeMimeType = typeof mimeType === 'string' && mimeType.length > 0 ? mimeType : 'image/png';
  return `data:${safeMimeType};base64,${trimmed}`;
}

function joinUrl(base: string, relative: string): string {
  const trimmedRelative = relative.trim();
  if (/^https?:/i.test(trimmedRelative)) {
    return trimmedRelative;
  }

  if (trimmedRelative.startsWith('//')) {
    try {
      const parsedBase = new URL(base);
      return `${parsedBase.protocol}${trimmedRelative}`;
    } catch {
      return `https:${trimmedRelative}`;
    }
  }

  if (!base) {
    return trimmedRelative.startsWith('/') ? trimmedRelative : `/${trimmedRelative}`;
  }

  try {
    const parsedBase = new URL(base);
    return new URL(trimmedRelative, parsedBase).toString();
  } catch {
    const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const normalizedRelative = trimmedRelative.startsWith('/') ? trimmedRelative : `/${trimmedRelative}`;
    return `${normalizedBase}${normalizedRelative}`;
  }
}

export function resolvePreviewSource(
  resource: PreviewSourceLike | null | undefined,
  serverBaseUrl: string
): string | null {
  if (!resource) {
    return null;
  }

  const mimeType = resolveMimeType(resource);

  if (typeof resource.previewBase64 === 'string' && resource.previewBase64.trim().length > 0) {
    return normalizeBase64(resource.previewBase64, mimeType);
  }

  if (typeof resource.imageBase64 === 'string' && resource.imageBase64.trim().length > 0) {
    return normalizeBase64(resource.imageBase64, mimeType);
  }

  if (typeof resource.previewUrl === 'string' && resource.previewUrl.trim().length > 0) {
    return joinUrl(serverBaseUrl, resource.previewUrl);
  }

  return null;
}
