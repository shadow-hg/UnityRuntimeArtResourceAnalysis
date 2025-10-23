using System;
using System.Collections;
using System.Collections.Generic;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace UnityProfileV2.Telemetry
{
    [DisallowMultipleComponent]
    public class AssetTelemetryReporter : MonoBehaviour
    {
        private const int DefaultServerPort = 48080;
        internal const string ServerEndpointPlayerPrefsKey = "UnityProfileV2.Telemetry.ServerEndpointOverride";

        [SerializeField]
        [Tooltip("Optional override for the telemetry server endpoint (e.g. http://localhost:48080). Leave empty to auto-detect.")]
        private string _serverEndpointOverride = string.Empty;

        private string _serverEndpoint = string.Empty;

        private float _sampleIntervalSeconds = 0f;

        private float _framePreviewScale = 0.2f;

        private int _maxAssetsPerCategory = 200;

        private bool _autoManageSession = true;

        private bool _framePreviewDisabled = false;

        private const int ServerConfigRequestTimeoutSeconds = 5;
        private const int ServerConfigRetryCount = 3;
        private const float ServerConfigRetryDelaySeconds = 1f;
        private const float ServerConfigPollingIntervalSeconds = 1f;

        private string _sessionId;
        private float _lastSampleTime;
        private float _lastSampleRealtime;
        private int _lastFrameCount;
        private int _snapshotSequence;
        private Coroutine _sampleCoroutine;
        private Coroutine _initializationCoroutine;
        private Coroutine _configPollingCoroutine;
        private bool _sessionManagedAutomatically;
        private TelemetrySnapshotOptions _snapshotOptions = TelemetrySnapshotOptions.Default;
        private AssetTelemetryUtility.TelemetryCollectionState _collectionState = new();
        private ClientDefaultsPayload? _lastAppliedClientDefaults;

        private static CoroutineRunner _coroutineRunner;

        public string ServerEndpointOverride => _serverEndpointOverride;

        public string CurrentServerEndpoint => _serverEndpoint;

        public string GetAutoDetectedServerEndpoint()
        {
            return BuildEndpointFromHost(ResolveLocalIpAddress());
        }

        public void ApplyServerEndpointOverride(string endpoint, bool persist = true)
        {
            var sanitized = SanitizeEndpoint(endpoint);

            if (string.IsNullOrWhiteSpace(endpoint))
            {
                sanitized = string.Empty;
            }

            if (string.Equals(_serverEndpointOverride, sanitized, StringComparison.Ordinal))
            {
                if (persist)
                {
                    PersistServerEndpointOverride(sanitized);
                }

                return;
            }

            _serverEndpointOverride = sanitized;

            if (persist)
            {
                PersistServerEndpointOverride(sanitized);
            }

            RestartTelemetry();
        }

        private void PersistServerEndpointOverride(string sanitizedEndpoint)
        {
            if (string.IsNullOrEmpty(sanitizedEndpoint))
            {
                if (PlayerPrefs.HasKey(ServerEndpointPlayerPrefsKey))
                {
                    PlayerPrefs.DeleteKey(ServerEndpointPlayerPrefsKey);
                }
            }
            else
            {
                PlayerPrefs.SetString(ServerEndpointPlayerPrefsKey, sanitizedEndpoint);
            }

            PlayerPrefs.Save();
        }

        private void RestartTelemetry()
        {
            var wasActive = isActiveAndEnabled;

            if (_initializationCoroutine != null)
            {
                StopCoroutine(_initializationCoroutine);
                _initializationCoroutine = null;
            }

            if (_sampleCoroutine != null)
            {
                StopCoroutine(_sampleCoroutine);
                _sampleCoroutine = null;
            }

            StopConfigPolling();

            if (!string.IsNullOrEmpty(_sessionId))
            {
                var sessionId = _sessionId;
                _sessionId = null;
                EnsureCoroutineRunner().StartCoroutine(EndSessionCoroutine(sessionId));
            }

            _sessionManagedAutomatically = false;
            _snapshotSequence = 0;
            _serverEndpoint = ResolveServerEndpoint();
            _collectionState = new AssetTelemetryUtility.TelemetryCollectionState();
            _lastAppliedClientDefaults = null;

            if (wasActive)
            {
                _initializationCoroutine = StartCoroutine(InitializeAndMaybeRegisterCoroutine());
            }
        }

        private void LoadServerEndpointOverrideFromPreferences()
        {
            _serverEndpointOverride = SanitizeEndpoint(_serverEndpointOverride);

            if (!PlayerPrefs.HasKey(ServerEndpointPlayerPrefsKey))
            {
                return;
            }

            var persisted = PlayerPrefs.GetString(ServerEndpointPlayerPrefsKey, string.Empty);
            var sanitized = SanitizeEndpoint(persisted);
            _serverEndpointOverride = string.IsNullOrEmpty(sanitized) ? string.Empty : sanitized;
        }

        private static bool IsSupportedInterface(NetworkInterface networkInterface)
        {
            if (networkInterface == null)
            {
                return false;
            }

            if (networkInterface.OperationalStatus != OperationalStatus.Up)
            {
                return false;
            }

            switch (networkInterface.NetworkInterfaceType)
            {
                case NetworkInterfaceType.Loopback:
                case NetworkInterfaceType.Tunnel:
                case NetworkInterfaceType.Unknown:
                case NetworkInterfaceType.Ppp:
                    return false;
            }

            return true;
        }

        private static bool TryGetValidAddress(UnicastIPAddressInformation unicast, out IPAddress address)
        {
            address = unicast?.Address;
            if (address == null)
            {
                return false;
            }

            if (address.AddressFamily != AddressFamily.InterNetwork)
            {
                return false;
            }

            if (IPAddress.IsLoopback(address))
            {
                return false;
            }

            if (Equals(address, IPAddress.Any) || Equals(address, IPAddress.None))
            {
                return false;
            }

            return true;
        }

        private static bool HasIpv4Gateway(IPInterfaceProperties properties)
        {
            if (properties == null)
            {
                return false;
            }

            foreach (var gateway in properties.GatewayAddresses)
            {
                var gatewayAddress = gateway?.Address;
                if (gatewayAddress == null)
                {
                    continue;
                }

                if (gatewayAddress.AddressFamily != AddressFamily.InterNetwork)
                {
                    continue;
                }

                if (Equals(gatewayAddress, IPAddress.Any) || Equals(gatewayAddress, IPAddress.None))
                {
                    continue;
                }

                return true;
            }

            return false;
        }

        private static string ResolveLocalIpAddress()
        {
            try
            {
                string fallbackAddress = null;

                foreach (var networkInterface in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (!IsSupportedInterface(networkInterface))
                    {
                        continue;
                    }

                    var ipProperties = networkInterface.GetIPProperties();
                    var hasGateway = HasIpv4Gateway(ipProperties);

                    foreach (var unicast in ipProperties.UnicastAddresses)
                    {
                        if (!TryGetValidAddress(unicast, out var address))
                        {
                            continue;
                        }

                        if (hasGateway)
                        {
                            return address.ToString();
                        }

                        if (fallbackAddress == null)
                        {
                            fallbackAddress = address.ToString();
                        }
                    }
                }

                if (!string.IsNullOrEmpty(fallbackAddress))
                {
                    return fallbackAddress;
                }

                var hostAddresses = Dns.GetHostAddresses(Dns.GetHostName());
                foreach (var address in hostAddresses)
                {
                    if (address.AddressFamily != AddressFamily.InterNetwork)
                    {
                        continue;
                    }

                    if (IPAddress.IsLoopback(address))
                    {
                        continue;
                    }

                    if (Equals(address, IPAddress.Any) || Equals(address, IPAddress.None))
                    {
                        continue;
                    }

                    return address.ToString();
                }
            }
            catch
            {
                // Ignored: network information might not be available on all platforms.
            }

            return "127.0.0.1";
        }

        private static string SanitizeEndpoint(string endpoint)
        {
            if (string.IsNullOrWhiteSpace(endpoint))
            {
                return string.Empty;
            }

            return endpoint.EndsWith("/") ? endpoint.TrimEnd('/') : endpoint;
        }

        private static string BuildEndpointFromHost(string host)
        {
            if (string.IsNullOrWhiteSpace(host))
            {
                return string.Empty;
            }

            try
            {
                var builder = new UriBuilder(Uri.UriSchemeHttp, host, DefaultServerPort);
                return SanitizeEndpoint(builder.Uri.ToString());
            }
            catch
            {
                return SanitizeEndpoint($"http://{host}:{DefaultServerPort}");
            }
        }

        private string ResolveServerEndpoint()
        {
            if (!string.IsNullOrWhiteSpace(_serverEndpointOverride))
            {
                return SanitizeEndpoint(_serverEndpointOverride);
            }

            var ipAddress = ResolveLocalIpAddress();
            return BuildEndpointFromHost(ipAddress);
        }

        private IEnumerable<string> EnumerateServerEndpointCandidates()
        {
            var candidates = new List<string>
            {
                _serverEndpointOverride,
                _serverEndpoint,
                BuildEndpointFromHost(ResolveLocalIpAddress()),
                BuildEndpointFromHost("127.0.0.1"),
                BuildEndpointFromHost("localhost")
            };

            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var candidate in candidates)
            {
                var sanitized = SanitizeEndpoint(candidate);
                if (string.IsNullOrEmpty(sanitized))
                {
                    continue;
                }

                if (seen.Add(sanitized))
                {
                    yield return sanitized;
                }
            }
        }

        private void Awake()
        {
            AssetTelemetryUtility.MarkMainThread();
            LoadServerEndpointOverrideFromPreferences();
            _serverEndpoint = ResolveServerEndpoint();
        }

        private void OnEnable()
        {
            LoadServerEndpointOverrideFromPreferences();
            _serverEndpoint = ResolveServerEndpoint();
            _sessionManagedAutomatically = false;
            _lastAppliedClientDefaults = null;

            if (_initializationCoroutine != null)
            {
                StopCoroutine(_initializationCoroutine);
            }

            _initializationCoroutine = StartCoroutine(InitializeAndMaybeRegisterCoroutine());
        }

        private void OnDisable()
        {
            if (_initializationCoroutine != null)
            {
                StopCoroutine(_initializationCoroutine);
                _initializationCoroutine = null;
            }

            if (_sampleCoroutine != null)
            {
                StopCoroutine(_sampleCoroutine);
                _sampleCoroutine = null;
            }

            StopConfigPolling();

            if (_sessionManagedAutomatically && !string.IsNullOrEmpty(_sessionId))
            {
                var sessionId = _sessionId;
                _sessionId = null;
                EnsureCoroutineRunner().StartCoroutine(EndSessionCoroutine(sessionId));
            }

            _sessionManagedAutomatically = false;
        }

        private IEnumerator InitializeAndMaybeRegisterCoroutine()
        {
            yield return LoadServerConfigCoroutine();

            StartConfigPolling();

            if (_autoManageSession)
            {
                _sessionManagedAutomatically = true;
                yield return RegisterSessionCoroutine();
            }
            else
            {
                _sessionManagedAutomatically = false;
            }

            _initializationCoroutine = null;
        }

        private void StartConfigPolling()
        {
            if (_configPollingCoroutine != null)
            {
                return;
            }

            if (ServerConfigPollingIntervalSeconds <= Mathf.Epsilon)
            {
                return;
            }

            _configPollingCoroutine = StartCoroutine(ConfigPollingCoroutine());
        }

        private void StopConfigPolling()
        {
            if (_configPollingCoroutine == null)
            {
                return;
            }

            StopCoroutine(_configPollingCoroutine);
            _configPollingCoroutine = null;
        }

        private IEnumerator ConfigPollingCoroutine()
        {
            var wait = new WaitForSecondsRealtime(Mathf.Max(ServerConfigPollingIntervalSeconds, 0.01f));

            while (isActiveAndEnabled)
            {
                yield return wait;
                yield return RefreshServerConfigCoroutine();
            }

            _configPollingCoroutine = null;
        }

        private IEnumerator RegisterSessionCoroutine()
        {
            var payload = new SessionRegistration
            {
                buildGuid = Application.buildGUID,
                unityVersion = Application.unityVersion,
                platform = Application.platform.ToString(),
                productName = Application.productName,
                deviceModel = SystemInfo.deviceModel,
                deviceName = SystemInfo.deviceName,
                accountName = ResolveAccountName()
            };

            using var request = BuildJsonRequest("/sessions", UnityWebRequest.kHttpVerbPOST, payload);
            yield return request.SendWebRequest();

            if (request.result != UnityWebRequest.Result.Success)
            {
                Debug.LogError($"[UnityProfileV2] Failed to register telemetry session: {request.error}");
                yield break;
            }

            var responseText = request.downloadHandler.text;
            var response = JsonUtility.FromJson<SessionRegistrationResponse>(responseText);
            if (!string.IsNullOrEmpty(responseText) && responseText.IndexOf("\"clientConfig\"", StringComparison.Ordinal) >= 0)
            {
                ApplyClientDefaults(response.clientConfig);
            }
            _sessionId = response.sessionId;
            _lastSampleTime = Time.realtimeSinceStartup;
            _lastSampleRealtime = _lastSampleTime;
            _lastFrameCount = Time.frameCount;
            _snapshotSequence = 0;
            _sampleCoroutine = StartCoroutine(SampleCoroutine());
        }

        private bool ApplyServerConfigurationFromJson(string json)
        {
            if (string.IsNullOrEmpty(json) || json.IndexOf("\"clientDefaults\"", StringComparison.Ordinal) < 0)
            {
                Debug.LogWarning("[UnityProfileV2] Server configuration response did not contain client defaults.");
                return false;
            }

            try
            {
                var payload = JsonUtility.FromJson<ServerConfigurationPayload>(json);
                ApplyServerConfiguration(payload);
                return true;
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[UnityProfileV2] Failed to parse server configuration: {ex.Message}");
                return false;
            }
        }

        private IEnumerator RefreshServerConfigCoroutine(bool allowReconnect = true)
        {
            if (string.IsNullOrEmpty(_serverEndpoint))
            {
                if (allowReconnect)
                {
                    yield return LoadServerConfigCoroutine();
                }

                yield break;
            }

            using (var request = UnityWebRequest.Get(_serverEndpoint + "/config"))
            {
                request.downloadHandler = new DownloadHandlerBuffer();

                if (ServerConfigRequestTimeoutSeconds > 0)
                {
                    request.timeout = Mathf.Max(ServerConfigRequestTimeoutSeconds, 0);
                }

                yield return request.SendWebRequest();

                if (request.result == UnityWebRequest.Result.Success)
                {
                    var json = request.downloadHandler.text;

                    if (ApplyServerConfigurationFromJson(json))
                    {
                        yield break;
                    }
                }
                else if (request.result != UnityWebRequest.Result.InProgress)
                {
                    Debug.LogWarning($"[UnityProfileV2] Failed to refresh server configuration: {request.error}");
                }
            }

            if (allowReconnect)
            {
                yield return LoadServerConfigCoroutine();
            }
        }

        private IEnumerator LoadServerConfigCoroutine()
        {
            var initialEndpoint = _serverEndpoint;

            foreach (var endpoint in EnumerateServerEndpointCandidates())
            {
                var attempt = 0;
                var retriesRemaining = ServerConfigRetryCount;

                while (true)
                {
                    attempt++;

                    using (var request = UnityWebRequest.Get(endpoint + "/config"))
                    {
                        request.downloadHandler = new DownloadHandlerBuffer();

                        if (ServerConfigRequestTimeoutSeconds > 0)
                        {
                            request.timeout = Mathf.Max(ServerConfigRequestTimeoutSeconds, 0);
                        }

                        yield return request.SendWebRequest();

                        if (request.result == UnityWebRequest.Result.Success)
                        {
                            var json = request.downloadHandler.text;

                            if (!ApplyServerConfigurationFromJson(json))
                            {
                                yield break;
                            }

                            if (!string.Equals(_serverEndpoint, endpoint, StringComparison.Ordinal))
                            {
                                _serverEndpoint = endpoint;
                            }

                            if (!string.Equals(initialEndpoint, endpoint, StringComparison.Ordinal))
                            {
                                Debug.Log($"[UnityProfileV2] Connected to telemetry server at {endpoint}.");
                            }

                            yield break;
                        }

                        Debug.LogWarning(
                            $"[UnityProfileV2] Failed to load server configuration from {endpoint} (attempt {attempt}): {request.error}"
                        );
                    }

                    if (retriesRemaining == 0)
                    {
                        break;
                    }

                    if (retriesRemaining > 0)
                    {
                        retriesRemaining--;
                    }

                    if (ServerConfigRetryDelaySeconds > 0f)
                    {
                        yield return new WaitForSecondsRealtime(ServerConfigRetryDelaySeconds);
                    }
                    else
                    {
                        yield return null;
                    }
                }
            }

            Debug.LogWarning("[UnityProfileV2] Unable to reach telemetry server at any known endpoint.");
        }

        private void ApplyServerConfiguration(ServerConfigurationPayload payload)
        {
            ApplyClientDefaults(payload.clientDefaults);
        }

        private void ApplyClientDefaults(ClientDefaultsPayload payload)
        {
            if (_lastAppliedClientDefaults.HasValue && AreClientDefaultsEqual(_lastAppliedClientDefaults.Value, payload))
            {
                return;
            }

            if (payload.maxAssetsPerCategory <= 0)
            {
                payload.maxAssetsPerCategory = _maxAssetsPerCategory;
            }

            _sampleIntervalSeconds = Mathf.Max(payload.sampleIntervalSeconds, 0f);
            _framePreviewScale = Mathf.Clamp01(payload.framePreviewScale);
            _maxAssetsPerCategory = Mathf.Max(payload.maxAssetsPerCategory, 1);
            _autoManageSession = payload.autoManageSession;
            _framePreviewDisabled = payload.disableFramePreview;

            var nextOptions = TelemetrySnapshotOptions.Default;
            if (payload.assetCategoryVersion > 0)
            {
                nextOptions.includeTextures = payload.assetCategories.includeTextures;
                nextOptions.includeMeshes = payload.assetCategories.includeMeshes;
                nextOptions.includeRenderTextures = payload.assetCategories.includeRenderTextures;
                nextOptions.includeMaterials = payload.assetCategories.includeMaterials;
                nextOptions.includeShaders = payload.assetCategories.includeShaders;
                nextOptions.hasExplicitSelection = true;
            }

            nextOptions.includeFrameInsights = payload.telemetrySections.includeFrameInsights;
            nextOptions.includeSystemStats = payload.telemetrySections.includeSystemStats;
            nextOptions.includeAssetIo = payload.telemetrySections.includeAssetIo;
            nextOptions.includeEnvironment = payload.telemetrySections.includeEnvironment;

            _snapshotOptions = nextOptions;

            _lastAppliedClientDefaults = payload;
        }

        private static bool AreClientDefaultsEqual(ClientDefaultsPayload a, ClientDefaultsPayload b)
        {
            if (!Mathf.Approximately(a.sampleIntervalSeconds, b.sampleIntervalSeconds))
            {
                return false;
            }

            if (!Mathf.Approximately(a.framePreviewScale, b.framePreviewScale))
            {
                return false;
            }

            if (a.disableFramePreview != b.disableFramePreview)
            {
                return false;
            }

            if (a.maxAssetsPerCategory != b.maxAssetsPerCategory)
            {
                return false;
            }

            if (a.autoManageSession != b.autoManageSession)
            {
                return false;
            }

            if (a.assetCategoryVersion != b.assetCategoryVersion)
            {
                return false;
            }

            if (a.assetCategoryVersion <= 0 && b.assetCategoryVersion <= 0)
            {
                return AreTelemetrySectionsEqual(a.telemetrySections, b.telemetrySections);
            }

            return AreAssetCategoriesEqual(a.assetCategories, b.assetCategories) &&
                   AreTelemetrySectionsEqual(a.telemetrySections, b.telemetrySections);
        }

        private static bool AreAssetCategoriesEqual(AssetCategoryPayload a, AssetCategoryPayload b)
        {
            return a.includeTextures == b.includeTextures &&
                   a.includeMeshes == b.includeMeshes &&
                   a.includeRenderTextures == b.includeRenderTextures &&
                   a.includeMaterials == b.includeMaterials &&
                    a.includeShaders == b.includeShaders;
        }

        private static bool AreTelemetrySectionsEqual(TelemetrySectionPayload a, TelemetrySectionPayload b)
        {
            return a.includeFrameInsights == b.includeFrameInsights &&
                   a.includeSystemStats == b.includeSystemStats &&
                   a.includeAssetIo == b.includeAssetIo &&
                   a.includeEnvironment == b.includeEnvironment;
        }

        private IEnumerator EndSessionCoroutine(string sessionId)
        {
            using var request = BuildJsonRequest($"/sessions/{sessionId}/close", UnityWebRequest.kHttpVerbPOST, new {});
            yield return request.SendWebRequest();
        }

        private IEnumerator SampleCoroutine()
        {
            while (!string.IsNullOrEmpty(_sessionId))
            {
                var interval = Mathf.Max(_sampleIntervalSeconds, 0f);
                if (interval <= Mathf.Epsilon || Time.realtimeSinceStartup - _lastSampleTime >= interval)
                {
                    yield return SendSnapshot();
                    _lastSampleTime = Time.realtimeSinceStartup;
                }

                yield return null;
            }
        }

        private IEnumerator SendSnapshot()
        {
            var snapshotTask = AssetTelemetryUtility.CreateSnapshotAsync(
                _maxAssetsPerCategory,
                _snapshotOptions,
                _collectionState);

            while (!snapshotTask.IsCompleted)
            {
                yield return null;
            }

            if (snapshotTask.IsFaulted)
            {
                Debug.LogError($"[UnityProfileV2] Failed to build telemetry snapshot: {snapshotTask.Exception?.GetBaseException().Message}");
                yield break;
            }

            if (snapshotTask.IsCanceled)
            {
                Debug.LogWarning("[UnityProfileV2] Telemetry snapshot creation was canceled.");
                yield break;
            }

            var snapshot = snapshotTask.Result;
            if (!_framePreviewDisabled)
            {
                yield return AssetTelemetryUtility.PopulateFramePreview(snapshot, _framePreviewScale);
            }
            var nowRealtime = Time.realtimeSinceStartup;
            var currentFrameCount = Time.frameCount;
            var frameDelta = Mathf.Max(currentFrameCount - _lastFrameCount, 0);
            var elapsedRealtime = Mathf.Max(nowRealtime - _lastSampleRealtime, 1e-4f);
            var averageDeltaTime = frameDelta > 0 ? elapsedRealtime / frameDelta : elapsedRealtime;

            snapshot.frameNumber = ++_snapshotSequence;
            snapshot.timestampUtc = DateTime.UtcNow.ToString("o");
            snapshot.deltaTime = averageDeltaTime;
            snapshot.fps = frameDelta > 0 ? frameDelta / elapsedRealtime : 0f;

            _lastFrameCount = currentFrameCount;
            _lastSampleRealtime = nowRealtime;

            using var request = BuildJsonRequest($"/sessions/{_sessionId}/frames", UnityWebRequest.kHttpVerbPOST, snapshot);
            yield return request.SendWebRequest();

            if (request.result != UnityWebRequest.Result.Success)
            {
                Debug.LogWarning($"[UnityProfileV2] Failed to send telemetry frame: {request.error}");
            }
        }

        private UnityWebRequest BuildJsonRequest(string path, string method, object payload)
        {
            var request = new UnityWebRequest(_serverEndpoint + path, method)
            {
                downloadHandler = new DownloadHandlerBuffer()
            };
            var json = JsonUtility.ToJson(payload);
            var bodyRaw = Encoding.UTF8.GetBytes(json);
            request.uploadHandler = new UploadHandlerRaw(bodyRaw);
            request.SetRequestHeader("Content-Type", "application/json");
            return request;
        }

        private static string ResolveAccountName()
        {
            try
            {
                var userName = Environment.UserName;
                if (!string.IsNullOrWhiteSpace(userName))
                {
                    return userName.Trim();
                }
            }
            catch
            {
                // Ignored: Environment information might not be accessible on all platforms.
            }

            var deviceName = SystemInfo.deviceName;
            return string.IsNullOrWhiteSpace(deviceName) ? null : deviceName.Trim();
        }

        [Serializable]
        private struct SessionRegistration
        {
            public string buildGuid;
            public string unityVersion;
            public string platform;
            public string productName;
            public string deviceModel;
            public string deviceName;
            public string accountName;
        }

        [Serializable]
        private struct ServerConfigurationPayload
        {
            public ClientDefaultsPayload clientDefaults;
        }

        [Serializable]
        private struct ClientDefaultsPayload
        {
            public float sampleIntervalSeconds;
            public float framePreviewScale;
            public bool disableFramePreview;
            public int maxAssetsPerCategory;
            public bool autoManageSession;
            public int assetCategoryVersion;
            public AssetCategoryPayload assetCategories;
            public TelemetrySectionPayload telemetrySections;
        }

        [Serializable]
        private struct SessionRegistrationResponse
        {
            public string sessionId;
            public ClientDefaultsPayload clientConfig;
        }

        [Serializable]
        private struct AssetCategoryPayload
        {
            public bool includeTextures;
            public bool includeMeshes;
            public bool includeRenderTextures;
            public bool includeMaterials;
            public bool includeShaders;
        }

        [Serializable]
        private struct TelemetrySectionPayload
        {
            public bool includeFrameInsights;
            public bool includeSystemStats;
            public bool includeAssetIo;
            public bool includeEnvironment;
        }

        private static CoroutineRunner EnsureCoroutineRunner()
        {
            if (_coroutineRunner != null)
            {
                return _coroutineRunner;
            }

            var runnerGameObject = new GameObject("AssetTelemetryReporterCoroutineRunner")
            {
                hideFlags = HideFlags.HideAndDontSave
            };
            DontDestroyOnLoad(runnerGameObject);
            _coroutineRunner = runnerGameObject.AddComponent<CoroutineRunner>();
            return _coroutineRunner;
        }

        private sealed class CoroutineRunner : MonoBehaviour
        {
        }
    }
}
