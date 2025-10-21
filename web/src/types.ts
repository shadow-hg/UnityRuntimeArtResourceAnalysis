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
  totalShaderBytes?: number;
  shaderMemoryBytes?: number;
  textures: TextureInfo[];
  meshes: MeshInfo[];
  renderTextures?: RenderTextureInfo[];
  shaders: ShaderInfo[];
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
