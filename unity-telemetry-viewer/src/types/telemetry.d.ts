interface TelemetryData {
    frameId: number;
    timestamp: number;
    position: {
        x: number;
        y: number;
        z: number;
    };
    rotation: {
        x: number;
        y: number;
        z: number;
        w: number;
    };
    velocity: {
        x: number;
        y: number;
        z: number;
    };
    input: {
        [key: string]: any; // 可以根据需要定义具体的输入数据结构
    };
}

interface TelemetryFrame {
    frameId: number;
    data: TelemetryData;
}

interface TelemetryResponse {
    frames: TelemetryFrame[];
    currentFrameId: number;
}