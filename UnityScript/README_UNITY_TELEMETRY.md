TelemetrySender Unity changes

What changed
- TelemetrySender now uses System.Net.WebSockets.ClientWebSocket instead of websocket-sharp. This avoids adding a native DLL dependency.
- JSON serialization uses Newtonsoft.Json (Json.NET). Please add the Newtonsoft.Json package to your Unity project (Package Manager or drop-in DLL) and set Api Compatibility Level to ".NET 4.x" if needed.
- A small UnityMainThreadDispatcher helper was added to safely invoke Unity main-thread actions from background tasks.

Action items to use in your Unity project
1. Install Newtonsoft.Json:
   - Recommended: In Unity Window -> Package Manager -> Add package by name: "com.unity.nuget.newtonsoft-json" or install Newtonsoft.Json.dll into Plugins folder.
2. Ensure scripting runtime compatibility is set to .NET 4.x in Project Settings -> Player -> Other Settings.
3. Add the `UnityMainThreadDispatcher` prefab or ensure the class is referenced so the singleton instance is created at runtime. The TelemetrySender calls `UnityMainThreadDispatcher.Instance()` on receive.
4. If targeting platforms where System.Net.WebSockets is not available, fallback to websocket-sharp can be reintroduced behind conditional compilation. The current code uses ClientWebSocket when building for common platforms.

Notes
- ClientWebSocket in Unity may not be available on all IL2CPP/mobile platform configurations; test on your target devices. If you encounter platform limitations, we can switch to UnityWebRequest WebSocket implementations or reintroduce websocket-sharp as fallback.
