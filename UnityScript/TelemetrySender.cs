using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.SceneManagement;

#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
using System.Net.WebSockets;
using Newtonsoft.Json;
#endif

// TelemetrySender: attach to a GameObject in your scene (or create a persistent GameObject)
// Sends per-frame telemetry (frameIndex, timestamp, sceneName, metrics, resources) to the telemetry server
// Supports optional thumbnail capture and upload. Uses ClientWebSocket + Json.NET to avoid websocket-sharp dependency.
public class TelemetrySender : MonoBehaviour
{
    [Header("Server")]
    public string serverWsUrl = "ws://192.168.1.100:8080"; // ws://host:port
    public string serverHttpUrl = "http://192.168.1.100:8080"; // for thumbnail upload
    public string clientId = null;

    [Header("Sampling")]
    public bool sendThumbnail = true;
    public int thumbnailIntervalFrames = 30; // capture every N frames
    public int thumbnailWidth = 320;
    [Range(10, 90)]
    public int jpegQuality = 60;

    [Header("Resources")]
    public bool sendResourceSnapshots = true; // use existing analyzer to build resource list and send on change

    private int frameCounter = 0;
    private float startTime;

#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
    private ClientWebSocket ws;
    private CancellationTokenSource wsCts;
    private Task wsReceiveTask;
#endif

    // simple last-sent snapshot hash to avoid flooding
    private string lastSnapshotHash = null;

    void Start()
    {
        startTime = Time.realtimeSinceStartup;
        if (string.IsNullOrEmpty(clientId)) clientId = SystemInfo.deviceName + "-" + Application.productName;
        ConnectWebSocket();
        DontDestroyOnLoad(this.gameObject);
    }

    void ConnectWebSocket()
    {
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
        try {
            ws = new ClientWebSocket();
            wsCts = new CancellationTokenSource();
            var uri = new Uri(serverWsUrl);
            Task.Run(async () => {
                try {
                    await ws.ConnectAsync(uri, wsCts.Token).ConfigureAwait(false);
                    Debug.Log("Telemetry WS open (ClientWebSocket)");
                    var hello = new { role = "unity", clientId = clientId };
                    await SendJsonAsync(hello).ConfigureAwait(false);
                    wsReceiveTask = Task.Run(() => ReceiveLoopAsync(ws, wsCts.Token));
                }
                catch (Exception ex) {
                    Debug.LogWarning("WebSocket connect failed: " + ex.Message);
                }
            });
        }
        catch (Exception ex) {
            Debug.LogWarning("WebSocket init failed: " + ex.Message);
        }
#else
        Debug.LogWarning("WebSocket not supported on this platform in this sample");
#endif
    }

    void OnDestroy()
    {
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
        try {
            if (wsCts != null) wsCts.Cancel();
            if (ws != null) ws.Dispose();
            ws = null;
        } catch { }
#endif
    }

    void LateUpdate()
    {
        frameCounter++;
        var frameIndex = frameCounter;
        var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        // Collect metrics (basic)
        var metrics = new Dictionary<string, object>();
        metrics["fps"] = 1.0f / Mathf.Max(0.0001f, Time.deltaTime);
        metrics["dt"] = Time.deltaTime;

        // Collect resources: integrate with runtime collector
        List<ResourceEntry> resources = null;
        List<ResourceEntry> frameResourceSnapshot = null;
        ResourceCategoryStat[] resourceBreakdown = null;
        if (sendResourceSnapshots) {
            resources = CollectResourceSnapshot();
        }

        // send resource snapshot only when changed
        if (resources != null) {
            var snapWrapper = new ResourceEntryListWrapper { items = resources };
            var snapJson = JsonUtility.ToJson(snapWrapper);
            var hash = snapJson.GetHashCode().ToString();
            if (hash != lastSnapshotHash) {
                lastSnapshotHash = hash;
                // convert to serializable message
                var snapshotMsg = new SnapshotMessage { clientId = clientId, resources = resources };
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
                var j = JsonConvert.SerializeObject(snapshotMsg);
                _ = SendTextAsync(j);
#endif
                // start background upload of thumbnails for resources that have textures available
                StartCoroutine(UploadResourceThumbnailsAsync(resources));
                frameResourceSnapshot = resources;
            }
            resourceBreakdown = BuildResourceBreakdown(resources);
        }

        var resourceIds = ResourceIdsFrom(resources);
        if (resourceBreakdown == null && resources != null && resources.Count > 0)
        {
            resourceBreakdown = BuildResourceBreakdown(resources);
        }

        // Build frame message
        // thumbnail capture/upload
        if (sendThumbnail && (frameCounter % thumbnailIntervalFrames == 0)) {
            StartCoroutine(CaptureAndUploadThumbnail(frameIndex, (url) => {
                var fm = new FrameMessage {
                    clientId = clientId,
                    frameIndex = frameIndex,
                    timestamp = ts,
                    sceneName = SceneManager.GetActiveScene().name,
                    dt = Time.deltaTime,
                    metrics = new Metrics { fps = (float)metrics["fps"], dt = Time.deltaTime },
                    resources = resourceIds,
                    resourceSnapshot = frameResourceSnapshot,
                    resourceBreakdown = resourceBreakdown
                };
                if (!string.IsNullOrEmpty(url)) fm.thumbnailUrl = url;
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
                var fj = JsonConvert.SerializeObject(fm);
                _ = SendTextAsync(fj);
#endif
            }));
        } else {
            var fm = new FrameMessage {
                clientId = clientId,
                frameIndex = frameIndex,
                timestamp = ts,
                sceneName = SceneManager.GetActiveScene().name,
                dt = Time.deltaTime,
                metrics = new Metrics { fps = (float)metrics["fps"], dt = Time.deltaTime },
                resources = resourceIds,
                resourceSnapshot = frameResourceSnapshot,
                resourceBreakdown = resourceBreakdown
            };
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
            var fj = JsonConvert.SerializeObject(fm);
            _ = SendTextAsync(fj);
#endif
        }
    }

    private List<string> ResourceIdsFrom(List<ResourceEntry> resources)
    {
        var ids = new List<string>();
        if (resources == null) return ids;
        foreach (var r in resources) {
            if (!string.IsNullOrEmpty(r.id)) ids.Add(r.id);
        }
        return ids;
    }

    private ResourceCategoryStat[] BuildResourceBreakdown(List<ResourceEntry> resources)
    {
        if (resources == null || resources.Count == 0) return null;
        var map = new Dictionary<string, ResourceCategoryStat>();
        foreach (var resource in resources)
        {
            if (resource == null) continue;
            var category = !string.IsNullOrEmpty(resource.category) ? resource.category : resource.type;
            if (string.IsNullOrEmpty(category)) category = "Unknown";

            if (!map.TryGetValue(category, out var stat))
            {
                stat = new ResourceCategoryStat { category = category, count = 0, sizeKB = 0 };
                map[category] = stat;
            }

            stat.count += 1;
            if (resource.sizeKB > 0) stat.sizeKB += resource.sizeKB;
        }

        var list = new List<ResourceCategoryStat>(map.Values);
        list.Sort((a, b) => string.CompareOrdinal(a.category, b.category));
        return list.ToArray();
    }


    private IEnumerator CaptureAndUploadThumbnail(int frameIndex, Action<string> onComplete)
    {
        yield return new WaitForEndOfFrame();

        var cam = Camera.main;
        if (cam == null) { onComplete(null); yield break; }

        int w = thumbnailWidth;
        int h = Mathf.RoundToInt(thumbnailWidth * ( (float)Screen.height / Screen.width ));
        var rt = new RenderTexture(w, h, 24);
        cam.targetTexture = rt;
        Texture2D tex = new Texture2D(w, h, TextureFormat.RGB24, false);
        cam.Render();
        RenderTexture.active = rt;
        tex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
        tex.Apply();
        cam.targetTexture = null;
        RenderTexture.active = null;
        Destroy(rt);

        byte[] jpg = tex.EncodeToJPG(jpegQuality);
        Destroy(tex);

        // upload via WWWForm
        if (jpg != null && jpg.Length > 0) {
            var form = new WWWForm();
            form.AddBinaryData("thumb", jpg, "thumb.jpg", "image/jpeg");
            form.AddField("clientId", clientId);
            form.AddField("frameIndex", frameIndex.ToString());

            using (var uwr = UnityWebRequest.Post(serverHttpUrl + "/upload/thumb", form))
            {
                yield return uwr.SendWebRequest();
                if (uwr.result == UnityWebRequest.Result.Success)
                {
                    var resp = uwr.downloadHandler.text;
                    try
                    {
                        var respObj = JsonConvert.DeserializeObject<ThumbUploadResponse>(resp);
                        if (!string.IsNullOrEmpty(respObj.url)) { onComplete(respObj.url); yield break; }
                    }
                    catch { }
                }
                else
                {
                    Debug.LogWarning("Thumb upload failed: " + uwr.error);
                }
            }
        }

        onComplete(null);
    }

    // upload thumbnails for resource list when available (uses RuntimeResourceCollector.GetSnapshotWithTextures)
    private HashSet<string> uploadedResourceIds = new HashSet<string>();

    private IEnumerator UploadResourceThumbnailsAsync(List<ResourceEntry> resources)
    {
        // try get runtime textures to upload; if none available, skip
        List<ResourceWithTexture> withTex = null;
        try { withTex = RuntimeResourceCollector.GetSnapshotWithTextures(); } catch { withTex = null; }
        if (withTex == null || withTex.Count == 0) yield break;

        foreach (var rwt in withTex)
        {
            var id = rwt.entry.id;
            if (uploadedResourceIds.Contains(id)) continue;
            if (rwt.tex == null) continue;
            // capture texture to jpg
            Texture2D tex2 = RuntimeArtResourceAnalysis.CopyTextureToTexture2D(rwt.tex);
            if (tex2 == null) continue;
            byte[] jpg = tex2.EncodeToJPG(Mathf.Clamp(jpegQuality, 10, 90));
            UnityEngine.Object.Destroy(tex2);
            if (jpg == null || jpg.Length == 0) continue;

            var form = new WWWForm();
            form.AddBinaryData("thumb", jpg, id + ".jpg", "image/jpeg");
            form.AddField("clientId", clientId);
            form.AddField("frameIndex", frameCounter.ToString());

            using (var uwr = UnityWebRequest.Post(serverHttpUrl + "/upload/thumb", form))
            {
                yield return uwr.SendWebRequest();
                if (uwr.result == UnityWebRequest.Result.Success)
                {
                    var resp = uwr.downloadHandler.text;
                    try
                    {
                        var respObj = JsonConvert.DeserializeObject<ThumbUploadResponse>(resp);
                        if (!string.IsNullOrEmpty(respObj.url))
                        {
                            // update local snapshot entry and notify server about updated resource
                            var updated = new ResourceEntry {
                                id = rwt.entry.id,
                                name = rwt.entry.name,
                                type = rwt.entry.type,
                                category = rwt.entry.category,
                                width = rwt.entry.width,
                                height = rwt.entry.height,
                                sizeKB = rwt.entry.sizeKB,
                                format = rwt.entry.format,
                                depth = rwt.entry.depth,
                                mipCount = rwt.entry.mipCount,
                                dimension = rwt.entry.dimension,
                                filterMode = rwt.entry.filterMode,
                                wrapMode = rwt.entry.wrapMode,
                                colorSpace = rwt.entry.colorSpace,
                                shader = rwt.entry.shader,
                                notes = rwt.entry.notes,
                                thumbnailUrl = respObj.url,
                                keywords = rwt.entry.keywords,
                                metrics = rwt.entry.metrics,
                                parentId = rwt.entry.parentId,
                                variantKey = rwt.entry.variantKey,
                                subMeshCount = rwt.entry.subMeshCount
                            };
                            var snapshotMsg = new SnapshotMessage { clientId = clientId, resources = new List<ResourceEntry> { updated } };
                            var j = JsonConvert.SerializeObject(snapshotMsg);
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
                            _ = SendTextAsync(j);
#endif
                            uploadedResourceIds.Add(id);
                        }
                    }
                    catch { }
                }
            }
        }
    }

    // Placeholder: Collect resources via existing analyzer code in your project.
    // This method should be adapted to call into your RuntimeArtResourceAnalysis analyzer and return an array
    // of objects with id/name/type/size/thumbnailUrl etc.
    private List<ResourceEntry> CollectResourceSnapshot()
    {
        try
        {
            return RuntimeResourceCollector.GetSnapshot();
        }
        catch (Exception ex)
        {
            Debug.LogWarning("CollectResourceSnapshot failed: " + ex.Message);
            return new List<ResourceEntry>();
        }
    }

#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
    private async Task SendJsonAsync(object obj)
    {
        var s = JsonConvert.SerializeObject(obj);
        await SendTextAsync(s).ConfigureAwait(false);
    }

    private async Task SendTextAsync(string text)
    {
        try {
            if (ws == null) return;
            if (ws.State != WebSocketState.Open) return;
            var bytes = Encoding.UTF8.GetBytes(text);
            var seg = new ArraySegment<byte>(bytes);
            await ws.SendAsync(seg, WebSocketMessageType.Text, true, wsCts.Token).ConfigureAwait(false);
        } catch (Exception ex) {
            Debug.LogWarning("WebSocket send failed: " + ex.Message);
        }
    }

    private async Task ReceiveLoopAsync(ClientWebSocket socket, CancellationToken token)
    {
        var buffer = new byte[8192];
        try {
            while (!token.IsCancellationRequested && socket != null && socket.State == WebSocketState.Open)
            {
                var seg = new ArraySegment<byte>(buffer);
                var result = await socket.ReceiveAsync(seg, token).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close) {
                    Debug.Log("Telemetry WS closed by server");
                    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None).ConfigureAwait(false);
                    break;
                }
                var count = result.Count;
                var str = Encoding.UTF8.GetString(buffer, 0, count);
                // run on main thread: use Unity's queue via StartCoroutine
                UnityMainThreadDispatcher.Instance().Enqueue(() => {
                    Debug.Log("Telemetry WS recv: " + str);
                });
            }
        } catch (Exception ex) {
            Debug.LogWarning("WebSocket receive loop ended: " + ex.Message);
        }
    }
#endif
}

// --- Minimal JSON helper (MiniJson) ---
// Add a small JSON serializer/deserializer. For production use, prefer Newtonsoft.Json or Unity's JsonUtility with typed classes.
[Serializable]
public class ResourceEntryListWrapper { public List<ResourceEntry> items; }

[Serializable]
public class SnapshotMessage { public string type = "resource_snapshot"; public string clientId; public List<ResourceEntry> resources; }

[Serializable]
public class Metrics { public float fps; public float dt; }

[Serializable]
public class FrameMessage { public string type = "frame"; public string clientId; public int frameIndex; public long timestamp; public string sceneName; public float dt; public Metrics metrics; public List<string> resources; public string thumbnailUrl; public List<ResourceEntry> resourceSnapshot; public ResourceCategoryStat[] resourceBreakdown; }

[Serializable]
public class ThumbUploadResponse { public string url; }

[Serializable]
public class GenericWrapper { public object obj; }

