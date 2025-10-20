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

const PORT = process.env.PORT || 48080;
const PREVIEW_ROOT = path.join(process.cwd(), 'data', 'previews');
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
  },
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const historyStore = new HistoryStore();

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

function sanitizeFramePayload(payload) {
  const { textures = [], meshes = [], shaders = [], renderTextures = [], ...rest } = payload ?? {};
  return {
    ...rest,
    textures,
    meshes,
    renderTextures,
    shaders,
  };
}

function extractBase64Payload(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  const commaIndex = value.indexOf(',');
  if (commaIndex !== -1) {
    const prefix = value.slice(0, commaIndex);
    if (prefix.startsWith('data:')) {
      return value.slice(commaIndex + 1);
    }
  }

  return value;
}

async function persistTexturePreview(sessionId, texture) {
  if (!texture || typeof texture !== 'object') {
    return texture;
  }

  const payload = extractBase64Payload(texture.previewBase64 ?? '');
  if (!payload) {
    return texture;
  }

  try {
    const buffer = Buffer.from(payload, 'base64');
    if (!buffer || buffer.length === 0) {
      return texture;
    }

    const identifier = `${texture.name ?? 'unknown'}|${texture.width ?? 0}|${texture.height ?? 0}|${texture.formatName ?? texture.format ?? ''}`;
    const previewId = crypto.createHash('md5').update(identifier).digest('hex');
    const sessionDir = path.join(PREVIEW_ROOT, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `${previewId}.png`);
    await fs.writeFile(filePath, buffer);

    return {
      ...texture,
      previewUrl: `/sessions/${sessionId}/textures/${previewId}/preview`,
    };
  } catch (err) {
    console.warn('Failed to persist texture preview', err);
    return texture;
  }
}

async function prepareFramePayload(sessionId, payload) {
  const frame = sanitizeFramePayload(payload);
  if (Array.isArray(frame.textures) && frame.textures.length > 0) {
    frame.textures = await Promise.all(frame.textures.map((texture) => persistTexturePreview(sessionId, texture)));
  }
  return frame;
}

app.post('/sessions', async (req, res) => {
  try {
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    const session = await historyStore.createSession({
      id,
      createdAt,
      client: req.body,
    });
    res.json({ sessionId: id, createdAt });
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

app.get('/sessions/:sessionId', async (req, res) => {
  const session = await historyStore.getSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ message: 'Session not found' });
  }
  res.json(session);
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

app.post('/sessions/:sessionId/frames', async (req, res) => {
  const sessionId = req.params.sessionId;
  try {
    const frame = await prepareFramePayload(sessionId, req.body);
    await historyStore.appendFrame(sessionId, frame);
    res.status(204).end();
    io.emit('session:frame', { sessionId, frame });
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
  await historyStore.init();
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
