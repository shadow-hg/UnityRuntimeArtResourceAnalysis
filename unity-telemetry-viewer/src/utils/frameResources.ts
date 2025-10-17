import { getResourceCategory } from './resourceMetadata';

export function collectActiveFrameResources(frame: any | null, resourceCatalog?: Record<string, any>) {
  if (!frame) return [] as any[];

  const inlineResources: any[] = [];
  const inlineResourceById = new Map<string, any>();

  if (Array.isArray(frame.resourceSnapshot)) {
    for (const entry of frame.resourceSnapshot) {
      if (!entry) continue;
      inlineResources.push(entry);
      if (entry.id && typeof entry.id === 'string') {
        inlineResourceById.set(entry.id, entry);
      }
    }
  }

  const merged: any[] = [];
  const seenKeys = new Set<string>();

  const pushResource = (resource: any) => {
    if (!resource) return;
    const category = getResourceCategory(resource);
    const key = resource.id || resource.guid || resource.name || `${category}-${merged.length}`;
    if (key && seenKeys.has(key)) return;
    if (key) {
      seenKeys.add(key);
    }
    merged.push(resource);
  };

  if (Array.isArray(frame.resources)) {
    for (const rid of frame.resources) {
      if (typeof rid !== 'string') continue;
      const fromCatalog = resourceCatalog?.[rid];
      const fromSnapshot = inlineResourceById.get(rid);
      if (fromCatalog || fromSnapshot) {
        pushResource({ ...(fromCatalog || {}), ...(fromSnapshot || {}) });
      }
    }
  }

  if (merged.length === 0 && inlineResources.length > 0) {
    inlineResources.forEach((resource) => pushResource(resource));
  }

  return merged;
}

export type ActiveFrameResource = ReturnType<typeof collectActiveFrameResources>[number];
