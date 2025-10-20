# UnityProfileV2 Telemetry Server

This Node.js service ingests telemetry sessions produced by the UnityProfileV2 client. The API is intentionally simple so it can be deployed locally alongside a development machine or in a production environment.

## Features

- REST API for registering sessions and uploading frame snapshots.
- Socket.IO channel that pushes session and frame events to connected dashboards in real time.
- File-based persistence (`data/telemetry-history.json`) to retain history across restarts.

## Scripts

```bash
npm install
npm run dev   # start with nodemon
npm start     # start without auto-reload
```

## API Overview

- `POST /sessions` – register a new session. Returns `{ sessionId, createdAt }`.
- `POST /sessions/{id}/frames` – append a frame snapshot.
- `POST /sessions/{id}/close` – mark a session as closed.
- `GET /sessions` – list all sessions with history.
- `GET /sessions/{id}` – fetch a single session and its frames.

The server defaults to port `48080`. Configure the `PORT` environment variable to override.
