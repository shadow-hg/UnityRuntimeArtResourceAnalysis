Unity Telemetry LAN Test Script

Purpose
- Verify end-to-end telemetry from a Unity mobile build to the relay server and browser UI over a LAN.

Prerequisites
- Server machine running `telemetry-server` reachable on LAN (e.g., 192.168.1.100). Ensure port 8080 is open.
- Build of Unity app with `TelemetrySender` included, pointing to WebSocket URL `ws://<server-ip>:8080` and HTTP URL `http://<server-ip>:8080`.
- Device (mobile) and a laptop/desktop browser on same LAN.

Checklist & Steps

1) Start server
- On server machine (where repo is), run:

```bash
cd /workspaces/UnityRuntimeArtResourceAnalysis/telemetry-server
npm start
```

- Confirm console: "Telemetry server listening on http://0.0.0.0:8080"

2) Verify frontend served
- From your test laptop, open browser to:

http://<server-ip>:8080/static/index.html

- Expect to see the Unity Telemetry Viewer UI.

3) Prepare Unity build
- In Unity, set `TelemetrySender.serverWsUrl = "ws://<server-ip>:8080"` and `TelemetrySender.serverHttpUrl = "http://<server-ip>:8080"`.
- Ensure `TelemetrySender` component is enabled in the main scene.
- Ensure `Newtonsoft.Json` package is installed and Api Compatibility set to .NET 4.x.
- Build the app for your target mobile platform and install it on the device.

4) Start test run on device
- Launch the built Unity app on the mobile device.
- In server console you should see a WebSocket connection and logs like: "[ws] connected unity <clientId>" and periodic frame broadcasts.
- In browser (Telemetry Viewer), verify frames begin to appear in FrameList and Timeline. You should see `sceneName` and timestamp values.

5) Verify thumbnails and resources
- Observe in the Resource panel that resource catalog entries appear and thumbnails load (if `sendResourceSnapshots` and thumbnail upload are enabled).
- In the FrameViewer you should see periodic thumbnails from the device if `sendThumbnail` is true.

6) Test resource -> frame mapping
- Click a resource in the ResourcePanel. The viewer should jump to a frame that references that resource (first match). Note failures if no frame is found.

7) Network / bandwidth observations
- While running, check server network usage (e.g., `iftop` or `nethogs`) to estimate uploaded thumbnail bandwidth. Large thumbnails every frame can saturate mobile.
- If bandwidth is high, reduce `thumbnailIntervalFrames` or lower `thumbnailWidth` and `jpegQuality` in `TelemetrySender`.

8) Common troubleshooting
- If no frames appear in browser:
  - Confirm server reachable from device (on device browser visit http://<server-ip>:8080/api/clients).
  - Confirm WebSocket URL matches server (`ws://<server-ip>:8080`).
  - Check server logs for invalid JSON or upload errors.
- If thumbnails do not appear:
  - Confirm `TelemetrySender` attempted upload (Unity logs). Check server `/thumbs` folder for saved files.
- If ClientWebSocket fails on device:
  - Fall back: build with websocket-sharp by reintroducing its DLL and switching code (I can provide a branch with fallback if needed).

9) What to paste back to me
If something doesn't work, paste the following so I can triage quickly:
- Server log around the time you start the device test.
- Browser console errors (open DevTools -> Console).
- A sample frame message payload (from server logs or browser) and a resource_snapshot payload.
- Unity player logs (adb logcat for Android or device logs for iOS) around the connection and upload calls.

10) Safety & privacy notes
- Thumbnails may contain user data—avoid exposing server on public networks without authentication.
- Consider enabling a shared secret or simple token if you plan to test across less-trusted networks.


-- End of script
