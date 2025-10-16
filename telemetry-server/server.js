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

// WebSocket server
const wss = new WebSocket.Server({ server });

// In-memory state
// clients: Map of ws -> {id, type}
const clients = new Map();
// per-client timeline: clientId -> array of frames
const timelines = {};
// per-client resource catalog: clientId -> {resourceId -> resourceMeta}
const resourceCatalog = {};

function broadcastToBrowsers(obj) {
  const str = JSON.stringify(obj);
  for (const [ws, info] of clients) {
    if (info.type === 'browser' && ws.readyState === WebSocket.OPEN) {
      ws.send(str);
    }
  }
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

    ws.on('message', (m) => handleWsMessage(ws, m, clientId));
    ws.on('close', () => { clients.delete(ws); console.log('[ws] closed', clientId); });
  });
});

function handleWsMessage(ws, msg, clientId) {
  let obj;
  try { obj = JSON.parse(msg); } catch (e) { console.warn('invalid json from', clientId); return; }

  if (obj.type === 'frame') {
    const thumb = obj.thumbnailUrl || obj.thumbnail || null;
    const frameEntry = {
      frameIndex: obj.frameIndex,
      timestamp: obj.timestamp || Date.now(),
      sceneName: obj.sceneName || obj.state || null,
      dt: obj.dt !== undefined ? obj.dt : null,
      metrics: obj.metrics || {},
      resources: obj.resources || [],
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
    // cap length
    if (timelines[clientId].length > 20000) timelines[clientId].shift();

    // if resources included as snapshot, merge into catalog
    if (obj.resourceSnapshot) {
      for (const r of obj.resourceSnapshot) {
        resourceCatalog[clientId][r.id] = r;
      }
    }

    // attach per-frame active resource ids -> we already did

    // broadcast to browsers
    broadcastToBrowsers({ type: 'frame', clientId, frame: frameEntry });
  } else if (obj.type === 'resource_snapshot') {
    if (Array.isArray(obj.resources)) {
      for (const r of obj.resources) resourceCatalog[clientId][r.id] = r;
    }
    broadcastToBrowsers({ type: 'resource_snapshot', clientId, resources: obj.resources });
  } else if (obj.type === 'ping') {
    ws.send(JSON.stringify({ type: 'pong', pongTime: Date.now() }));
  } else {
    // pass-through
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
