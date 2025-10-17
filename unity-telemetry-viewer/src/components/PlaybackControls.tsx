import React from 'react';

type Props = {
  playing: boolean;
  onPlayPause: () => void;
  speed: number;
  setSpeed: (value: number) => void;
  onStepForward?: () => void;
  onStepBack?: () => void;
};

const PlaybackControls: React.FC<Props> = ({ playing, onPlayPause, speed, setSpeed, onStepForward, onStepBack }) => {
  const handleSpeedChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSpeed(parseFloat(event.target.value));
  };

  return (
    <div className="panel playback-panel">
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
