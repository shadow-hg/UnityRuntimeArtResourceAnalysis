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
// per-client session metadata
const currentSessions = {};
const sessionHistory = {};
const MAX_TIMELINE_LENGTH = 10000;
const MAX_SESSION_HISTORY = 20;

function sanitiseFilenameSegment(value, fallback) {
  const str = String(value ?? '').trim();
  const cleaned = str.replace(/[^a-zA-Z0-9_-]+/g, '_');
  return cleaned.length > 0 ? cleaned : fallback;
}

function normaliseFrameIndexValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const str = String(value).trim();
  if (!str) return null;
  const parsed = Number(str);
  return Number.isFinite(parsed) ? parsed : str;
}

function normaliseTimestampValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const str = String(value).trim();
  if (!str) return null;
  const parsed = Date.parse(str);
  return Number.isNaN(parsed) ? null : parsed;
}

function frameMatchesTarget(frame, target) {
  if (!frame || typeof frame !== 'object') return false;
  if (target.sessionId && frame.sessionId && frame.sessionId !== target.sessionId) return false;

  if (target.frameIndex !== null) {
    const frameIndex = normaliseFrameIndexValue(frame.frameIndex);
    if (frameIndex !== null) {
      if (typeof frameIndex === 'number' && typeof target.frameIndex === 'number' && frameIndex === target.frameIndex) {
        return true;
      }
      if (String(frameIndex) === String(target.frameIndex)) {
        return true;
      }
    }
  }

  if (target.timestamp !== null) {
    const frameTimestamp = normaliseTimestampValue(frame.timestamp);
    if (frameTimestamp !== null && frameTimestamp === target.timestamp) {
      return true;
    }
  }

  return false;
}

function applyThumbnailToTimelineFrames(clientId, target, url) {
  let updated = false;

  const updateFrames = (frames) => {
    if (!Array.isArray(frames)) return;
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const frame = frames[i];
      if (!frameMatchesTarget(frame, target)) continue;
      frame.thumbnail = url;
      frame.thumbnailUrl = url;
      updated = true;
      break;
    }
  };

  updateFrames(timelines[clientId]);

  const history = sessionHistory[clientId];
  if (Array.isArray(history)) {
    history.forEach((session) => {
      if (!session || (target.sessionId && session.sessionId !== target.sessionId)) return;
      updateFrames(session.frames);
    });
  }

  return updated;
}

function createSessionId(clientId) {
  const unique = Math.random().toString(36).slice(2, 10);
  return `${clientId}-${Date.now().toString(36)}-${unique}`;
}

function ensureSessionHistory(clientId) {
  if (!sessionHistory[clientId]) sessionHistory[clientId] = [];
  return sessionHistory[clientId];
}

function archiveCurrentSession(clientId, reason = 'archive') {
  const current = currentSessions[clientId];
  if (!current) return null;

  const frames = timelines[clientId] || [];
  const catalog = resourceCatalog[clientId] || {};
  const frameCount = frames.length;
  const resourceCount = Object.keys(catalog).length;

  if (frameCount === 0 && resourceCount === 0) {
    currentSessions[clientId] = null;
    return null;
  }

  const endedAt = Date.now();
  const record = {
    sessionId: current.sessionId,
    startedAt: current.startedAt,
    endedAt,
    frameCount,
    resourceCount,
    frames,
    catalog,
    reason
  };

  const history = ensureSessionHistory(clientId);
  history.unshift(record);
  while (history.length > MAX_SESSION_HISTORY) history.pop();

  currentSessions[clientId] = null;
  timelines[clientId] = [];
  resourceCatalog[clientId] = {};

  return record;
}

function beginNewSession(clientId, origin = 'connect') {
  const now = Date.now();
  const previous = archiveCurrentSession(clientId, 'superseded');
  const sessionId = createSessionId(clientId);
  timelines[clientId] = [];
  resourceCatalog[clientId] = {};
  currentSessions[clientId] = {
    sessionId,
    startedAt: now,
    frameCount: 0,
    resourceCount: 0,
    origin,
    archived: previous?.sessionId || null
  };
  return currentSessions[clientId];
}

function getSessionOverview(clientId) {
  const current = currentSessions[clientId];
  const history = ensureSessionHistory(clientId).map((entry) => ({
    sessionId: entry.sessionId,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    frameCount: entry.frameCount,
    resourceCount: entry.resourceCount,
    reason: entry.reason
  }));

  const currentSummary = current
    ? {
        sessionId: current.sessionId,
        startedAt: current.startedAt,
        frameCount: current.frameCount,
        resourceCount: current.resourceCount,
        origin: current.origin
      }
    : null;

  return { currentSession: currentSummary, history };
}

function broadcastSessionUpdate(clientId) {
  const overview = getSessionOverview(clientId);
  broadcastToBrowsers({ type: 'session_update', clientId, ...overview });
}

function resetClientData(clientId) {
  timelines[clientId] = [];
  resourceCatalog[clientId] = {};
}

function getSessionData(clientId, sessionId) {
  if (!clientId) return null;
  if (sessionId) {
    const current = currentSessions[clientId];
    if (current && current.sessionId === sessionId) {
      return {
        sessionId,
        frames: timelines[clientId] || [],
        catalog: resourceCatalog[clientId] || {},
        current: true
      };
    }
    const history = ensureSessionHistory(clientId);
    const record = history.find((entry) => entry.sessionId === sessionId);
    if (record) {
      return {
        sessionId,
        frames: record.frames || [],
        catalog: record.catalog || {},
        current: false,
        startedAt: record.startedAt,
        endedAt: record.endedAt
      };
    }
    return null;
  }

  const current = currentSessions[clientId];
  if (current) {
    return {
      sessionId: current.sessionId,
      frames: timelines[clientId] || [],
      catalog: resourceCatalog[clientId] || {},
      current: true
    };
  }

  return { sessionId: null, frames: [], catalog: {}, current: false };
}

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

    // initialize structures
    if (!timelines[clientId]) timelines[clientId] = [];
    if (!resourceCatalog[clientId]) resourceCatalog[clientId] = {};
    ensureSessionHistory(clientId);

    if (role === 'unity') {
      const session = beginNewSession(clientId, 'connect');
      broadcastSessionUpdate(clientId);
      console.log('[session] started', clientId, session.sessionId);
    }

    // send a hello ack
    ws.send(JSON.stringify({
      type: 'hello',
      serverTime: Date.now(),
      clientId,
      session: currentSessions[clientId] || null,
      sessions: getSessionOverview(clientId)
    }));

    if (role !== 'unity') {
      const knownClients = new Set([...Object.keys(currentSessions), ...Object.keys(sessionHistory), ...Object.keys(timelines)]);
      for (const knownClientId of knownClients) {
        try {
          ws.send(JSON.stringify({ type: 'session_update', clientId: knownClientId, ...getSessionOverview(knownClientId) }));
        } catch (error) {
          console.warn('failed to send session overview', knownClientId, error);
        }
      }
    }

    ws.on('message', (m) => handleWsMessage(ws, m));
    ws.on('close', () => {
      clients.delete(ws);
      console.log('[ws] closed', clientId);
      const info = { id: clientId, type: role };
      if (info.type === 'unity') {
        const archived = archiveCurrentSession(clientId, 'disconnect');
        if (archived) {
          console.log('[session] archived', clientId, archived.sessionId);
        }
        broadcastSessionUpdate(clientId);
      }
    });
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
    const session = currentSessions[clientId] || (role === 'unity' ? beginNewSession(clientId, 'frame') : null);
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
      buildVersion: obj.buildVersion || null,
      sessionId: session ? session.sessionId : null
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
    if (session) {
      const previousCount = session.frameCount || 0;
      session.frameCount = timelines[clientId].length;
      if (!previousCount && session.frameCount > 0) {
        broadcastSessionUpdate(clientId);
      }
    }

    if (obj.resourceSnapshot) {
      for (const r of obj.resourceSnapshot) {
        if (!r || !r.id) continue;
        const existing = resourceCatalog[clientId][r.id] || {};
        resourceCatalog[clientId][r.id] = { ...existing, ...r };
      }
    }

    broadcastToBrowsers({ type: 'frame', clientId, frame: frameEntry, sessionId: frameEntry.sessionId });
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
    const session = currentSessions[clientId];
    if (session) {
      const previousResourceCount = session.resourceCount || 0;
      session.resourceCount = Object.keys(resourceCatalog[clientId]).length;
      if (!previousResourceCount && session.resourceCount > 0) {
        broadcastSessionUpdate(clientId);
      }
    }
    broadcastToBrowsers({
      type: 'resource_snapshot',
      clientId,
      resources: obj.resources,
      replace: shouldReplace,
      sessionId: session ? session.sessionId : null
    });
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
  const sessions = {};
  const knownClients = new Set(Object.keys(timelines));
  Object.keys(currentSessions).forEach((id) => knownClients.add(id));
  Object.keys(sessionHistory).forEach((id) => knownClients.add(id));
  list.forEach((info) => { if (info?.id) knownClients.add(info.id); });
  for (const clientId of knownClients) {
    sessions[clientId] = getSessionOverview(clientId);
  }
  res.json({ clients: list, timelines: Object.keys(timelines), sessions });
});

app.get('/api/timeline/:clientId', (req, res) => {
  const id = req.params.clientId;
  const sessionId = req.query.sessionId ? String(req.query.sessionId) : null;
  const data = getSessionData(id, sessionId);
  res.json({ frames: data ? data.frames : [], sessionId: data ? data.sessionId : sessionId || null });
});

app.get('/api/catalog/:clientId', (req, res) => {
  const id = req.params.clientId;
  const sessionId = req.query.sessionId ? String(req.query.sessionId) : null;
  const data = getSessionData(id, sessionId);
  res.json({ catalog: data ? data.catalog : {}, sessionId: data ? data.sessionId : sessionId || null });
});

app.get('/api/sessions', (req, res) => {
  const summary = {};
  const knownClients = new Set(Object.keys(timelines));
  Object.keys(currentSessions).forEach((id) => knownClients.add(id));
  Object.keys(sessionHistory).forEach((id) => knownClients.add(id));
  for (const clientId of knownClients) {
    summary[clientId] = getSessionOverview(clientId);
  }
  res.json({ sessions: summary });
});

app.get('/api/sessions/:clientId', (req, res) => {
  const id = req.params.clientId;
  if (!id) {
    res.status(400).json({ error: 'clientId required' });
    return;
  }
  res.json(getSessionOverview(id));
});

// thumbnail upload (multipart)
const upload = multer({ dest: THUMBS_DIR });
app.post('/upload/thumb', upload.single('thumb'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'thumb file required' });
    return;
  }

  const rawClientId = typeof req.body.clientId === 'string' ? req.body.clientId : 'anon';
  const clientId = rawClientId && rawClientId.trim().length > 0 ? rawClientId.trim() : 'anon';
  const frameIndexValue = normaliseFrameIndexValue(req.body.frameIndex);
  const timestampValue = normaliseTimestampValue(req.body.timestamp);
  const sessionId =
    typeof req.body.sessionId === 'string' && req.body.sessionId.trim().length > 0
      ? req.body.sessionId.trim()
      : null;

  const safeClientSegment = sanitiseFilenameSegment(clientId, 'client');
  const frameSegmentSource =
    frameIndexValue !== null ? frameIndexValue : timestampValue !== null ? timestampValue : Date.now();
  const safeFrameSegment = sanitiseFilenameSegment(frameSegmentSource, Date.now().toString(36));

  const orig = req.file.path;
  const ext = path.extname(req.file.originalname || '') || '.jpg';
  const newName = `${safeClientSegment}-${safeFrameSegment}${ext}`;
  const newPath = path.join(THUMBS_DIR, newName);

  fs.renameSync(orig, newPath);

  const url = `/thumbs/${newName}`;
  const target = { frameIndex: frameIndexValue, timestamp: timestampValue, sessionId };
  const updated = applyThumbnailToTimelineFrames(clientId, target, url);

  if (updated) {
    broadcastToBrowsers({
      type: 'frame_thumbnail',
      clientId,
      sessionId,
      frameIndex: frameIndexValue,
      timestamp: timestampValue,
      url
    });
  }

  res.json({ url, clientId, frameIndex: frameIndexValue, timestamp: timestampValue, sessionId, updated });
});

// serve thumbs
app.use('/thumbs', express.static(THUMBS_DIR));

server.listen(PORT, () => {
  console.log(`Telemetry server listening on http://0.0.0.0:${PORT}`);
});

// graceful handling
process.on('SIGINT', () => { console.log('shutting down'); server.close(); process.exit(0); });
