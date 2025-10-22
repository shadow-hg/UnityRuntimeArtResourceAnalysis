import { promises as fs } from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'telemetry-history.json');
const DEFAULT_MAX_SESSION_FRAMES = 10000;

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

async function readHistory() {
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

async function writeHistory(history) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
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

export class HistoryStore {
  constructor(options = {}) {
    this.history = { sessions: [] };
    this.initialized = false;
    this.configStore = options.configStore ?? null;
  }

  getConfigOptions() {
    const historyConfig = this.configStore?.getHistoryConfig?.();
    return { maxSessionFrames: historyConfig?.maxSessionFrames ?? DEFAULT_MAX_SESSION_FRAMES };
  }

  async init() {
    if (this.initialized) return;
    this.history = await readHistory();
    if (!Array.isArray(this.history.sessions)) {
      this.history.sessions = [];
    }
    const options = this.getConfigOptions();
    this.history.sessions = this.history.sessions.map((session) => normalizeSession(session, options));
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
    await writeHistory(this.history);
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
    await writeHistory(this.history);
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
      await writeHistory(this.history);
    }
    return session;
  }

  async listSessions() {
    await this.init();
    return this.history.sessions;
  }

  async getLastFrame(sessionId) {
    await this.init();
    const session = this.history.sessions.find((s) => s.id === sessionId);
    if (!session || !Array.isArray(session.frames) || session.frames.length === 0) {
      return null;
    }

    const last = session.frames[session.frames.length - 1];
    try {
      return JSON.parse(JSON.stringify(last));
    } catch (err) {
      return { ...last };
    }
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
      await writeHistory(this.history);
    }
  }

  async clearHistory() {
    await this.init();
    this.history.sessions = [];
    await writeHistory(this.history);
  }

  async deleteSession(sessionId) {
    await this.init();
    const index = this.history.sessions.findIndex((session) => session.id === sessionId);
    if (index === -1) {
      return null;
    }

    const [removed] = this.history.sessions.splice(index, 1);
    await writeHistory(this.history);
    return removed || null;
  }
}
