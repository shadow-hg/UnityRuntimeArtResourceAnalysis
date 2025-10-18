import { getResourceCategory } from './resourceMetadata';

function normaliseIdentifier(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function getResourceIdentityKeys(resource: any): string[] {
  if (!resource || typeof resource !== 'object') return [];
  const keys: string[] = [];
  const candidates: unknown[] = [
    (resource as any).id,
    (resource as any).guid,
    (resource as any).assetGuid,
    (resource as any).assetId,
    (resource as any).instanceId,
    (resource as any).hash,
    (resource as any).path
  ];
  for (const candidate of candidates) {
    const normalised = normaliseIdentifier(candidate);
    if (normalised && !keys.includes(normalised)) {
      keys.push(normalised);
    }
  }
  const nameCandidate = normaliseIdentifier((resource as any).name);
  if (nameCandidate) {
    const prefixed = `name:${nameCandidate}`;
    if (!keys.includes(prefixed)) {
      keys.push(prefixed);
    }
  }
  return keys;
}

export function collectActiveFrameResources(frame: any | null, resourceCatalog?: Record<string, any>) {
  if (!frame) return [] as any[];

  const inlineResources: any[] = [];
  const inlineResourceByKey = new Map<string, any>();

  if (Array.isArray(frame.resourceSnapshot)) {
    for (const entry of frame.resourceSnapshot) {
      if (!entry) continue;
      inlineResources.push(entry);
      const keys = getResourceIdentityKeys(entry);
      for (const key of keys) {
        inlineResourceByKey.set(key, entry);
      }
    }
  }

  const merged: any[] = [];
  const seenKeys = new Set<string>();

  const pushResource = (resource: any, explicitKey?: string | null) => {
    if (!resource) return;
    const category = getResourceCategory(resource);
    const identityKeys = getResourceIdentityKeys(resource);
    const fallbackName = normaliseIdentifier(resource?.name);
    const normalisedExplicit = normaliseIdentifier(explicitKey);
    const primaryKey =
      normalisedExplicit || identityKeys[0] || fallbackName || `${category}-${merged.length}`;
    if (primaryKey && seenKeys.has(primaryKey)) return;
    if (primaryKey) {
      seenKeys.add(primaryKey);
    }
    identityKeys.forEach((key) => seenKeys.add(key));
    if (fallbackName) {
      seenKeys.add(fallbackName);
    }
    merged.push(resource);
  };

  if (Array.isArray(frame.resources)) {
    for (const rid of frame.resources) {
      const ridKey = normaliseIdentifier(rid);
      if (!ridKey) continue;
      const fromCatalog = resourceCatalog?.[ridKey];
      const fromSnapshot = inlineResourceByKey.get(ridKey);
      if (fromCatalog || fromSnapshot) {
        const combined = { ...(fromCatalog || {}) } as Record<string, any>;
        let appliedSnapshot = false;

        if (fromSnapshot) {
          for (const [key, value] of Object.entries(fromSnapshot)) {
            if (value === undefined || value === null) {
              continue;
            }
            if (typeof value === 'string' && value.trim().length === 0) {
              continue;
            }
            combined[key] = value;
            appliedSnapshot = true;
          }
        }

        const result = fromCatalog || appliedSnapshot ? combined : fromSnapshot || {};
        pushResource(result, ridKey);
      }
    }
  }

  if (inlineResources.length > 0) {
    inlineResources.forEach((resource) => {
      const keys = getResourceIdentityKeys(resource);
      const primary = keys[0] || normaliseIdentifier(resource?.name);
      pushResource(resource, primary || null);
    });
  }

  return merged;
}

export type ActiveFrameResource = ReturnType<typeof collectActiveFrameResources>[number];
