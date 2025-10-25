import { Worker } from 'worker_threads';

let requestCounter = 0;

export class HistoryStoreClient {
  constructor({ configStore } = {}) {
    const workerUrl = new URL('./historyStoreWorker.js', import.meta.url);
    this.worker = new Worker(workerUrl, { type: 'module' });
    this.pending = new Map();
    this.worker.on('message', (message) => this.handleMessage(message));
    this.worker.on('error', (error) => this.failAll(error));
    this.worker.on('exit', (code) => {
      if (code !== 0) {
        this.failAll(new Error(`History worker exited with code ${code}`));
      }
    });
    this.configStore = configStore ?? null;
    if (this.configStore) {
      this.unsubscribe = this.configStore.onChange?.((config) => {
        this.applyConfig(config).catch((error) => {
          console.warn('Failed to propagate config to history worker', error);
        });
      });
    }
  }

  async init() {
    await this.call('init');
    if (this.configStore) {
      const config = await this.configStore.getConfig?.();
      if (config) {
        await this.call('setConfig', config);
      }
    }
  }

  async call(type, payload = null) {
    const id = ++requestCounter;
    const message = { id, type, payload };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(message);
    });
  }

  handleMessage(message) {
    const { id, result, error } = message ?? {};
    if (!this.pending.has(id)) {
      return;
    }
    const { resolve, reject } = this.pending.get(id);
    this.pending.delete(id);
    if (error) {
      const err = new Error(error.message ?? 'History worker error');
      err.stack = error.stack;
      err.name = error.name ?? err.name;
      reject(err);
      return;
    }
    resolve(result ?? null);
  }

  failAll(error) {
    for (const { reject } of this.pending.values()) {
      reject(error);
    }
    this.pending.clear();
  }

  async createSession(payload) {
    return this.call('createSession', payload);
  }

  async listSessions() {
    return this.call('listSessions');
  }

  async getSession(sessionId, options = {}) {
    return this.call('getSession', { sessionId, options });
  }

  async getSessionTextures(sessionId, textureIds) {
    return this.call('getSessionTextures', { sessionId, textureIds });
  }

  async ensureSessionTextures(sessionId, textures) {
    return this.call('ensureSessionTextures', { sessionId, textures });
  }

  async appendFrame(sessionId, frame) {
    return this.call('appendFrame', { sessionId, frame });
  }

  async closeSession(sessionId) {
    return this.call('closeSession', { sessionId });
  }

  async deleteSession(sessionId) {
    return this.call('deleteSession', { sessionId });
  }

  async clearHistory() {
    return this.call('clearHistory');
  }

  async getLastFrame(sessionId) {
    return this.call('getLastFrame', { sessionId });
  }

  async deletePreviews(sessionId, previewIds) {
    return this.call('deletePreviews', { sessionId, previewIds });
  }

  async getPreview(sessionId, previewId) {
    return this.call('getPreview', { sessionId, previewId });
  }

  async savePreview(sessionId, options) {
    return this.call('savePreview', { sessionId, options });
  }

  async persistTexturePreview(payload) {
    return this.call('persistTexturePreview', payload);
  }

  async persistFramePreview(payload) {
    return this.call('persistFramePreview', payload);
  }

  async applyConfig(config) {
    return this.call('applyConfig', config);
  }

  async close() {
    if (this.unsubscribe) {
      try {
        this.unsubscribe();
      } catch (err) {
        // ignore
      }
      this.unsubscribe = null;
    }
    await this.call('close');
    await this.worker.terminate();
  }
}

export function createHistoryStoreClient(options = {}) {
  return new HistoryStoreClient(options);
}
