import { promises as fs } from 'fs';
import path from 'path';
import { gzip as gzipCallback } from 'zlib';
import { promisify } from 'util';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'telemetry-history.json');
const HISTORY_LOG_FILE = path.join(DATA_DIR, 'telemetry-history.log');
const LOG_ARCHIVE_DIR = path.join(DATA_DIR, 'log-archive');
const LOG_COMPACTION_THRESHOLD = 200;
const LOG_SIZE_CHECK_FREQUENCY = 25;
const LOG_SIZE_THRESHOLD_BYTES = 5 * 1024 * 1024;

const gzip = promisify(gzipCallback);
const DEFAULT_MAX_SESSION_FRAMES = 10000;

async function ensureDataDirectory() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function ensureLogArchiveDirectory() {
  await fs.mkdir(LOG_ARCHIVE_DIR, { recursive: true });
}

function ensureNumeric(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function ensurePositiveInteger(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.round(value);
  if (rounded <= 0) {
    return fallback;
  }
  return rounded;
}

function getFrameLimit(options) {
  const limit = ensurePositiveInteger(options?.maxSessionFrames, DEFAULT_MAX_SESSION_FRAMES);
  return limit;
}

function trimFrames(session, options) {
  if (!Array.isArray(session.frames)) {
    session.frames = [];
    return { removedFrames: [], removedCount: 0 };
  }

  session.trimmedFrameCount = ensureNumeric(session.trimmedFrameCount, 0);
  session.totalFrameCount = ensureNumeric(
    session.totalFrameCount,
    session.trimmedFrameCount + session.frames.length
  );

  const maxSessionFrames = getFrameLimit(options);
  const overflow = session.frames.length - maxSessionFrames;
  let removedFrames = [];
  if (overflow > 0) {
    removedFrames = session.frames.splice(0, overflow);
    session.trimmedFrameCount += overflow;
  }

  const visible = session.frames.length;
  const expectedTotal = session.trimmedFrameCount + visible;
  if (session.totalFrameCount < expectedTotal) {
    session.totalFrameCount = expectedTotal;
  }

  return { removedFrames, removedCount: removedFrames.length };
}

function normalizeSession(session, options) {
  if (!Array.isArray(session.frames)) {
    session.frames = [];
  }
  session.trimmedFrameCount = ensureNumeric(session.trimmedFrameCount, 0);
  session.totalFrameCount = ensureNumeric(
    session.totalFrameCount,
    session.trimmedFrameCount + session.frames.length
  );
  trimFrames(session, options);
  return session;
}

function deepClonePlain(value) {
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    return null;
  }
}

function sanitizeSessionForLog(session) {
  if (!session || typeof session !== 'object') {
    return null;
  }

  const payload = {
    id: session.id,
    createdAt: session.createdAt,
    client: deepClonePlain(session.client) ?? null,
    clientIp: session.clientIp ?? null,
    trimmedFrameCount: ensureNumeric(session.trimmedFrameCount, 0),
    totalFrameCount: ensureNumeric(session.totalFrameCount, 0),
  };

  if (typeof session.closedAt === 'string' && session.closedAt.length > 0) {
    payload.closedAt = session.closedAt;
  }

  return payload;
}

function sanitizeFrameForLog(frame) {
  if (frame == null) {
    return null;
  }
  const clone = deepClonePlain(frame);
  if (clone == null) {
    return null;
  }
  return clone;
}

async function readBaseHistory() {
  try {
    const file = await fs.readFile(DATA_FILE, 'utf-8');
    try {
      return JSON.parse(file);
    } catch (parseErr) {
      if (parseErr instanceof SyntaxError) {
        const corruptPath = `${DATA_FILE}.corrupt-${Date.now()}`;
        try {
          await fs.rename(DATA_FILE, corruptPath);
          console.warn(
            `Telemetry history file was corrupt and has been moved to ${path.basename(corruptPath)}.`
          );
        } catch (renameErr) {
          console.warn(
            `Telemetry history file was corrupt but could not be moved: ${renameErr.message}`
          );
        }
        return { sessions: [] };
      }
      throw parseErr;
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { sessions: [] };
    }
    throw err;
  }
}

async function readHistoryLogEntries() {
  try {
    const file = await fs.readFile(HISTORY_LOG_FILE, 'utf-8');
    return file
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch (err) {
          console.warn(`Failed to parse telemetry history log entry at line ${index + 1}:`, err);
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

async function writeHistory(history) {
  await ensureDataDirectory();
  const tempPath = `${DATA_FILE}.tmp-${process.pid}-${Date.now()}`;

  const handle = await fs.open(tempPath, 'w');

  async function writeSession(session) {
    const entries = Object.entries(session).filter(([, value]) =>
      typeof value !== 'function' && typeof value !== 'undefined'
    );
    await handle.write('{');
    let first = true;
    for (const [key, value] of entries) {
      if (!first) {
        await handle.write(',');
      }
      if (key === 'frames') {
        const frames = Array.isArray(value) ? value : [];
        await handle.write(`${JSON.stringify(key)}:[`);
        for (let i = 0; i < frames.length; i += 1) {
          if (i > 0) {
            await handle.write(',');
          }
          await handle.write(JSON.stringify(frames[i]));
        }
        await handle.write(']');
      } else {
        await handle.write(`${JSON.stringify(key)}:${JSON.stringify(value)}`);
      }
      first = false;
    }
    await handle.write('}');
  }

  try {
    await handle.write('{"sessions":[');
    for (let i = 0; i < history.sessions.length; i += 1) {
      if (i > 0) {
        await handle.write(',');
      }
      await writeSession(history.sessions[i]);
    }
    await handle.write(']}');
  } finally {
    await handle.close();
  }

  try {
    await fs.rename(tempPath, DATA_FILE);
  } catch (err) {
    if (err.code === 'EEXIST') {
      await fs.rm(DATA_FILE, { force: true });
      await fs.rename(tempPath, DATA_FILE);
    } else {
      await fs.rm(tempPath, { force: true });
      throw err;
    }
  }
}

async function archiveHistoryLog() {
  try {
    const buffer = await fs.readFile(HISTORY_LOG_FILE);
    if (!buffer || buffer.length === 0) {
      await fs.rm(HISTORY_LOG_FILE, { force: true });
      return;
    }

    await ensureLogArchiveDirectory();
    const compressed = await gzip(buffer);
    const archiveName = `telemetry-history-${Date.now()}.log.gz`;
    const archivePath = path.join(LOG_ARCHIVE_DIR, archiveName);
    await fs.writeFile(archivePath, compressed);
    await fs.rm(HISTORY_LOG_FILE, { force: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return;
    }
    console.warn('Failed to archive telemetry history log', err);
    try {
      await fs.rm(HISTORY_LOG_FILE, { force: true });
    } catch (removeErr) {
      if (removeErr.code !== 'ENOENT') {
        console.warn('Failed to remove telemetry history log after archive failure', removeErr);
      }
    }
  }
}

function applyLogEntry(history, entry, options) {
  if (!entry || typeof entry !== 'object') {
    return;
  }

  const sessions = Array.isArray(history.sessions) ? history.sessions : [];

  switch (entry.type) {
    case 'createSession': {
      if (!entry.session || typeof entry.session !== 'object' || !entry.session.id) {
        console.warn('Skipping invalid telemetry history log session creation entry');
        break;
      }
      const normalizedSession = normalizeSession(
        {
          id: entry.session?.id,
          createdAt: entry.session?.createdAt,
          client: entry.session?.client ?? null,
          clientIp: entry.session?.clientIp ?? null,
          frames: [],
          trimmedFrameCount: ensureNumeric(entry.session?.trimmedFrameCount, 0),
          totalFrameCount: ensureNumeric(entry.session?.totalFrameCount, 0),
          closedAt:
            typeof entry.session?.closedAt === 'string' && entry.session.closedAt.length > 0
              ? entry.session.closedAt
              : undefined,
        },
        options
      );

      const existingIndex = sessions.findIndex((session) => session.id === normalizedSession.id);
      if (existingIndex >= 0) {
        sessions[existingIndex] = normalizedSession;
      } else {
        sessions.push(normalizedSession);
      }
      break;
    }
    case 'appendFrame': {
      const session = sessions.find((item) => item.id === entry.sessionId);
      if (!session) {
        break;
      }

      if (!Array.isArray(session.frames)) {
        session.frames = [];
      }

      const previousTotal = ensureNumeric(
        session.totalFrameCount,
        ensureNumeric(session.trimmedFrameCount, 0) + session.frames.length
      );

      const frameClone = sanitizeFrameForLog(entry.frame);

      session.totalFrameCount = previousTotal + 1;
      session.frames.push(frameClone);
      trimFrames(session, options);
      break;
    }
    case 'closeSession': {
      const session = sessions.find((item) => item.id === entry.sessionId);
      if (session) {
        session.closedAt =
          typeof entry.closedAt === 'string' && entry.closedAt.length > 0
            ? entry.closedAt
            : new Date().toISOString();
      }
      break;
    }
    case 'clearHistory':
      history.sessions = [];
      break;
    case 'deleteSession': {
      const index = sessions.findIndex((item) => item.id === entry.sessionId);
      if (index !== -1) {
        sessions.splice(index, 1);
      }
      break;
    }
    default:
      break;
  }
}

function applyLogEntries(history, entries, options) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return;
  }

  for (const entry of entries) {
    try {
      applyLogEntry(history, entry, options);
    } catch (err) {
      console.warn('Failed to apply telemetry history log entry', entry?.type, err);
    }
  }
}

export class HistoryStore {
  constructor(options = {}) {
    this.history = { sessions: [] };
    this.initialized = false;
    this.configStore = options.configStore ?? null;
    this.operationsSinceCompact = 0;
    this.compactPromise = null;
  }

  getConfigOptions() {
    const historyConfig = this.configStore?.getHistoryConfig?.();
    return { maxSessionFrames: historyConfig?.maxSessionFrames ?? DEFAULT_MAX_SESSION_FRAMES };
  }

  async appendLogOperation(operation) {
    if (!operation || typeof operation !== 'object') {
      return;
    }

    let serialized;
    try {
      serialized = JSON.stringify(operation);
    } catch (err) {
      console.warn('Failed to serialize telemetry history log operation', err);
      return;
    }
    await ensureDataDirectory();
    await fs.appendFile(HISTORY_LOG_FILE, `${serialized}\n`);
    this.operationsSinceCompact += 1;
  }

  async ensureCompaction(force = false) {
    if (force) {
      await this.compactHistorySnapshot();
      return;
    }

    if (this.operationsSinceCompact >= LOG_COMPACTION_THRESHOLD) {
      await this.compactHistorySnapshot();
      return;
    }

    if (
      this.operationsSinceCompact > 0 &&
      this.operationsSinceCompact % LOG_SIZE_CHECK_FREQUENCY === 0
    ) {
      try {
        const stats = await fs.stat(HISTORY_LOG_FILE);
        if (stats.size >= LOG_SIZE_THRESHOLD_BYTES) {
          await this.compactHistorySnapshot();
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.warn('Failed to inspect telemetry history log size', err);
        }
      }
    }
  }

  async compactHistorySnapshot() {
    if (this.compactPromise) {
      return this.compactPromise;
    }

    this.compactPromise = (async () => {
      await writeHistory(this.history);
      await archiveHistoryLog();
      this.operationsSinceCompact = 0;
    })();

    try {
      await this.compactPromise;
    } finally {
      this.compactPromise = null;
    }
  }

  async init() {
    if (this.initialized) return;
    await ensureDataDirectory();
    const baseHistory = await readBaseHistory();
    if (!Array.isArray(baseHistory.sessions)) {
      baseHistory.sessions = [];
    }
    const options = this.getConfigOptions();
    baseHistory.sessions = baseHistory.sessions.map((session) => normalizeSession(session, options));
    const logEntries = await readHistoryLogEntries();
    applyLogEntries(baseHistory, logEntries, options);
    this.history = baseHistory;
    this.operationsSinceCompact = logEntries.length;
    await this.ensureCompaction();
    this.initialized = true;
  }

  async createSession(metadata) {
    await this.init();
    const options = this.getConfigOptions();
    const session = normalizeSession({
      id: metadata.id,
      createdAt: metadata.createdAt,
      client: metadata.client,
      clientIp: metadata.clientIp ?? null,
      frames: [],
      trimmedFrameCount: 0,
      totalFrameCount: 0,
    }, options);
    this.history.sessions.push(session);
    const sessionLog = sanitizeSessionForLog(session);
    if (sessionLog) {
      await this.appendLogOperation({ type: 'createSession', session: sessionLog });
      await this.ensureCompaction();
    } else {
      console.warn('Unable to serialize telemetry session for history log, forcing snapshot rewrite');
      await this.compactHistorySnapshot();
    }
    return session;
  }

  async appendFrame(sessionId, frame) {
    await this.init();
    const options = this.getConfigOptions();
    const session = this.history.sessions.find((s) => s.id === sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    if (!Array.isArray(session.frames)) {
      session.frames = [];
    }
    const previousTotal = ensureNumeric(
      session.totalFrameCount,
      ensureNumeric(session.trimmedFrameCount, 0) + session.frames.length
    );
    session.totalFrameCount = previousTotal + 1;
    session.frames.push(frame);
    const { removedFrames, removedCount } = trimFrames(session, options);
    const frameLog = sanitizeFrameForLog(frame);
    if (frame != null && frameLog == null) {
      console.warn('Unable to serialize telemetry frame for history log, forcing snapshot rewrite');
      await this.compactHistorySnapshot();
    } else {
      await this.appendLogOperation({
        type: 'appendFrame',
        sessionId,
        frame: frameLog,
      });
      await this.ensureCompaction();
    }
    return {
      frame,
      trimmedFrameCount: session.trimmedFrameCount,
      totalFrameCount: session.totalFrameCount,
      removedFrameCount: removedCount,
      removedFrames,
    };
  }

  async closeSession(sessionId) {
    await this.init();
    const session = this.history.sessions.find((s) => s.id === sessionId);
    if (session) {
      session.closedAt = new Date().toISOString();
      await this.appendLogOperation({
        type: 'closeSession',
        sessionId,
        closedAt: session.closedAt,
      });
      await this.ensureCompaction();
    }
    return session;
  }

  async listSessions() {
    await this.init();
    return this.history.sessions;
  }

  async getSession(sessionId) {
    await this.init();
    return this.history.sessions.find((s) => s.id === sessionId) || null;
  }

  async applyConfig(config) {
    await this.init();
    const options = {
      maxSessionFrames: config?.history?.maxSessionFrames ?? this.getConfigOptions().maxSessionFrames,
    };
    let changed = false;
    for (const session of this.history.sessions) {
      const beforeLength = session.frames?.length ?? 0;
      const beforeTrimmed = session.trimmedFrameCount ?? 0;
      normalizeSession(session, options);
      if (
        (session.frames?.length ?? 0) !== beforeLength ||
        (session.trimmedFrameCount ?? 0) !== beforeTrimmed
      ) {
        changed = true;
      }
    }
    if (changed) {
      await this.compactHistorySnapshot();
    }
  }

  async clearHistory() {
    await this.init();
    this.history.sessions = [];
    await this.appendLogOperation({ type: 'clearHistory' });
    await this.ensureCompaction(true);
  }

  async deleteSession(sessionId) {
    await this.init();
    const index = this.history.sessions.findIndex((session) => session.id === sessionId);
    if (index === -1) {
      return null;
    }

    const [removed] = this.history.sessions.splice(index, 1);
    await this.appendLogOperation({ type: 'deleteSession', sessionId });
    await this.ensureCompaction(true);
    return removed || null;
  }
}
