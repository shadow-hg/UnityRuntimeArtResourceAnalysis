const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;
const DATA_DIR = path.join(__dirname, 'data');
const THUMBS_DIR = path.join(DATA_DIR, 'thumbs');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(THUMBS_DIR)) fs.mkdirSync(THUMBS_DIR);

const app = express();
const server = http.createServer(app);

app.use((req, res, next) => {
  const allowedOrigin = process.env.CORS_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// WebSocket server
const wss = new WebSocket.Server({ server });

// In-memory state
// clients: Map of ws -> {id, type}
const clients = new Map();
// per-client timeline: clientId -> array of frames
const timelines = {};
// per-client resource catalog: clientId -> {resourceId -> resourceMeta}
const resourceCatalog = {};
const MAX_TIMELINE_LENGTH = 10000;

function broadcastToBrowsers(obj) {
  const str = JSON.stringify(obj);
  for (const [ws, info] of clients) {
    if (info.type === 'browser' && ws.readyState === WebSocket.OPEN) {
      ws.send(str);
    }
  }
}

function sendToUnity(targetIds, obj) {
  const payload = JSON.stringify(obj);
  const targetSet = Array.isArray(targetIds) && targetIds.length > 0 ? new Set(targetIds) : null;
  let delivered = 0;
  for (const [ws, info] of clients) {
    if (info.type !== 'unity') continue;
    if (targetSet && !targetSet.has(info.id)) continue;
    if (ws.readyState !== WebSocket.OPEN) continue;
    try {
      ws.send(payload);
      delivered += 1;
    } catch (error) {
      console.warn('control forward failed', info.id, error);
    }
  }
  return delivered;
}

wss.on('connection', (ws, req) => {
  // expect first message to be a hello specifying role
  ws.once('message', (msg) => {
    let obj;
    try { obj = JSON.parse(msg); } catch (e) { ws.close(1003, 'invalid json'); return; }
    const role = obj.role || 'unknown';
    const clientId = obj.clientId || `anon-${Math.random().toString(36).slice(2,8)}`;
    clients.set(ws, { id: clientId, type: role });
    console.log('[ws] connected', role, clientId);

    // send a hello ack
    ws.send(JSON.stringify({ type: 'hello', serverTime: Date.now(), clientId }));

    // initialize structures
    if (!timelines[clientId]) timelines[clientId] = [];
    if (!resourceCatalog[clientId]) resourceCatalog[clientId] = {};

    ws.on('message', (m) => handleWsMessage(ws, m));
    ws.on('close', () => { clients.delete(ws); console.log('[ws] closed', clientId); });
  });
});

function handleWsMessage(ws, msg) {
  const info = clients.get(ws);
  if (!info) return;
  const clientId = info.id;
  const role = info.type;
  let obj;
  try { obj = JSON.parse(msg); } catch (e) { console.warn('invalid json from', clientId || 'unknown'); return; }

  if (role === 'browser') {
    if (obj.type === 'control') {
      const targets = [];
      if (typeof obj.targetClientId === 'string' && obj.targetClientId) targets.push(obj.targetClientId);
      if (Array.isArray(obj.targetClientIds)) {
        for (const id of obj.targetClientIds) {
          if (typeof id === 'string' && id) targets.push(id);
        }
      }
      const uniqueTargets = Array.from(new Set(targets));
      const forwarded = { ...obj, sourceClientId: clientId, serverTime: Date.now() };
      const delivered = sendToUnity(uniqueTargets, forwarded);
      broadcastToBrowsers({
        type: 'control_forwarded',
        clientId,
        command: obj.command || null,
        payload: obj.payload ?? null,
        targetClientIds: uniqueTargets,
        delivered,
        serverTime: Date.now()
      });
      return;
    }
    if (obj.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', pongTime: Date.now() }));
    }
    return;
  }

  if (obj.type === 'frame') {
    const thumb = obj.thumbnailUrl || obj.thumbnail || null;
    const frameEntry = {
      frameIndex: obj.frameIndex,
      timestamp: obj.timestamp || Date.now(),
      sceneName: obj.sceneName || obj.state || null,
      dt: obj.dt !== undefined ? obj.dt : null,
      metrics: obj.metrics || {},
      resources: obj.resources || [],
      resourceStats: Array.isArray(obj.resourceStats) ? obj.resourceStats : [],
      resourceTotalKB: typeof obj.resourceTotalKB === 'number' ? obj.resourceTotalKB : 0,
      resourceCount: typeof obj.resourceCount === 'number' ? obj.resourceCount : (Array.isArray(obj.resources) ? obj.resources.length : 0),
      thumbnail: thumb,
      thumbnailUrl: thumb,
      buildVersion: obj.buildVersion || null
    };

    const passthroughKeys = [
      'camera',
      'quality',
      'events',
      'memory',
      'annotations',
      'tags',
      'notes',
      'playback',
      'device',
      'environment'
    ];
    for (const key of passthroughKeys) {
      if (obj[key] !== undefined) frameEntry[key] = obj[key];
    }
    timelines[clientId].push(frameEntry);
    if (timelines[clientId].length > MAX_TIMELINE_LENGTH) timelines[clientId].shift();

    if (obj.resourceSnapshot) {
      for (const r of obj.resourceSnapshot) {
        if (!r || !r.id) continue;
        const existing = resourceCatalog[clientId][r.id] || {};
        resourceCatalog[clientId][r.id] = { ...existing, ...r };
      }
    }

    broadcastToBrowsers({ type: 'frame', clientId, frame: frameEntry });
  } else if (obj.type === 'resource_snapshot') {
    const shouldReplace = obj.replace !== false;
    if (!resourceCatalog[clientId] || shouldReplace) {
      resourceCatalog[clientId] = {};
    }
    if (Array.isArray(obj.resources)) {
      for (const r of obj.resources) {
        if (!r || !r.id) continue;
        const existing = resourceCatalog[clientId][r.id] || {};
        resourceCatalog[clientId][r.id] = { ...existing, ...r };
      }
    }
    broadcastToBrowsers({ type: 'resource_snapshot', clientId, resources: obj.resources, replace: shouldReplace });
  } else if (obj.type === 'ping') {
    ws.send(JSON.stringify({ type: 'pong', pongTime: Date.now() }));
  } else if (obj.type === 'control_ack') {
    const ack = { ...obj, clientId: obj.clientId || clientId, serverTime: Date.now() };
    broadcastToBrowsers(ack);
  } else {
    broadcastToBrowsers({ type: 'message', clientId, payload: obj });
  }
}

// HTTP endpoints: static hosting for front-end (if placed in ../unity-telemetry-viewer/dist) and thumb upload
app.use('/static', express.static(path.join(__dirname, '..', 'unity-telemetry-viewer', 'dist')));

// basic admin endpoints
app.get('/api/clients', (req, res) => {
  const list = [];
  for (const [ws, info] of clients) list.push(info);
  res.json({ clients: list, timelines: Object.keys(timelines) });
});

app.get('/api/timeline/:clientId', (req, res) => {
  const id = req.params.clientId;
  res.json({ frames: timelines[id] || [] });
});

app.get('/api/catalog/:clientId', (req, res) => {
  const id = req.params.clientId;
  res.json({ catalog: resourceCatalog[id] || {} });
});

// thumbnail upload (multipart)
const upload = multer({ dest: THUMBS_DIR });
app.post('/upload/thumb', upload.single('thumb'), (req, res) => {
  // rename to clientid-frameIndex.jpg if provided
  const clientId = req.body.clientId || 'anon';
  const frameIndex = req.body.frameIndex || Date.now();
  const orig = req.file.path;
  const ext = path.extname(req.file.originalname) || '.jpg';
  const newName = `${clientId}-${frameIndex}${ext}`;
  const newPath = path.join(THUMBS_DIR, newName);
  fs.renameSync(orig, newPath);
  const url = `/thumbs/${newName}`;
  res.json({ url });
});

// serve thumbs
app.use('/thumbs', express.static(THUMBS_DIR));

server.listen(PORT, () => {
  console.log(`Telemetry server listening on http://0.0.0.0:${PORT}`);
});

// graceful handling
process.on('SIGINT', () => { console.log('shutting down'); server.close(); process.exit(0); });
