export interface TextureInfo {
  instanceId?: number;
  name: string;
  path: string;
  width: number;
  height: number;
  format: string | number;
  formatName?: string;
  graphicsFormat?: string;
  compressionFormat?: string;
  wrapMode: string | number;
  filterMode: string | number;
  mipCount?: number;
  originalBytes: number;
  EstimatedBytes: number;
  previewUrl?: string;
  previewBase64?: string;
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
}

export interface FramePreviewInfo {
  previewUrl?: string;
  previewBase64?: string;
  imageBase64?: string;
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
}

export interface TelemetrySession {
  id: string;
  createdAt: string;
  closedAt?: string;
  client: Record<string, unknown>;
  clientIp?: string | null;
  frames: TelemetrySnapshot[];
  trimmedFrameCount?: number;
  totalFrameCount?: number;
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

export interface ClientDefaultsConfig {
  sampleIntervalSeconds: number;
  framePreviewScale: number;
  disableFramePreview: boolean;
  maxAssetsPerCategory: number;
  autoManageSession: boolean;
  assetCategoryVersion: number;
  assetCategories: AssetCategoryConfig;
}

export interface HistoryConfig {
  maxSessionFrames: number;
}

export interface ServerConfig {
  clientDefaults: ClientDefaultsConfig;
  history: HistoryConfig;
}
