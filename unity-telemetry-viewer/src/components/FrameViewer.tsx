import React from 'react';

type Props = {
  frame: any | null;
};

const FrameViewer: React.FC<Props> = ({ frame }) => {
  const hasFrame = !!frame;
  const image = frame?.thumbnailUrl || frame?.thumbnail || null;
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
            <span>{hasFrame ? '未收到缩略图' : '等待帧数据'}</span>
          </div>
        )}
      </div>
      {hasFrame && (
        <details className="frame-viewer__details">
          <summary>原始数据</summary>
          <pre>{JSON.stringify(frame, null, 2)}</pre>
        </details>
      )}
    </div>
  );
};

export default FrameViewer;