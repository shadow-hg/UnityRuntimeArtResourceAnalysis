import express from 'express';
import http from 'http';
import cors from 'cors';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { HistoryStore } from './historyStore.js';
import { createConfigStore } from './configStore.js';

const PORT = process.env.PORT || 48080;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const PREVIEW_ROOT = path.join(moduleDir, '..', 'data', 'previews');
const FRAME_PREVIEW_DIR = 'frames';
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
  },
});

app.use(cors());
app.use(express.json({ limit: '30mb' }));

const configStore = createConfigStore();
const historyStore = new HistoryStore({ configStore });

configStore.onChange((config) => {
  historyStore.applyConfig(config).catch((err) => {
    console.warn('Failed to apply config change', err);
  });
});

function listLanAddresses(port) {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  Object.entries(interfaces).forEach(([interfaceName, records = []]) => {
    records
      .filter((record) => record.family === 'IPv4' && !record.internal)
      .forEach((record) => {
        addresses.push({
          interface: interfaceName,
          address: record.address,
          url: `http://${record.address}:${port}`,
        });
      });
  });
  return addresses;
}

function normalizeIp(value) {
  if (typeof value !== 'string') {
    return null;
  }
  if (value.startsWith('::ffff:')) {
    return value.slice(7);
  }
  if (value === '::1') {
    return '127.0.0.1';
  }
  return value;
}

function extractClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const [first] = forwarded.split(',');
    const normalized = normalizeIp(first?.trim() ?? '');
    if (normalized) {
      return normalized;
    }
  }

  if (Array.isArray(forwarded) && forwarded.length > 0) {
    const normalized = normalizeIp((forwarded[0] ?? '').trim());
    if (normalized) {
      return normalized;
    }
  }

  const remoteAddress = normalizeIp(req.socket?.remoteAddress ?? req.ip ?? '');
  if (remoteAddress) {
    return remoteAddress;
  }

  return 'unknown';
}

function cloneArray(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => {
    if (!item || typeof item !== 'object') {
      return item;
    }
    return { ...item };
  });
}

function deepClone(value) {
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item));
  }
  if (value && typeof value === 'object') {
    const cloned = {};
    for (const [key, entry] of Object.entries(value)) {
      cloned[key] = deepClone(entry);
    }
    return cloned;
  }
  return value;
}

function ensureFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function ensureNonNegativeInteger(value, fallback = 0) {
  const numeric = ensureFiniteNumber(value, fallback);
  const rounded = Math.round(numeric);
  if (!Number.isFinite(rounded)) {
    return Math.max(0, Math.round(fallback));
  }
  return Math.max(0, rounded);
}

function normalizeShaderVariantStats(stats) {
  if (!stats || typeof stats !== 'object') {
    return {
      shaderCount: 0,
      totalVariants: 0,
    };
  }

  const totalVariants = ensureNonNegativeInteger(stats.totalVariants, 0);
  const shaderCount = ensureNonNegativeInteger(stats.shaderCount, 0);

  return {
    shaderCount,
    totalVariants,
  };
}

function sanitizeFramePayload(payload) {
  const {
    textures = [],
    meshes = [],
    shaders = [],
    renderTextures = [],
    materials = [],
    framePreview = null,
    textureOrder = [],
    meshOrder = [],
    renderTextureOrder = [],
    materialOrder = [],
    shaderOrder = [],
    shaderVariantStats = null,
    totalShaderBytes = 0,
    shaderMemoryBytes = 0,
    isIncremental = false,
    frameTiming = null,
    memoryStats = null,
    threadStats = null,
    assetIo = null,
    environment = null,
    ...rest
  } = payload ?? {};
  const preview =
    framePreview && typeof framePreview === 'object'
      ? { ...framePreview }
      : undefined;
  return {
    ...rest,
    isIncremental: Boolean(isIncremental),
    textures: cloneArray(textures),
    meshes: cloneArray(meshes),
    renderTextures: cloneArray(renderTextures),
    materials: cloneArray(materials),
    shaders: cloneArray(shaders),
    framePreview: preview,
    textureOrder: Array.isArray(textureOrder) ? [...textureOrder] : [],
    meshOrder: Array.isArray(meshOrder) ? [...meshOrder] : [],
    renderTextureOrder: Array.isArray(renderTextureOrder) ? [...renderTextureOrder] : [],
    materialOrder: Array.isArray(materialOrder) ? [...materialOrder] : [],
    shaderOrder: Array.isArray(shaderOrder) ? [...shaderOrder] : [],
    totalShaderBytes: ensureFiniteNumber(totalShaderBytes, 0),
    shaderMemoryBytes: ensureFiniteNumber(shaderMemoryBytes, 0),
    shaderVariantStats: normalizeShaderVariantStats(shaderVariantStats),
    frameTiming: frameTiming && typeof frameTiming === 'object' ? deepClone(frameTiming) : null,
    memoryStats: memoryStats && typeof memoryStats === 'object' ? deepClone(memoryStats) : null,
    threadStats: threadStats && typeof threadStats === 'object' ? deepClone(threadStats) : null,
    assetIo: assetIo && typeof assetIo === 'object' ? deepClone(assetIo) : null,
    environment: environment && typeof environment === 'object' ? deepClone(environment) : null,
  };
}

function normalizeInstanceId(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const rounded = Math.round(parsed);
  return Number.isInteger(rounded) ? rounded : null;
}

function normalizeTextureId(texture) {
  if (!texture || typeof texture !== 'object') {
    return null;
  }

  const fromPayload = typeof texture.textureId === 'string' ? texture.textureId.trim() : '';
  if (fromPayload.length > 0) {
    return fromPayload;
  }

  const pathValue = typeof texture.path === 'string' ? texture.path.trim() : '';
  if (pathValue.length > 0) {
    return `path:${pathValue.toLowerCase()}`;
  }

  const instanceId = normalizeInstanceId(texture.instanceId);
  if (instanceId != null) {
    return `instance:${instanceId}`;
  }

  const fingerprint = `${texture.name ?? ''}|${texture.width ?? 0}|${texture.height ?? 0}|${texture.formatName ?? texture.format ?? ''}|${texture.EstimatedBytes ?? texture.estimatedBytes ?? 0}`;
  return `hash:${crypto.createHash('sha1').update(fingerprint).digest('hex')}`;
}

function resolveOrder(order, updates = [], previous = []) {
  const resolved = [];
  const seen = new Set();
  const normalized = Array.isArray(order)
    ? order
        .map((value) => normalizeInstanceId(value))
        .filter((value) => value != null)
    : [];

  const append = (items) => {
    if (!Array.isArray(items)) {
      return;
    }
    items.forEach((item) => {
      const id = normalizeInstanceId(item?.instanceId);
      if (id == null || seen.has(id)) {
        return;
      }
      seen.add(id);
      resolved.push(id);
    });
  };

  normalized.forEach((id) => {
    if (id == null || seen.has(id)) {
      return;
    }
    seen.add(id);
    resolved.push(id);
  });

  append(updates);

  if (resolved.length === 0) {
    append(previous);
  }

  return resolved;
}

function applyCategoryDelta(previousItems, updates, orderIds) {
  const baseItems = Array.isArray(previousItems) ? previousItems : [];
  const deltaItems = Array.isArray(updates) ? updates : [];
  const hasExplicitOrder = Array.isArray(orderIds);
  const finalOrder = resolveOrder(hasExplicitOrder ? orderIds : undefined, deltaItems, hasExplicitOrder ? [] : baseItems);

  const map = new Map();
  baseItems.forEach((item) => {
    const id = normalizeInstanceId(item?.instanceId);
    if (id == null) {
      return;
    }
    map.set(id, { ...item });
  });

  deltaItems.forEach((item) => {
    const id = normalizeInstanceId(item?.instanceId);
    if (id == null) {
      return;
    }
    map.set(id, { ...item });
  });

  if (hasExplicitOrder) {
    const activeSet = new Set(finalOrder);
    for (const key of Array.from(map.keys())) {
      if (!activeSet.has(key)) {
        map.delete(key);
      }
    }
  }

  const ordered = [];
  const seen = new Set();
  finalOrder.forEach((id) => {
    if (id == null || seen.has(id) || !map.has(id)) {
      return;
    }
    ordered.push(map.get(id));
    seen.add(id);
  });

  for (const [id, item] of map.entries()) {
    if (!seen.has(id)) {
      ordered.push(item);
      finalOrder.push(id);
      seen.add(id);
    }
  }

  return { items: ordered, order: finalOrder };
}

async function expandIncrementalFrame(sessionId, frame) {
  const isIncremental = Boolean(frame?.isIncremental);
  const normalizedFrame = { ...frame };

  const ensureBaselineOrders = () => {
    normalizedFrame.textureOrder = resolveOrder(normalizedFrame.textureOrder, normalizedFrame.textures);
    normalizedFrame.meshOrder = resolveOrder(normalizedFrame.meshOrder, normalizedFrame.meshes);
    normalizedFrame.renderTextureOrder = resolveOrder(
      normalizedFrame.renderTextureOrder,
      normalizedFrame.renderTextures
    );
    normalizedFrame.materialOrder = resolveOrder(normalizedFrame.materialOrder, normalizedFrame.materials);
    normalizedFrame.shaderOrder = resolveOrder(normalizedFrame.shaderOrder, normalizedFrame.shaders);
    normalizedFrame.isIncremental = false;
  };

  const updateTotals = () => {
    const sumBytes = (items, key) =>
      Array.isArray(items)
        ? items.reduce((total, item) => total + (Number(item?.[key]) || 0), 0)
        : 0;

    normalizedFrame.totalTextureBytes = sumBytes(normalizedFrame.textures, 'EstimatedBytes');
    normalizedFrame.totalMeshBytes = sumBytes(normalizedFrame.meshes, 'EstimatedBytes');
    normalizedFrame.totalRenderTextureBytes = sumBytes(normalizedFrame.renderTextures, 'EstimatedBytes');
    normalizedFrame.totalMaterialBytes = sumBytes(normalizedFrame.materials, 'memoryBytes');
    normalizedFrame.totalShaderBytes = sumBytes(normalizedFrame.shaders, 'memoryBytes');
    if (!Number.isFinite(normalizedFrame.shaderMemoryBytes) || normalizedFrame.shaderMemoryBytes <= 0) {
      normalizedFrame.shaderMemoryBytes = normalizedFrame.totalShaderBytes;
    }

    const aggregatedStats = normalizeShaderVariantStats(normalizedFrame.shaderVariantStats);
    if (
      aggregatedStats.shaderCount === 0 &&
      aggregatedStats.totalVariants === 0 &&
      Array.isArray(normalizedFrame.shaders) &&
      normalizedFrame.shaders.length > 0
    ) {
      let totalVariants = 0;
      normalizedFrame.shaders.forEach((shader) => {
        totalVariants += ensureNonNegativeInteger(shader?.totalVariantCount, 0);
      });
      aggregatedStats.shaderCount = normalizedFrame.shaders.length;
      aggregatedStats.totalVariants = totalVariants;
    }
    normalizedFrame.shaderVariantStats = aggregatedStats;
  };

  if (!isIncremental) {
    ensureBaselineOrders();
    updateTotals();
    return normalizedFrame;
  }

  const previousFrame = await historyStore.getLastFrame(sessionId);
  if (!previousFrame) {
    ensureBaselineOrders();
    return normalizedFrame;
  }

  const textureDelta = applyCategoryDelta(
    previousFrame.textures,
    normalizedFrame.textures,
    normalizedFrame.textureOrder
  );
  const meshDelta = applyCategoryDelta(
    previousFrame.meshes,
    normalizedFrame.meshes,
    normalizedFrame.meshOrder
  );
  const renderTextureDelta = applyCategoryDelta(
    previousFrame.renderTextures,
    normalizedFrame.renderTextures,
    normalizedFrame.renderTextureOrder
  );
  const materialDelta = applyCategoryDelta(
    previousFrame.materials,
    normalizedFrame.materials,
    normalizedFrame.materialOrder
  );
  const shaderDelta = applyCategoryDelta(
    previousFrame.shaders,
    normalizedFrame.shaders,
    normalizedFrame.shaderOrder
  );

  normalizedFrame.textures = textureDelta.items;
  normalizedFrame.textureOrder = textureDelta.order;
  normalizedFrame.meshes = meshDelta.items;
  normalizedFrame.meshOrder = meshDelta.order;
  normalizedFrame.renderTextures = renderTextureDelta.items;
  normalizedFrame.renderTextureOrder = renderTextureDelta.order;
  normalizedFrame.materials = materialDelta.items;
  normalizedFrame.materialOrder = materialDelta.order;
  normalizedFrame.shaders = shaderDelta.items;
  normalizedFrame.shaderOrder = shaderDelta.order;
  normalizedFrame.isIncremental = false;

  const carryForward = (key) => {
    if (normalizedFrame[key] != null) {
      return;
    }
    const previousValue = previousFrame[key];
    if (previousValue == null) {
      return;
    }
    normalizedFrame[key] = deepClone(previousValue);
  };

  ['frameTiming', 'memoryStats', 'threadStats', 'assetIo', 'environment'].forEach((key) => carryForward(key));

  updateTotals();

  return normalizedFrame;
}

function extractBase64Components(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return { payload: null, contentType: null };
  }

  let payload = value;
  let contentType = null;

  const commaIndex = value.indexOf(',');
  if (commaIndex !== -1) {
    const prefix = value.slice(0, commaIndex);
    if (prefix.startsWith('data:')) {
      const metadata = prefix.slice('data:'.length);
      const separatorIndex = metadata.indexOf(';');
      if (separatorIndex !== -1) {
        contentType = metadata.slice(0, separatorIndex);
      } else if (metadata) {
        contentType = metadata;
      }
      payload = value.slice(commaIndex + 1);
    }
  }

  return { payload, contentType };
}

function extractBase64Payload(value) {
  const { payload } = extractBase64Components(value);
  return payload;
}

async function persistTexturePreview(sessionId, texture) {
  if (!texture || typeof texture !== 'object') {
    return { stored: texture, broadcast: texture };
  }

  const { previewBase64, ...rest } = texture;
  const broadcastTexture = { ...texture };
  const storedTexture = { ...rest };
  const textureId = normalizeTextureId(texture);
  if (textureId) {
    storedTexture.textureId = textureId;
    broadcastTexture.textureId = textureId;
  }

  const payload = extractBase64Payload(previewBase64 ?? '');
  if (!payload) {
    return { stored: storedTexture, broadcast: broadcastTexture };
  }

  try {
    const buffer = Buffer.from(payload, 'base64');
    if (!buffer || buffer.length === 0) {
      return { stored: storedTexture, broadcast: broadcastTexture };
    }

    const identifierSeed = textureId
      ? `${textureId}|${texture.width ?? 0}|${texture.height ?? 0}|${texture.formatName ?? texture.format ?? ''}`
      : `${texture.name ?? 'unknown'}|${texture.width ?? 0}|${texture.height ?? 0}|${texture.formatName ?? texture.format ?? ''}`;
    const previewId = crypto.createHash('md5').update(identifierSeed).digest('hex');
    const previewUrl = `/sessions/${sessionId}/textures/${previewId}/preview`;

    const saved = await historyStore.savePreview(sessionId, {
      previewId,
      kind: 'texture',
      mimeType: 'image/png',
      data: buffer,
    });

    if (saved) {
      storedTexture.previewUrl = previewUrl;
      broadcastTexture.previewUrl = previewUrl;
    }
  } catch (err) {
    console.warn('Failed to persist texture preview', err);
  }

  delete storedTexture.previewBase64;

  return { stored: storedTexture, broadcast: broadcastTexture };
}

async function persistFramePreview(sessionId, frameNumber, framePreview) {
  if (!framePreview || typeof framePreview !== 'object') {
    return { stored: framePreview, broadcast: framePreview };
  }

  const { previewBase64, imageBase64, ...rest } = framePreview;
  const broadcastPreview = { ...framePreview };
  const storedPreview = { ...rest };

  const { payload } = extractBase64Components(previewBase64 ?? imageBase64 ?? '');
  if (!payload) {
    return { stored: storedPreview, broadcast: broadcastPreview };
  }

  try {
    const buffer = Buffer.from(payload, 'base64');
    if (!buffer || buffer.length === 0) {
      return { stored: storedPreview, broadcast: broadcastPreview };
    }

    const identifier = `${frameNumber ?? 'unknown'}|${storedPreview.width ?? 0}|${storedPreview.height ?? 0}|${buffer.length}`;
    const previewId = crypto.createHash('md5').update(identifier).digest('hex');
    const previewUrl = `/sessions/${sessionId}/frames/${previewId}/preview`;

    const saved = await historyStore.savePreview(sessionId, {
      previewId,
      kind: 'frame',
      mimeType: 'image/png',
      frameIndex: typeof frameNumber === 'number' ? frameNumber : null,
      data: buffer,
    });

    if (saved) {
      storedPreview.previewUrl = previewUrl;
      broadcastPreview.previewUrl = previewUrl;
    }
  } catch (err) {
    console.warn('Failed to persist frame preview', err);
  }

  delete storedPreview.previewBase64;
  delete storedPreview.imageBase64;

  return { stored: storedPreview, broadcast: broadcastPreview };
}

async function prepareFramePayload(sessionId, payload) {
  const sanitizedFrame = sanitizeFramePayload(payload);
  const expandedFrame = await expandIncrementalFrame(sessionId, sanitizedFrame);
  const storedFrame = { ...expandedFrame };
  const broadcastFrame = { ...expandedFrame };

  if (Array.isArray(expandedFrame.textures) && expandedFrame.textures.length > 0) {
    const textures = await Promise.all(
      expandedFrame.textures.map((texture) => persistTexturePreview(sessionId, texture))
    );
    storedFrame.textures = textures.map((result) => result.stored);
    const textureReferences = await historyStore.ensureSessionTextures(sessionId, storedFrame.textures);
    storedFrame.textures = textureReferences;
    broadcastFrame.textures = textureReferences.map((texture) => ({ ...texture }));
  }

  if (Array.isArray(expandedFrame.renderTextures) && expandedFrame.renderTextures.length > 0) {
    const renderTextures = await Promise.all(
      expandedFrame.renderTextures.map((renderTexture) => persistTexturePreview(sessionId, renderTexture))
    );
    storedFrame.renderTextures = renderTextures.map((result) => result.stored);
    broadcastFrame.renderTextures = renderTextures.map((result) => result.broadcast);
  }

  if (expandedFrame.framePreview && typeof expandedFrame.framePreview === 'object') {
    const { stored, broadcast } = await persistFramePreview(
      sessionId,
      expandedFrame.frameNumber,
      expandedFrame.framePreview
    );
    storedFrame.framePreview = stored;
    broadcastFrame.framePreview = broadcast;
  }

  return { storedFrame, broadcastFrame };
}

async function removeFramePreviews(sessionId, frames = []) {
  if (!Array.isArray(frames) || frames.length === 0) {
    return;
  }

  const previewIds = new Set();

  await Promise.all(
    frames.map(async (frame) => {
      const previewUrl = frame?.framePreview?.previewUrl;
      if (!previewUrl || typeof previewUrl !== 'string') {
        return;
      }

      const match = previewUrl.match(/\/frames\/([^/]+)\/preview$/);
      if (!match) {
        return;
      }

      const previewId = match[1];
      previewIds.add(previewId);

      // Remove any legacy file-based previews for backward compatibility.
      const filePath = path.join(PREVIEW_ROOT, sessionId, FRAME_PREVIEW_DIR, `${previewId}.png`);
      try {
        await fs.rm(filePath, { force: true });
      } catch (err) {
        if (err && err.code !== 'ENOENT') {
          console.warn('Failed to remove frame preview file', previewUrl, err);
        }
      }
    })
  );

  if (previewIds.size > 0) {
    await historyStore.deletePreviews(sessionId, Array.from(previewIds));
  }
}

async function respondWithStoredPreview(res, { sessionId, previewId, fallbackPath = null }) {
  try {
    const stored = await historyStore.getPreview(sessionId, previewId);
    if (stored && stored.data) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Content-Type', stored.mimeType ?? 'image/png');
      return res.send(stored.data);
    }
  } catch (err) {
    console.error(`Failed to read preview ${previewId} for session ${sessionId}`, err);
  }

  if (fallbackPath) {
    try {
      await fs.access(fallbackPath);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(fallbackPath);
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.warn('Failed to serve legacy preview file', fallbackPath, err);
      }
    }
  }

  return res.status(404).json({ message: 'Preview not found' });
}

app.post('/sessions', async (req, res) => {
  try {
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    const clientIp = extractClientIp(req);
    const session = await historyStore.createSession({
      id,
      createdAt,
      client: req.body,
      clientIp,
    });
    await configStore.init();
    res.json({
      sessionId: id,
      createdAt,
      clientIp,
      clientConfig: configStore.getClientDefaults(),
    });
    io.emit('session:create', session);
  } catch (err) {
    console.error('Failed to create session', err);
    res.status(500).json({ message: 'Unable to create session' });
  }
});

app.get('/sessions', async (_req, res) => {
  const sessions = await historyStore.listSessions();
  res.json(sessions);
});

app.get('/network-info', (_req, res) => {
  res.json({
    hostname: os.hostname(),
    port: Number(PORT),
    addresses: listLanAddresses(PORT),
  });
});

app.get('/config', async (_req, res) => {
  try {
    await configStore.init();
    res.json(configStore.getConfig());
  } catch (err) {
    console.error('Failed to load server config', err);
    res.status(500).json({ message: 'Unable to load config' });
  }
});

app.put('/config', async (req, res) => {
  try {
    await configStore.init();
    const updatedConfig = await configStore.update(req.body ?? {});
    await historyStore.applyConfig(updatedConfig);
    io.emit('config:update', updatedConfig);
    res.json(updatedConfig);
  } catch (err) {
    console.error('Failed to update server config', err);
    res.status(400).json({ message: 'Invalid config payload' });
  }
});

app.get('/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const hydrateParam = req.query.hydrateTextures ?? req.query.includeTextures;
  const hydrateTextures =
    hydrateParam === undefined ? true : !['0', 'false', 'no'].includes(String(hydrateParam).toLowerCase());
  const session = await historyStore.getSession(sessionId, { hydrateTextures });
  if (!session) {
    return res.status(404).json({ message: 'Session not found' });
  }
  res.json(session);
});

function parseTextureIds(queryValue) {
  if (!queryValue) {
    return [];
  }
  const raw = Array.isArray(queryValue) ? queryValue : [queryValue];
  const ids = [];
  raw.forEach((value) => {
    if (typeof value !== 'string') {
      return;
    }
    value
      .split(',')
      .forEach((part) => {
        try {
          const decoded = decodeURIComponent(part.trim());
          if (decoded && typeof decoded === 'string') {
            ids.push(decoded);
          }
        } catch {
          // Ignore malformed encodings
        }
      });
  });
  return Array.from(new Set(ids)).filter((id) => id.length > 0);
}

app.get('/sessions/:sessionId/textures', async (req, res) => {
  const { sessionId } = req.params;
  const ids = parseTextureIds(req.query.ids);
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.json({ textures: [] });
  }

  try {
    const textures = await historyStore.getSessionTextures(sessionId, ids);
    res.json({ textures });
  } catch (err) {
    console.error(`Failed to load textures for session ${sessionId}`, err);
    res.status(500).json({ message: 'Unable to load textures' });
  }
});

app.delete('/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId) {
    return res.status(400).json({ message: 'Session id is required' });
  }

  try {
    const removedSession = await historyStore.deleteSession(sessionId);
    if (!removedSession) {
      return res.status(404).json({ message: 'Session not found' });
    }

    await fs.rm(path.join(PREVIEW_ROOT, sessionId), { recursive: true, force: true });
    io.emit('session:deleted', { sessionId });
    return res.status(204).end();
  } catch (err) {
    console.error('Failed to delete telemetry session', err);
    return res.status(500).json({ message: 'Unable to delete session' });
  }
});

app.delete('/sessions', async (_req, res) => {
  try {
    await historyStore.clearHistory();
    await fs.rm(PREVIEW_ROOT, { recursive: true, force: true });
    io.emit('history:cleared');
    res.status(204).end();
  } catch (err) {
    console.error('Failed to clear telemetry history', err);
    res.status(500).json({ message: 'Unable to clear history' });
  }
});

app.get('/sessions/:sessionId/textures/:previewId/preview', async (req, res) => {
  const { sessionId, previewId } = req.params;
  if (!previewId) {
    return res.status(400).json({ message: 'Preview id is required' });
  }

  const fallbackPath = path.join(PREVIEW_ROOT, sessionId, `${previewId}.png`);
  return respondWithStoredPreview(res, { sessionId, previewId, fallbackPath });
});

app.get('/sessions/:sessionId/frames/:previewId/preview', async (req, res) => {
  const { sessionId, previewId } = req.params;
  if (!previewId) {
    return res.status(400).json({ message: 'Preview id is required' });
  }

  const fallbackPath = path.join(PREVIEW_ROOT, sessionId, FRAME_PREVIEW_DIR, `${previewId}.png`);
  return respondWithStoredPreview(res, { sessionId, previewId, fallbackPath });
});

app.post('/sessions/:sessionId/frames', async (req, res) => {
  const sessionId = req.params.sessionId;
  try {
    const { storedFrame, broadcastFrame } = await prepareFramePayload(sessionId, req.body);
    const { trimmedFrameCount, totalFrameCount, removedFrameCount, removedFrames } = await historyStore.appendFrame(
      sessionId,
      storedFrame
    );
    await removeFramePreviews(sessionId, removedFrames);
    res.status(204).end();
    io.emit('session:frame', {
      sessionId,
      frame: broadcastFrame,
      trimmedFrameCount,
      totalFrameCount,
      removedFrameCount,
    });
  } catch (err) {
    console.error('Failed to append frame', err);
    res.status(400).json({ message: err.message });
  }
});

app.post('/sessions/:sessionId/close', async (req, res) => {
  const sessionId = req.params.sessionId;
  const session = await historyStore.closeSession(sessionId);
  if (!session) {
    return res.status(404).json({ message: 'Session not found' });
  }
  res.status(204).end();
  io.emit('session:close', { sessionId });
});

io.on('connection', (socket) => {
  console.log('Web client connected');
  socket.on('disconnect', () => {
    console.log('Web client disconnected');
  });
});

async function startServer() {
  await configStore.init();
  await historyStore.init();
  await historyStore.applyConfig(configStore.getConfig());
  server.listen(PORT, () => {
    console.log(`UnityProfileV2 server listening on port ${PORT}`);
  });
}

function closeServer(callback) {
  io.close(() => {
    server.close((err) => {
      if (err) {
        console.error('Failed to close server gracefully', err);
      }
      try {
        historyStore.close();
      } catch (dbErr) {
        console.warn('Failed to close history store', dbErr);
      }
      callback();
    });
  });
}

function handleShutdown(signal) {
  console.log(`Received ${signal}, shutting down server`);
  closeServer(() => {
    process.exit(0);
  });
}

function handleNodemonRestart() {
  closeServer(() => {
    process.kill(process.pid, 'SIGUSR2');
  });
}

process.once('SIGINT', handleShutdown);
process.once('SIGTERM', handleShutdown);
process.once('SIGUSR2', handleNodemonRestart);

startServer().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
