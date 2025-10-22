import express from 'express';
import http from 'http';
import cors from 'cors';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import crypto from 'crypto';
import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { HistoryStore } from './historyStore.js';
import { createConfigStore, DEFAULT_CONFIG } from './configStore.js';

const PORT = process.env.PORT || 48080;
const PREVIEW_ROOT = path.join(process.cwd(), 'data', 'previews');
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

function sanitizeFramePayload(payload) {
  const {
    textures = [],
    meshes = [],
    shaders = [],
    renderTextures = [],
    materials = [],
    framePreview = null,
    ...rest
  } = payload ?? {};
  const preview =
    framePreview && typeof framePreview === 'object'
      ? { ...framePreview }
      : undefined;
  return {
    ...rest,
    textures: cloneArray(textures),
    meshes: cloneArray(meshes),
    renderTextures: cloneArray(renderTextures),
    materials: cloneArray(materials),
    shaders: cloneArray(shaders),
    framePreview: preview,
  };
}

function ensureFiniteNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function ensurePositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const rounded = Math.round(numeric);
  return rounded > 0 ? rounded : fallback;
}

function normalizeKeyPart(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : '';
}

function extractInstanceId(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const candidate =
    item.instanceId ?? item.instanceID ?? item.InstanceId ?? item.InstanceID ?? item.id ?? null;
  const numeric = Number(candidate);
  if (Number.isInteger(numeric)) {
    return numeric;
  }
  return null;
}

function buildIndexedKey(prefix, index) {
  return `${prefix}:index:${index}`;
}

function buildTextureKey(texture, index) {
  const instanceId = extractInstanceId(texture);
  if (instanceId != null) {
    return `texture:id:${instanceId}`;
  }
  const name = normalizeKeyPart(texture?.name);
  if (name) {
    return `texture:name:${name}`;
  }
  const path = normalizeKeyPart(texture?.path);
  if (path) {
    return `texture:path:${path}`;
  }
  const width = ensureFiniteNumber(texture?.width, -1);
  const height = ensureFiniteNumber(texture?.height, -1);
  const format = normalizeKeyPart(texture?.formatName ?? texture?.format);
  return `texture:${width}x${height}:${format}:${index}`;
}

function buildRenderTextureKey(renderTexture, index) {
  const instanceId = extractInstanceId(renderTexture);
  if (instanceId != null) {
    return `renderTexture:id:${instanceId}`;
  }
  const name = normalizeKeyPart(renderTexture?.name);
  if (name) {
    return `renderTexture:name:${name}`;
  }
  return buildIndexedKey('renderTexture', index);
}

function buildMaterialKey(material, index) {
  const instanceId = extractInstanceId(material);
  if (instanceId != null) {
    return `material:id:${instanceId}`;
  }
  const name = normalizeKeyPart(material?.name);
  const shaderName = normalizeKeyPart(material?.shaderName);
  if (name || shaderName) {
    return `material:${name}|${shaderName}`;
  }
  const path = normalizeKeyPart(material?.path);
  if (path) {
    return `material:path:${path}`;
  }
  return buildIndexedKey('material', index);
}

function buildMeshKey(mesh, index) {
  const instanceId = extractInstanceId(mesh);
  if (instanceId != null) {
    return `mesh:id:${instanceId}`;
  }
  const name = normalizeKeyPart(mesh?.name);
  if (name) {
    return `mesh:name:${name}`;
  }
  const path = normalizeKeyPart(mesh?.path);
  if (path) {
    return `mesh:path:${path}`;
  }
  return buildIndexedKey('mesh', index);
}

function buildShaderKey(shader, index) {
  const instanceId = extractInstanceId(shader);
  if (instanceId != null) {
    return `shader:id:${instanceId}`;
  }
  const name = normalizeKeyPart(shader?.name);
  if (name) {
    return `shader:name:${name}`;
  }
  const path = normalizeKeyPart(shader?.path);
  if (path) {
    return `shader:path:${path}`;
  }
  return buildIndexedKey('shader', index);
}

function dedupeByKey(items, keyBuilder, scoreSelector) {
  const bestByKey = new Map();
  items.forEach((item, index) => {
    const key = keyBuilder(item, index);
    if (!key) {
      return;
    }
    const score = scoreSelector(item, index);
    const existing = bestByKey.get(key);
    if (!existing || score > existing.score) {
      bestByKey.set(key, { item, score });
    }
  });
  return Array.from(bestByKey.values()).map((entry) => entry.item);
}

function processTextures(textures, limit) {
  const normalized = Array.isArray(textures)
    ? textures.filter((texture) => texture && typeof texture === 'object')
    : [];
  const deduped = dedupeByKey(normalized, buildTextureKey, (texture) =>
    ensureFiniteNumber(texture?.EstimatedBytes, 0)
  );
  deduped.sort(
    (a, b) => ensureFiniteNumber(b?.EstimatedBytes, 0) - ensureFiniteNumber(a?.EstimatedBytes, 0)
  );
  const limited = limit > 0 ? deduped.slice(0, limit) : deduped;
  const total = limited.reduce(
    (sum, texture) => sum + ensureFiniteNumber(texture?.EstimatedBytes, 0),
    0
  );
  return { items: limited, total };
}

function processRenderTextures(renderTextures, limit) {
  const normalized = Array.isArray(renderTextures)
    ? renderTextures.filter((renderTexture) => renderTexture && typeof renderTexture === 'object')
    : [];
  const deduped = dedupeByKey(normalized, buildRenderTextureKey, (renderTexture) =>
    ensureFiniteNumber(renderTexture?.EstimatedBytes, 0)
  );
  deduped.sort(
    (a, b) =>
      ensureFiniteNumber(b?.EstimatedBytes, 0) - ensureFiniteNumber(a?.EstimatedBytes, 0)
  );
  const limited = limit > 0 ? deduped.slice(0, limit) : deduped;
  const total = limited.reduce(
    (sum, renderTexture) => sum + ensureFiniteNumber(renderTexture?.EstimatedBytes, 0),
    0
  );
  return { items: limited, total };
}

function processMaterials(materials, limit) {
  const normalized = Array.isArray(materials)
    ? materials.filter((material) => material && typeof material === 'object')
    : [];
  const deduped = dedupeByKey(normalized, buildMaterialKey, (material) =>
    ensureFiniteNumber(material?.memoryBytes, 0)
  );
  deduped.sort(
    (a, b) => ensureFiniteNumber(b?.memoryBytes, 0) - ensureFiniteNumber(a?.memoryBytes, 0)
  );
  const limited = limit > 0 ? deduped.slice(0, limit) : deduped;
  const total = limited.reduce(
    (sum, material) => sum + ensureFiniteNumber(material?.memoryBytes, 0),
    0
  );
  return { items: limited, total };
}

function processMeshes(meshes, limit) {
  const normalized = Array.isArray(meshes)
    ? meshes.filter((mesh) => mesh && typeof mesh === 'object')
    : [];
  const deduped = dedupeByKey(normalized, buildMeshKey, (mesh) =>
    ensureFiniteNumber(mesh?.EstimatedBytes ?? mesh?.assetBytes, 0)
  );
  deduped.sort(
    (a, b) =>
      ensureFiniteNumber(b?.EstimatedBytes ?? b?.assetBytes, 0) -
      ensureFiniteNumber(a?.EstimatedBytes ?? a?.assetBytes, 0)
  );
  const limited = limit > 0 ? deduped.slice(0, limit) : deduped;
  const total = limited.reduce(
    (sum, mesh) => sum + ensureFiniteNumber(mesh?.EstimatedBytes ?? mesh?.assetBytes, 0),
    0
  );
  return { items: limited, total };
}

function processShaders(shaders, limit) {
  const normalized = Array.isArray(shaders)
    ? shaders.filter((shader) => shader && typeof shader === 'object')
    : [];
  const seen = new Set();
  const result = [];
  normalized.forEach((shader, index) => {
    const key = buildShaderKey(shader, index);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(shader);
  });
  const limited = limit > 0 ? result.slice(0, limit) : result;
  return { items: limited };
}

function processFrameAssets(frame, clientDefaults) {
  const maxAssetsPerCategory = ensurePositiveInteger(
    clientDefaults?.maxAssetsPerCategory,
    DEFAULT_CONFIG.clientDefaults.maxAssetsPerCategory
  );

  const { items: textures, total: textureBytes } = processTextures(
    frame.textures,
    maxAssetsPerCategory
  );
  frame.textures = textures;
  frame.totalTextureBytes = textureBytes;

  const { items: renderTextures, total: renderTextureBytes } = processRenderTextures(
    frame.renderTextures,
    maxAssetsPerCategory
  );
  frame.renderTextures = renderTextures;
  frame.totalRenderTextureBytes = renderTextureBytes;

  const { items: materials, total: materialBytes } = processMaterials(
    frame.materials,
    maxAssetsPerCategory
  );
  frame.materials = materials;
  frame.totalMaterialBytes = materialBytes;

  const { items: meshes, total: meshBytes } = processMeshes(frame.meshes, maxAssetsPerCategory);
  frame.meshes = meshes;
  frame.totalMeshBytes = meshBytes;

  const { items: shaders } = processShaders(frame.shaders, maxAssetsPerCategory);
  frame.shaders = shaders;

  return frame;
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

  const payload = extractBase64Payload(previewBase64 ?? '');
  if (!payload) {
    return { stored: storedTexture, broadcast: broadcastTexture };
  }

  try {
    const buffer = Buffer.from(payload, 'base64');
    if (!buffer || buffer.length === 0) {
      return { stored: storedTexture, broadcast: broadcastTexture };
    }

    const identifier = `${texture.name ?? 'unknown'}|${texture.width ?? 0}|${texture.height ?? 0}|${texture.formatName ?? texture.format ?? ''}`;
    const previewId = crypto.createHash('md5').update(identifier).digest('hex');
    const sessionDir = path.join(PREVIEW_ROOT, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `${previewId}.png`);
    await fs.writeFile(filePath, buffer);

    const previewUrl = `/sessions/${sessionId}/textures/${previewId}/preview`;
    storedTexture.previewUrl = previewUrl;
    broadcastTexture.previewUrl = previewUrl;
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
    const sessionDir = path.join(PREVIEW_ROOT, sessionId, FRAME_PREVIEW_DIR);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `${previewId}.png`);
    await fs.writeFile(filePath, buffer);

    const previewUrl = `/sessions/${sessionId}/frames/${previewId}/preview`;
    storedPreview.previewUrl = previewUrl;
    broadcastPreview.previewUrl = previewUrl;
  } catch (err) {
    console.warn('Failed to persist frame preview', err);
  }

  delete storedPreview.previewBase64;
  delete storedPreview.imageBase64;

  return { stored: storedPreview, broadcast: broadcastPreview };
}

async function prepareFramePayload(sessionId, payload) {
  await configStore.init();
  const sanitizedFrame = sanitizeFramePayload(payload);
  const clientDefaults = configStore.getClientDefaults();
  const processedFrame = processFrameAssets(sanitizedFrame, clientDefaults);
  const storedFrame = { ...processedFrame };
  const broadcastFrame = { ...processedFrame };

  if (Array.isArray(processedFrame.textures) && processedFrame.textures.length > 0) {
    const textures = await Promise.all(
      processedFrame.textures.map((texture) => persistTexturePreview(sessionId, texture))
    );
    storedFrame.textures = textures.map((result) => result.stored);
    broadcastFrame.textures = textures.map((result) => result.broadcast);
  }

  if (Array.isArray(processedFrame.renderTextures) && processedFrame.renderTextures.length > 0) {
    const renderTextures = await Promise.all(
      processedFrame.renderTextures.map((renderTexture) => persistTexturePreview(sessionId, renderTexture))
    );
    storedFrame.renderTextures = renderTextures.map((result) => result.stored);
    broadcastFrame.renderTextures = renderTextures.map((result) => result.broadcast);
  }

  if (processedFrame.framePreview && typeof processedFrame.framePreview === 'object') {
    const { stored, broadcast } = await persistFramePreview(
      sessionId,
      processedFrame.frameNumber,
      processedFrame.framePreview
    );
    storedFrame.framePreview = stored;
    broadcastFrame.framePreview = broadcast;
  }

  return { storedFrame, broadcastFrame };
}

async function removeFramePreviewFiles(sessionId, frames = []) {
  if (!Array.isArray(frames) || frames.length === 0) {
    return;
  }

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
      const filePath = path.join(PREVIEW_ROOT, sessionId, FRAME_PREVIEW_DIR, `${previewId}.png`);
      try {
        await fs.rm(filePath, { force: true });
      } catch (err) {
        console.warn('Failed to remove frame preview', previewUrl, err);
      }
    })
  );
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
  const session = await historyStore.getSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ message: 'Session not found' });
  }
  res.json(session);
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

  const filePath = path.join(PREVIEW_ROOT, sessionId, `${previewId}.png`);

  try {
    await fs.access(filePath);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(filePath);
  } catch (err) {
    return res.status(404).json({ message: 'Preview not found' });
  }
});

app.get('/sessions/:sessionId/frames/:previewId/preview', async (req, res) => {
  const { sessionId, previewId } = req.params;
  if (!previewId) {
    return res.status(400).json({ message: 'Preview id is required' });
  }

  const filePath = path.join(PREVIEW_ROOT, sessionId, FRAME_PREVIEW_DIR, `${previewId}.png`);

  try {
    await fs.access(filePath);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(filePath);
  } catch (err) {
    return res.status(404).json({ message: 'Preview not found' });
  }
});

app.post('/sessions/:sessionId/frames', async (req, res) => {
  const sessionId = req.params.sessionId;
  try {
    const { storedFrame, broadcastFrame } = await prepareFramePayload(sessionId, req.body);
    const { trimmedFrameCount, totalFrameCount, removedFrameCount, removedFrames } = await historyStore.appendFrame(
      sessionId,
      storedFrame
    );
    await removeFramePreviewFiles(sessionId, removedFrames);
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
