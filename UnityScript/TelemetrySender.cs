using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Concurrent;
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
    [Tooltip("How many frames to wait between resource snapshot refreshes.")]
    public int resourceSnapshotIntervalFrames = 30;

    private int frameCounter = 0;
    private float startTime;
    private float nextCaptureTime = 0f;
    private int lastResourceSnapshotFrame = int.MinValue;

#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
    private ClientWebSocket ws;
    private CancellationTokenSource wsCts;
    private Task wsReceiveTask;
    private Thread wsSenderThread;
    private CancellationTokenSource wsSenderCts;
    private readonly ConcurrentQueue<object> outboundQueue = new ConcurrentQueue<object>();
    private AutoResetEvent outboundSignal = new AutoResetEvent(false);
    private readonly ResourceValidationResult lastResourceValidation = new ResourceValidationResult();
    private string lastIntegrityFingerprint;
#endif

    // simple last-sent snapshot hash to avoid flooding
    private string lastSnapshotHash = null;
    private List<ResourceEntry> currentResourceSnapshot = new List<ResourceEntry>();

    void Awake()
    {
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
        EnsureSenderWorker();
#endif
    }

    void Start()
    {
        startTime = Time.realtimeSinceStartup;
        nextCaptureTime = Time.realtimeSinceStartup;
        if (string.IsNullOrEmpty(clientId)) clientId = SystemInfo.deviceName + "-" + Application.productName;
        ConnectWebSocket();
        DontDestroyOnLoad(this.gameObject);
    }

    void ConnectWebSocket()
    {
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
        try {
            EnsureSenderWorker();
            ws = new ClientWebSocket();
            wsCts = new CancellationTokenSource();
            var uri = new Uri(serverWsUrl);
            Task.Run(async () => {
                try {
                    await ws.ConnectAsync(uri, wsCts.Token).ConfigureAwait(false);
                    Debug.Log("Telemetry WS open (ClientWebSocket)");
                    var hello = new { role = "unity", clientId = clientId };
                    EnqueueTelemetryPayload(hello);
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
        try {
            StopSenderWorker();
            if (wsCts != null) wsCts.Cancel();
            if (ws != null) ws.Dispose();
            ws = null;
            if (outboundSignal != null)
            {
                outboundSignal.Dispose();
                outboundSignal = null;
            }
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
        float deltaTime = Time.deltaTime;
        float fpsValue = 1.0f / Mathf.Max(0.0001f, deltaTime);

        // Collect resources: integrate with runtime collector
        List<ResourceEntry> latestSnapshot = null;
        int snapshotInterval = Mathf.Max(1, resourceSnapshotIntervalFrames);
        bool shouldRefreshSnapshot = (frameCounter - lastResourceSnapshotFrame) >= snapshotInterval;
        if (shouldRefreshSnapshot || currentResourceSnapshot == null)
        {
            lastResourceSnapshotFrame = frameCounter;
            try
            {
                latestSnapshot = CollectResourceSnapshot() ?? new List<ResourceEntry>();
            }
            catch
            {
                latestSnapshot = new List<ResourceEntry>();
            }

            UpdateResourceValidation(latestSnapshot);
            currentResourceSnapshot = latestSnapshot;

            var snapWrapper = new ResourceEntryListWrapper { items = latestSnapshot };
            var snapJson = JsonUtility.ToJson(snapWrapper);
            var hash = Hash128.Compute(snapJson).ToString();
            bool snapshotChanged = !string.Equals(hash, lastSnapshotHash, StringComparison.Ordinal);

            if (snapshotChanged && sendResourceSnapshots)
            {
                var snapshotMsg = new SnapshotMessage { clientId = clientId, resources = latestSnapshot, replace = true };
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
                EnqueueTelemetryPayload(snapshotMsg);
#endif
                StartCoroutine(UploadResourceThumbnailsAsync(latestSnapshot));
            }

            lastSnapshotHash = hash;
        }
        else
        {
            UpdateResourceValidation(currentResourceSnapshot);
        }

        var activeResources = currentResourceSnapshot ?? new List<ResourceEntry>();
        int resourceTotalKB;
        int resourceCount;
        var resourceStats = SummarizeResourceStats(activeResources, out resourceTotalKB, out resourceCount);
        var resourceIds = ResourceIdsFrom(activeResources);
        var sceneName = SceneManager.GetActiveScene().name;
        var frameValidation = ValidateFrameData(deltaTime, fpsValue, sceneName, resourceIds, resourceCount);

        // thumbnail capture/upload
        if (sendThumbnail && (frameCounter % thumbnailIntervalFrames == 0)) {
            StartCoroutine(CaptureAndUploadThumbnail(frameIndex, (url) => {
                var fm = new FrameMessage {
                    clientId = clientId,
                    frameIndex = frameIndex,
                    timestamp = ts,
                    sceneName = sceneName,
                    dt = deltaTime,
                    metrics = new Metrics { fps = fpsValue, dt = deltaTime },
                    resources = resourceIds,
                    resourceStats = resourceStats,
                    resourceTotalKB = resourceTotalKB,
                    resourceCount = resourceCount
                };
                if (!string.IsNullOrEmpty(url)) fm.thumbnailUrl = url;
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
                EnqueueTelemetryPayload(fm);
                MaybeEmitIntegrityReport(frameIndex, ts, frameValidation, resourceIds, resourceCount);
#endif
            }));
        } else {
            var fm = new FrameMessage {
                clientId = clientId,
                frameIndex = frameIndex,
                timestamp = ts,
                sceneName = sceneName,
                dt = deltaTime,
                metrics = new Metrics { fps = fpsValue, dt = deltaTime },
                resources = resourceIds,
                resourceStats = resourceStats,
                resourceTotalKB = resourceTotalKB,
                resourceCount = resourceCount
            };
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
            EnqueueTelemetryPayload(fm);
            MaybeEmitIntegrityReport(frameIndex, ts, frameValidation, resourceIds, resourceCount);
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

    private void UpdateResourceValidation(List<ResourceEntry> resources)
    {
        lastResourceValidation.Reset();
        if (resources == null)
        {
            return;
        }

        lastResourceValidation.totalEntries = resources.Count;
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var entry in resources)
        {
            if (entry == null)
            {
                lastResourceValidation.nullEntries++;
                continue;
            }

            if (string.IsNullOrEmpty(entry.id))
            {
                lastResourceValidation.missingId++;
            }
            else if (!seen.Add(entry.id))
            {
                lastResourceValidation.duplicateId++;
            }

            if (string.IsNullOrEmpty(entry.name))
            {
                lastResourceValidation.missingName++;
            }

            if (string.IsNullOrEmpty(entry.type) && string.IsNullOrEmpty(entry.category))
            {
                lastResourceValidation.missingType++;
            }

            if (entry.sizeKB <= 0 && entry.runtimeSizeKB <= 0 && entry.compressedSizeKB <= 0 && entry.sizeAfterCompressionKB <= 0)
            {
                lastResourceValidation.missingSize++;
            }
        }
    }

    private FrameValidationResult ValidateFrameData(float deltaTime, float fpsValue, string sceneName, List<string> resourceIds, int resourceCount)
    {
        var result = new FrameValidationResult();

        if (float.IsNaN(deltaTime) || float.IsInfinity(deltaTime) || deltaTime < 0f)
        {
            result.invalidDelta = true;
        }

        if (float.IsNaN(fpsValue) || float.IsInfinity(fpsValue) || fpsValue <= 0f)
        {
            result.invalidFps = true;
        }

        if (string.IsNullOrEmpty(sceneName))
        {
            result.missingSceneName = true;
        }

        int idCount = resourceIds != null ? resourceIds.Count : 0;
        if (resourceCount != idCount)
        {
            result.resourceIdMismatch = resourceCount - idCount;
        }

        return result;
    }

    private void MaybeEmitIntegrityReport(int frameIndex, long timestamp, FrameValidationResult frameValidation, List<string> resourceIds, int resourceCount)
    {
        var issues = BuildIntegrityIssues(frameValidation);
        bool healthy = issues.Count == 0;

        var fingerprintBuilder = new StringBuilder();
        fingerprintBuilder.Append(healthy ? "healthy" : "issues");
        foreach (var issue in issues)
        {
            fingerprintBuilder.Append('|').Append(issue.code).Append(':').Append(issue.count);
        }
        string fingerprint = fingerprintBuilder.ToString();
        if (fingerprint == lastIntegrityFingerprint)
        {
            return;
        }

        lastIntegrityFingerprint = fingerprint;

        var report = new IntegrityReportMessage
        {
            clientId = clientId,
            timestamp = timestamp,
            frameIndex = frameIndex,
            healthy = healthy,
            issues = issues,
            resourceSnapshotCount = lastResourceValidation.totalEntries,
            resourceTotalCount = resourceCount,
            resourceIdCount = resourceIds != null ? resourceIds.Count : 0,
            resourceNullEntries = lastResourceValidation.nullEntries,
            resourceMissingIds = lastResourceValidation.missingId,
            resourceDuplicateIds = lastResourceValidation.duplicateId,
            resourceMissingName = lastResourceValidation.missingName,
            resourceMissingType = lastResourceValidation.missingType,
            resourceMissingSize = lastResourceValidation.missingSize,
            resourceIdMismatch = frameValidation.resourceIdMismatch,
            invalidFrameDelta = frameValidation.invalidDelta,
            invalidFps = frameValidation.invalidFps,
            missingSceneName = frameValidation.missingSceneName
        };

#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
        EnqueueTelemetryPayload(report);
#endif

        if (!healthy)
        {
            foreach (var issue in issues)
            {
                Debug.LogWarning($"Telemetry integrity issue [{issue.code}] x{issue.count}: {issue.message}");
            }
        }
        else
        {
            Debug.Log("Telemetry data integrity verified.");
        }
    }

    private List<TelemetryIntegrityIssue> BuildIntegrityIssues(FrameValidationResult frameValidation)
    {
        var issues = new List<TelemetryIntegrityIssue>();

        if (lastResourceValidation.nullEntries > 0)
        {
            issues.Add(new TelemetryIntegrityIssue { code = "resource_null_entries", message = "Resource snapshot contained null entries.", count = lastResourceValidation.nullEntries });
        }

        if (lastResourceValidation.missingId > 0)
        {
            issues.Add(new TelemetryIntegrityIssue { code = "resource_missing_id", message = "Resources were missing stable identifiers.", count = lastResourceValidation.missingId });
        }

        if (lastResourceValidation.duplicateId > 0)
        {
            issues.Add(new TelemetryIntegrityIssue { code = "resource_duplicate_id", message = "Duplicate resource identifiers detected in snapshot.", count = lastResourceValidation.duplicateId });
        }

        if (lastResourceValidation.missingName > 0)
        {
            issues.Add(new TelemetryIntegrityIssue { code = "resource_missing_name", message = "Resources without a readable name were found.", count = lastResourceValidation.missingName });
        }

        if (lastResourceValidation.missingType > 0)
        {
            issues.Add(new TelemetryIntegrityIssue { code = "resource_missing_type", message = "Resources were missing type or category metadata.", count = lastResourceValidation.missingType });
        }

        if (lastResourceValidation.missingSize > 0)
        {
            issues.Add(new TelemetryIntegrityIssue { code = "resource_missing_size", message = "Resources had no size information populated.", count = lastResourceValidation.missingSize });
        }

        if (frameValidation.resourceIdMismatch != 0)
        {
            int magnitude = Mathf.Abs(frameValidation.resourceIdMismatch);
            string message = frameValidation.resourceIdMismatch > 0
                ? $"{magnitude} resources were missing IDs in the frame payload."
                : $"Frame payload reported {magnitude} more resource IDs than entries in the snapshot.";
            issues.Add(new TelemetryIntegrityIssue { code = "resource_id_mismatch", message = message, count = magnitude });
        }

        if (frameValidation.invalidDelta)
        {
            issues.Add(new TelemetryIntegrityIssue { code = "invalid_delta_time", message = "Frame delta time was invalid (NaN/Inf/negative).", count = 1 });
        }

        if (frameValidation.invalidFps)
        {
            issues.Add(new TelemetryIntegrityIssue { code = "invalid_fps", message = "Calculated FPS was invalid (NaN/Inf/non-positive).", count = 1 });
        }

        if (frameValidation.missingSceneName)
        {
            issues.Add(new TelemetryIntegrityIssue { code = "missing_scene_name", message = "Active scene name was empty when building frame payload.", count = 1 });
        }

        return issues;
    }

    private sealed class ResourceValidationResult
    {
        public int totalEntries;
        public int nullEntries;
        public int missingId;
        public int duplicateId;
        public int missingName;
        public int missingType;
        public int missingSize;

        public void Reset()
        {
            totalEntries = 0;
            nullEntries = 0;
            missingId = 0;
            duplicateId = 0;
            missingName = 0;
            missingType = 0;
            missingSize = 0;
        }
    }

    private struct FrameValidationResult
    {
        public bool invalidDelta;
        public bool invalidFps;
        public bool missingSceneName;
        public int resourceIdMismatch;
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

    private List<ResourceCategoryStat> SummarizeResourceStats(List<ResourceEntry> resources, out int totalKB, out int totalCount)
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

        Texture2D tex = null;
        RenderTexture initialActive = RenderTexture.active;
        RenderTexture tempRt = null;
        RenderTexture scaleRt = null;
        Camera captureCamera = null;
        RenderTexture originalTarget = null;

        try
        {
#if UNITY_2018_2_OR_NEWER
            try
            {
                tex = ScreenCapture.CaptureScreenshotAsTexture();
            }
            catch (Exception ex)
            {
                Debug.LogWarning("Thumbnail screen capture failed, falling back to camera render: " + ex.Message);
                tex = null;
            }
#endif

            if (tex == null)
            {
                captureCamera = FindBestCamera();
                if (captureCamera == null)
                {
                    onComplete(null);
                    yield break;
                }

                int w = Mathf.Clamp(thumbnailWidth, 32, 4096);
                float aspect = Screen.width > 0 ? (float)Screen.height / Screen.width : 1f;
                int h = Mathf.Max(1, Mathf.RoundToInt(w * aspect));

                tempRt = RenderTexture.GetTemporary(w, h, 24, RenderTextureFormat.ARGB32);
                originalTarget = captureCamera.targetTexture;

                captureCamera.targetTexture = tempRt;
                captureCamera.Render();

                RenderTexture.active = tempRt;
                tex = new Texture2D(w, h, TextureFormat.RGB24, false);
                tex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
                tex.Apply();
                RenderTexture.active = initialActive;
            }

            if (tex == null)
            {
                onComplete(null);
                yield break;
            }

            if (thumbnailWidth > 0 && tex.width > thumbnailWidth)
            {
                float aspect = tex.width > 0 ? (float)tex.height / tex.width : 1f;
                int targetW = Mathf.Clamp(thumbnailWidth, 32, 4096);
                int targetH = Mathf.Max(1, Mathf.RoundToInt(targetW * aspect));
                var scaled = new Texture2D(targetW, targetH, TextureFormat.RGB24, false);
                scaleRt = RenderTexture.GetTemporary(targetW, targetH, 0, RenderTextureFormat.ARGB32);
                Graphics.Blit(tex, scaleRt);
                RenderTexture.active = scaleRt;
                scaled.ReadPixels(new Rect(0, 0, targetW, targetH), 0, 0);
                scaled.Apply();
                RenderTexture.active = initialActive;
                RenderTexture.ReleaseTemporary(scaleRt);
                scaleRt = null;
                UnityEngine.Object.Destroy(tex);
                tex = scaled;
            }

            byte[] jpg = tex.EncodeToJPG(Mathf.Clamp(jpegQuality, 10, 90));
            UnityEngine.Object.Destroy(tex);

            if (jpg != null && jpg.Length > 0)
            {
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
            if (scaleRt != null)
            {
                RenderTexture.ReleaseTemporary(scaleRt);
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
                            EnqueueTelemetryPayload(snapshotMsg);
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
        if (currentResourceSnapshot == null) return;
        for (int i = 0; i < currentResourceSnapshot.Count; i++)
        {
            var entry = currentResourceSnapshot[i];
            if (entry != null && entry.id == updated.id)
            {
                currentResourceSnapshot[i] = updated;
                break;
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
        EnqueueTelemetryPayload(ack);
#endif
    }

#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_ANDROID || UNITY_IOS
    private void EnsureSenderWorker()
    {
        if (wsSenderThread != null && wsSenderThread.IsAlive) return;

        if (outboundSignal == null)
        {
            outboundSignal = new AutoResetEvent(false);
        }

        wsSenderCts?.Dispose();
        wsSenderCts = new CancellationTokenSource();
        wsSenderThread = new Thread(() => ProcessOutboundQueue(wsSenderCts.Token))
        {
            IsBackground = true,
            Name = "TelemetrySenderQueue"
        };
        wsSenderThread.Start();
    }

    private void StopSenderWorker()
    {
        if (wsSenderCts != null && !wsSenderCts.IsCancellationRequested)
        {
            wsSenderCts.Cancel();
        }
        if (outboundSignal != null)
        {
            outboundSignal.Set();
        }
        if (wsSenderThread != null)
        {
            try
            {
                wsSenderThread.Join(200);
            }
            catch { }
            wsSenderThread = null;
        }
        if (wsSenderCts != null)
        {
            wsSenderCts.Dispose();
            wsSenderCts = null;
        }

        while (outboundQueue.TryDequeue(out _)) { }
    }

    private void ProcessOutboundQueue(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            if (!outboundQueue.TryDequeue(out var payload))
            {
                try
                {
                    outboundSignal?.WaitOne(10);
                }
                catch (ObjectDisposedException)
                {
                    return;
                }
                continue;
            }

            string json = payload as string;
            if (json == null)
            {
                try
                {
                    json = JsonConvert.SerializeObject(payload);
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("Failed to serialize telemetry payload: " + ex.Message);
                    continue;
                }
            }

            if (string.IsNullOrEmpty(json))
            {
                continue;
            }

            var bytes = Encoding.UTF8.GetBytes(json);
            var seg = new ArraySegment<byte>(bytes);

            bool sent = false;
            while (!sent && !token.IsCancellationRequested)
            {
                try
                {
                    if (ws == null || ws.State != WebSocketState.Open)
                    {
                        Thread.Sleep(5);
                        continue;
                    }

                    ws.SendAsync(seg, WebSocketMessageType.Text, true, token).GetAwaiter().GetResult();
                    sent = true;
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                catch (ObjectDisposedException)
                {
                    return;
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("Telemetry send failed: " + ex.Message);
                    Thread.Sleep(20);
                }
            }
        }
    }

    private void EnqueueTelemetryPayload(object payload)
    {
        if (payload == null) return;
        outboundQueue.Enqueue(payload);
        outboundSignal.Set();
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

[Serializable]
public class TelemetryIntegrityIssue
{
    public string code;
    public string message;
    public int count;
}

[Serializable]
public class IntegrityReportMessage
{
    public string type = "integrity_report";
    public string clientId;
    public long timestamp;
    public int frameIndex;
    public bool healthy;
    public List<TelemetryIntegrityIssue> issues;
    public int resourceSnapshotCount;
    public int resourceTotalCount;
    public int resourceIdCount;
    public int resourceNullEntries;
    public int resourceMissingIds;
    public int resourceDuplicateIds;
    public int resourceMissingName;
    public int resourceMissingType;
    public int resourceMissingSize;
    public int resourceIdMismatch;
    public bool invalidFrameDelta;
    public bool invalidFps;
    public bool missingSceneName;
}

