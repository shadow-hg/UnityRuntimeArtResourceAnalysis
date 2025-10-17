import React from 'react';

type Props = {
  frame: any | null;
  resourceCatalog?: Record<string, any> | undefined;
};

function pickThumbnail(frame: any | null, resourceCatalog?: Record<string, any>) {
  if (!frame) return null;

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
    </div>
  );
};

export default FrameViewer;