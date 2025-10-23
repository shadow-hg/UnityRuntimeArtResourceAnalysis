import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Database from 'better-sqlite3';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(moduleDir, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'telemetry-history.db');
const SESSION_DB_DIR = path.join(DATA_DIR, 'sessions');
const SESSION_DB_SIZE_LIMIT_BYTES = 800 * 1024 * 1024;
const SESSION_DB_PART_PADDING = 4;
const DEFAULT_MAX_SESSION_FRAMES = 10000;
const SCHEMA_VERSION = 1;

const PRAGMA_SETTINGS = [
  { statement: 'journal_mode = WAL' },
  { statement: 'synchronous = NORMAL' },
  { statement: 'foreign_keys = ON' },
  { statement: 'busy_timeout = 5000' },
  { statement: 'temp_store = MEMORY' },
];

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

function parseJson(value, fallback = null) {
  if (typeof value !== 'string' || value.length === 0) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function serializeJson(value) {
  if (value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

function normalizeSessionRow(row, { frames = [], includeFrames = true } = {}) {
  const sessionFrames = Array.isArray(frames) ? frames : [];
  const trimmedFrameCount = ensureNumeric(row.trimmedFrameCount, 0);
  const totalFrameCount = ensureNumeric(
    row.totalFrameCount,
    trimmedFrameCount + sessionFrames.length
  );

  const session = {
    id: row.id,
    createdAt: row.createdAt,
    client: parseJson(row.client, null),
    clientIp: row.clientIp ?? null,
    trimmedFrameCount,
    totalFrameCount,
  };

  if (includeFrames) {
    session.frames = sessionFrames;
  }

  if (row.closedAt) {
    session.closedAt = row.closedAt;
  }

  return session;
}

function parseFrameRow(row) {
  return parseJson(row.payload, null);
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function ensureSessionDbDir() {
  await ensureDataDir();
  await fs.mkdir(SESSION_DB_DIR, { recursive: true });
}

function sanitizeForFilename(value) {
  return String(value ?? '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
}

function getSessionStorageKey(sessionId) {
  const sanitizedId = sanitizeForFilename(sessionId);
  const hash = crypto.createHash('sha256').update(String(sessionId ?? 'unknown')).digest('hex').slice(0, 12);
  return `${sanitizedId}-${hash}`;
}

function formatSessionDbPart(part) {
  return String(part).padStart(SESSION_DB_PART_PADDING, '0');
}

function getSessionDbBasename(sessionId, part) {
  const key = getSessionStorageKey(sessionId);
  return `${key}-part${formatSessionDbPart(part)}.db`;
}

function getSessionDbPath(sessionId, part) {
  const basename = getSessionDbBasename(sessionId, part);
  return path.join(SESSION_DB_DIR, basename);
}

function parseSessionDbPart(sessionId, filename) {
  const key = getSessionStorageKey(sessionId).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const pattern = new RegExp(`^${key}-part(\\d{${SESSION_DB_PART_PADDING}})\\.db$`);
  const match = filename.match(pattern);
  if (!match) {
    return null;
  }
  const part = Number.parseInt(match[1], 10);
  return Number.isFinite(part) ? part : null;
}

export class HistoryStore {
  constructor(options = {}) {
    this.configStore = options.configStore ?? null;
    this.initialized = false;
    this.db = null;
    this.statements = null;
    this.operationsSinceOptimize = 0;
    this.sessionStores = new Map();
    this.sessionPartsCache = new Map();
  }

  getConfigOptions() {
    const historyConfig = this.configStore?.getHistoryConfig?.();
    return { maxSessionFrames: historyConfig?.maxSessionFrames ?? DEFAULT_MAX_SESSION_FRAMES };
  }

  async init() {
    if (this.initialized) {
      return;
    }

    await ensureDataDir();
    await ensureSessionDbDir();
    this.db = new Database(DB_FILE);
    for (const pragma of PRAGMA_SETTINGS) {
      try {
        this.db.pragma(pragma.statement);
      } catch (err) {
        console.warn(`Failed to apply pragma ${pragma.statement}`, err);
      }
    }

    this.applyMigrations();
    this.prepareStatements();
    this.initialized = true;
  }

  applyMigrations() {
    const currentVersion = this.db.pragma('user_version', { simple: true });
    if (currentVersion === SCHEMA_VERSION) {
      return;
    }

    if (currentVersion === 0) {
      this.createSchema();
      return;
    }

    if (currentVersion > SCHEMA_VERSION) {
      throw new Error(
        `History database version (${currentVersion}) is newer than supported version (${SCHEMA_VERSION}).`
      );
    }

    this.performMigrations(currentVersion);
  }

  createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        createdAt TEXT NOT NULL,
        client TEXT,
        clientIp TEXT,
        trimmedFrameCount INTEGER NOT NULL DEFAULT 0,
        totalFrameCount INTEGER NOT NULL DEFAULT 0,
        closedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS frames (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId TEXT NOT NULL,
        frameIndex INTEGER NOT NULL,
        payload TEXT NOT NULL,
        FOREIGN KEY(sessionId) REFERENCES sessions(id) ON DELETE CASCADE,
        UNIQUE(sessionId, frameIndex)
      );

      CREATE INDEX IF NOT EXISTS idx_frames_session ON frames(sessionId, frameIndex);
    `);

    this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

  performMigrations(_currentVersion) {
    this.db.transaction(() => {
      // Placeholder for future migrations. Currently we only have version 1.
    })();

    this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

  prepareStatements() {
    this.statements = {
      insertSession: this.db.prepare(
        `INSERT INTO sessions (id, createdAt, client, clientIp, trimmedFrameCount, totalFrameCount, closedAt)
         VALUES (@id, @createdAt, @client, @clientIp, @trimmedFrameCount, @totalFrameCount, @closedAt)`
      ),
      selectSession: this.db.prepare(
        `SELECT id, createdAt, client, clientIp, trimmedFrameCount, totalFrameCount, closedAt
         FROM sessions WHERE id = ?`
      ),
      selectAllSessions: this.db.prepare(
        `SELECT id, createdAt, client, clientIp, trimmedFrameCount, totalFrameCount, closedAt
         FROM sessions ORDER BY datetime(createdAt) ASC, id ASC`
      ),
      updateSessionCounts: this.db.prepare(
        `UPDATE sessions SET totalFrameCount = @totalFrameCount, trimmedFrameCount = @trimmedFrameCount WHERE id = @id`
      ),
      updateSessionClosedAt: this.db.prepare(
        `UPDATE sessions SET closedAt = @closedAt WHERE id = @id`
      ),
      deleteSession: this.db.prepare(`DELETE FROM sessions WHERE id = ?`),
      deleteAllSessions: this.db.prepare(`DELETE FROM sessions`),
    };
  }

  async loadSessionParts(sessionId) {
    if (this.sessionPartsCache.has(sessionId)) {
      return this.sessionPartsCache.get(sessionId);
    }

    await ensureSessionDbDir();
    let entries = [];
    try {
      entries = await fs.readdir(SESSION_DB_DIR);
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.warn(`Failed to read session database directory`, err);
      }
      entries = [];
    }

    const parts = entries
      .map((entry) => parseSessionDbPart(sessionId, entry))
      .filter((part) => Number.isInteger(part))
      .sort((a, b) => a - b);

    this.sessionPartsCache.set(sessionId, parts);
    return parts;
  }

  async registerSessionPart(sessionId, part) {
    const parts = await this.loadSessionParts(sessionId);
    if (!parts.includes(part)) {
      parts.push(part);
      parts.sort((a, b) => a - b);
      this.sessionPartsCache.set(sessionId, parts);
    }
    return parts;
  }

  async unregisterSessionPart(sessionId, part) {
    const parts = await this.loadSessionParts(sessionId);
    const next = parts.filter((value) => value !== part);
    this.sessionPartsCache.set(sessionId, next);
  }

  async clearSessionParts(sessionId) {
    this.sessionPartsCache.delete(sessionId);
  }

  async removeSessionDatabases(sessionId) {
    this.closeSessionStore(sessionId);
    const parts = await this.loadSessionParts(sessionId);
    for (const part of parts) {
      const filePath = getSessionDbPath(sessionId, part);
      try {
        await fs.unlink(filePath);
      } catch (err) {
        if (err && err.code !== 'ENOENT') {
          console.warn(`Failed to remove session database ${filePath}`, err);
        }
      }
    }
    await this.clearSessionParts(sessionId);
  }

  async removeAllSessionDatabases() {
    for (const sessionId of Array.from(this.sessionStores.keys())) {
      this.closeSessionStore(sessionId);
    }
    const sessionIds = Array.from(this.sessionPartsCache.keys());
    for (const sessionId of sessionIds) {
      await this.removeSessionDatabases(sessionId);
    }
    this.sessionStores.clear();
    this.sessionPartsCache.clear();
    try {
      await fs.rm(SESSION_DB_DIR, { recursive: true, force: true });
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.warn('Failed to remove session database directory', err);
      }
    }
    await ensureSessionDbDir();
  }

  createSessionDb(sessionId, part, { readOnly = false } = {}) {
    const dbPath = getSessionDbPath(sessionId, part);
    const options = readOnly ? { readonly: true, fileMustExist: true } : {};
    let db;
    try {
      db = new Database(dbPath, options);
    } catch (err) {
      if (readOnly && err && err.code === 'SQLITE_CANTOPEN') {
        throw new Error(`Session database ${dbPath} is missing`);
      }
      throw err;
    }
    for (const pragma of PRAGMA_SETTINGS) {
      try {
        db.pragma(pragma.statement);
      } catch (err) {
        if (!readOnly) {
          console.warn(`Failed to apply session pragma ${pragma.statement}`, err);
        }
      }
    }

    if (!readOnly) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS frames (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          frameIndex INTEGER NOT NULL,
          payload TEXT NOT NULL,
          UNIQUE(frameIndex)
        );

        CREATE INDEX IF NOT EXISTS idx_frames_frame_index ON frames(frameIndex ASC);

        CREATE TABLE IF NOT EXISTS previews (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          previewId TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL,
          mimeType TEXT NOT NULL,
          frameIndex INTEGER,
          data BLOB NOT NULL,
          createdAt TEXT NOT NULL DEFAULT (datetime('now')),
          updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_previews_kind ON previews(kind);
        CREATE INDEX IF NOT EXISTS idx_previews_frame_index ON previews(frameIndex);
      `);
    }

    const statements = {
      insertFrame: db.prepare(
        `INSERT INTO frames (frameIndex, payload) VALUES (@frameIndex, @payload)`
      ),
      selectFrames: db.prepare(`SELECT frameIndex, payload FROM frames ORDER BY frameIndex ASC`),
      selectOldestFrames: db.prepare(
        `SELECT id, frameIndex, payload FROM frames ORDER BY frameIndex ASC LIMIT ?`
      ),
      deleteFramesByIdSet: db.prepare(`DELETE FROM frames WHERE id IN (SELECT value FROM json_each(?))`),
      countFrames: db.prepare(`SELECT COUNT(*) as count FROM frames`),
      selectLastFrame: db.prepare(
        `SELECT frameIndex, payload FROM frames ORDER BY frameIndex DESC LIMIT 1`
      ),
      insertPreview: db.prepare(`
        INSERT INTO previews (previewId, kind, mimeType, frameIndex, data, createdAt, updatedAt)
        VALUES (@previewId, @kind, @mimeType, @frameIndex, @data, datetime('now'), datetime('now'))
        ON CONFLICT(previewId) DO UPDATE SET
          kind = excluded.kind,
          mimeType = excluded.mimeType,
          frameIndex = excluded.frameIndex,
          data = excluded.data,
          updatedAt = datetime('now')
      `),
      selectPreview: db.prepare(
        `SELECT previewId, kind, mimeType, frameIndex, data FROM previews WHERE previewId = ?`
      ),
      deletePreview: db.prepare(`DELETE FROM previews WHERE previewId = ?`),
      deletePreviewsByIdSet: db.prepare(
        `DELETE FROM previews WHERE previewId IN (SELECT value FROM json_each(?))`
      ),
    };

    return {
      sessionId,
      part,
      db,
      path: dbPath,
      statements,
    };
  }

  async ensureSessionStore(sessionId) {
    await ensureSessionDbDir();
    let store = this.sessionStores.get(sessionId);
    if (store) {
      return store;
    }

    const parts = await this.loadSessionParts(sessionId);
    const activePart = parts.length > 0 ? parts[parts.length - 1] : 1;
    store = this.createSessionDb(sessionId, activePart);
    store.parts = parts.length > 0 ? [...parts] : [activePart];
    this.sessionStores.set(sessionId, store);
    await this.registerSessionPart(sessionId, activePart);
    return store;
  }

  async rotateSessionStore(sessionId) {
    const current = await this.ensureSessionStore(sessionId);
    const nextPart = current.part + 1;
    try {
      current.db.close();
    } catch (err) {
      console.warn(`Failed to close session database for rotation`, err);
    }
    const store = this.createSessionDb(sessionId, nextPart);
    const previousParts = Array.isArray(current.parts) ? [...current.parts] : [];
    if (!previousParts.includes(nextPart)) {
      previousParts.push(nextPart);
    }
    store.parts = previousParts;
    this.sessionStores.set(sessionId, store);
    await this.registerSessionPart(sessionId, nextPart);
    return store;
  }

  closeSessionStore(sessionId) {
    const store = this.sessionStores.get(sessionId);
    if (!store) {
      return;
    }
    try {
      store.db.close();
    } catch (err) {
      console.warn(`Failed to close session database for ${sessionId}`, err);
    }
    this.sessionStores.delete(sessionId);
  }

  async getSessionStoreParts(sessionId) {
    const store = this.sessionStores.get(sessionId);
    if (store && Array.isArray(store.parts)) {
      return [...store.parts];
    }
    const parts = await this.loadSessionParts(sessionId);
    if (store) {
      store.parts = [...parts];
    }
    return parts;
  }

  async getSessionFramesFromPart(sessionId, part, store) {
    const useStore = store && store.part === part ? store : null;
    if (useStore) {
      const rows = useStore.statements.selectFrames.all();
      return rows.map((row) => parseFrameRow(row));
    }

    let tempStore;
    try {
      tempStore = this.createSessionDb(sessionId, part, { readOnly: true });
    } catch (err) {
      console.warn(`Failed to open session database ${sessionId} part ${part} for reading`, err);
      return [];
    }
    try {
      const rows = tempStore.statements.selectFrames.all();
      return rows.map((row) => parseFrameRow(row));
    } finally {
      try {
        tempStore.db.close();
      } catch (err) {
        console.warn(`Failed to close temporary session database for ${sessionId}`, err);
      }
    }
  }

  async prepareSessionStoreForInsert(sessionId, payloadSize) {
    let store = await this.ensureSessionStore(sessionId);
    try {
      const stats = await fs.stat(store.path);
      if (stats && Number.isFinite(stats.size) && stats.size + payloadSize > SESSION_DB_SIZE_LIMIT_BYTES) {
        store = await this.rotateSessionStore(sessionId);
      }
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.warn(`Failed to stat session database ${store.path}`, err);
      }
      if (err && err.code === 'ENOENT') {
        store = await this.rotateSessionStore(sessionId);
      }
    }
    return store;
  }

  async ensurePostInsertCapacity(sessionId, store) {
    try {
      const stats = await fs.stat(store.path);
      if (stats && Number.isFinite(stats.size) && stats.size >= SESSION_DB_SIZE_LIMIT_BYTES) {
        await this.rotateSessionStore(sessionId);
      }
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.warn(`Failed to perform post-insert capacity check for ${store.path}`, err);
      }
    }
  }

  getSessionRow(sessionId) {
    return this.statements.selectSession.get(sessionId) ?? null;
  }

  async getSessionFrames(sessionId) {
    await this.init();
    const store = this.sessionStores.get(sessionId) ?? null;
    const parts = await this.getSessionStoreParts(sessionId);
    const frames = [];
    for (const part of parts) {
      const partFrames = await this.getSessionFramesFromPart(sessionId, part, store);
      frames.push(...partFrames);
    }
    return frames;
  }

  async savePreview(sessionId, { previewId, kind = 'texture', mimeType = 'image/png', frameIndex = null, data } = {}) {
    if (!previewId || !data) {
      return false;
    }

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (!buffer || buffer.length === 0) {
      return false;
    }

    await this.init();

    let numericFrameIndex = null;
    if (typeof frameIndex === 'number' && Number.isFinite(frameIndex)) {
      numericFrameIndex = Math.round(frameIndex);
    }

    try {
      const store = await this.prepareSessionStoreForInsert(sessionId, buffer.length);
      store.statements.insertPreview.run({
        previewId,
        kind,
        mimeType,
        frameIndex: numericFrameIndex,
        data: buffer,
      });
      await this.ensurePostInsertCapacity(sessionId, store);
      this.trackWriteOperation();
      return true;
    } catch (err) {
      console.warn(`Failed to persist preview ${previewId} for session ${sessionId}`, err);
      return false;
    }
  }

  async getPreview(sessionId, previewId) {
    if (!previewId) {
      return null;
    }

    await this.init();

    const activeStore = this.sessionStores.get(sessionId) ?? null;
    if (activeStore) {
      try {
        const row = activeStore.statements.selectPreview.get(previewId);
        if (row && row.data) {
          return { mimeType: row.mimeType, data: row.data };
        }
      } catch (err) {
        console.warn(`Failed to load preview ${previewId} from active store for session ${sessionId}`, err);
      }
    }

    const parts = await this.getSessionStoreParts(sessionId);
    for (const part of parts) {
      if (activeStore && activeStore.part === part) {
        continue;
      }

      let tempStore;
      try {
        tempStore = this.createSessionDb(sessionId, part, { readOnly: true });
        const row = tempStore.statements.selectPreview.get(previewId);
        if (row && row.data) {
          return { mimeType: row.mimeType, data: row.data };
        }
      } catch (err) {
        if (err && err.code === 'SQLITE_CANTOPEN') {
          continue;
        }
        console.warn(`Failed to inspect preview ${previewId} for session ${sessionId} part ${part}`, err);
      } finally {
        if (tempStore) {
          try {
            tempStore.db.close();
          } catch (closeErr) {
            console.warn(`Failed to close preview reader for session ${sessionId}`, closeErr);
          }
        }
      }
    }

    return null;
  }

  async deletePreviews(sessionId, previewIds = []) {
    if (!Array.isArray(previewIds) || previewIds.length === 0) {
      return;
    }

    const uniqueIds = Array.from(
      new Set(
        previewIds
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => value.length > 0)
      )
    );

    if (uniqueIds.length === 0) {
      return;
    }

    await this.init();

    const idsJson = JSON.stringify(uniqueIds);
    const activeStore = this.sessionStores.get(sessionId) ?? null;
    const parts = await this.getSessionStoreParts(sessionId);

    for (const part of parts) {
      const isActive = activeStore && activeStore.part === part;
      let targetStore = activeStore;

      if (!isActive) {
        try {
          targetStore = this.createSessionDb(sessionId, part);
        } catch (err) {
          console.warn(`Failed to open session database ${sessionId} part ${part} for preview cleanup`, err);
          continue;
        }
      }

      try {
        targetStore.statements.deletePreviewsByIdSet.run(idsJson);
      } catch (err) {
        console.warn(`Failed to delete previews for session ${sessionId} part ${part}`, err);
      } finally {
        if (!isActive && targetStore) {
          try {
            targetStore.db.close();
          } catch (closeErr) {
            console.warn(`Failed to close preview cleanup store for session ${sessionId}`, closeErr);
          }
        }
      }
    }

    this.trackWriteOperation();
  }

  async buildSessionFromRow(row, { includeFrames = true } = {}) {
    if (!row) {
      return null;
    }
    if (!includeFrames) {
      return normalizeSessionRow(row, { includeFrames: false });
    }
    const frames = await this.getSessionFrames(row.id);
    return normalizeSessionRow(row, { frames });
  }

  async createSession(metadata) {
    await this.init();
    const session = {
      id: metadata.id,
      createdAt: metadata.createdAt,
      client: serializeJson(metadata.client ?? null),
      clientIp: metadata.clientIp ?? null,
      trimmedFrameCount: 0,
      totalFrameCount: 0,
      closedAt: null,
    };

    this.statements.insertSession.run(session);

    await this.ensureSessionStore(session.id);
    this.trackWriteOperation();
    return normalizeSessionRow({ ...session, client: session.client }, { frames: [] });
  }

  async appendFrame(sessionId, frame) {
    await this.init();
    const options = this.getConfigOptions();
    const limit = getFrameLimit(options);

    const payload = serializeJson(frame ?? null) ?? 'null';
    const payloadSize = Buffer.byteLength(payload, 'utf8');

    const sessionRow = this.getSessionRow(sessionId);
    if (!sessionRow) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const trimmedFrameCount = ensureNumeric(sessionRow.trimmedFrameCount, 0);
    const currentTotal = ensureNumeric(sessionRow.totalFrameCount, trimmedFrameCount);
    const currentVisibleFrames = Math.max(currentTotal - trimmedFrameCount, 0);
    const newTotal = currentTotal + 1;
    const frameIndex = newTotal - 1;

    const store = await this.prepareSessionStoreForInsert(sessionId, payloadSize);
    store.statements.insertFrame.run({
      frameIndex,
      payload,
    });
    await this.ensurePostInsertCapacity(sessionId, store);

    const newVisibleCount = currentVisibleFrames + 1;
    const overflow = Math.max(0, newVisibleCount - limit);

    const {
      removedFrames,
      removedFrameCount,
      trimmedFrameCount: updatedTrimmed,
      totalFrameCount: updatedTotal,
    } = await this.removeOverflowFrames({
      sessionId,
      trimmedFrameCount,
      newTotal,
      newVisibleCount,
      overflow,
    });

    const result = {
      frame,
      trimmedFrameCount: updatedTrimmed,
      totalFrameCount: updatedTotal,
      removedFrameCount,
      removedFrames,
    };
    this.trackWriteOperation();
    return result;
  }

  async closeSession(sessionId) {
    await this.init();
    const sessionRow = this.getSessionRow(sessionId);
    if (!sessionRow) {
      return null;
    }

    const closedAt = new Date().toISOString();
    this.statements.updateSessionClosedAt.run({ id: sessionId, closedAt });
    this.trackWriteOperation();

    return this.getSession(sessionId);
  }

  async listSessions() {
    await this.init();
    const rows = this.statements.selectAllSessions.all();
    const sessions = await Promise.all(
      rows.map((row) => this.buildSessionFromRow(row, { includeFrames: false }))
    );
    return sessions;
  }

  async getLastFrame(sessionId) {
    await this.init();
    const parts = await this.getSessionStoreParts(sessionId);
    if (parts.length === 0) {
      return null;
    }

    const activeStore = this.sessionStores.get(sessionId) ?? null;
    const lastPart = parts[parts.length - 1];
    let useStore = activeStore && activeStore.part === lastPart ? activeStore : null;
    if (!useStore) {
      try {
        useStore = this.createSessionDb(sessionId, lastPart, { readOnly: true });
      } catch (err) {
        console.warn(`Failed to open session database ${sessionId} part ${lastPart} for last frame`, err);
        return null;
      }
    }
    try {
      const row = useStore.statements.selectLastFrame.get();
      if (!row) {
        return null;
      }
      return parseFrameRow(row);
    } finally {
      if (!activeStore || activeStore.part !== lastPart) {
        try {
          useStore.db.close();
        } catch (err) {
          console.warn(`Failed to close temporary session db for last frame`, err);
        }
      }
    }
  }

  async getSession(sessionId) {
    await this.init();
    const sessionRow = this.getSessionRow(sessionId);
    if (!sessionRow) {
      return null;
    }
    return this.buildSessionFromRow(sessionRow);
  }

  async applyConfig(config) {
    await this.init();
    const currentOptions = this.getConfigOptions();
    const limit = getFrameLimit({
      maxSessionFrames: config?.history?.maxSessionFrames ?? currentOptions.maxSessionFrames,
    });

    const currentLimit = getFrameLimit(currentOptions);
    if (limit === currentLimit) {
      return;
    }

    const rows = this.statements.selectAllSessions.all();
    for (const row of rows) {
      const trimmedFrameCount = ensureNumeric(row.trimmedFrameCount, 0);
      const totalFrameCount = ensureNumeric(row.totalFrameCount, trimmedFrameCount);
      const visibleFrames = Math.max(totalFrameCount - trimmedFrameCount, 0);
      const overflow = Math.max(0, visibleFrames - limit);
      const newTotal = Math.max(totalFrameCount, trimmedFrameCount + visibleFrames);
      await this.removeOverflowFrames({
        sessionId: row.id,
        trimmedFrameCount,
        newTotal,
        newVisibleCount: visibleFrames,
        overflow,
      });
    }

    this.trackWriteOperation();
  }

  async clearHistory() {
    await this.init();
    this.statements.deleteAllSessions.run();
    await this.removeAllSessionDatabases();
    this.runMaintenance({ vacuum: true });
  }

  async deleteSession(sessionId) {
    await this.init();
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }
    this.statements.deleteSession.run(sessionId);
    await this.removeSessionDatabases(sessionId);
    this.runMaintenance();
    return session;
  }

  async removeOverflowFrames({ sessionId, trimmedFrameCount, newTotal, newVisibleCount, overflow }) {
    if (overflow <= 0) {
      this.statements.updateSessionCounts.run({
        id: sessionId,
        totalFrameCount: newTotal,
        trimmedFrameCount,
      });
      return {
        removedFrames: [],
        removedFrameCount: 0,
        trimmedFrameCount,
        totalFrameCount: newTotal,
      };
    }

    let remainingOverflow = overflow;
    const removedFrames = [];
    const store = this.sessionStores.get(sessionId) ?? null;
    const parts = await this.getSessionStoreParts(sessionId);

    for (const part of parts) {
      if (remainingOverflow <= 0) {
        break;
      }

      const isActiveStore = store && store.part === part;
      const targetStore = isActiveStore ? store : this.createSessionDb(sessionId, part);
      try {
        const rowsToRemove = targetStore.statements.selectOldestFrames.all(remainingOverflow);
        if (rowsToRemove.length > 0) {
          const idsJson = JSON.stringify(rowsToRemove.map((row) => row.id));
          targetStore.statements.deleteFramesByIdSet.run(idsJson);
          removedFrames.push(...rowsToRemove.map((row) => parseFrameRow(row)));
          remainingOverflow -= rowsToRemove.length;
        }

        const remainingInPartResult = targetStore.statements.countFrames.get();
        const remainingInPart = ensureNumeric(remainingInPartResult?.count, 0);
        if (!isActiveStore && remainingInPart === 0) {
          try {
            targetStore.db.close();
          } catch (err) {
            console.warn(`Failed to close empty session database ${targetStore.path}`, err);
          }
          try {
            await fs.unlink(targetStore.path);
            await this.unregisterSessionPart(sessionId, part);
            if (store) {
              store.parts = (store.parts ?? []).filter((value) => value !== part);
            }
          } catch (err) {
            if (err && err.code !== 'ENOENT') {
              console.warn(`Failed to delete empty session database ${targetStore.path}`, err);
            }
          }
        } else if (!isActiveStore) {
          try {
            targetStore.db.close();
          } catch (err) {
            console.warn(`Failed to close temporary session database ${targetStore.path}`, err);
          }
        } else if (remainingInPart === 0) {
          try {
            targetStore.db.close();
          } catch (err) {
            console.warn(`Failed to close emptied active session database ${targetStore.path}`, err);
          }
          this.sessionStores.delete(sessionId);
          try {
            await fs.unlink(targetStore.path);
            await this.unregisterSessionPart(sessionId, part);
            const partIndex = parts.indexOf(part);
            if (partIndex !== -1) {
              parts.splice(partIndex, 1);
            }
          } catch (err) {
            if (err && err.code !== 'ENOENT') {
              console.warn(`Failed to delete active session database ${targetStore.path}`, err);
            }
          }
        }
      } catch (err) {
        console.warn(`Failed to remove overflow frames for session ${sessionId}`, err);
        if (!isActiveStore) {
          try {
            targetStore.db.close();
          } catch (closeErr) {
            console.warn(`Failed to close temporary session db after error`, closeErr);
          }
        }
        break;
      }
    }

    const actualRemoved = removedFrames.length;
    const updatedTrimmed = trimmedFrameCount + actualRemoved;
    const remainingVisible = Math.max(newVisibleCount - actualRemoved, 0);
    const updatedTotal = Math.max(newTotal, updatedTrimmed + remainingVisible);

    this.statements.updateSessionCounts.run({
      id: sessionId,
      totalFrameCount: updatedTotal,
      trimmedFrameCount: updatedTrimmed,
    });

    return {
      removedFrames,
      removedFrameCount: actualRemoved,
      trimmedFrameCount: updatedTrimmed,
      totalFrameCount: updatedTotal,
    };
  }

  trackWriteOperation() {
    this.operationsSinceOptimize += 1;
    if (this.operationsSinceOptimize >= 100) {
      this.runMaintenance();
      this.operationsSinceOptimize = 0;
    }
  }

  runMaintenance({ vacuum = false } = {}) {
    if (!this.db) {
      return;
    }
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      this.db.exec('PRAGMA optimize;');
      if (vacuum) {
        this.db.exec('VACUUM;');
      }
      this.operationsSinceOptimize = 0;
    } catch (err) {
      console.warn('Failed to run history database maintenance', err);
    }
  }

  close() {
    for (const sessionId of Array.from(this.sessionStores.keys())) {
      this.closeSessionStore(sessionId);
    }
    this.sessionStores.clear();
    this.sessionPartsCache.clear();
    if (!this.db) {
      return;
    }
    try {
      this.runMaintenance();
      this.db.close();
    } catch (err) {
      console.warn('Failed to close history database cleanly', err);
    } finally {
      this.db = null;
      this.statements = null;
      this.initialized = false;
      this.operationsSinceOptimize = 0;
    }
  }
}

