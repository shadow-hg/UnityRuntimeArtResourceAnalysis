import { formatNumber } from './format';

const TEXTURE_CATEGORY_PATTERN = /texture|纹理/i;

export type TextureReference = {
  id?: string | null;
  name?: string | null;
};

export function getResourceCategory(resource: any): string {
  return resource?.category || resource?.type || '未分类';
}

export function isTextureCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  return TEXTURE_CATEGORY_PATTERN.test(category);
}

export function coerceSize(value: any): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normaliseCollection(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return Object.values(value);
  return [];
}

export function gatherTextureReferences(resource: any): TextureReference[] {
  const references = new Map<string, TextureReference>();

  const pushRef = (ref: TextureReference) => {
    const key = `${ref.id || ''}|${ref.name || ''}`;
    if (!references.has(key)) {
      references.set(key, ref);
    }
  };

  normaliseCollection(resource?.textures).forEach((entry: any) => {
    if (!entry) return;
    pushRef({ id: entry.id || entry.guid || null, name: entry.name || entry.slot || entry.path || null });
  });

  normaliseCollection(resource?.textureReferences).forEach((entry: any) => {
    if (!entry) return;
    pushRef({ id: entry.id || entry.guid || null, name: entry.name || entry.slot || entry.path || null });
  });

  normaliseCollection(resource?.textureSlots).forEach((entry: any) => {
    if (!entry) return;
    pushRef({ id: entry.id || entry.guid || null, name: entry.name || entry.slot || entry.path || null });
  });

  normaliseCollection(resource?.properties?.textures).forEach((entry: any) => {
    if (!entry) return;
    if (typeof entry === 'string') {
      pushRef({ name: entry });
      return;
    }
    pushRef({ id: entry.id || entry.guid || null, name: entry.name || entry.slot || entry.path || null });
  });

  if (typeof resource?.mainTexture === 'string') {
    pushRef({ name: resource.mainTexture });
  }

  if (resource?.mainTexture && typeof resource.mainTexture === 'object') {
    pushRef({ id: resource.mainTexture.id || resource.mainTexture.guid || null, name: resource.mainTexture.name || 'MainTexture' });
  }

  return Array.from(references.values()).filter((ref) => ref.id || ref.name);
}

export function buildResourceSummary(resource: any) {
  const originalKB = coerceSize(resource?.sizeKB ?? resource?.size);
  const compressedKB = coerceSize(
    resource?.sizeAfterCompressionKB ??
      resource?.sizeAfterCompression ??
      resource?.compressedSizeKB ??
      resource?.compressedSize ??
      resource?.platformData?.compressedSizeKB ??
      resource?.platformData?.compressedSize
  );
  const runtimeKB = coerceSize(
    resource?.runtimeSizeKB ??
      resource?.runtimeSize ??
      resource?.memorySizeKB ??
      resource?.memoryKB ??
      (compressedKB > 0 ? compressedKB : originalKB)
  );

  const thumbnail = resource?.thumbnailUrl || resource?.thumbnail || resource?.previewUrl || resource?.preview || null;
  const dimensions = resource?.width && resource?.height ? `${resource.width}×${resource.height}` : null;
  const keywords = Array.isArray(resource?.keywords) ? resource.keywords.filter(Boolean) : [];
  const textureRefs = gatherTextureReferences(resource);
  const format = resource?.format || resource?.compression || resource?.graphicsFormat;

  return {
    originalKB,
    runtimeKB,
    compressedKB,
    thumbnail,
    dimensions,
    keywords,
    textureRefs,
    format
  };
}

export type ResourceSummary = ReturnType<typeof buildResourceSummary>;

export function getDisplayMemoryKB(resource: any, summary?: ResourceSummary): number {
  const resourceSummary = summary ?? buildResourceSummary(resource);
  const category = getResourceCategory(resource);

  if (isTextureCategory(category)) {
    if (resourceSummary.compressedKB > 0) {
      return resourceSummary.compressedKB;
    }
  }

  if (resourceSummary.runtimeKB > 0) {
    return resourceSummary.runtimeKB;
  }

  if (resourceSummary.originalKB > 0) {
    return resourceSummary.originalKB;
  }

  return coerceSize(resource?.sizeKB ?? resource?.size ?? 0);
}

export function getStatDisplaySizeKB(stat: any): number {
  return coerceSize(
    stat?.compressedKB ??
      stat?.compressedSizeKB ??
      stat?.sizeAfterCompressionKB ??
      stat?.sizeAfterCompression ??
      stat?.runtimeKB ??
      stat?.runtimeSizeKB ??
      stat?.sizeKB ??
      stat?.size ??
      stat?.totalKB ??
      stat?.totalSize ??
      stat?.memoryKB
  );
}

export function buildMaterialSummary(resource: any) {
  const textures = gatherTextureReferences(resource);
  return {
    textureCount: textures.length,
    textureNames: textures.map((item) => item.name || item.id || '纹理')
  };
}

export function describeMesh(resource: any) {
  const info: string[] = [];
  if (resource.vertexCount) info.push(`顶点 ${formatNumber(resource.vertexCount)}`);
  if (resource.triangleCount) info.push(`三角形 ${formatNumber(resource.triangleCount)}`);
  if (resource.subMeshCount) info.push(`子网格 ${formatNumber(resource.subMeshCount)}`);
  return info;
}
