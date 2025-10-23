import type {
  AssetCategoryConfig,
  MemoryStats,
  NetworkInfoResponse,
  ServerConfig,
  TelemetrySectionConfig,
  TelemetrySession,
  TelemetrySnapshot,
} from '../types';

interface StatsAccumulator {
  count: number;
  sum: number;
  min: number;
  max: number;
}

function createStatsAccumulator(): StatsAccumulator {
  return {
    count: 0,
    sum: 0,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
  };
}

function addSample(accumulator: StatsAccumulator, value: number | null | undefined): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return;
  }

  if (accumulator.count === 0) {
    accumulator.min = value;
    accumulator.max = value;
  } else {
    accumulator.min = Math.min(accumulator.min, value);
    accumulator.max = Math.max(accumulator.max, value);
  }

  accumulator.count += 1;
  accumulator.sum += value;
}

export interface MetricStats {
  min: number | null;
  max: number | null;
  average: number | null;
}

function finalizeStats(accumulator: StatsAccumulator): MetricStats {
  if (accumulator.count === 0) {
    return {
      min: null,
      max: null,
      average: null,
    };
  }

  return {
    min: accumulator.min,
    max: accumulator.max,
    average: accumulator.sum / accumulator.count,
  };
}

function computeMetricStats<T>(items: T[], selector: (item: T) => number | null | undefined): MetricStats {
  const accumulator = createStatsAccumulator();
  items.forEach((item) => {
    addSample(accumulator, selector(item));
  });
  return finalizeStats(accumulator);
}

interface ResourceByteAccumulator {
  textures: StatsAccumulator;
  meshes: StatsAccumulator;
  renderTextures: StatsAccumulator;
  materials: StatsAccumulator;
  shaders: StatsAccumulator;
}

function createResourceByteAccumulator(): ResourceByteAccumulator {
  return {
    textures: createStatsAccumulator(),
    meshes: createStatsAccumulator(),
    renderTextures: createStatsAccumulator(),
    materials: createStatsAccumulator(),
    shaders: createStatsAccumulator(),
  };
}

function addResourceSample(accumulator: ResourceByteAccumulator, frame: TelemetrySnapshot): void {
  addSample(accumulator.textures, frame.totalTextureBytes);
  addSample(accumulator.meshes, frame.totalMeshBytes);
  addSample(accumulator.renderTextures, frame.totalRenderTextureBytes);
  addSample(accumulator.materials, frame.totalMaterialBytes);
  const shaderBytes = frame.totalShaderBytes ?? frame.shaderMemoryBytes;
  addSample(accumulator.shaders, shaderBytes);
}

export interface ResourceByteSummary {
  textures: MetricStats;
  meshes: MetricStats;
  renderTextures: MetricStats;
  materials: MetricStats;
  shaders: MetricStats;
}

function finalizeResourceBytes(accumulator: ResourceByteAccumulator): ResourceByteSummary {
  return {
    textures: finalizeStats(accumulator.textures),
    meshes: finalizeStats(accumulator.meshes),
    renderTextures: finalizeStats(accumulator.renderTextures),
    materials: finalizeStats(accumulator.materials),
    shaders: finalizeStats(accumulator.shaders),
  };
}

interface MemoryAccumulator {
  unityHeapBytes: StatsAccumulator;
  nativeMemoryBytes: StatsAccumulator;
  gpuMemoryBytes: StatsAccumulator;
  texturePoolBytes: StatsAccumulator;
  meshPoolBytes: StatsAccumulator;
  otherMemoryBytes: StatsAccumulator;
  managedHeapSizeBytes: StatsAccumulator;
  gcDurationMs: StatsAccumulator;
}

function createMemoryAccumulator(): MemoryAccumulator {
  return {
    unityHeapBytes: createStatsAccumulator(),
    nativeMemoryBytes: createStatsAccumulator(),
    gpuMemoryBytes: createStatsAccumulator(),
    texturePoolBytes: createStatsAccumulator(),
    meshPoolBytes: createStatsAccumulator(),
    otherMemoryBytes: createStatsAccumulator(),
    managedHeapSizeBytes: createStatsAccumulator(),
    gcDurationMs: createStatsAccumulator(),
  };
}

function addMemorySample(accumulator: MemoryAccumulator, stats: MemoryStats | null | undefined): void {
  if (!stats) {
    return;
  }

  addSample(accumulator.unityHeapBytes, stats.unityHeapBytes);
  addSample(accumulator.nativeMemoryBytes, stats.nativeMemoryBytes);
  addSample(accumulator.gpuMemoryBytes, stats.gpuMemoryBytes);
  addSample(accumulator.texturePoolBytes, stats.texturePoolBytes);
  addSample(accumulator.meshPoolBytes, stats.meshPoolBytes);
  addSample(accumulator.otherMemoryBytes, stats.otherMemoryBytes);

  const gc = stats.gc;
  if (gc) {
    addSample(accumulator.managedHeapSizeBytes, gc.managedHeapSizeBytes);
    addSample(accumulator.gcDurationMs, gc.lastCollectionDurationMs);
    addSample(accumulator.gcDurationMs, gc.recentCollectionDurationMs);
  }
}

export interface MemorySummary {
  unityHeapBytes: MetricStats;
  nativeMemoryBytes: MetricStats;
  gpuMemoryBytes: MetricStats;
  texturePoolBytes: MetricStats;
  meshPoolBytes: MetricStats;
  otherMemoryBytes: MetricStats;
  managedHeapSizeBytes: MetricStats;
  gcDurationMs: MetricStats;
}

function finalizeMemory(accumulator: MemoryAccumulator): MemorySummary {
  return {
    unityHeapBytes: finalizeStats(accumulator.unityHeapBytes),
    nativeMemoryBytes: finalizeStats(accumulator.nativeMemoryBytes),
    gpuMemoryBytes: finalizeStats(accumulator.gpuMemoryBytes),
    texturePoolBytes: finalizeStats(accumulator.texturePoolBytes),
    meshPoolBytes: finalizeStats(accumulator.meshPoolBytes),
    otherMemoryBytes: finalizeStats(accumulator.otherMemoryBytes),
    managedHeapSizeBytes: finalizeStats(accumulator.managedHeapSizeBytes),
    gcDurationMs: finalizeStats(accumulator.gcDurationMs),
  };
}

export interface FrameMetricSummary {
  fps: MetricStats;
  cpuFrameTimeMs: MetricStats;
  gpuFrameTimeMs: MetricStats;
  cpuMainThreadTimeMs: MetricStats;
  cpuRenderThreadTimeMs: MetricStats;
}

function computeFrameMetrics(frames: TelemetrySnapshot[]): FrameMetricSummary {
  return {
    fps: computeMetricStats(frames, (frame) => frame.fps),
    cpuFrameTimeMs: computeMetricStats(frames, (frame) => frame.frameTiming?.cpuFrameTimeMs),
    gpuFrameTimeMs: computeMetricStats(frames, (frame) => frame.frameTiming?.gpuFrameTimeMs),
    cpuMainThreadTimeMs: computeMetricStats(frames, (frame) => frame.frameTiming?.cpuMainThreadTimeMs),
    cpuRenderThreadTimeMs: computeMetricStats(frames, (frame) => frame.frameTiming?.cpuRenderThreadTimeMs),
  };
}

export interface ResourceInventorySummary {
  textures: number;
  meshes: number;
  renderTextures: number;
  materials: number;
  shaders: number;
}

function buildResourceInventory(frame: TelemetrySnapshot | null | undefined): ResourceInventorySummary | null {
  if (!frame) {
    return null;
  }

  return {
    textures: Array.isArray(frame.textures) ? frame.textures.length : 0,
    meshes: Array.isArray(frame.meshes) ? frame.meshes.length : 0,
    renderTextures: Array.isArray(frame.renderTextures) ? frame.renderTextures.length : 0,
    materials: Array.isArray(frame.materials) ? frame.materials.length : 0,
    shaders: Array.isArray(frame.shaders) ? frame.shaders.length : 0,
  };
}

export interface EnvironmentSummary {
  gpuModel: string | null;
  gpuDriverVersion: string | null;
  cpuModel: string | null;
  cpuCoreCount: number | null;
  qualitySetting: string | null;
  screenResolution: string | null;
  screenRefreshRate: number | null;
  platform: string | null;
  sceneId: string | null;
  sceneName: string | null;
  cameraHeight: number | null;
  playerPosition: { x: number | null; y: number | null; z: number | null } | null;
}

function summarizeEnvironment(frame: TelemetrySnapshot | null | undefined): EnvironmentSummary | null {
  const environment = frame?.environment;
  if (!environment) {
    return null;
  }

  return {
    gpuModel: environment.gpuModel ?? null,
    gpuDriverVersion: environment.gpuDriverVersion ?? null,
    cpuModel: environment.cpuModel ?? null,
    cpuCoreCount: environment.cpuCoreCount ?? null,
    qualitySetting: environment.qualitySetting ?? null,
    screenResolution: environment.screenResolution ?? null,
    screenRefreshRate: environment.screenRefreshRate ?? null,
    platform: environment.platform ?? null,
    sceneId: environment.sceneId ?? null,
    sceneName: environment.sceneName ?? null,
    cameraHeight: environment.cameraHeight ?? null,
    playerPosition: environment.playerPosition
      ? {
          x: environment.playerPosition.x ?? null,
          y: environment.playerPosition.y ?? null,
          z: environment.playerPosition.z ?? null,
        }
      : null,
  };
}

function computeDurationSeconds(start: string | null, end: string | null): number | null {
  if (!start || !end) {
    return null;
  }

  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }

  if (endMs < startMs) {
    return 0;
  }

  return (endMs - startMs) / 1000;
}

export interface SessionReport {
  id: string;
  createdAt: string;
  closedAt?: string;
  clientIp?: string | null;
  clientMetadata: Record<string, unknown>;
  capturedFrameCount: number;
  trimmedFrameCount: number;
  totalFrameCount: number;
  startTimestamp: string | null;
  endTimestamp: string | null;
  durationSeconds: number | null;
  frameMetrics: FrameMetricSummary;
  resourceBytes: ResourceByteSummary;
  memory: MemorySummary;
  resourceInventory: ResourceInventorySummary | null;
  environmentSummary: EnvironmentSummary | null;
}

export function buildSessionReport(session: TelemetrySession): SessionReport {
  const frames = Array.isArray(session.frames) ? session.frames : [];
  const capturedFrameCount = frames.length;
  const trimmedFrameCount = session.trimmedFrameCount ?? 0;
  const totalFrameCount = session.totalFrameCount ?? capturedFrameCount + trimmedFrameCount;
  const firstFrame = frames[0] ?? null;
  const lastFrame = frames[capturedFrameCount - 1] ?? null;
  const startTimestamp = firstFrame?.timestampUtc ?? session.createdAt ?? null;
  const endTimestamp = lastFrame?.timestampUtc ?? session.closedAt ?? null;

  const resourceAccumulator = createResourceByteAccumulator();
  const memoryAccumulator = createMemoryAccumulator();
  frames.forEach((frame) => {
    addResourceSample(resourceAccumulator, frame);
    addMemorySample(memoryAccumulator, frame.memoryStats);
  });

  return {
    id: session.id,
    createdAt: session.createdAt,
    closedAt: session.closedAt,
    clientIp: session.clientIp,
    clientMetadata: session.client ?? {},
    capturedFrameCount,
    trimmedFrameCount,
    totalFrameCount,
    startTimestamp,
    endTimestamp,
    durationSeconds: computeDurationSeconds(startTimestamp, endTimestamp),
    frameMetrics: computeFrameMetrics(frames),
    resourceBytes: finalizeResourceBytes(resourceAccumulator),
    memory: finalizeMemory(memoryAccumulator),
    resourceInventory: buildResourceInventory(lastFrame),
    environmentSummary: summarizeEnvironment(lastFrame ?? firstFrame),
  };
}

export interface ServerConfigSnapshot {
  sampleIntervalSeconds: number;
  framePreviewScale: number;
  disableFramePreview: boolean;
  maxAssetsPerCategory: number;
  autoManageSession: boolean;
  assetCategoryVersion: number;
  assetCategories: AssetCategoryConfig;
  telemetrySections: TelemetrySectionConfig;
  history: {
    maxSessionFrames: number | null;
  };
}

function buildServerConfigSnapshot(config: ServerConfig | null | undefined): ServerConfigSnapshot | null {
  if (!config) {
    return null;
  }

  return {
    sampleIntervalSeconds: config.clientDefaults.sampleIntervalSeconds,
    framePreviewScale: config.clientDefaults.framePreviewScale,
    disableFramePreview: config.clientDefaults.disableFramePreview,
    maxAssetsPerCategory: config.clientDefaults.maxAssetsPerCategory,
    autoManageSession: config.clientDefaults.autoManageSession,
    assetCategoryVersion: config.clientDefaults.assetCategoryVersion,
    assetCategories: { ...config.clientDefaults.assetCategories },
    telemetrySections: { ...config.clientDefaults.telemetrySections },
    history: {
      maxSessionFrames: config.history?.maxSessionFrames ?? null,
    },
  };
}

export interface NetworkInfoSnapshot {
  hostname?: string;
  port?: number;
  addresses?: NetworkInfoResponse['addresses'];
}

function buildNetworkInfoSnapshot(info: NetworkInfoResponse | null | undefined): NetworkInfoSnapshot | null {
  if (!info) {
    return null;
  }

  return {
    hostname: info.hostname,
    port: info.port,
    addresses: Array.isArray(info.addresses) ? info.addresses.map((address) => ({ ...address })) : undefined,
  };
}

export interface GlobalReport {
  reportVersion: number;
  generatedAt: string;
  sessionCount: number;
  activeSessionCount: number;
  totalCapturedFrames: number;
  totalTrimmedFrames: number;
  totalFrameCountEstimate: number;
  distinctClientIps: string[];
  frameMetrics: FrameMetricSummary;
  resourceBytes: ResourceByteSummary;
  memory: MemorySummary;
  serverConfigSnapshot: ServerConfigSnapshot | null;
  networkInfo: NetworkInfoSnapshot | null;
  sessions: SessionReport[];
}

interface BuildGlobalReportOptions {
  sessions: TelemetrySession[];
  serverConfig?: ServerConfig | null;
  networkInfo?: NetworkInfoResponse | null;
}

export function buildGlobalReport({
  sessions,
  serverConfig,
  networkInfo,
}: BuildGlobalReportOptions): GlobalReport {
  const fpsAccumulator = createStatsAccumulator();
  const cpuFrameTimeAccumulator = createStatsAccumulator();
  const gpuFrameTimeAccumulator = createStatsAccumulator();
  const cpuMainThreadAccumulator = createStatsAccumulator();
  const cpuRenderThreadAccumulator = createStatsAccumulator();
  const resourceAccumulator = createResourceByteAccumulator();
  const memoryAccumulator = createMemoryAccumulator();
  let totalCapturedFrames = 0;
  let totalTrimmedFrames = 0;

  sessions.forEach((session) => {
    const frames = Array.isArray(session.frames) ? session.frames : [];
    totalCapturedFrames += frames.length;
    totalTrimmedFrames += session.trimmedFrameCount ?? 0;

    frames.forEach((frame) => {
      addSample(fpsAccumulator, frame.fps);
      addSample(cpuFrameTimeAccumulator, frame.frameTiming?.cpuFrameTimeMs);
      addSample(gpuFrameTimeAccumulator, frame.frameTiming?.gpuFrameTimeMs);
      addSample(cpuMainThreadAccumulator, frame.frameTiming?.cpuMainThreadTimeMs);
      addSample(cpuRenderThreadAccumulator, frame.frameTiming?.cpuRenderThreadTimeMs);
      addResourceSample(resourceAccumulator, frame);
      addMemorySample(memoryAccumulator, frame.memoryStats);
    });
  });

  const sessionReports = sessions.map((session) => buildSessionReport(session));
  const totalFrameCountEstimate = sessionReports.reduce((sum, report) => sum + report.totalFrameCount, 0);
  const distinctClientIps = Array.from(
    new Set(
      sessions
        .map((session) => (typeof session.clientIp === 'string' ? session.clientIp.trim() : ''))
        .filter((value) => value.length > 0)
    )
  ).sort();

  return {
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    sessionCount: sessions.length,
    activeSessionCount: sessions.filter((session) => !session.closedAt).length,
    totalCapturedFrames,
    totalTrimmedFrames,
    totalFrameCountEstimate,
    distinctClientIps,
    frameMetrics: {
      fps: finalizeStats(fpsAccumulator),
      cpuFrameTimeMs: finalizeStats(cpuFrameTimeAccumulator),
      gpuFrameTimeMs: finalizeStats(gpuFrameTimeAccumulator),
      cpuMainThreadTimeMs: finalizeStats(cpuMainThreadAccumulator),
      cpuRenderThreadTimeMs: finalizeStats(cpuRenderThreadAccumulator),
    },
    resourceBytes: finalizeResourceBytes(resourceAccumulator),
    memory: finalizeMemory(memoryAccumulator),
    serverConfigSnapshot: buildServerConfigSnapshot(serverConfig),
    networkInfo: buildNetworkInfoSnapshot(networkInfo),
    sessions: sessionReports,
  };
}

