import { parentPort } from 'worker_threads';
import crypto from 'crypto';
import { HistoryStore } from './historyStore.js';

if (!parentPort) {
  throw new Error('historyStoreWorker must be run as a worker thread');
}

const configState = {
  snapshot: null,
};

const historyStore = new HistoryStore({
  configSnapshot: configState.snapshot,
});

function serializeError(error) {
  if (!error || typeof error !== 'object') {
    return { message: String(error) };
  }
  return {
    message: error.message ?? 'Unknown error',
    stack: error.stack,
    name: error.name ?? 'Error',
  };
}

async function handleMessage(message) {
  const { id, type, payload } = message;
  try {
    let result;
    switch (type) {
      case 'init':
        await historyStore.init();
        result = true;
        break;
      case 'setConfig':
        configState.snapshot = payload ?? null;
        historyStore.setConfigSnapshot(configState.snapshot);
        result = true;
        break;
      case 'applyConfig':
        configState.snapshot = payload ?? configState.snapshot;
        await historyStore.applyConfig(payload ?? null);
        result = true;
        break;
      case 'createSession':
        result = await historyStore.createSession(payload);
        break;
      case 'listSessions':
        result = await historyStore.listSessions();
        break;
      case 'getSession':
        result = await historyStore.getSession(payload.sessionId, payload.options ?? {});
        break;
      case 'getSessionTextures':
        result = await historyStore.getSessionTextures(payload.sessionId, payload.textureIds ?? []);
        break;
      case 'ensureSessionTextures':
        result = await historyStore.ensureSessionTextures(payload.sessionId, payload.textures ?? []);
        break;
      case 'appendFrame':
        result = await historyStore.appendFrame(payload.sessionId, payload.frame);
        break;
      case 'closeSession':
        result = await historyStore.closeSession(payload.sessionId);
        break;
      case 'deleteSession':
        result = await historyStore.deleteSession(payload.sessionId);
        break;
      case 'clearHistory':
        result = await historyStore.clearHistory();
        break;
      case 'getLastFrame':
        result = await historyStore.getLastFrame(payload.sessionId);
        break;
      case 'deletePreviews':
        result = await historyStore.deletePreviews(payload.sessionId, payload.previewIds ?? []);
        break;
      case 'getPreview':
        result = await historyStore.getPreview(payload.sessionId, payload.previewId);
        break;
      case 'savePreview':
        result = await historyStore.savePreview(payload.sessionId, payload.options ?? {});
        break;
      case 'persistTexturePreview':
        result = await persistTexturePreview(payload);
        break;
      case 'persistFramePreview':
        result = await persistFramePreview(payload);
        break;
      case 'close':
        historyStore.close?.();
        result = true;
        break;
      default:
        throw new Error(`Unknown history worker message type: ${type}`);
    }
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: serializeError(error) });
  }
}

async function persistTexturePreview(payload) {
  const { sessionId, textureId, base64, metadata = {}, identifierSeed } = payload ?? {};
  if (!sessionId || typeof base64 !== 'string' || base64.length === 0) {
    return { previewUrl: null, saved: false };
  }

  const buffer = Buffer.from(base64, 'base64');
  if (!buffer || buffer.length === 0) {
    return { previewUrl: null, saved: false };
  }

  const seedParts = [
    identifierSeed ?? null,
    textureId ?? 'unknown',
    metadata.width ?? 0,
    metadata.height ?? 0,
    metadata.format ?? '',
  ].filter((value) => value !== null);
  const previewId = createPreviewHash(seedParts.join('|'));
  const previewUrl = `/sessions/${sessionId}/textures/${previewId}/preview`;

  const saved = await historyStore.savePreview(sessionId, {
    previewId,
    kind: 'texture',
    mimeType: metadata.mimeType ?? 'image/png',
    data: buffer,
  });

  return { previewUrl, saved };
}

async function persistFramePreview(payload) {
  const { sessionId, frameNumber, base64, metadata = {}, identifierSeed } = payload ?? {};
  if (!sessionId || typeof base64 !== 'string' || base64.length === 0) {
    return { previewUrl: null, saved: false };
  }
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer || buffer.length === 0) {
    return { previewUrl: null, saved: false };
  }
  const seedParts = [
    identifierSeed ?? null,
    frameNumber ?? 'unknown',
    metadata.width ?? 0,
    metadata.height ?? 0,
    buffer.length,
  ].filter((value) => value !== null);
  const previewId = createPreviewHash(seedParts.join('|'));
  const previewUrl = `/sessions/${sessionId}/frames/${previewId}/preview`;

  const saved = await historyStore.savePreview(sessionId, {
    previewId,
    kind: 'frame',
    mimeType: metadata.mimeType ?? 'image/png',
    frameIndex: typeof frameNumber === 'number' ? frameNumber : null,
    data: buffer,
  });

  return { previewUrl, saved };
}

function createPreviewHash(seed) {
  return crypto.createHash('md5').update(seed).digest('hex');
}

parentPort.on('message', (message) => {
  if (!message || typeof message !== 'object') {
    return;
  }
  handleMessage(message);
});
