import express from 'express';
import http from 'http';
import cors from 'cors';
import os from 'os';
import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { HistoryStore } from './historyStore.js';

const PORT = process.env.PORT || 48080;
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
  const { textures = [], meshes = [], shaders = [], ...rest } = payload;
  return {
    ...rest,
    textures,
    meshes,
    shaders,
  };
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

app.post('/sessions/:sessionId/frames', async (req, res) => {
  const sessionId = req.params.sessionId;
  try {
    const frame = sanitizeFramePayload(req.body);
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

server.listen(PORT, async () => {
  await historyStore.init();
  console.log(`UnityProfileV2 server listening on port ${PORT}`);
});
