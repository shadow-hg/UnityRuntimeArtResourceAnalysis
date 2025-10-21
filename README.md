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

## Running the server and web client together

The repository includes helper scripts at the root level for a fast local
development experience:

* `start-dev.sh` – Bash script for macOS/Linux environments.
* `start-dev.ps1` – PowerShell script for Windows environments.

1. Install the dependencies for the API server and web dashboard:
   ```bash
   (cd server && npm install)
   (cd web && npm install)
   ```
2. Ensure `npx` is available (it is bundled with recent Node.js releases).
3. Launch both services with a single command from the repository root:
   * macOS/Linux (Bash):
     ```bash
     ./start-dev.sh
     ```
   * Windows (PowerShell):
     ```powershell
     .\start-dev.ps1
     ```

By default each script starts the server on port `48080` and the web client on
port `5175`. Set the `SERVER_PORT` and/or `WEB_PORT` environment variables, or
pass `-ServerPort` / `-WebPort` parameters when using PowerShell, if you need to
override the defaults. For example:

```bash
SERVER_PORT=5000 WEB_PORT=3000 ./start-dev.sh
```

```powershell
./start-dev.ps1 -ServerPort 5000 -WebPort 3000
```

Both scripts automatically free any lingering processes bound to the selected
ports before starting and will stop both processes when you interrupt them
(Ctrl+C).
