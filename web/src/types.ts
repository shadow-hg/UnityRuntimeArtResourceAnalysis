export interface TextureInfo {
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
  name: string;
  path: string;
  passCount: number;
  keywords: string[];
  memoryBytes?: number;
}

export interface TelemetrySnapshot {
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
  textures: TextureInfo[];
  meshes: MeshInfo[];
  renderTextures?: RenderTextureInfo[];
  materials?: MaterialInfo[];
  shaders: ShaderInfo[];
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

export interface ClientDefaultsConfig {
  sampleIntervalSeconds: number;
  framePreviewScale: number;
  disableFramePreview: boolean;
  maxAssetsPerCategory: number;
  autoManageSession: boolean;
}

export interface HistoryConfig {
  maxSessionFrames: number;
}

export interface ServerConfig {
  clientDefaults: ClientDefaultsConfig;
  history: HistoryConfig;
}
