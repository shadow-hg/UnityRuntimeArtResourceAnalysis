import { promises as fs } from 'fs';
import path from 'path';

const CONFIG_FILE = path.join(process.cwd(), 'data', 'server-config.json');

const DEFAULT_CONFIG = {
  clientDefaults: {
    sampleIntervalSeconds: 0,
    framePreviewScale: 0.2,
    disableFramePreview: false,
    maxAssetsPerCategory: 200,
    autoManageSession: true,
  },
  history: {
    maxSessionFrames: 10000,
  },
};

function ensureNumber(value, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, fallback = 0, integer = false } = {}) {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  let clamped = Math.min(Math.max(parsed, min), max);
  if (integer) {
    clamped = Math.round(clamped);
  }
  return clamped;
}

function ensureBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

function mergeConfig(baseConfig, overrideConfig) {
  const merged = {
    clientDefaults: { ...baseConfig.clientDefaults },
    history: { ...baseConfig.history },
  };

  const clientDefaults = overrideConfig?.clientDefaults;
  if (clientDefaults && typeof clientDefaults === 'object') {
    if ('sampleIntervalSeconds' in clientDefaults) {
      merged.clientDefaults.sampleIntervalSeconds = ensureNumber(clientDefaults.sampleIntervalSeconds, {
        min: 0,
        fallback: baseConfig.clientDefaults.sampleIntervalSeconds,
      });
    }
    if ('framePreviewScale' in clientDefaults) {
      merged.clientDefaults.framePreviewScale = ensureNumber(clientDefaults.framePreviewScale, {
        min: 0,
        max: 1,
        fallback: baseConfig.clientDefaults.framePreviewScale,
      });
    }
    if ('disableFramePreview' in clientDefaults) {
      merged.clientDefaults.disableFramePreview = ensureBoolean(
        clientDefaults.disableFramePreview,
        baseConfig.clientDefaults.disableFramePreview
      );
    }
    if ('maxAssetsPerCategory' in clientDefaults) {
      merged.clientDefaults.maxAssetsPerCategory = ensureNumber(clientDefaults.maxAssetsPerCategory, {
        min: 1,
        fallback: baseConfig.clientDefaults.maxAssetsPerCategory,
        integer: true,
      });
    }
    if ('autoManageSession' in clientDefaults) {
      merged.clientDefaults.autoManageSession = ensureBoolean(
        clientDefaults.autoManageSession,
        baseConfig.clientDefaults.autoManageSession
      );
    }
  }

  const history = overrideConfig?.history;
  if (history && typeof history === 'object') {
    if ('maxSessionFrames' in history) {
      merged.history.maxSessionFrames = ensureNumber(history.maxSessionFrames, {
        min: 100,
        fallback: baseConfig.history.maxSessionFrames,
        integer: true,
      });
    }
  }

  return merged;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class ConfigStore {
  constructor() {
    this.config = deepClone(DEFAULT_CONFIG);
    this.initialized = false;
    this.listeners = new Set();
  }

  async init() {
    if (this.initialized) {
      return;
    }

    try {
      const file = await fs.readFile(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(file);
      this.config = mergeConfig(DEFAULT_CONFIG, parsed);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('Failed to read server config file, falling back to defaults', err);
      }
      await this.persist();
    }

    this.initialized = true;
  }

  getConfig() {
    return deepClone(this.config);
  }

  getClientDefaults() {
    return deepClone(this.config.clientDefaults);
  }

  getHistoryConfig() {
    return deepClone(this.config.history);
  }

  async update(partialConfig = {}) {
    await this.init();
    const nextConfig = mergeConfig(this.config, partialConfig);
    this.config = nextConfig;
    await this.persist();
    this.emitChange();
    return this.getConfig();
  }

  async persist() {
    await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitChange() {
    for (const listener of this.listeners) {
      try {
        listener(this.getConfig());
      } catch (err) {
        console.warn('ConfigStore listener failed', err);
      }
    }
  }
}

export function createConfigStore() {
  return new ConfigStore();
}

export { DEFAULT_CONFIG };
