import React, { useMemo } from 'react';
import { formatMemoryFromKB } from '../utils/format';
import {
  buildResourceSummary,
  getDisplayMemoryKB,
  getResourceCategory,
  isTextureCategory,
  ResourceSummary
} from '../utils/resourceMetadata';
import { collectActiveFrameResources } from '../utils/frameResources';

type Props = {
  frame: any | null;
  resourceCatalog?: Record<string, any> | undefined;
};

function pickCameraImage(camera: any): string | null {
  if (!camera || typeof camera !== 'object') return null;
  const preferredKeys = ['imageUrl', 'image', 'previewUrl', 'preview', 'thumbnailUrl', 'thumbnail', 'screenshot', 'screenshotUrl'];
  for (const key of preferredKeys) {
    const value = camera[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  const nestedCandidates = [camera.renderTarget, camera.renderTexture, camera.output, camera.capture, camera.source];
  for (const nested of nestedCandidates) {
    if (!nested || typeof nested !== 'object') continue;
    const nestedValue = pickCameraImage(nested);
    if (nestedValue) return nestedValue;
  }

  if (Array.isArray(camera.captures)) {
    for (const capture of camera.captures) {
      const captureValue = pickCameraImage(capture);
      if (captureValue) return captureValue;
    }
  }

  return null;
}

function pickThumbnail(frame: any | null, resourceCatalog?: Record<string, any>) {
  if (!frame) return null;

  const cameraImage = pickCameraImage(frame.camera);
  if (cameraImage) return cameraImage;

  const directSources = [
    frame.thumbnailUrl,
    frame.thumbnail,
    frame.previewUrl,
    frame.preview?.url,
    frame.screenshotUrl,
    frame.screenshot?.url,
    frame.image,
    frame.imageUrl
  ].map((value) => (typeof value === 'string' ? value : null));

  const direct = directSources.find((value) => value && value.trim().length > 0);
  if (direct) return direct;

  if (Array.isArray(frame.resourceSnapshot)) {
    for (const res of frame.resourceSnapshot) {
      if (!res) continue;
      const thumb = res.thumbnailUrl || res.thumbnail || res.previewUrl || res.preview;
      if (typeof thumb === 'string' && thumb.trim()) {
        return thumb;
      }
    }
  }

  if (resourceCatalog && Array.isArray(frame.resources)) {
    for (const rid of frame.resources) {
      if (typeof rid !== 'string') continue;
      const res = resourceCatalog[rid];
      if (!res) continue;
      const thumb = res.thumbnailUrl || res.thumbnail || res.previewUrl || res.preview;
      if (typeof thumb === 'string' && thumb.trim()) {
        return thumb;
      }
    }
  }

  if (frame.lastRenderTexture && typeof frame.lastRenderTexture === 'object') {
    const thumb = frame.lastRenderTexture.thumbnailUrl || frame.lastRenderTexture.thumbnail;
    if (typeof thumb === 'string' && thumb.trim()) {
      return thumb;
    }
  }

  return null;
}

const FrameViewer: React.FC<Props> = ({ frame, resourceCatalog }) => {
  const hasFrame = !!frame;
  const image = pickThumbnail(frame, resourceCatalog) || null;
  const frameIndex = typeof frame?.frameIndex === 'number' ? `#${frame.frameIndex}` : '';
  const scene = frame?.sceneName || frame?.state || '未命名场景';
  const timestamp = frame?.timestamp ? new Date(frame.timestamp) : null;
  const activeResources = useMemo(
    () => collectActiveFrameResources(frame, resourceCatalog),
    [frame, resourceCatalog]
  );

  const textureSummaries = useMemo(() => {
    if (!activeResources || activeResources.length === 0) return [] as {
      key: string;
      name: string;
      displayMemoryKB: number;
      compressedKB: number;
      dimensions: string | null;
      format: string | null;
    }[];

    const cache = new WeakMap<any, ResourceSummary>();

    return activeResources
      .map((resource, index) => {
        const category = getResourceCategory(resource);
        if (!isTextureCategory(category)) return null;

        const summary = cache.get(resource) || buildResourceSummary(resource);
        if (!cache.has(resource)) {
          cache.set(resource, summary);
        }

        const displayMemoryKB = getDisplayMemoryKB(resource, summary);
        const compressedKB = summary.compressedKB;
        const name = resource.name || resource.id || `纹理 ${index + 1}`;
        const key = resource.id || resource.guid || name || `texture-${index}`;

        return {
          key,
          name,
          displayMemoryKB,
          compressedKB,
          dimensions: summary.dimensions || null,
          format: summary.format || null
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => b.displayMemoryKB - a.displayMemoryKB);
  }, [activeResources]);

  return (
    <div className="panel frame-viewer">
      <div className="panel-header">
        <div className="panel-title">帧画面</div>
        {hasFrame && (
          <div className="frame-viewer__meta">
            {frameIndex && <span className="badge badge--outline">{frameIndex}</span>}
            <span className="frame-viewer__scene">{scene}</span>
            {timestamp && <span className="frame-viewer__timestamp">{timestamp.toLocaleTimeString()}</span>}
          </div>
        )}
      </div>
      <div className="frame-viewer__content">
        {image ? (
          <img src={image} alt="Frame thumbnail" className="frame-viewer__image" />
        ) : (
          <div className="frame-viewer__empty">
            <span>{hasFrame ? '未收到缩略图，请检查客户端是否开启缩略图上传' : '等待帧数据'}</span>
          </div>
        )}
      </div>
      {textureSummaries.length > 0 && (
        <div className="frame-viewer__details">
          <div className="frame-viewer__details-title">纹理概览</div>
          <ul className="frame-viewer__texture-list">
            {textureSummaries.map((texture) => {
              const showCompressed = texture.compressedKB > 0;
              return (
                <li key={texture.key} className="frame-viewer__texture-item">
                  <div className="frame-viewer__texture-name">{texture.name}</div>
                  <div className="frame-viewer__texture-meta">
                    <span>{formatMemoryFromKB(texture.displayMemoryKB)}</span>
                    {showCompressed && (
                      <span className="frame-viewer__texture-meta-secondary">
                        压缩 {formatMemoryFromKB(texture.compressedKB)}
                      </span>
                    )}
                    {texture.dimensions && <span>{texture.dimensions}</span>}
                    {texture.format && <span>{texture.format}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

export default FrameViewer;