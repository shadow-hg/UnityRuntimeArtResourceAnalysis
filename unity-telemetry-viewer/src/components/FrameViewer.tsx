import React, { useEffect, useMemo, useState } from 'react';

type Props = {
  frame: any | null;
  resourceCatalog?: Record<string, any> | undefined;
  clientId?: string | null;
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

type LastPreview = {
  clientId: string | null;
  image: string;
  frameIndex: number | null;
  timestamp: number | null;
};

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

const FrameViewer: React.FC<Props> = ({ frame, resourceCatalog, clientId = null }) => {
  const hasFrame = !!frame;
  const image = pickThumbnail(frame, resourceCatalog) || null;
  const frameIndex = typeof frame?.frameIndex === 'number' ? `#${frame.frameIndex}` : '';
  const scene = frame?.sceneName || frame?.state || '未命名场景';
  const timestamp = frame?.timestamp ? new Date(frame.timestamp) : null;
  const [lastPreview, setLastPreview] = useState<LastPreview | null>(null);

  useEffect(() => {
    setLastPreview((prev) => {
      if (!clientId || !frame) {
        return null;
      }

      if (image) {
        return {
          clientId,
          image,
          frameIndex: typeof frame.frameIndex === 'number' ? frame.frameIndex : null,
          timestamp: parseTimestamp(frame.timestamp)
        };
      }

      if (prev && prev.clientId === clientId) {
        return prev;
      }

      return null;
    });
  }, [clientId, frame, image]);

  const displayPreview = image || (lastPreview && lastPreview.clientId === clientId ? lastPreview.image : null);

  const fallbackFrameIndex = useMemo(() => {
    if (!displayPreview) return null;
    if (image) return typeof frame?.frameIndex === 'number' ? frame.frameIndex : null;
    if (lastPreview && lastPreview.clientId === clientId) {
      return lastPreview.frameIndex;
    }
    return null;
  }, [clientId, displayPreview, frame, image, lastPreview]);

  const fallbackTimestamp = useMemo(() => {
    if (!displayPreview) return null;
    if (image) return parseTimestamp(frame?.timestamp);
    if (lastPreview && lastPreview.clientId === clientId) {
      return lastPreview.timestamp;
    }
    return null;
  }, [clientId, displayPreview, frame, image, lastPreview]);

  const fallbackDate = fallbackTimestamp ? new Date(fallbackTimestamp) : null;
  const isFallback = Boolean(displayPreview && !image);

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
        {displayPreview ? (
          <>
            <img src={displayPreview} alt="Frame thumbnail" className="frame-viewer__image" />
            {isFallback && (
              <div className="frame-viewer__stale-badge">
                {fallbackFrameIndex !== null ? `展示上次捕获帧 #${fallbackFrameIndex}` : '展示最近捕获画面'}
              </div>
            )}
          </>
        ) : (
          <div className="frame-viewer__empty">
            <span>{hasFrame ? '未收到缩略图，请检查客户端是否开启缩略图上传' : '等待帧数据'}</span>
          </div>
        )}
      </div>
      {isFallback && (
        <div className="frame-viewer__hint">
          当前帧未上传缩略图，正在显示最近捕获的画面
          {fallbackDate ? `（${fallbackDate.toLocaleTimeString()}）` : ''}。
        </div>
      )}
    </div>
  );
};

export default FrameViewer;
