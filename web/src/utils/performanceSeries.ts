import type { TelemetrySnapshot } from '../types';

function ensureFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function convertBytesToMegabytes(value: unknown): number | null {
  const numeric = ensureFiniteNumber(value, Number.NaN);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  const megabytes = numeric / (1024 * 1024);
  if (!Number.isFinite(megabytes)) {
    return null;
  }

  return Number(megabytes.toFixed(2));
}

function convertMilliseconds(value: unknown): number | null {
  const numeric = ensureFiniteNumber(value, Number.NaN);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return Number(numeric.toFixed(2));
}

function convertPercentage(value: unknown): number | null {
  const numeric = ensureFiniteNumber(value, Number.NaN);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  const normalized = numeric <= 1 ? numeric * 100 : numeric;
  if (!Number.isFinite(normalized)) {
    return null;
  }

  return Number(normalized.toFixed(1));
}

function sumBytes(values: Array<unknown | null | undefined>): number {
  return values.reduce<number>((total, value) => total + ensureFiniteNumber(value, 0), 0);
}

function resolveTextureBytes(frame: TelemetrySnapshot): number | null {
  const explicitTotal = ensureFiniteNumber(frame.totalTextureBytes, Number.NaN);
  if (Number.isFinite(explicitTotal) && explicitTotal >= 0) {
    return explicitTotal;
  }

  const textures = Array.isArray(frame.textures) ? frame.textures : [];
  if (textures.length === 0) {
    return null;
  }

  const aggregated = textures
    .filter((texture) => !texture?.isRenderTexture)
    .reduce((sum, texture) => sum + ensureFiniteNumber(texture?.EstimatedBytes, 0), 0);

  return aggregated > 0 ? aggregated : null;
}

function resolveMeshBytes(frame: TelemetrySnapshot): number | null {
  const explicitTotal = ensureFiniteNumber(frame.totalMeshBytes, Number.NaN);
  if (Number.isFinite(explicitTotal) && explicitTotal >= 0) {
    return explicitTotal;
  }

  const meshes = Array.isArray(frame.meshes) ? frame.meshes : [];
  if (meshes.length === 0) {
    return null;
  }

  const aggregated = sumBytes(meshes.map((mesh) => mesh?.EstimatedBytes));
  return aggregated > 0 ? aggregated : null;
}

function resolveRenderTextureBytes(frame: TelemetrySnapshot): number | null {
  const explicitTotal = ensureFiniteNumber(frame.totalRenderTextureBytes, Number.NaN);
  if (Number.isFinite(explicitTotal) && explicitTotal >= 0) {
    return explicitTotal;
  }

  const renderTextures = Array.isArray(frame.renderTextures) ? frame.renderTextures : [];
  if (renderTextures.length === 0) {
    return null;
  }

  const aggregated = sumBytes(renderTextures.map((texture) => texture?.EstimatedBytes));
  return aggregated > 0 ? aggregated : null;
}

function resolveShaderBytes(frame: TelemetrySnapshot): number | null {
  const explicitBytes = ensureFiniteNumber(frame.totalShaderBytes ?? frame.shaderMemoryBytes, Number.NaN);
  if (Number.isFinite(explicitBytes) && explicitBytes > 0) {
    return explicitBytes;
  }

  const shaders = Array.isArray(frame.shaders) ? frame.shaders : [];
  if (shaders.length === 0) {
    return null;
  }

  const aggregated = sumBytes(shaders.map((shader) => shader?.memoryBytes));
  return aggregated > 0 ? aggregated : null;
}

function resolveMaterialBytes(frame: TelemetrySnapshot): number | null {
  const explicitTotal = ensureFiniteNumber(frame.totalMaterialBytes, Number.NaN);
  if (Number.isFinite(explicitTotal) && explicitTotal > 0) {
    return explicitTotal;
  }

  const materials = Array.isArray(frame.materials) ? frame.materials : [];
  if (materials.length === 0) {
    return null;
  }

  const aggregated = sumBytes(materials.map((material) => material?.memoryBytes));
  return aggregated > 0 ? aggregated : null;
}

function normalizeBytesToMegabytes(value: number | null): number | null {
  if (value == null) {
    return null;
  }
  return convertBytesToMegabytes(value);
}

function normalizeFramePreviewTimestamp(frame: TelemetrySnapshot): string | null {
  const timestamp = frame.timestampUtc ?? frame.framePreview?.captureTimestampUtc ?? null;
  return timestamp ?? null;
}

export interface PerformanceSeriesSnapshot {
  readonly frameNumbers: readonly number[];
  readonly timestamps: ReadonlyArray<string | null>;
  readonly fps: ReadonlyArray<number | null>;
  readonly memory: {
    readonly textures: ReadonlyArray<number | null>;
    readonly meshes: ReadonlyArray<number | null>;
    readonly renderTextures: ReadonlyArray<number | null>;
    readonly shaders: ReadonlyArray<number | null>;
    readonly materials: ReadonlyArray<number | null>;
    readonly unityHeap: ReadonlyArray<number | null>;
    readonly nativeMemory: ReadonlyArray<number | null>;
    readonly gpuMemory: ReadonlyArray<number | null>;
    readonly texturePool: ReadonlyArray<number | null>;
    readonly meshPool: ReadonlyArray<number | null>;
    readonly otherMemory: ReadonlyArray<number | null>;
    readonly managedHeap: ReadonlyArray<number | null>;
  };
  readonly frameTiming: {
    readonly cpu: ReadonlyArray<number | null>;
    readonly gpu: ReadonlyArray<number | null>;
    readonly mainThread: ReadonlyArray<number | null>;
    readonly renderThread: ReadonlyArray<number | null>;
  };
  readonly threadUtilization: {
    readonly mainThread: ReadonlyArray<number | null>;
    readonly renderThread: ReadonlyArray<number | null>;
    readonly jobWorker: ReadonlyArray<number | null>;
  };
}

export interface PerformanceSeriesMutable {
  frameNumbers: number[];
  timestamps: Array<string | null>;
  fps: Array<number | null>;
  memory: {
    textures: Array<number | null>;
    meshes: Array<number | null>;
    renderTextures: Array<number | null>;
    shaders: Array<number | null>;
    materials: Array<number | null>;
    unityHeap: Array<number | null>;
    nativeMemory: Array<number | null>;
    gpuMemory: Array<number | null>;
    texturePool: Array<number | null>;
    meshPool: Array<number | null>;
    otherMemory: Array<number | null>;
    managedHeap: Array<number | null>;
  };
  frameTiming: {
    cpu: Array<number | null>;
    gpu: Array<number | null>;
    mainThread: Array<number | null>;
    renderThread: Array<number | null>;
  };
  threadUtilization: {
    mainThread: Array<number | null>;
    renderThread: Array<number | null>;
    jobWorker: Array<number | null>;
  };
}

export function createPerformanceSeriesSnapshot(
  series: PerformanceSeriesMutable
): PerformanceSeriesSnapshot {
  return {
    frameNumbers: series.frameNumbers,
    timestamps: series.timestamps,
    fps: series.fps,
    memory: {
      textures: series.memory.textures,
      meshes: series.memory.meshes,
      renderTextures: series.memory.renderTextures,
      shaders: series.memory.shaders,
      materials: series.memory.materials,
      unityHeap: series.memory.unityHeap,
      nativeMemory: series.memory.nativeMemory,
      gpuMemory: series.memory.gpuMemory,
      texturePool: series.memory.texturePool,
      meshPool: series.memory.meshPool,
      otherMemory: series.memory.otherMemory,
      managedHeap: series.memory.managedHeap,
    },
    frameTiming: {
      cpu: series.frameTiming.cpu,
      gpu: series.frameTiming.gpu,
      mainThread: series.frameTiming.mainThread,
      renderThread: series.frameTiming.renderThread,
    },
    threadUtilization: {
      mainThread: series.threadUtilization.mainThread,
      renderThread: series.threadUtilization.renderThread,
      jobWorker: series.threadUtilization.jobWorker,
    },
  };
}

export interface PerformanceSeriesStore {
  readonly mutable: PerformanceSeriesMutable;
  readonly snapshot: PerformanceSeriesSnapshot;
}

export function createPerformanceSeriesStore(): PerformanceSeriesStore {
  const mutable = createEmptySeries();
  return {
    mutable,
    snapshot: createPerformanceSeriesSnapshot(mutable),
  };
}

function createEmptySeries(): PerformanceSeriesMutable {
  return {
    frameNumbers: [],
    timestamps: [],
    fps: [],
    memory: {
      textures: [],
      meshes: [],
      renderTextures: [],
      shaders: [],
      materials: [],
      unityHeap: [],
      nativeMemory: [],
      gpuMemory: [],
      texturePool: [],
      meshPool: [],
      otherMemory: [],
      managedHeap: [],
    },
    frameTiming: {
      cpu: [],
      gpu: [],
      mainThread: [],
      renderThread: [],
    },
    threadUtilization: {
      mainThread: [],
      renderThread: [],
      jobWorker: [],
    },
  };
}

export function cloneSeries(series: PerformanceSeriesMutable): PerformanceSeriesMutable {
  return {
    frameNumbers: [...series.frameNumbers],
    timestamps: [...series.timestamps],
    fps: [...series.fps],
    memory: {
      textures: [...series.memory.textures],
      meshes: [...series.memory.meshes],
      renderTextures: [...series.memory.renderTextures],
      shaders: [...series.memory.shaders],
      materials: [...series.memory.materials],
      unityHeap: [...series.memory.unityHeap],
      nativeMemory: [...series.memory.nativeMemory],
      gpuMemory: [...series.memory.gpuMemory],
      texturePool: [...series.memory.texturePool],
      meshPool: [...series.memory.meshPool],
      otherMemory: [...series.memory.otherMemory],
      managedHeap: [...series.memory.managedHeap],
    },
    frameTiming: {
      cpu: [...series.frameTiming.cpu],
      gpu: [...series.frameTiming.gpu],
      mainThread: [...series.frameTiming.mainThread],
      renderThread: [...series.frameTiming.renderThread],
    },
    threadUtilization: {
      mainThread: [...series.threadUtilization.mainThread],
      renderThread: [...series.threadUtilization.renderThread],
      jobWorker: [...series.threadUtilization.jobWorker],
    },
  };
}

export interface DerivedSeriesEntry {
  timestamp: string | null;
  fps: number | null;
  memory: {
    textures: number | null;
    meshes: number | null;
    renderTextures: number | null;
    shaders: number | null;
    materials: number | null;
    unityHeap: number | null;
    nativeMemory: number | null;
    gpuMemory: number | null;
    texturePool: number | null;
    meshPool: number | null;
    otherMemory: number | null;
    managedHeap: number | null;
  };
  frameTiming: {
    cpu: number | null;
    gpu: number | null;
    mainThread: number | null;
    renderThread: number | null;
  };
  threadUtilization: {
    mainThread: number | null;
    renderThread: number | null;
    jobWorker: number | null;
  };
}

export function deriveSeriesEntry(frame: TelemetrySnapshot): DerivedSeriesEntry {
  const fpsValue = ensureFiniteNumber(frame.fps, Number.NaN);
  const fps = Number.isFinite(fpsValue) ? Number(fpsValue.toFixed(2)) : null;

  const unityHeap = convertBytesToMegabytes(frame.memoryStats?.unityHeapBytes);
  const nativeMemory = convertBytesToMegabytes(frame.memoryStats?.nativeMemoryBytes);
  const gpuMemory = convertBytesToMegabytes(frame.memoryStats?.gpuMemoryBytes);
  const texturePool = convertBytesToMegabytes(frame.memoryStats?.texturePoolBytes);
  const meshPool = convertBytesToMegabytes(frame.memoryStats?.meshPoolBytes);
  const otherMemory = convertBytesToMegabytes(frame.memoryStats?.otherMemoryBytes);
  const managedHeap = convertBytesToMegabytes(frame.memoryStats?.gc?.managedHeapSizeBytes);

  return {
    timestamp: normalizeFramePreviewTimestamp(frame),
    fps,
    memory: {
      textures: normalizeBytesToMegabytes(resolveTextureBytes(frame)),
      meshes: normalizeBytesToMegabytes(resolveMeshBytes(frame)),
      renderTextures: normalizeBytesToMegabytes(resolveRenderTextureBytes(frame)),
      shaders: normalizeBytesToMegabytes(resolveShaderBytes(frame)),
      materials: normalizeBytesToMegabytes(resolveMaterialBytes(frame)),
      unityHeap,
      nativeMemory,
      gpuMemory,
      texturePool,
      meshPool,
      otherMemory,
      managedHeap,
    },
    frameTiming: {
      cpu: convertMilliseconds(frame.frameTiming?.cpuFrameTimeMs),
      gpu: convertMilliseconds(frame.frameTiming?.gpuFrameTimeMs),
      mainThread: convertMilliseconds(frame.frameTiming?.cpuMainThreadTimeMs),
      renderThread: convertMilliseconds(frame.frameTiming?.cpuRenderThreadTimeMs),
    },
    threadUtilization: {
      mainThread: convertPercentage(frame.threadStats?.mainThreadPercent),
      renderThread: convertPercentage(frame.threadStats?.renderThreadPercent),
      jobWorker: convertPercentage(frame.threadStats?.jobWorkerPercent),
    },
  };
}

function applyEntry(series: PerformanceSeriesMutable, index: number, frameNumber: number, entry: DerivedSeriesEntry) {
  series.frameNumbers[index] = frameNumber;
  series.timestamps[index] = entry.timestamp;
  series.fps[index] = entry.fps;

  series.memory.textures[index] = entry.memory.textures;
  series.memory.meshes[index] = entry.memory.meshes;
  series.memory.renderTextures[index] = entry.memory.renderTextures;
  series.memory.shaders[index] = entry.memory.shaders;
  series.memory.materials[index] = entry.memory.materials;
  series.memory.unityHeap[index] = entry.memory.unityHeap;
  series.memory.nativeMemory[index] = entry.memory.nativeMemory;
  series.memory.gpuMemory[index] = entry.memory.gpuMemory;
  series.memory.texturePool[index] = entry.memory.texturePool;
  series.memory.meshPool[index] = entry.memory.meshPool;
  series.memory.otherMemory[index] = entry.memory.otherMemory;
  series.memory.managedHeap[index] = entry.memory.managedHeap;

  series.frameTiming.cpu[index] = entry.frameTiming.cpu;
  series.frameTiming.gpu[index] = entry.frameTiming.gpu;
  series.frameTiming.mainThread[index] = entry.frameTiming.mainThread;
  series.frameTiming.renderThread[index] = entry.frameTiming.renderThread;

  series.threadUtilization.mainThread[index] = entry.threadUtilization.mainThread;
  series.threadUtilization.renderThread[index] = entry.threadUtilization.renderThread;
  series.threadUtilization.jobWorker[index] = entry.threadUtilization.jobWorker;
}

export function trimSeries(series: PerformanceSeriesMutable, count: number) {
  if (!Number.isFinite(count) || count <= 0) {
    return;
  }

  const removed = Math.min(count, series.frameNumbers.length);
  if (removed <= 0) {
    return;
  }

  series.frameNumbers.splice(0, removed);
  series.timestamps.splice(0, removed);
  series.fps.splice(0, removed);

  series.memory.textures.splice(0, removed);
  series.memory.meshes.splice(0, removed);
  series.memory.renderTextures.splice(0, removed);
  series.memory.shaders.splice(0, removed);
  series.memory.materials.splice(0, removed);
  series.memory.unityHeap.splice(0, removed);
  series.memory.nativeMemory.splice(0, removed);
  series.memory.gpuMemory.splice(0, removed);
  series.memory.texturePool.splice(0, removed);
  series.memory.meshPool.splice(0, removed);
  series.memory.otherMemory.splice(0, removed);
  series.memory.managedHeap.splice(0, removed);

  series.frameTiming.cpu.splice(0, removed);
  series.frameTiming.gpu.splice(0, removed);
  series.frameTiming.mainThread.splice(0, removed);
  series.frameTiming.renderThread.splice(0, removed);

  series.threadUtilization.mainThread.splice(0, removed);
  series.threadUtilization.renderThread.splice(0, removed);
  series.threadUtilization.jobWorker.splice(0, removed);
}

export function updateSeriesWithFrame(
  series: PerformanceSeriesMutable,
  frame: TelemetrySnapshot
): { index: number; replaced: boolean } {
  const entry = deriveSeriesEntry(frame);
  const existingIndex = series.frameNumbers.findIndex((value) => value === frame.frameNumber);

  if (existingIndex !== -1) {
    applyEntry(series, existingIndex, frame.frameNumber, entry);
    return { index: existingIndex, replaced: true };
  }

  const index = series.frameNumbers.length;
  applyEntry(series, index, frame.frameNumber, entry);
  return { index, replaced: false };
}

export function rebuildSeries(frames: TelemetrySnapshot[]): PerformanceSeriesMutable {
  const series = createEmptySeries();
  const deduped = new Map<number, TelemetrySnapshot>();

  for (const frame of frames) {
    if (!frame) continue;
    deduped.set(frame.frameNumber, frame);
  }

  const sorted = Array.from(deduped.values()).sort((a, b) => a.frameNumber - b.frameNumber);
  sorted.forEach((frame, index) => {
    const entry = deriveSeriesEntry(frame);
    applyEntry(series, index, frame.frameNumber, entry);
  });

  return series;
}

export function rebuildSeriesStore(frames: TelemetrySnapshot[]): PerformanceSeriesStore {
  const mutable = rebuildSeries(frames);
  return {
    mutable,
    snapshot: createPerformanceSeriesSnapshot(mutable),
  };
}

export { createEmptySeries as createPerformanceSeries };
