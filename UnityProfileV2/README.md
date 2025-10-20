# UnityProfileV2

UnityProfileV2 is a complete telemetry pipeline tailored for Unity projects. It consists of three cooperative pieces:

1. **Unity Client** – A Unity project that records art asset usage (textures, meshes, shaders) and rendering statistics while a build or the editor is running. The data is normalized and streamed to the telemetry server.
2. **Telemetry Server** – An Express-based Node.js service that ingests telemetry sessions from the Unity client, persists the history to disk, and rebroadcasts new events to web consumers in real time via Socket.IO.
3. **Web Front-end** – A Vite + React dashboard that mimics PerfDog/UWA style dashboards. It includes a timeline visualization, hierarchical resource browser, sorting, and filtering for art asset telemetry.

Each project can be worked on independently, but together they deliver a feedback loop for analyzing runtime art resource usage in live builds or play sessions.

## Project Structure

```
UnityProfileV2/
├── Client/                  # Unity project for collecting telemetry
├── server/                  # Node.js telemetry ingestion service
└── web/                     # React dashboard for timeline + asset browsing
```

Consult the documentation inside each subproject for setup instructions.
