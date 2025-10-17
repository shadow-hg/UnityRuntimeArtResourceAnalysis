import React from 'react';

type Props = {
  playing: boolean;
  onPlayPause: () => void;
  speed: number;
  setSpeed: (value: number) => void;
  onStepForward?: () => void;
  onStepBack?: () => void;
  className?: string;
  appearance?: 'panel' | 'floating' | 'inline';
};

const PlaybackControls: React.FC<Props> = ({
  playing,
  onPlayPause,
  speed,
  setSpeed,
  onStepForward,
  onStepBack,
  className,
  appearance = 'panel'
}) => {
  const handleSpeedChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(event.target.value);
    if (!Number.isNaN(value)) {
      setSpeed(value);
    }
  };

  if (appearance === 'floating') {
    return (
      <div className={`playback-panel playback-panel--floating ${className ?? ''}`}>
        <button
          type="button"
          className="icon-button"
          onClick={() => onStepBack && onStepBack()}
          disabled={!onStepBack}
          aria-label="上一帧"
        >
          ‹
        </button>
        <button
          type="button"
          className={`button ${playing ? 'button--ghost' : 'button--primary'}`}
          onClick={onPlayPause}
          aria-label={playing ? '暂停' : '播放'}
        >
          {playing ? '暂停' : '播放'}
        </button>
        <div className="playback-panel__speed">
          <span className="playback-panel__label">速度</span>
          <input
            aria-label="播放速度"
            type="range"
            min="0.25"
            max="2"
            step="0.25"
            value={speed}
            onChange={handleSpeedChange}
          />
          <span className="playback-panel__value">×{speed.toFixed(2)}</span>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => onStepForward && onStepForward()}
          disabled={!onStepForward}
          aria-label="下一帧"
        >
          ›
        </button>
      </div>
    );
  }

  if (appearance === 'inline') {
    return (
      <div className={`playback-panel playback-panel--inline ${className ?? ''}`}>
        <button
          type="button"
          className="icon-button"
          onClick={() => onStepBack && onStepBack()}
          disabled={!onStepBack}
          aria-label="上一帧"
        >
          ‹
        </button>
        <button type="button" className={`button ${playing ? 'button--ghost' : 'button--primary'}`} onClick={onPlayPause} aria-label={playing ? '暂停' : '播放'}>
          {playing ? '暂停' : '播放'}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => onStepForward && onStepForward()}
          disabled={!onStepForward}
          aria-label="下一帧"
        >
          ›
        </button>
        <div className="playback-panel__speed">
          <span className="playback-panel__label">速度</span>
          <input
            aria-label="播放速度"
            type="range"
            min="0.25"
            max="2"
            step="0.25"
            value={speed}
            onChange={handleSpeedChange}
          />
          <span className="playback-panel__value">×{speed.toFixed(2)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`panel playback-panel ${className ?? ''}`}>
      <div className="panel-header">
        <div className="panel-title">播放控制</div>
      </div>
      <div className="playback-panel__controls">
        <div className="playback-panel__buttons">
          <button
            type="button"
            className="icon-button"
            onClick={() => onStepBack && onStepBack()}
            disabled={!onStepBack}
            aria-label="上一帧"
          >
            ‹
          </button>
          <button type="button" className="button button--primary" onClick={onPlayPause} aria-label={playing ? '暂停' : '播放'}>
            {playing ? '暂停' : '播放'}
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => onStepForward && onStepForward()}
            disabled={!onStepForward}
            aria-label="下一帧"
          >
            ›
          </button>
        </div>
        <div className="playback-panel__speed">
          <label htmlFor="speed" className="playback-panel__label">速度</label>
          <input
            id="speed"
            type="range"
            min="0.25"
            max="2"
            step="0.25"
            value={speed}
            onChange={handleSpeedChange}
          />
          <span className="playback-panel__value">×{speed.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
};

export default PlaybackControls;
