# UnityProfileV2 Web Dashboard

A PerfDog/UWA-inspired dashboard built with Vite, React, and Ant Design. The dashboard connects to the UnityProfileV2 telemetry server and visualises real-time frame metrics alongside a browsable resource hierarchy.

## Features

- **Timeline** – Live-updating timeline (powered by `vis-timeline`) with adjustable frame window.
- **Resource Explorer** – Drill down into textures, meshes, and shaders with sorting and search.
- **Session Sidebar** – Browse historical sessions stored by the telemetry server.

## Getting Started

```bash
npm install
npm run dev
```

## Production build

```bash
npm start
```

By default the dashboard connects to `http://localhost:48080`. Override this by setting `VITE_SERVER_URL` in an `.env` file.
