using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.SceneManagement;

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
        private const int MaxConcurrentServerConfigRequests = 4;
        private const float MinServerConfigProbeTimeoutSeconds = 1f;
        private const float ServerConfigTimeoutDecayFactor = 0.75f;
        private const int ServerConfigRetryCount = 3;
        private const float ServerConfigRetryDelaySeconds = 1f;
        private const float ServerConfigPollingIntervalSeconds = 1f;
        private const float EndpointCandidateCacheTtlSeconds = 30f;
        private const int EndpointCandidateSampleMultiplier = 4;
        private const float EndpointProbeBaseBackoffSeconds = 1f;
        private const float EndpointProbeMaxBackoffSeconds = 30f;

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
        private string _cachedServerConfigurationJson;
        private bool _hasPendingCachedServerConfiguration;

        private readonly ConcurrentQueue<PendingSnapshotUpload> _snapshotUploadQueue = new();
        private readonly ConcurrentDictionary<int, PendingSnapshotStatus> _pendingSnapshots = new();
        private readonly ConcurrentQueue<Action> _mainThreadActions = new();
        private readonly object _snapshotUploadLock = new();
        private CancellationTokenSource _snapshotUploadCts;
        private Task _snapshotUploadTask;
        private int _pendingSnapshotSequence;
        private const float SnapshotUploadThrottleSeconds = 0.1f;
        private static readonly HttpClientWrapper SnapshotHttpClient = new();

        private readonly List<string> _cachedSubnetCandidates = new();
        private string _cachedSubnetLocalIp = string.Empty;
        private float _cachedSubnetTimestamp;
        private bool _cachedSubnetDirty = true;
        private int _cachedSubnetProbeCursor;
        private readonly System.Random _endpointProbeRandom = new();
        private float _nextEndpointProbeTime;
        private int _consecutiveEndpointProbeFailures;

        private static CoroutineRunner _coroutineRunner;

        public event Action<UnityEngine.Object> OnResourceCreated;
        public event Action<int> OnResourceDestroyed;

        public IEnumerable<PendingSnapshotStatus> PendingSnapshots => _pendingSnapshots.Values;

        public string ServerEndpointOverride => _serverEndpointOverride;

        public string CurrentServerEndpoint => _serverEndpoint;

        public void RequestServerConfigurationRefresh(bool forceSubnetRescan = true)
        {
            var mode = forceSubnetRescan ? EndpointProbeRequestMode.Manual : EndpointProbeRequestMode.Automatic;
            StartCoroutine(RefreshServerConfigCoroutine(true, mode));
        }

        public string GetAutoDetectedServerEndpoint()
        {
            return BuildEndpointFromHost(ResolveLocalIpAddress());
        }

        public void NotifyResourceCreated(UnityEngine.Object resource)
        {
            if (resource == null)
            {
                return;
            }

            AssetTelemetryUtility.NotifyResourceCreated(resource, _collectionState);
            OnResourceCreated?.Invoke(resource);
        }

        public void NotifyResourceDestroyed(UnityEngine.Object resource)
        {
            if (resource == null)
            {
                return;
            }

            AssetTelemetryUtility.NotifyResourceDestroyed(resource, _collectionState);

            OnResourceDestroyed?.Invoke(resource.GetInstanceID());
        }

        public void NotifyResourceDestroyed(int instanceId)
        {
            if (instanceId == 0)
            {
                return;
            }

            AssetTelemetryUtility.NotifyResourceDestroyed(instanceId, _collectionState);
            OnResourceDestroyed?.Invoke(instanceId);
        }

        public void MarkResourceCacheDirty()
        {
            AssetTelemetryUtility.MarkResourceCacheDirty(_collectionState);
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
            InvalidateEndpointCandidateCache();

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

            InvalidateEndpointCandidateCache();

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
            StopSnapshotUploadLoop();
            ProcessMainThreadActions();

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

        private static bool IsPrivateIpv4(string ipAddress)
        {
            if (string.IsNullOrWhiteSpace(ipAddress))
            {
                return false;
            }

            if (!IPAddress.TryParse(ipAddress, out var address))
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

            var bytes = address.GetAddressBytes();

            if (bytes[0] == 10)
            {
                return true;
            }

            if (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31)
            {
                return true;
            }

            if (bytes[0] == 192 && bytes[1] == 168)
            {
                return true;
            }

            if (bytes[0] == 169 && bytes[1] == 254)
            {
                return true;
            }

            return false;
        }

        private static IEnumerable<string> EnumerateLocalSubnetEndpointCandidates(string localIpAddress)
        {
            if (string.IsNullOrWhiteSpace(localIpAddress))
            {
                yield break;
            }

            if (!IPAddress.TryParse(localIpAddress, out var address))
            {
                yield break;
            }

            if (address.AddressFamily != AddressFamily.InterNetwork)
            {
                yield break;
            }

            var addressBytes = address.GetAddressBytes();
            var prefix = $"{addressBytes[0]}.{addressBytes[1]}.{addressBytes[2]}";

            for (var host = 1; host < 255; host++)
            {
                if (host == addressBytes[3])
                {
                    continue;
                }

                yield return BuildEndpointFromHost($"{prefix}.{host}");
            }
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

        private enum EndpointProbeRequestMode
        {
            Automatic,
            Manual,
            OverrideChanged,
            Initialization,
            Retry
        }

        private sealed class EndpointCandidatePlan
        {
            public EndpointProbeRequestMode Mode { get; set; }
            public bool CacheHit { get; set; }
            public List<IReadOnlyList<string>> Batches { get; } = new();
        }

        private void InvalidateEndpointCandidateCache()
        {
            _cachedSubnetDirty = true;
        }

        private static bool ShouldForceEndpointRescan(EndpointProbeRequestMode mode)
        {
            switch (mode)
            {
                case EndpointProbeRequestMode.Manual:
                case EndpointProbeRequestMode.OverrideChanged:
                case EndpointProbeRequestMode.Initialization:
                    return true;
                default:
                    return false;
            }
        }

        private EndpointCandidatePlan PrepareEndpointCandidatePlan(EndpointProbeRequestMode mode)
        {
            var plan = new EndpointCandidatePlan
            {
                Mode = mode
            };

            var now = Time.realtimeSinceStartup;
            var localIpAddress = ResolveLocalIpAddress();

            var forceRescan = ShouldForceEndpointRescan(mode) || _cachedSubnetDirty;

            var shouldRefreshSubnet = forceRescan ||
                string.IsNullOrEmpty(_cachedSubnetLocalIp) ||
                !string.Equals(_cachedSubnetLocalIp, localIpAddress, StringComparison.Ordinal) ||
                (EndpointCandidateCacheTtlSeconds > 0f &&
                 now - _cachedSubnetTimestamp >= EndpointCandidateCacheTtlSeconds);

            List<string> subnetCandidates;

            if (shouldRefreshSubnet)
            {
                subnetCandidates = new List<string>();

                foreach (var candidate in EnumerateLocalSubnetEndpointCandidates(localIpAddress))
                {
                    var sanitized = SanitizeEndpoint(candidate);
                    if (string.IsNullOrEmpty(sanitized))
                    {
                        continue;
                    }

                    subnetCandidates.Add(sanitized);
                }

                ShuffleInPlace(subnetCandidates, _endpointProbeRandom);

                _cachedSubnetCandidates.Clear();
                _cachedSubnetCandidates.AddRange(subnetCandidates);
                _cachedSubnetLocalIp = localIpAddress;
                _cachedSubnetTimestamp = now;
                _cachedSubnetProbeCursor = 0;
                _cachedSubnetDirty = false;

                plan.CacheHit = false;
            }
            else
            {
                subnetCandidates = _cachedSubnetCandidates;
                plan.CacheHit = true;
            }

            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            void AddSingletonCandidate(string endpoint)
            {
                var sanitized = SanitizeEndpoint(endpoint);
                if (string.IsNullOrEmpty(sanitized) || !seen.Add(sanitized))
                {
                    return;
                }

                plan.Batches.Add(new List<string> { sanitized });
            }

            AddSingletonCandidate(_serverEndpointOverride);
            AddSingletonCandidate(_serverEndpoint);
            AddSingletonCandidate(BuildEndpointFromHost(localIpAddress));
            AddSingletonCandidate(BuildEndpointFromHost("127.0.0.1"));
            AddSingletonCandidate(BuildEndpointFromHost("localhost"));

            if (subnetCandidates.Count > 0 && IsPrivateIpv4(localIpAddress))
            {
                var subnetSample = BuildSubnetSample(subnetCandidates, seen, !plan.CacheHit);

                if (subnetSample.Count > 0)
                {
                    var batch = new List<string>(MaxConcurrentServerConfigRequests);

                    foreach (var candidate in subnetSample)
                    {
                        batch.Add(candidate);

                        if (batch.Count >= MaxConcurrentServerConfigRequests)
                        {
                            plan.Batches.Add(new List<string>(batch));
                            batch.Clear();
                        }
                    }

                    if (batch.Count > 0)
                    {
                        plan.Batches.Add(batch);
                    }
                }
            }

            return plan;
        }

        private List<string> BuildSubnetSample(IReadOnlyList<string> candidates, HashSet<string> seen, bool forceFullScan)
        {
            var sample = new List<string>();

            if (candidates == null || candidates.Count == 0)
            {
                return sample;
            }

            var sampleSize = forceFullScan
                ? candidates.Count
                : Mathf.Min(candidates.Count, MaxConcurrentServerConfigRequests * EndpointCandidateSampleMultiplier);

            var totalCandidates = candidates.Count;
            var processed = 0;

            while (sample.Count < sampleSize && processed < totalCandidates)
            {
                var index = (_cachedSubnetProbeCursor + processed) % totalCandidates;
                processed++;

                var candidate = candidates[index];

                if (string.IsNullOrEmpty(candidate) || !seen.Add(candidate))
                {
                    continue;
                }

                sample.Add(candidate);
            }

            if (totalCandidates > 0)
            {
                _cachedSubnetProbeCursor = (_cachedSubnetProbeCursor + processed) % totalCandidates;
            }

            return sample;
        }

        private static void ShuffleInPlace<T>(IList<T> list, System.Random random)
        {
            if (list == null || list.Count <= 1)
            {
                return;
            }

            for (var i = list.Count - 1; i > 0; i--)
            {
                var swapIndex = random.Next(i + 1);
                (list[i], list[swapIndex]) = (list[swapIndex], list[i]);
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

        private IEnumerable<string> EnumerateServerEndpointCandidates(EndpointProbeRequestMode mode = EndpointProbeRequestMode.Automatic)
        {
            var plan = PrepareEndpointCandidatePlan(mode);

            foreach (var batch in plan.Batches)
            {
                foreach (var endpoint in batch)
                {
                    yield return endpoint;
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

            SceneManager.sceneLoaded += HandleSceneLoaded;
            SceneManager.sceneUnloaded += HandleSceneUnloaded;
            SceneManager.activeSceneChanged += HandleActiveSceneChanged;

            if (_initializationCoroutine != null)
            {
                StopCoroutine(_initializationCoroutine);
            }

            _initializationCoroutine = StartCoroutine(InitializeAndMaybeRegisterCoroutine());
        }

        private void OnDisable()
        {
            StopSnapshotUploadLoop();
            ProcessMainThreadActions();

            SceneManager.sceneLoaded -= HandleSceneLoaded;
            SceneManager.sceneUnloaded -= HandleSceneUnloaded;
            SceneManager.activeSceneChanged -= HandleActiveSceneChanged;

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
            yield return LoadServerConfigCoroutine(EndpointProbeRequestMode.Initialization);

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

        private void Update()
        {
            if (_mainThreadActions.IsEmpty)
            {
                return;
            }

            ProcessMainThreadActions();
        }

        private void HandleSceneLoaded(Scene scene, LoadSceneMode mode)
        {
            AssetTelemetryUtility.MarkResourceCacheDirty(_collectionState);
        }

        private void HandleSceneUnloaded(Scene scene)
        {
            AssetTelemetryUtility.MarkResourceCacheDirty(_collectionState);
        }

        private void HandleActiveSceneChanged(Scene previousScene, Scene newScene)
        {
            AssetTelemetryUtility.MarkResourceCacheDirty(_collectionState);
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
                yield return RefreshServerConfigCoroutine(mode: EndpointProbeRequestMode.Automatic);
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

        private IEnumerator RefreshServerConfigCoroutine(bool allowReconnect = true, EndpointProbeRequestMode mode = EndpointProbeRequestMode.Automatic)
        {
            if (_hasPendingCachedServerConfiguration && !string.IsNullOrEmpty(_cachedServerConfigurationJson))
            {
                _hasPendingCachedServerConfiguration = false;

                if (ApplyServerConfigurationFromJson(_cachedServerConfigurationJson))
                {
                    yield break;
                }
            }

            if (string.IsNullOrEmpty(_serverEndpoint))
            {
                if (allowReconnect)
                {
                    var reconnectMode = mode == EndpointProbeRequestMode.Automatic
                        ? EndpointProbeRequestMode.Retry
                        : mode;
                    yield return LoadServerConfigCoroutine(reconnectMode);
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
                        _cachedServerConfigurationJson = json;
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
                var reconnectMode = mode == EndpointProbeRequestMode.Automatic
                    ? EndpointProbeRequestMode.Retry
                    : mode;
                yield return LoadServerConfigCoroutine(reconnectMode);
            }
        }

        private IEnumerator LoadServerConfigCoroutine(EndpointProbeRequestMode mode = EndpointProbeRequestMode.Automatic)
        {
            _cachedServerConfigurationJson = null;
            _hasPendingCachedServerConfiguration = false;

            var initialEndpoint = _serverEndpoint;
            var plan = PrepareEndpointCandidatePlan(mode);
            var baseTimeoutSeconds = ServerConfigRequestTimeoutSeconds > 0
                ? Mathf.Max(ServerConfigRequestTimeoutSeconds, Mathf.CeilToInt(MinServerConfigProbeTimeoutSeconds))
                : 0;

            if (plan.CacheHit &&
                (mode == EndpointProbeRequestMode.Automatic || mode == EndpointProbeRequestMode.Retry) &&
                _consecutiveEndpointProbeFailures > 0)
            {
                var now = Time.realtimeSinceStartup;

                if (now < _nextEndpointProbeTime)
                {
                    var delay = Mathf.Max(0f, _nextEndpointProbeTime - now);
                    if (delay > 0f)
                    {
                        yield return new WaitForSecondsRealtime(delay);
                    }
                }
            }

            foreach (var batch in plan.Batches)
            {
                var dynamicTimeoutSeconds = baseTimeoutSeconds > 0 ? (float)baseTimeoutSeconds : 0f;
                var states = new List<ServerEndpointProbeState>(batch.Count);

                foreach (var endpoint in batch)
                {
                    states.Add(new ServerEndpointProbeState(endpoint, ServerConfigRetryCount));
                }

                var pending = new Queue<ServerEndpointProbeState>(states);

                while (pending.Count > 0)
                {
                    var window = new List<ServerEndpointProbeState>(MaxConcurrentServerConfigRequests);

                    while (window.Count < MaxConcurrentServerConfigRequests && pending.Count > 0)
                    {
                        window.Add(pending.Dequeue());
                    }

                    var timeoutSeconds = dynamicTimeoutSeconds <= 0f
                        ? 0
                        : Mathf.Max(1, Mathf.CeilToInt(dynamicTimeoutSeconds));

                    var result = new ServerEndpointBatchResult();
                    yield return ProbeServerEndpointWindow(window, timeoutSeconds, result);

                    if (result.Success)
                    {
                        if (!ApplyServerConfigurationFromJson(result.Json))
                        {
                            yield break;
                        }

                        if (!string.Equals(_serverEndpoint, result.Endpoint, StringComparison.Ordinal))
                        {
                            _serverEndpoint = result.Endpoint;
                        }

                        _cachedServerConfigurationJson = result.Json;
                        _hasPendingCachedServerConfiguration = true;

                        if (!string.Equals(initialEndpoint, result.Endpoint, StringComparison.Ordinal))
                        {
                            Debug.Log($"[UnityProfileV2] Connected to telemetry server at {result.Endpoint}.");
                        }

                        _consecutiveEndpointProbeFailures = 0;
                        _nextEndpointProbeTime = 0f;
                        yield break;
                    }

                    var shouldDelay = false;
                    var hadTimeout = false;

                    foreach (var state in window)
                    {
                        if (state.TimedOut && dynamicTimeoutSeconds > 0f)
                        {
                            hadTimeout = true;
                        }

                        if (!state.ShouldRetry)
                        {
                            continue;
                        }

                        state.ShouldRetry = false;
                        pending.Enqueue(state);
                        shouldDelay = true;
                    }

                    if (hadTimeout && dynamicTimeoutSeconds > 0f)
                    {
                        dynamicTimeoutSeconds = Mathf.Max(
                            MinServerConfigProbeTimeoutSeconds,
                            dynamicTimeoutSeconds * ServerConfigTimeoutDecayFactor
                        );
                    }

                    if (!shouldDelay)
                    {
                        continue;
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

            if (plan.CacheHit && (mode == EndpointProbeRequestMode.Automatic || mode == EndpointProbeRequestMode.Retry))
            {
                _consecutiveEndpointProbeFailures = Mathf.Clamp(_consecutiveEndpointProbeFailures + 1, 0, 10);
                var exponent = Mathf.Max(0, _consecutiveEndpointProbeFailures - 1);
                var backoffSeconds = Mathf.Min(
                    EndpointProbeMaxBackoffSeconds,
                    EndpointProbeBaseBackoffSeconds * Mathf.Pow(2f, exponent));
                var jitter = (float)_endpointProbeRandom.NextDouble() * EndpointProbeBaseBackoffSeconds;
                _nextEndpointProbeTime = Time.realtimeSinceStartup + backoffSeconds + jitter;
            }
            else
            {
                _consecutiveEndpointProbeFailures = 0;
                _nextEndpointProbeTime = 0f;
            }
        }

        private IEnumerator ProbeServerEndpointWindow(
            List<ServerEndpointProbeState> window,
            int timeoutSeconds,
            ServerEndpointBatchResult result)
        {
            if (window == null || window.Count == 0)
            {
                yield break;
            }

            var operations = new List<ServerEndpointProbeOperation>(window.Count);

            foreach (var state in window)
            {
                state.Attempts++;
                state.ShouldRetry = false;
                state.TimedOut = false;

                var request = UnityWebRequest.Get(state.Endpoint + "/config");
                request.downloadHandler = new DownloadHandlerBuffer();

                if (timeoutSeconds > 0)
                {
                    request.timeout = timeoutSeconds;
                }

                var operation = request.SendWebRequest();
                operations.Add(new ServerEndpointProbeOperation(state, request, operation));
            }

            while (operations.Count > 0)
            {
                ServerEndpointProbeOperation completedOperation = null;

                for (var i = 0; i < operations.Count; i++)
                {
                    var candidate = operations[i];
                    if (!candidate.Operation.isDone)
                    {
                        continue;
                    }

                    completedOperation = candidate;
                    operations.RemoveAt(i);
                    break;
                }

                if (completedOperation == null)
                {
                    yield return null;
                    continue;
                }

                var request = completedOperation.Request;
                var state = completedOperation.State;
                var attempt = state.Attempts;

                if (request.result == UnityWebRequest.Result.Success)
                {
                    result.Success = true;
                    result.Endpoint = state.Endpoint;
                    result.Json = request.downloadHandler.text;
                    completedOperation.Dispose();
                    break;
                }

                var error = request.error ?? string.Empty;

                if (error.IndexOf("timed out", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    state.TimedOut = true;
                }

                if (string.IsNullOrEmpty(error))
                {
                    Debug.LogWarning(
                        $"[UnityProfileV2] Failed to load server configuration from {state.Endpoint} (attempt {attempt})."
                    );
                }
                else
                {
                    Debug.LogWarning(
                        $"[UnityProfileV2] Failed to load server configuration from {state.Endpoint} (attempt {attempt}): {error}"
                    );
                }

                if (state.RetriesRemaining != 0)
                {
                    if (state.RetriesRemaining > 0)
                    {
                        state.RetriesRemaining--;
                    }

                    state.ShouldRetry = true;
                }

                completedOperation.Dispose();
            }

            if (result.Success)
            {
                foreach (var operation in operations)
                {
                    operation.Request.Abort();
                    operation.Dispose();
                }
            }
            else
            {
                foreach (var operation in operations)
                {
                    if (!operation.Operation.isDone)
                    {
                        operation.Request.Abort();
                    }

                    operation.Dispose();
                }
            }
        }

        private sealed class ServerEndpointProbeState
        {
            public ServerEndpointProbeState(string endpoint, int retriesRemaining)
            {
                Endpoint = endpoint;
                RetriesRemaining = retriesRemaining;
            }

            public string Endpoint { get; }
            public int Attempts { get; set; }
            public int RetriesRemaining { get; set; }
            public bool ShouldRetry { get; set; }
            public bool TimedOut { get; set; }
        }

        private sealed class ServerEndpointBatchResult
        {
            public bool Success { get; set; }
            public string Endpoint { get; set; }
            public string Json { get; set; }
        }

        private sealed class ServerEndpointProbeOperation : IDisposable
        {
            public ServerEndpointProbeOperation(
                ServerEndpointProbeState state,
                UnityWebRequest request,
                UnityWebRequestAsyncOperation operation)
            {
                State = state;
                Request = request;
                Operation = operation;
            }

            public ServerEndpointProbeState State { get; }
            public UnityWebRequest Request { get; }
            public UnityWebRequestAsyncOperation Operation { get; }

            public void Dispose()
            {
                Request.Dispose();
            }
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

            if (!SubmitTelemetryUpdates(snapshot))
            {
                AssetTelemetryUtility.ReleaseSnapshot(snapshot);
            }
        }

        private bool SubmitTelemetryUpdates(TelemetrySnapshot snapshot)
        {
            if (snapshot == null)
            {
                return false;
            }

            var sessionId = _sessionId;
            if (string.IsNullOrEmpty(sessionId))
            {
                return false;
            }

            var endpoint = _serverEndpoint;
            if (string.IsNullOrEmpty(endpoint))
            {
                return false;
            }

            var uploadId = Interlocked.Increment(ref _pendingSnapshotSequence);

            var status = new PendingSnapshotStatus
            {
                Id = uploadId,
                State = SnapshotUploadState.Queued,
                EnqueuedAtUtc = DateTime.UtcNow
            };

            _pendingSnapshots[uploadId] = status;

            void Completion(bool succeeded, string error)
            {
                status.CompletedAtUtc = DateTime.UtcNow;
                status.Error = error;
                status.State = succeeded ? SnapshotUploadState.Completed : SnapshotUploadState.Failed;

                if (!succeeded && !string.IsNullOrEmpty(error) && !string.Equals(error, "Upload canceled", StringComparison.Ordinal))
                {
                    Debug.LogWarning($"[UnityProfileV2] Failed to send telemetry frame: {error}");
                }

                _pendingSnapshots.TryRemove(uploadId, out _);
            }

            var pending = new PendingSnapshotUpload(uploadId, sessionId, endpoint, snapshot, Completion);
            _snapshotUploadQueue.Enqueue(pending);
            EnsureSnapshotUploadLoop();

            return true;
        }

        private void EnsureSnapshotUploadLoop()
        {
            lock (_snapshotUploadLock)
            {
                if (_snapshotUploadTask != null && !_snapshotUploadTask.IsCompleted)
                {
                    return;
                }

                _snapshotUploadCts?.Dispose();
                _snapshotUploadCts = new CancellationTokenSource();

                var token = _snapshotUploadCts.Token;
                _snapshotUploadTask = Task.Run(() => SnapshotUploadLoopAsync(token), token);
                _snapshotUploadTask.ContinueWith(t =>
                {
                    if (t.Exception == null)
                    {
                        return;
                    }

                    var flattened = t.Exception.Flatten();
                    foreach (var exception in flattened.InnerExceptions)
                    {
                        EnqueueMainThreadAction(() => Debug.LogException(exception));
                    }
                }, CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted, TaskScheduler.Default);
            }
        }

        private async Task SnapshotUploadLoopAsync(CancellationToken token)
        {
            try
            {
                while (!token.IsCancellationRequested)
                {
                    if (!_snapshotUploadQueue.TryDequeue(out var pending))
                    {
                        try
                        {
                            await Task.Delay(TimeSpan.FromMilliseconds(50), token).ConfigureAwait(false);
                        }
                        catch (OperationCanceledException)
                        {
                            break;
                        }

                        continue;
                    }

                    NotifySnapshotUploadStarted(pending);

                    var throttleDelay = Task.Delay(TimeSpan.FromSeconds(Mathf.Max(SnapshotUploadThrottleSeconds, 0f)), token);

                    try
                    {
                        await UploadSnapshotAsync(pending, token).ConfigureAwait(false);
                        NotifySnapshotUploadResult(pending, true, null);
                    }
                    catch (OperationCanceledException)
                    {
                        NotifySnapshotUploadResult(pending, false, "Upload canceled");
                        break;
                    }
                    catch (Exception exception)
                    {
                        NotifySnapshotUploadResult(pending, false, exception.Message);
                    }

                    try
                    {
                        await throttleDelay.ConfigureAwait(false);
                    }
                    catch (OperationCanceledException)
                    {
                        break;
                    }
                }
            }
            finally
            {
                while (_snapshotUploadQueue.TryDequeue(out var remaining))
                {
                    AssetTelemetryUtility.ReleaseSnapshot(remaining.Snapshot);
                    NotifySnapshotUploadResult(remaining, false, "Upload canceled");
                }
            }
        }

        private async Task UploadSnapshotAsync(PendingSnapshotUpload pending, CancellationToken token)
        {
            if (pending == null)
            {
                return;
            }

            string json;
            try
            {
                json = JsonUtility.ToJson(pending.Snapshot);
            }
            finally
            {
                AssetTelemetryUtility.ReleaseSnapshot(pending.Snapshot);
            }

            var bytes = Encoding.UTF8.GetBytes(json);
            var url = BuildSnapshotUrl(pending.Endpoint, pending.SessionId);

            using var content = new ByteArrayContent(bytes);
            content.Headers.ContentType = new MediaTypeHeaderValue("application/json");

            using var response = await SnapshotHttpClient.PostAsync(url, content, token).ConfigureAwait(false);
            if (response.IsSuccessStatusCode)
            {
                return;
            }

            var reason = response.ReasonPhrase;
            string body = null;
            try
            {
                body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
            catch
            {
                // Ignored: best effort diagnostics.
            }

            var message = new StringBuilder();
            message.Append($"HTTP {(int)response.StatusCode} {reason}");
            if (!string.IsNullOrEmpty(body))
            {
                message.Append($": {body}");
            }

            throw new HttpRequestException(message.ToString());
        }

        private static string BuildSnapshotUrl(string endpoint, string sessionId)
        {
            var sanitizedEndpoint = string.IsNullOrEmpty(endpoint) ? string.Empty : endpoint.TrimEnd('/');
            var sanitizedSession = string.IsNullOrEmpty(sessionId) ? string.Empty : sessionId.Trim();
            return $"{sanitizedEndpoint}/sessions/{sanitizedSession}/frames";
        }

        private void NotifySnapshotUploadStarted(PendingSnapshotUpload pending)
        {
            if (pending == null)
            {
                return;
            }

            EnqueueMainThreadAction(() =>
            {
                if (_pendingSnapshots.TryGetValue(pending.Id, out var status))
                {
                    status.State = SnapshotUploadState.Uploading;
                }
            });
        }

        private void NotifySnapshotUploadResult(PendingSnapshotUpload pending, bool succeeded, string error)
        {
            if (pending == null)
            {
                return;
            }

            EnqueueMainThreadAction(() => pending.InvokeCompletion(succeeded, error));
        }

        private void StopSnapshotUploadLoop()
        {
            Task uploadTask;
            CancellationTokenSource cts;

            lock (_snapshotUploadLock)
            {
                uploadTask = _snapshotUploadTask;
                cts = _snapshotUploadCts;
                _snapshotUploadTask = null;
                _snapshotUploadCts = null;
            }

            if (cts != null)
            {
                try
                {
                    cts.Cancel();
                }
                catch (ObjectDisposedException)
                {
                    // Ignore: shutting down.
                }
            }

            if (uploadTask != null)
            {
                try
                {
                    uploadTask.Wait(TimeSpan.FromSeconds(2));
                }
                catch (AggregateException exception)
                {
                    foreach (var inner in exception.Flatten().InnerExceptions)
                    {
                        Debug.LogException(inner);
                    }
                }
                catch (Exception exception)
                {
                    Debug.LogException(exception);
                }
            }

            cts?.Dispose();

            while (_snapshotUploadQueue.TryDequeue(out var pending))
            {
                AssetTelemetryUtility.ReleaseSnapshot(pending.Snapshot);
                NotifySnapshotUploadResult(pending, false, "Upload canceled");
            }
        }

        private void ProcessMainThreadActions()
        {
            while (_mainThreadActions.TryDequeue(out var action))
            {
                try
                {
                    action?.Invoke();
                }
                catch (Exception exception)
                {
                    Debug.LogException(exception);
                }
            }
        }

        private void EnqueueMainThreadAction(Action action)
        {
            if (action == null)
            {
                return;
            }

            _mainThreadActions.Enqueue(action);
        }

        private UnityWebRequest BuildJsonRequest(string path, string method, object payload)
        {
            var request = new UnityWebRequest(_serverEndpoint + path, method)
            {
                downloadHandler = new DownloadHandlerBuffer()
            };

            string json;
            if (payload is TelemetrySnapshot telemetrySnapshot)
            {
                try
                {
                    json = JsonUtility.ToJson(telemetrySnapshot);
                }
                finally
                {
                    AssetTelemetryUtility.ReleaseSnapshot(telemetrySnapshot);
                }
            }
            else
            {
                json = JsonUtility.ToJson(payload);
            }
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

        private sealed class PendingSnapshotUpload
        {
            private readonly Action<bool, string> _completion;

            public PendingSnapshotUpload(int id, string sessionId, string endpoint, TelemetrySnapshot snapshot, Action<bool, string> completion)
            {
                Id = id;
                SessionId = sessionId;
                Endpoint = endpoint;
                Snapshot = snapshot;
                _completion = completion;
            }

            public int Id { get; }

            public string SessionId { get; }

            public string Endpoint { get; }

            public TelemetrySnapshot Snapshot { get; }

            public void InvokeCompletion(bool succeeded, string error)
            {
                _completion?.Invoke(succeeded, error);
            }
        }

        public sealed class PendingSnapshotStatus
        {
            public int Id { get; set; }

            public SnapshotUploadState State { get; set; }

            public DateTime EnqueuedAtUtc { get; set; }

            public DateTime? CompletedAtUtc { get; set; }

            public string Error { get; set; }
        }

        public enum SnapshotUploadState
        {
            Queued,
            Uploading,
            Completed,
            Failed
        }

        private sealed class HttpClientWrapper
        {
            private readonly HttpClient _client;

            public HttpClientWrapper()
            {
                _client = new HttpClient(new HttpClientHandler
                {
                    AutomaticDecompression = DecompressionMethods.Deflate | DecompressionMethods.GZip
                });
            }

            public Task<HttpResponseMessage> PostAsync(string url, HttpContent content, CancellationToken token)
            {
                return _client.PostAsync(url, content, token);
            }
        }
    }
}
