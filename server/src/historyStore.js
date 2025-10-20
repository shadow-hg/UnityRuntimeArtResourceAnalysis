import { promises as fs } from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'telemetry-history.json');

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
  const serialized = JSON.stringify(history, null, 2);
  await fs.writeFile(tempPath, serialized, 'utf-8');

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
  constructor() {
    this.history = { sessions: [] };
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    this.history = await readHistory();
    this.initialized = true;
  }

  async createSession(metadata) {
    await this.init();
    const session = {
      id: metadata.id,
      createdAt: metadata.createdAt,
      client: metadata.client,
      frames: []
    };
    this.history.sessions.push(session);
    await writeHistory(this.history);
    return session;
  }

  async appendFrame(sessionId, frame) {
    await this.init();
    const session = this.history.sessions.find((s) => s.id === sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    session.frames.push(frame);
    await writeHistory(this.history);
    return frame;
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

  async getSession(sessionId) {
    await this.init();
    return this.history.sessions.find((s) => s.id === sessionId) || null;
  }
}
