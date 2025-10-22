# UnityProfileV2 Client

This folder contains a Unity project configured to capture runtime art asset telemetry and send it to the UnityProfileV2 telemetry server.

## Key Components

- **AssetTelemetryReporter.cs** – Runtime component that samples textures, meshes, shaders, and rendering performance, then transmits the data to the telemetry server.
- **AssetTelemetryMenu.cs** – Editor utility that makes it easy to add the reporter to the current scene.
- **Packages/manifest.json** – Minimal Unity package manifest so the project opens cleanly in Unity 2021.3+.

## Usage

1. Open the project in Unity (2021.3 or newer recommended).
2. Use `Tools/UnityProfileV2/Add Telemetry Reporter` to add the `AssetTelemetryReporter` to the active scene.
3. Enter Play mode. The reporter will automatically register a session with the telemetry server and start sending telemetry data on a configurable interval.
4. Use the in-game “Telemetry Server” floating window to override the server endpoint on a target device. The override is saved between launches; leaving the field blank reverts to the auto-detected address.

By default the reporter points to `http://localhost:48080`. Adjust the endpoint in the inspector (or via the floating window) to match the actual server location.
