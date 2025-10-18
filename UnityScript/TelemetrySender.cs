using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Text;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using Unity.Collections;
using UnityEngine.Networking;
using UnityEngine.SceneManagement;
using UnityEngine.Rendering;
using UnityEngine.Experimental.Rendering;

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
    public bool captureEnabled = true;
    [Tooltip("Capture interval in milliseconds. Set to 0 to capture every frame.")]
    public int captureIntervalMs = 0;
    public bool sendThumbnail = true;
    public int thumbnailIntervalFrames = 30; // capture every N frames
    public int thumbnailWidth = 320;
    [Range(10, 90)]
    public int jpegQuality = 60;

    [Header("Resources")]
    public bool sendResourceSnapshots = true; // use existing analyzer to build resource list and send on change

    [Header("Performance")]
    [Tooltip("Minimum time in seconds between resource snapshot captures.")]
    public float resourceSnapshotInterval = 1f;

    private int frameCounter = 0;
    private float startTime;
    private float nextCaptureTime = 0f;

#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
    private ClientWebSocket ws;
    private CancellationTokenSource wsCts;
    private Task wsReceiveTask;
    private CancellationTokenSource sendWorkerCts;
    private Task sendWorkerTask;
    private readonly ConcurrentQueue<PendingMessage> pendingMessages = new ConcurrentQueue<PendingMessage>();
    private readonly SemaphoreSlim pendingMessageSignal = new SemaphoreSlim(0);
#endif

    // simple last-sent snapshot hash to avoid flooding
    private string lastSnapshotHash = null;
    private readonly List<ResourceEntry> currentResourceSnapshot = new List<ResourceEntry>();
    private Coroutine resourceSnapshotRoutine;
    private bool resourceSnapshotInProgress = false;
    private float nextResourceSnapshotTime = 0f;
    private CancellationTokenSource resourceProcessingCts;
    private Task<ResourceProcessingResult> resourceProcessingTask;
    private readonly object resourceStateLock = new object();
    private ResourceProcessingResult pendingResourceState;
    private bool resourceStateDirty = false;
    private ResourceProcessingResult currentResourceState = ResourceProcessingResult.CreateEmpty();

    private static readonly List<ResourceCategoryStat> EmptyCategoryStats = new List<ResourceCategoryStat>(0);
    private static readonly List<string> EmptyResourceIds = new List<string>(0);

    private class ResourceProcessingResult
    {
        public List<ResourceEntry> Snapshot;
        public List<ResourceCategoryStat> Stats;
        public List<string> ResourceIds;
        public int TotalKB;
        public int TotalCount;
        public string Hash;

        public static ResourceProcessingResult CreateEmpty()
        {
            return new ResourceProcessingResult
            {
                Snapshot = new List<ResourceEntry>(),
                Stats = new List<ResourceCategoryStat>(),
                ResourceIds = new List<string>(),
                TotalKB = 0,
                TotalCount = 0,
                Hash = null
            };
        }
    }

    void Start()
    {
        startTime = Time.realtimeSinceStartup;
        nextCaptureTime = Time.realtimeSinceStartup;
        nextResourceSnapshotTime = Time.realtimeSinceStartup;
        if (string.IsNullOrEmpty(clientId)) clientId = SystemInfo.deviceName + "-" + Application.productName;
        StartSendWorker();
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
                    SendControlAck("initial_state");
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
        CancelResourceSnapshotCoroutine();
        CancelResourceProcessingTask();
        StopSendWorker();
        try {
            if (wsCts != null) wsCts.Cancel();
            if (ws != null) ws.Dispose();
            ws = null;
        } catch { }
#endif
    }

    void LateUpdate()
    {
        if (!captureEnabled)
        {
            return;
        }

        var now = Time.realtimeSinceStartup;
        if (captureIntervalMs > 0)
        {
            if (now + 0.0001f < nextCaptureTime)
            {
                return;
            }
            nextCaptureTime = now + Mathf.Max(0.001f, (float)captureIntervalMs / 1000f);
        }

        frameCounter++;
        var frameIndex = frameCounter;
        var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        // Collect metrics (basic)
        var metrics = new Dictionary<string, object>();
        metrics["fps"] = 1.0f / Mathf.Max(0.0001f, Time.deltaTime);
        metrics["dt"] = Time.deltaTime;

        if (sendResourceSnapshots)
        {
            TryStartResourceSnapshot();
            ApplyCompletedResourceState();
        }
        else
        {
            CancelResourceSnapshotCoroutine();
            CancelResourceProcessingTask();
            if (currentResourceSnapshot.Count > 0)
            {
                currentResourceSnapshot.Clear();
            }
            currentResourceState = ResourceProcessingResult.CreateEmpty();
            lastSnapshotHash = null;
        }

        var resourceStats = (currentResourceState != null && currentResourceState.Stats != null && currentResourceState.Stats.Count > 0)
            ? currentResourceState.Stats
            : EmptyCategoryStats;
        int resourceTotalKB = currentResourceState != null ? currentResourceState.TotalKB : 0;
        int resourceCount = currentResourceState != null ? currentResourceState.TotalCount : 0;
        var resourceIds = (currentResourceState != null && currentResourceState.ResourceIds != null && currentResourceState.ResourceIds.Count > 0)
            ? currentResourceState.ResourceIds
            : EmptyResourceIds;

        // Build frame message dictionary snapshot (for debugging / potential extensions)
        var frameMsg = new Dictionary<string, object>() {
            { "type", "frame" },
            { "clientId", clientId },
            { "frameIndex", frameIndex },
            { "timestamp", ts },
            { "sceneName", SceneManager.GetActiveScene().name },
            { "dt", Time.deltaTime },
            { "metrics", metrics },
            { "resources", resourceIds },
            { "resourceStats", resourceStats },
            { "resourceTotalKB", resourceTotalKB },
            { "resourceCount", resourceCount }
        };

        var fpsValue = metrics.ContainsKey("fps") ? (float)metrics["fps"] : 0f;

        // thumbnail capture/upload
        if (sendThumbnail && (frameCounter % thumbnailIntervalFrames == 0)) {
            StartCoroutine(CaptureAndUploadThumbnail(frameIndex, (url) => {
                var fm = new FrameMessage {
                    clientId = clientId,
                    frameIndex = frameIndex,
                    timestamp = ts,
                    sceneName = SceneManager.GetActiveScene().name,
                    dt = Time.deltaTime,
                    metrics = new Metrics { fps = fpsValue, dt = Time.deltaTime },
                    resources = resourceIds,
                    resourceStats = resourceStats,
                    resourceTotalKB = resourceTotalKB,
                    resourceCount = resourceCount
                };
                if (!string.IsNullOrEmpty(url)) fm.thumbnailUrl = url;
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
                QueueMessage(fm);
#endif
            }));
        } else {
            var fm = new FrameMessage {
                clientId = clientId,
                frameIndex = frameIndex,
                timestamp = ts,
                sceneName = SceneManager.GetActiveScene().name,
                dt = Time.deltaTime,
                metrics = new Metrics { fps = fpsValue, dt = Time.deltaTime },
                resources = resourceIds,
                resourceStats = resourceStats,
                resourceTotalKB = resourceTotalKB,
                resourceCount = resourceCount
            };
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
            QueueMessage(fm);
#endif
        }
    }

    private void TryStartResourceSnapshot()
    {
        if (resourceSnapshotInProgress)
        {
            return;
        }

        if (!sendResourceSnapshots)
        {
            return;
        }

        if (resourceProcessingTask != null && !resourceProcessingTask.IsCompleted)
        {
            return;
        }

        if (Time.realtimeSinceStartup + 0.0001f < nextResourceSnapshotTime)
        {
            return;
        }

        if (!gameObject.activeInHierarchy)
        {
            return;
        }

        resourceSnapshotInProgress = true;
        resourceSnapshotRoutine = StartCoroutine(RuntimeResourceCollector.CaptureSnapshotAsync(OnResourceSnapshotReady, 64));
    }

    private void CancelResourceSnapshotCoroutine()
    {
        if (resourceSnapshotRoutine != null)
        {
            StopCoroutine(resourceSnapshotRoutine);
            resourceSnapshotRoutine = null;
        }
        resourceSnapshotInProgress = false;
    }

    private void OnResourceSnapshotReady(List<ResourceEntry> snapshot)
    {
        resourceSnapshotInProgress = false;
        resourceSnapshotRoutine = null;
        nextResourceSnapshotTime = Time.realtimeSinceStartup + Mathf.Max(0.1f, resourceSnapshotInterval);

        if (!sendResourceSnapshots)
        {
            return;
        }

        if (snapshot == null)
        {
            snapshot = new List<ResourceEntry>();
        }

        StartResourceProcessing(snapshot);
    }

    private void StartResourceProcessing(List<ResourceEntry> snapshot)
    {
        CancelResourceProcessingTask();
        resourceProcessingCts = new CancellationTokenSource();
        var token = resourceProcessingCts.Token;
        resourceProcessingTask = Task.Run(() => ProcessResourceSnapshot(snapshot, token), token);
        resourceProcessingTask.ContinueWith(t =>
        {
            if (t.Status == TaskStatus.RanToCompletion && !token.IsCancellationRequested)
            {
                lock (resourceStateLock)
                {
                    pendingResourceState = t.Result;
                    resourceStateDirty = true;
                }
            }
        }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
    }

    private void CancelResourceProcessingTask()
    {
        if (resourceProcessingCts != null)
        {
            try { resourceProcessingCts.Cancel(); } catch { }
            resourceProcessingCts.Dispose();
            resourceProcessingCts = null;
        }
        resourceProcessingTask = null;
        lock (resourceStateLock)
        {
            resourceStateDirty = false;
            pendingResourceState = null;
        }
    }

    private void ApplyCompletedResourceState()
    {
        ResourceProcessingResult next = null;
        lock (resourceStateLock)
        {
            if (resourceStateDirty)
            {
                next = pendingResourceState;
                pendingResourceState = null;
                resourceStateDirty = false;
            }
        }

        if (next == null)
        {
            return;
        }

        currentResourceState = next;
        currentResourceSnapshot.Clear();
        if (next.Snapshot != null && next.Snapshot.Count > 0)
        {
            currentResourceSnapshot.AddRange(next.Snapshot);
        }

        if (!string.IsNullOrEmpty(next.Hash) && next.Hash != lastSnapshotHash)
        {
            lastSnapshotHash = next.Hash;
            var snapshotMsg = new SnapshotMessage { clientId = clientId, resources = next.Snapshot, replace = true };
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
            QueueMessage(snapshotMsg);
#endif
            StartCoroutine(UploadResourceThumbnailsAsync(next.Snapshot));
        }
    }

    private static ResourceProcessingResult ProcessResourceSnapshot(List<ResourceEntry> snapshot, CancellationToken token)
    {
        if (snapshot == null)
        {
            snapshot = new List<ResourceEntry>();
        }

        snapshot.Sort((a, b) =>
        {
            var catA = a?.category ?? a?.type ?? string.Empty;
            var catB = b?.category ?? b?.type ?? string.Empty;
            int catCompare = string.CompareOrdinal(catA, catB);
            if (catCompare != 0) return catCompare;
            int sizeA = a != null ? a.sizeKB : 0;
            int sizeB = b != null ? b.sizeKB : 0;
            int sizeCompare = sizeB.CompareTo(sizeA);
            if (sizeCompare != 0) return sizeCompare;
            return string.CompareOrdinal(a?.name ?? string.Empty, b?.name ?? string.Empty);
        });

        var ids = new List<string>(snapshot.Count);
        for (int i = 0; i < snapshot.Count; i++)
        {
            if (token.IsCancellationRequested) break;
            var entry = snapshot[i];
            if (entry != null && !string.IsNullOrEmpty(entry.id))
            {
                ids.Add(entry.id);
            }
        }

        int totalKB;
        int totalCount;
        var stats = SummarizeResourceStats(snapshot, out totalKB, out totalCount);
        var hash = ComputeSnapshotHash(snapshot, token);

        return new ResourceProcessingResult
        {
            Snapshot = snapshot,
            ResourceIds = ids,
            Stats = stats,
            TotalKB = totalKB,
            TotalCount = totalCount,
            Hash = hash
        };
    }

    private static string ComputeSnapshotHash(List<ResourceEntry> snapshot, CancellationToken token)
    {
        if (snapshot == null || snapshot.Count == 0)
        {
            return string.Empty;
        }

        var sb = new StringBuilder(snapshot.Count * 64);
        for (int i = 0; i < snapshot.Count; i++)
        {
            if (token.IsCancellationRequested)
            {
                return string.Empty;
            }

            var entry = snapshot[i];
            if (entry == null)
            {
                continue;
            }

            sb.Append(entry.id ?? string.Empty).Append('|')
              .Append(entry.name ?? string.Empty).Append('|')
              .Append(entry.type ?? string.Empty).Append('|')
              .Append(entry.category ?? string.Empty).Append('|')
              .Append(entry.sizeKB).Append('|')
              .Append(entry.runtimeSizeKB).Append('|')
              .Append(entry.compressedSizeKB).Append('|')
              .Append(entry.sizeAfterCompressionKB).Append('|')
              .Append(entry.width).Append('x').Append(entry.height).Append('|')
              .Append(entry.format ?? string.Empty).Append('|')
              .Append(entry.variantId ?? string.Empty).Append('|');

            if (entry.keywords != null && entry.keywords.Length > 0)
            {
                sb.Append(string.Join(",", entry.keywords));
            }

            sb.Append("||");
        }

        using (var sha = SHA256.Create())
        {
            var bytes = Encoding.UTF8.GetBytes(sb.ToString());
            var hash = sha.ComputeHash(bytes);
            return Convert.ToBase64String(hash);
        }
    }

    private static int GetResourceContributionSizeKB(ResourceEntry entry)
    {
        if (entry == null) return 0;
        string category = !string.IsNullOrEmpty(entry.category) ? entry.category : entry.type;
        bool isTexture = !string.IsNullOrEmpty(category) && category.IndexOf("texture", StringComparison.OrdinalIgnoreCase) >= 0;

        if (isTexture)
        {
            if (entry.sizeAfterCompressionKB > 0) return entry.sizeAfterCompressionKB;
            if (entry.compressedSizeKB > 0) return entry.compressedSizeKB;
        }

        if (entry.runtimeSizeKB > 0) return entry.runtimeSizeKB;
        if (entry.sizeKB > 0) return entry.sizeKB;
        return 0;
    }

    private static List<ResourceCategoryStat> SummarizeResourceStats(List<ResourceEntry> resources, out int totalKB, out int totalCount)
    {
        totalKB = 0;
        totalCount = 0;
        var stats = new Dictionary<string, ResourceCategoryStat>(StringComparer.Ordinal);
        if (resources != null)
        {
            foreach (var r in resources)
            {
                if (r == null) continue;
                totalCount++;
                var category = !string.IsNullOrEmpty(r.category) ? r.category : (!string.IsNullOrEmpty(r.type) ? r.type : "Uncategorized");
                if (!stats.TryGetValue(category, out var stat))
                {
                    stat = new ResourceCategoryStat { category = category, count = 0, sizeKB = 0 };
                    stats[category] = stat;
                }
                stat.count++;
                var size = Mathf.Max(0, GetResourceContributionSizeKB(r));
                stat.sizeKB += size;
                totalKB += size;
            }
        }

        var list = new List<ResourceCategoryStat>(stats.Values);
        list.Sort((a, b) =>
        {
            int sizeCompare = b.sizeKB.CompareTo(a.sizeKB);
            if (sizeCompare != 0) return sizeCompare;
            return string.CompareOrdinal(a.category ?? string.Empty, b.category ?? string.Empty);
        });

        return list;
    }


    private IEnumerator CaptureAndUploadThumbnail(int frameIndex, Action<string> onComplete)
    {
        yield return new WaitForEndOfFrame();

        RenderTexture tempRt = null;
        Camera captureCamera = null;
        RenderTexture originalTarget = null;
        var initialActive = RenderTexture.active;

        try
        {
            captureCamera = FindBestCamera();
            if (captureCamera == null)
            {
                onComplete(null);
                yield break;
            }

            int targetWidth = thumbnailWidth > 0 ? Mathf.Clamp(thumbnailWidth, 32, 4096) : Screen.width;
            if (targetWidth <= 0) targetWidth = 256;
            float aspect = captureCamera.pixelWidth > 0
                ? (float)captureCamera.pixelHeight / Mathf.Max(1, captureCamera.pixelWidth)
                : (Screen.width > 0 ? (float)Screen.height / Mathf.Max(1, Screen.width) : 1f);
            int targetHeight = Mathf.Max(1, Mathf.RoundToInt(targetWidth * aspect));

            tempRt = RenderTexture.GetTemporary(targetWidth, targetHeight, 24, RenderTextureFormat.ARGB32);
            originalTarget = captureCamera.targetTexture;
            captureCamera.targetTexture = tempRt;
            captureCamera.Render();

            var request = AsyncGPUReadback.Request(tempRt, 0, TextureFormat.RGB24);
            while (!request.done)
            {
                if (request.hasError)
                {
                    onComplete(null);
                    yield break;
                }
                yield return null;
            }

            if (request.hasError)
            {
                onComplete(null);
                yield break;
            }

            byte[] jpg = null;
#if UNITY_2020_1_OR_NEWER
            var rawData = request.GetData<byte>();
            var rawCopy = rawData.ToArray();
            var encodeTask = Task.Run(() =>
            {
                return ImageConversion.EncodeArrayToJPG(rawCopy, tempRt.graphicsFormat, (uint)tempRt.width, (uint)tempRt.height, (uint)Mathf.Clamp(jpegQuality, 10, 90));
            });
            while (!encodeTask.IsCompleted)
            {
                yield return null;
            }
            if (encodeTask.Status == TaskStatus.RanToCompletion)
            {
                jpg = encodeTask.Result;
            }
#else
            var rawData = request.GetData<byte>();
            var tex = new Texture2D(tempRt.width, tempRt.height, TextureFormat.RGB24, false);
            tex.LoadRawTextureData(rawData);
            tex.Apply();
            jpg = tex.EncodeToJPG(Mathf.Clamp(jpegQuality, 10, 90));
            UnityEngine.Object.Destroy(tex);
#endif

            if (jpg == null || jpg.Length == 0)
            {
                onComplete(null);
                yield break;
            }

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
                        if (!string.IsNullOrEmpty(respObj.url))
                        {
                            onComplete(respObj.url);
                            yield break;
                        }
                    }
                    catch { }
                }
                else
                {
                    Debug.LogWarning("Thumb upload failed: " + uwr.error);
                }
            }
        }
        finally
        {
            if (captureCamera != null)
            {
                captureCamera.targetTexture = originalTarget;
            }
            RenderTexture.active = initialActive;
            if (tempRt != null)
            {
                RenderTexture.ReleaseTemporary(tempRt);
            }
        }

        onComplete(null);
    }

    private Camera FindBestCamera()
    {
        var cam = Camera.main;
        if (cam != null && cam.isActiveAndEnabled)
        {
            return cam;
        }

        Camera[] cameras = null;
        if (Camera.allCamerasCount > 0)
        {
            cameras = Camera.allCameras;
        }

        Camera best = null;
        if (cameras != null)
        {
            foreach (var c in cameras)
            {
                if (c == null || !c.isActiveAndEnabled)
                {
                    continue;
                }

                if (best == null || c.depth > best.depth)
                {
                    best = c;
                }
            }
        }

        if (best != null)
        {
            return best;
        }

        // fallback: any enabled camera
        if (cameras != null)
        {
            foreach (var c in cameras)
            {
                if (c != null && c.isActiveAndEnabled)
                {
                    return c;
                }
            }
        }

        return null;
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
                            rwt.entry.thumbnailUrl = respObj.url;
                            UpdateCachedResource(rwt.entry);
                            var snapshotMsg = new SnapshotMessage { clientId = clientId, resources = new List<ResourceEntry> { rwt.entry }, replace = false };
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
                            QueueMessage(snapshotMsg);
#endif
                            uploadedResourceIds.Add(id);
                        }
                    }
                    catch { }
                }
            }
        }
    }

    private void UpdateCachedResource(ResourceEntry updated)
    {
        if (updated == null || string.IsNullOrEmpty(updated.id)) return;
        for (int i = 0; i < currentResourceSnapshot.Count; i++)
        {
            var entry = currentResourceSnapshot[i];
            if (entry != null && entry.id == updated.id)
            {
                currentResourceSnapshot[i] = updated;
                if (currentResourceState != null && currentResourceState.Snapshot != null && i < currentResourceState.Snapshot.Count)
                {
                    var stateEntry = currentResourceState.Snapshot[i];
                    if (stateEntry != null && stateEntry.id == updated.id)
                    {
                        currentResourceState.Snapshot[i] = updated;
                    }
                }
                break;
            }
        }
    }

    private void HandleIncomingMessage(string json)
    {
        if (string.IsNullOrEmpty(json)) return;
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
        ControlMessage message = null;
        try
        {
            message = JsonConvert.DeserializeObject<ControlMessage>(json);
        }
        catch
        {
            return;
        }
        if (message == null) return;
        if (!string.Equals(message.type, "control", StringComparison.OrdinalIgnoreCase)) return;
        if (!string.IsNullOrEmpty(message.targetClientId) && message.targetClientId != clientId) return;

        if (string.Equals(message.command, "configure_capture", StringComparison.OrdinalIgnoreCase))
        {
            ApplyControlPayload(message.payload);
            SendControlAck("configure_capture");
        }
        else if (string.Equals(message.command, "request_state", StringComparison.OrdinalIgnoreCase))
        {
            SendControlAck("request_state");
        }
#endif
    }

    private void ApplyControlPayload(ControlPayload payload)
    {
        if (payload == null) return;
        bool shouldResetTimer = false;
        if (payload.captureEnabled.HasValue)
        {
            captureEnabled = payload.captureEnabled.Value;
            if (captureEnabled) shouldResetTimer = true;
        }
        if (payload.captureIntervalMs.HasValue)
        {
            captureIntervalMs = Mathf.Max(0, Mathf.RoundToInt(payload.captureIntervalMs.Value));
            shouldResetTimer = true;
        }
        if (payload.sendThumbnail.HasValue)
        {
            sendThumbnail = payload.sendThumbnail.Value;
        }
        if (payload.thumbnailIntervalFrames.HasValue)
        {
            thumbnailIntervalFrames = Mathf.Max(1, payload.thumbnailIntervalFrames.Value);
        }
        if (payload.sendResourceSnapshots.HasValue)
        {
            sendResourceSnapshots = payload.sendResourceSnapshots.Value;
        }

        if (shouldResetTimer)
        {
            nextCaptureTime = Time.realtimeSinceStartup;
        }
    }

    private void SendControlAck(string command)
    {
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
        var ack = new ControlAckMessage
        {
            clientId = clientId,
            command = command,
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            state = new ControlAckState
            {
                captureEnabled = captureEnabled,
                captureIntervalMs = captureIntervalMs,
                sendThumbnail = sendThumbnail,
                sendResourceSnapshots = sendResourceSnapshots,
                thumbnailIntervalFrames = thumbnailIntervalFrames
            }
        };
        QueueMessage(ack);
#endif
    }

#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
    private Task SendJsonAsync(object obj)
    {
        QueueMessage(obj);
        return Task.CompletedTask;
    }

    private Task SendTextAsync(string text)
    {
        QueueSerialized(text);
        return Task.CompletedTask;
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
                    try
                    {
                        HandleIncomingMessage(str);
                    }
                    catch (Exception ex)
                    {
                        Debug.LogWarning("Failed to handle control message: " + ex.Message);
                    }
                });
            }
        } catch (Exception ex) {
            Debug.LogWarning("WebSocket receive loop ended: " + ex.Message);
        }
    }

    private struct PendingMessage
    {
        public string Serialized;
        public object Payload;
    }

    private void StartSendWorker()
    {
        if (sendWorkerTask != null && !sendWorkerTask.IsCompleted)
        {
            return;
        }

        sendWorkerCts = new CancellationTokenSource();
        sendWorkerTask = Task.Run(() => ProcessSendQueueAsync(sendWorkerCts.Token));
    }

    private void StopSendWorker()
    {
        if (sendWorkerCts == null)
        {
            return;
        }

        try
        {
            sendWorkerCts.Cancel();
            pendingMessageSignal.Release();
        }
        catch { }

        try
        {
            sendWorkerTask?.Wait(250);
        }
        catch { }
        finally
        {
            sendWorkerTask = null;
        }

        sendWorkerCts.Dispose();
        sendWorkerCts = null;
    }

    private void QueueMessage(object payload)
    {
        if (payload == null)
        {
            return;
        }

        pendingMessages.Enqueue(new PendingMessage { Payload = payload });
        pendingMessageSignal.Release();
    }

    private void QueueSerialized(string json)
    {
        if (string.IsNullOrEmpty(json))
        {
            return;
        }

        pendingMessages.Enqueue(new PendingMessage { Serialized = json });
        pendingMessageSignal.Release();
    }

    private async Task ProcessSendQueueAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try
            {
                await pendingMessageSignal.WaitAsync(token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }

            while (!token.IsCancellationRequested && pendingMessages.TryDequeue(out var pending))
            {
                string json = pending.Serialized;
                if (json == null && pending.Payload != null)
                {
                    try
                    {
                        json = JsonConvert.SerializeObject(pending.Payload);
                    }
                    catch (Exception ex)
                    {
                        Debug.LogWarning("Failed to serialize telemetry payload: " + ex.Message);
                    }
                }

                if (string.IsNullOrEmpty(json))
                {
                    continue;
                }

                await SendTextInternalAsync(json, token).ConfigureAwait(false);
            }
        }
    }

    private async Task SendTextInternalAsync(string text, CancellationToken token)
    {
        try
        {
            if (ws == null)
            {
                return;
            }

            if (ws.State != WebSocketState.Open)
            {
                return;
            }

            var bytes = Encoding.UTF8.GetBytes(text);
            var seg = new ArraySegment<byte>(bytes);

            if (wsCts != null)
            {
                if (wsCts.IsCancellationRequested)
                {
                    return;
                }

                using (var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(token, wsCts.Token))
                {
                    await ws.SendAsync(seg, WebSocketMessageType.Text, true, linkedCts.Token).ConfigureAwait(false);
                }
            }
            else
            {
                await ws.SendAsync(seg, WebSocketMessageType.Text, true, token).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            Debug.LogWarning("WebSocket send failed: " + ex.Message);
        }
    }
#endif

#if !(UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS)
    private void StartSendWorker() { }
    private void StopSendWorker() { }
    private void QueueMessage(object payload) { }
    private void QueueSerialized(string json) { }
#endif
}

// --- Minimal JSON helper (MiniJson) ---
// Add a small JSON serializer/deserializer. For production use, prefer Newtonsoft.Json or Unity's JsonUtility with typed classes.
[Serializable]
public class ResourceEntryListWrapper { public List<ResourceEntry> items; }

[Serializable]
public class SnapshotMessage { public string type = "resource_snapshot"; public string clientId; public List<ResourceEntry> resources; public bool replace = true; }

[Serializable]
public class Metrics { public float fps; public float dt; }

[Serializable]
public class FrameMessage { public string type = "frame"; public string clientId; public int frameIndex; public long timestamp; public string sceneName; public float dt; public Metrics metrics; public List<string> resources; public List<ResourceCategoryStat> resourceStats; public int resourceTotalKB; public int resourceCount; public string thumbnailUrl; }

[Serializable]
public class ThumbUploadResponse { public string url; }

[Serializable]
public class GenericWrapper { public object obj; }

[Serializable]
public class ControlPayload
{
    public bool? captureEnabled;
    public float? captureIntervalMs;
    public bool? sendThumbnail;
    public bool? sendResourceSnapshots;
    public int? thumbnailIntervalFrames;
}

[Serializable]
public class ControlMessage
{
    public string type;
    public string command;
    public string targetClientId;
    public ControlPayload payload;
}

[Serializable]
public class ControlAckState
{
    public bool captureEnabled;
    public int captureIntervalMs;
    public bool sendThumbnail;
    public bool sendResourceSnapshots;
    public int thumbnailIntervalFrames;
}

[Serializable]
public class ControlAckMessage
{
    public string type = "control_ack";
    public string clientId;
    public string command;
    public ControlAckState state;
    public long timestamp;
}

