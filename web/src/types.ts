export interface TextureInfo {
  name: string;
  path: string;
  width: number;
  height: number;
  format: string;
  wrapMode: string;
  filterMode: string;
  originalBytes: number;
  EstimatedBytes: number;
}

export interface MeshInfo {
  name: string;
  path: string;
  vertexCount: number;
  subMeshCount: number;
  EstimatedBytes: number;
}

export interface ShaderInfo {
  name: string;
  path: string;
  passCount: number;
  keywords: string[];
}

export interface TelemetrySnapshot {
  timestampUtc: string;
  frameNumber: number;
  fps: number;
  deltaTime: number;
  totalTextureBytes: number;
  totalMeshBytes: number;
  textures: TextureInfo[];
  meshes: MeshInfo[];
  shaders: ShaderInfo[];
}

export interface TelemetrySession {
  id: string;
  createdAt: string;
  closedAt?: string;
  client: Record<string, unknown>;
  frames: TelemetrySnapshot[];
}

export interface TimelinePoint {
  id: string;
  content: string;
  start: Date;
  frame: TelemetrySnapshot;
}
