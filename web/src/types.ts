export interface TextureInfo {
  __textureRef?: boolean;
  instanceId?: number | null;
  textureId?: string;
  name?: string;
  path?: string;
  width?: number;
  height?: number;
  format?: string | number;
  formatName?: string;
  graphicsFormat?: string;
  compressionFormat?: string;
  wrapMode?: string | number;
  filterMode?: string | number;
  mipCount?: number;
  originalBytes?: number;
  EstimatedBytes?: number;
  previewUrl?: string;
  previewBase64?: string;
  previewMimeType?: string;
  isRenderTexture?: boolean;
  textureClass?: string;
}

export interface MeshInfo {
  instanceId?: number;
  name: string;
  path: string;
  vertexCount: number;
  subMeshCount: number;
  boundsSizeX?: number;
  boundsSizeY?: number;
  boundsSizeZ?: number;
  vertexAttributes?: string[];
  assetBytes?: number;
  EstimatedBytes: number;
}

export interface RenderTextureInfo {
  instanceId?: number;
  name: string;
  width: number;
  height: number;
  depth: number;
  mipCount: number;
  useMipMap: boolean;
  dimension: string;
  format: string;
  graphicsFormat: string;
  antiAliasing: number;
  EstimatedBytes: number;
  previewUrl?: string;
  previewBase64?: string;
  previewMimeType?: string;
}

export interface FramePreviewInfo {
  previewUrl?: string;
  previewBase64?: string;
  imageBase64?: string;
  previewMimeType?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  captureTimestampUtc?: string;
  orientation?: 'portrait' | 'landscape' | 'square' | string;
}

export interface MaterialTextureReference {
  propertyName: string;
  textureName?: string;
  texturePath?: string;
  textureClass?: string;
}

export interface MaterialInfo {
  instanceId?: number;
  name: string;
  path: string;
  shaderName?: string;
  shaderPath?: string;
  renderQueue: number;
  enableInstancing: boolean;
  doubleSidedGI: boolean;
  keywords: string[];
  memoryBytes?: number;
  textures?: MaterialTextureReference[];
}

export interface ShaderInfo {
  instanceId?: number;
  name: string;
  path: string;
  passCount: number;
  keywords: string[];
  memoryBytes?: number;
  totalVariantCount?: number;
}

export interface ShaderVariantStats {
  shaderCount: number;
  totalVariants: number;
}

export interface PipelineStageTiming {
  stage: string;
  timeMs?: number;
  contributionPercent?: number;
}

export interface DrawCallStats {
  drawCalls?: number;
  setPassCalls?: number;
  shadowDrawCalls?: number;
  transparentDrawCalls?: number;
  instancedBatches?: number;
  dynamicBatches?: number;
}

export type BottleneckSeverity = 'info' | 'warning' | 'critical';

export interface BottleneckHint {
  type?: string;
  message: string;
  severity?: BottleneckSeverity;
  source?: string;
}

export interface FrameTimingInfo {
  cpuFrameTimeMs?: number;
  gpuFrameTimeMs?: number;
  cpuMainThreadTimeMs?: number;
  cpuRenderThreadTimeMs?: number;
  pipelineStages?: PipelineStageTiming[];
  drawCalls?: DrawCallStats;
  bottleneckHints?: BottleneckHint[];
}

export interface GarbageCollectionStats {
  totalCollections?: number;
  lastCollectionDurationMs?: number;
  managedHeapSizeBytes?: number;
  recentCollectionDurationMs?: number;
}

export interface MemoryStats {
  unityHeapBytes?: number;
  nativeMemoryBytes?: number;
  gpuMemoryBytes?: number;
  texturePoolBytes?: number;
  meshPoolBytes?: number;
  otherMemoryBytes?: number;
  gc?: GarbageCollectionStats | null;
}

export interface ThreadUtilizationSample {
  threadName: string;
  utilizationPercent?: number;
  frameTimeMs?: number;
}

export interface ThreadStats {
  utilization?: ThreadUtilizationSample[];
  mainThreadPercent?: number;
  renderThreadPercent?: number;
  jobWorkerPercent?: number;
}

export type AssetLoadStatus = 'success' | 'failed' | 'in-progress';

export interface AssetLoadSample {
  name?: string;
  durationMs?: number;
  status?: AssetLoadStatus;
  sizeBytes?: number;
  type?: string;
  timestampUtc?: string;
}

export interface ResourceInstanceStats {
  resourceType?: string;
  activeCount?: number;
  peakCount?: number;
}

export interface ResourceUnloadEvent {
  resourceType?: string;
  name?: string;
  timestampUtc?: string;
}

export interface StreamingStatus {
  type: string;
  bufferedSeconds?: number;
  droppedFrames?: number;
  isStalled?: boolean;
}

export interface AssetIoStats {
  assetBundleAverageLoadMs?: number;
  addressableAverageLoadMs?: number;
  asyncQueueLength?: number;
  loadFailureRate?: number;
  recentLoads?: AssetLoadSample[];
  resourceInstances?: ResourceInstanceStats[];
  unloadEvents?: ResourceUnloadEvent[];
  streamingStatuses?: StreamingStatus[];
}

export interface PositionInfo {
  x?: number;
  y?: number;
  z?: number;
}

export interface EnvironmentInfo {
  gpuModel?: string;
  gpuDriverVersion?: string;
  cpuModel?: string;
  cpuCoreCount?: number;
  qualitySetting?: string;
  screenResolution?: string;
  screenRefreshRate?: number;
  platform?: string;
  sceneId?: string;
  sceneName?: string;
  playerPosition?: PositionInfo | null;
  cameraHeight?: number;
  extra?: Record<string, unknown> | EnvironmentExtraEntry[] | null;
}

export interface EnvironmentExtraEntry {
  key: string;
  value?: unknown;
}

export interface TelemetrySnapshot {
  isIncremental?: boolean;
  timestampUtc: string;
  frameNumber: number;
  fps: number;
  deltaTime: number;
  totalTextureBytes: number;
  totalMeshBytes: number;
  totalRenderTextureBytes?: number;
  totalMaterialBytes?: number;
  totalShaderBytes?: number;
  shaderMemoryBytes?: number;
  textureOrder?: number[];
  textures: TextureInfo[];
  meshOrder?: number[];
  meshes: MeshInfo[];
  renderTextureOrder?: number[];
  renderTextures?: RenderTextureInfo[];
  materialOrder?: number[];
  materials?: MaterialInfo[];
  shaderOrder?: number[];
  shaders: ShaderInfo[];
  shaderVariantStats?: ShaderVariantStats;
  framePreview?: FramePreviewInfo | null;
  frameTiming?: FrameTimingInfo | null;
  memoryStats?: MemoryStats | null;
  threadStats?: ThreadStats | null;
  assetIo?: AssetIoStats | null;
  environment?: EnvironmentInfo | null;
}

export interface TimelinePoint {
  id: string | number;
  content: string;
  start: Date;
  frame: TelemetrySnapshot;
}

export interface NetworkInterfaceInfo {
  interface: string;
  address: string;
  url: string;
}

export interface NetworkInfoResponse {
  hostname: string;
  port: number;
  addresses: NetworkInterfaceInfo[];
}

export interface AssetCategoryConfig {
  includeTextures: boolean;
  includeMeshes: boolean;
  includeRenderTextures: boolean;
  includeMaterials: boolean;
  includeShaders: boolean;
}

export interface TelemetrySectionConfig {
  includeFrameInsights: boolean;
  includeSystemStats: boolean;
  includeAssetIo: boolean;
  includeEnvironment: boolean;
}

export interface ClientDefaultsConfig {
  sampleIntervalSeconds: number;
  framePreviewScale: number;
  disableFramePreview: boolean;
  maxAssetsPerCategory: number;
  resourceHotspotTopCount: number;
  lifecycleTopCount: number;
  autoManageSession: boolean;
  assetCategoryVersion: number;
  assetCategories: AssetCategoryConfig;
  telemetrySections: TelemetrySectionConfig;
}

export interface HistoryConfig {
  maxSessionFrames: number;
}

export interface ServerConfig {
  clientDefaults: ClientDefaultsConfig;
  history: HistoryConfig;
}

export type SessionSortOrder = 'newest' | 'oldest' | 'frames-desc' | 'frames-asc';

export type SessionStatusFilter = 'all' | 'active' | 'closed';

export type SessionGrouping = 'ip' | 'account' | 'device' | 'product' | 'platform';

export interface TelemetrySession {
  id: string;
  createdAt: string;
  closedAt?: string;
  client: Record<string, unknown>;
  clientIp?: string | null;
  frames?: TelemetrySnapshot[];
  trimmedFrameCount?: number;
  totalFrameCount?: number;
  /**
   * Cached, normalized tokens for quick session search matching. These are defined as
   * non-enumerable properties to avoid leaking back to the telemetry server when
   * sessions are serialized.
   */
  searchTokens?: string[];
  /**
   * Cached grouping keys keyed by grouping strategy. Like {@link searchTokens}, they are
   * stored as non-enumerable properties.
   */
  groupKeys?: Partial<Record<SessionGrouping, string>>;
}

export interface SessionGroupingItem {
  value: string;
  label: string;
  sessionCount: number;
  activeSessionCount: number;
}
