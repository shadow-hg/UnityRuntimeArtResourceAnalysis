# Unity Telemetry Relay Server

This small Node.js service relays telemetry messages from Unity mobile builds to browser clients in real-time.

Features:
- WebSocket relay: Unity clients connect and send JSON messages; browser clients receive broadcast frames.
- Thumbnail upload endpoint (/upload/thumb) for larger binary blobs.
- Simple admin endpoints: /api/clients, /api/timeline/:clientId, /api/catalog/:clientId
- Static hosting hook: serves files from `../unity-telemetry-viewer/dist` if you build the frontend there.

Run:

1. Install dependencies:

```bash
cd telemetry-server
npm install
```

2. Start server:

```bash
npm start
```

3. By default server listens on port 8080. Configure PORT env to change.

WebSocket protocol (simple):

- Client connects to ws://server:PORT
- First message should be a small hello JSON: { "role": "unity" | "browser", "clientId": "device-123" }
- Then Unity sends frame messages: { type: 'frame', frameIndex, timestamp, sceneName, dt, metrics, resources, thumbnailUrl }

Thumbnail upload:

- POST multipart/form-data to /upload/thumb with fields: thumb (file), clientId, frameIndex
- Response: { url: "/thumbs/client-frame.jpg" }

Notes:
- This server keeps timeline and resource catalog data in memory. For production, add persistence.
- For large scale or public deployment, enable authentication and TLS.
