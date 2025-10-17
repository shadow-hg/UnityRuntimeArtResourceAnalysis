import React, { useEffect, useMemo, useState } from 'react';

type Props = {
  telemetryData: any[];
  currentIndex?: number;
  onSeek?: (index: number) => void;
};

const Timeline: React.FC<Props> = ({ telemetryData, currentIndex = -1, onSeek }) => {
  const [localIndex, setLocalIndex] = useState<number>(currentIndex);

  useEffect(() => {
    setLocalIndex(currentIndex);
  }, [currentIndex]);

  const max = Math.max(0, telemetryData.length - 1);
  const currentFrame = useMemo(() => {
    if (localIndex < 0 || localIndex >= telemetryData.length) return null;
    return telemetryData[localIndex];
  }, [telemetryData, localIndex]);

  return (
    <div className="panel timeline-panel">
      <div className="panel-header">
        <div className="panel-title">帧滑轨</div>
        <div className="badge">{telemetryData.length}</div>
      </div>
      <div className="timeline-panel__slider">
        <input
          type="range"
          min={0}
          max={max}
          value={localIndex < 0 ? max : localIndex}
          onChange={(event) => {
            const idx = parseInt(event.target.value, 10);
            setLocalIndex(idx);
            if (onSeek) onSeek(idx);
          }}
        />
        <div className="timeline-panel__scale">
          <span>0</span>
          <span>{max}</span>
        </div>
      </div>
      {currentFrame && (
        <div className="timeline-panel__details">
          <pre>{JSON.stringify(currentFrame, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

export default Timeline;