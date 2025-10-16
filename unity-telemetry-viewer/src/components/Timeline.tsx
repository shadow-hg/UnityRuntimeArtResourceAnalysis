import React, { useEffect, useState } from 'react';
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

    return (
        <div className="timeline" style={{ padding: 8 }}>
            <h3>Timeline ({telemetryData.length})</h3>
            <input
                type="range"
                min={0}
                max={max}
                value={localIndex < 0 ? max : localIndex}
                onChange={(e) => {
                    const idx = parseInt(e.target.value, 10);
                    setLocalIndex(idx);
                    if (onSeek) onSeek(idx);
                }}
                style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <small>0</small>
                <small>{max}</small>
            </div>
            <div style={{ marginTop: 8 }}>
                {localIndex >= 0 && telemetryData[localIndex] && (
                    <pre style={{ maxHeight: 240, overflow: 'auto' }}>{JSON.stringify(telemetryData[localIndex], null, 2)}</pre>
                )}
            </div>
        </div>
    );
};

export default Timeline;