import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(moduleDir, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'telemetry-history.db');
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

function normalizeSessionRow(row, frames) {
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
    frames: sessionFrames,
    trimmedFrameCount,
    totalFrameCount,
  };

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

export class HistoryStore {
  constructor(options = {}) {
    this.configStore = options.configStore ?? null;
    this.initialized = false;
    this.db = null;
    this.statements = null;
    this.operationsSinceOptimize = 0;
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
      insertFrame: this.db.prepare(
        `INSERT INTO frames (sessionId, frameIndex, payload) VALUES (@sessionId, @frameIndex, @payload)`
      ),
      selectFramesForSession: this.db.prepare(
        `SELECT id, frameIndex, payload FROM frames WHERE sessionId = ? ORDER BY frameIndex ASC`
      ),
      countFramesForSession: this.db.prepare(
        `SELECT COUNT(*) as count FROM frames WHERE sessionId = ?`
      ),
      selectOldestFrames: this.db.prepare(
        `SELECT id, payload FROM frames WHERE sessionId = ? ORDER BY frameIndex ASC LIMIT ?`
      ),
      deleteFramesByIdSet: this.db.prepare(
        `DELETE FROM frames WHERE id IN (SELECT value FROM json_each(?))`
      ),
      selectLastFrame: this.db.prepare(
        `SELECT payload FROM frames WHERE sessionId = ? ORDER BY frameIndex DESC LIMIT 1`
      ),
      deleteAllFrames: this.db.prepare(`DELETE FROM frames`),
      deleteAllSessions: this.db.prepare(`DELETE FROM sessions`),
    };
  }

  getFrameCount(sessionId) {
    const result = this.statements.countFramesForSession.get(sessionId);
    return ensureNumeric(result?.count, 0);
  }

  getSessionRow(sessionId) {
    return this.statements.selectSession.get(sessionId) ?? null;
  }

  getSessionFrames(sessionId) {
    const rows = this.statements.selectFramesForSession.all(sessionId);
    return rows.map((row) => parseFrameRow(row));
  }

  buildSessionFromRow(row) {
    const frames = this.getSessionFrames(row.id);
    return normalizeSessionRow(row, frames);
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

    this.trackWriteOperation();
    return normalizeSessionRow({ ...session, client: session.client }, []);
  }

  async appendFrame(sessionId, frame) {
    await this.init();
    const options = this.getConfigOptions();
    const limit = getFrameLimit(options);

    const transaction = this.db.transaction(() => {
      const sessionRow = this.getSessionRow(sessionId);
      if (!sessionRow) {
        throw new Error(`Session ${sessionId} not found`);
      }

      const trimmedFrameCount = ensureNumeric(sessionRow.trimmedFrameCount, 0);
      const currentVisibleFrames = this.getFrameCount(sessionId);
      const expectedTotal = ensureNumeric(
        sessionRow.totalFrameCount,
        trimmedFrameCount + currentVisibleFrames
      );

      const newTotal = expectedTotal + 1;
      const frameIndex = newTotal - 1;

      this.statements.insertFrame.run({
        sessionId,
        frameIndex,
        payload: serializeJson(frame ?? null),
      });

      const newVisibleCount = currentVisibleFrames + 1;
      const overflow = Math.max(0, newVisibleCount - limit);

      const {
        removedFrames,
        removedFrameCount,
        trimmedFrameCount: updatedTrimmed,
        totalFrameCount: updatedTotal,
      } = this.removeOverflowFrames({
        sessionId,
        trimmedFrameCount,
        newTotal,
        newVisibleCount,
        overflow,
      });

      return {
        frame,
        trimmedFrameCount: updatedTrimmed,
        totalFrameCount: updatedTotal,
        removedFrameCount,
        removedFrames,
      };
    });

    const result = transaction();
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
    return rows.map((row) => this.buildSessionFromRow(row));
  }

  async getLastFrame(sessionId) {
    await this.init();
    const row = this.statements.selectLastFrame.get(sessionId);
    if (!row) {
      return null;
    }
    return parseFrameRow(row);
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

    const transaction = this.db.transaction(() => {
      const rows = this.statements.selectAllSessions.all();
      for (const row of rows) {
        const trimmedFrameCount = ensureNumeric(row.trimmedFrameCount, 0);
        const visibleFrames = this.getFrameCount(row.id);
        const overflow = Math.max(0, visibleFrames - limit);
        const expectedTotal = ensureNumeric(row.totalFrameCount, trimmedFrameCount + visibleFrames);
        const newTotal = Math.max(expectedTotal, trimmedFrameCount + visibleFrames);
        this.removeOverflowFrames({
          sessionId: row.id,
          trimmedFrameCount,
          newTotal,
          newVisibleCount: visibleFrames,
          overflow,
        });
      }
    });

    transaction();
    this.trackWriteOperation();
  }

  async clearHistory() {
    await this.init();
    const transaction = this.db.transaction(() => {
      this.statements.deleteAllFrames.run();
      this.statements.deleteAllSessions.run();
    });
    transaction();

    this.runMaintenance({ vacuum: true });
  }

  async deleteSession(sessionId) {
    await this.init();
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }
    this.statements.deleteSession.run(sessionId);
    this.runMaintenance();
    return session;
  }

  removeOverflowFrames({ sessionId, trimmedFrameCount, newTotal, newVisibleCount, overflow }) {
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

    const rowsToRemove = this.statements.selectOldestFrames.all(sessionId, overflow);
    const removedFrames = rowsToRemove.map((row) => parseFrameRow(row));
    if (rowsToRemove.length > 0) {
      const idsJson = JSON.stringify(rowsToRemove.map((row) => row.id));
      this.statements.deleteFramesByIdSet.run(idsJson);
    }

    const actualRemoved = rowsToRemove.length;
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

