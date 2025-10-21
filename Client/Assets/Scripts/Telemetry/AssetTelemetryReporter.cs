using System;
using System.Collections;
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

        [Tooltip("HTTP endpoint of the telemetry server. Automatically resolved to the current device IP.")]
        [SerializeField] private string serverEndpoint = string.Empty;

        [Tooltip("Minimum interval in seconds between telemetry snapshots. Set to 0 to capture every frame.")]
        [SerializeField, Min(0f)] private float sampleIntervalSeconds = 0f;

        [Tooltip("Scale applied to captured frame previews to reduce bandwidth. Set to 0 to disable previews.")]
        [SerializeField, Range(0f, 1f)] private float framePreviewScale = 0.2f;

        [Tooltip("Maximum number of assets to send per payload per category to reduce payload size.")]
        [SerializeField] private int maxAssetsPerCategory = 200;

        [Tooltip("Automatically register and deregister telemetry sessions when play mode changes. Overridden by server configuration.")]
        [SerializeField] private bool autoManageSession = true;

        private string _sessionId;
        private float _lastSampleTime;
        private float _lastSampleRealtime;
        private int _lastFrameCount;
        private int _snapshotSequence;
        private Coroutine _sampleCoroutine;
        private Coroutine _initializationCoroutine;
        private bool _sessionManagedAutomatically;

        private static CoroutineRunner _coroutineRunner;

        private static string ResolveLocalIpAddress()
        {
            try
            {
                foreach (var networkInterface in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (networkInterface == null)
                    {
                        continue;
                    }

                    if (networkInterface.OperationalStatus != OperationalStatus.Up)
                    {
                        continue;
                    }

                    if (networkInterface.NetworkInterfaceType == NetworkInterfaceType.Loopback)
                    {
                        continue;
                    }

                    var ipProperties = networkInterface.GetIPProperties();
                    foreach (var unicast in ipProperties.UnicastAddresses)
                    {
                        var address = unicast?.Address;
                        if (address == null)
                        {
                            continue;
                        }

                        if (address.AddressFamily != AddressFamily.InterNetwork)
                        {
                            continue;
                        }

                        if (IPAddress.IsLoopback(address))
                        {
                            continue;
                        }

                        return address.ToString();
                    }
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

        private string ResolveServerEndpoint()
        {
            var ipAddress = ResolveLocalIpAddress();

            try
            {
                var builder = new UriBuilder(Uri.UriSchemeHttp, ipAddress, DefaultServerPort);
                return SanitizeEndpoint(builder.Uri.ToString());
            }
            catch
            {
                return SanitizeEndpoint($"http://{ipAddress}:{DefaultServerPort}");
            }
        }

        private void Awake()
        {
            serverEndpoint = ResolveServerEndpoint();
        }

        private void OnEnable()
        {
            serverEndpoint = ResolveServerEndpoint();
            _sessionManagedAutomatically = false;

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

            if (autoManageSession)
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

        private IEnumerator LoadServerConfigCoroutine()
        {
            if (string.IsNullOrEmpty(serverEndpoint))
            {
                yield break;
            }

            using var request = UnityWebRequest.Get(serverEndpoint + "/config");
            request.downloadHandler = new DownloadHandlerBuffer();
            request.timeout = 5;
            yield return request.SendWebRequest();

            if (request.result != UnityWebRequest.Result.Success)
            {
                Debug.LogWarning($"[UnityProfileV2] Failed to load server configuration: {request.error}");
                yield break;
            }

            var json = request.downloadHandler.text;

            if (string.IsNullOrEmpty(json) || json.IndexOf("\"clientDefaults\"", StringComparison.Ordinal) < 0)
            {
                Debug.LogWarning("[UnityProfileV2] Server configuration response did not contain client defaults.");
                yield break;
            }

            try
            {
                var payload = JsonUtility.FromJson<ServerConfigurationPayload>(json);
                ApplyServerConfiguration(payload);
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[UnityProfileV2] Failed to parse server configuration: {ex.Message}");
            }
        }

        private void ApplyServerConfiguration(ServerConfigurationPayload payload)
        {
            ApplyClientDefaults(payload.clientDefaults);
        }

        private void ApplyClientDefaults(ClientDefaultsPayload payload)
        {
            if (payload.maxAssetsPerCategory <= 0)
            {
                payload.maxAssetsPerCategory = maxAssetsPerCategory;
            }

            sampleIntervalSeconds = Mathf.Max(payload.sampleIntervalSeconds, 0f);
            framePreviewScale = Mathf.Clamp01(payload.framePreviewScale);
            maxAssetsPerCategory = Mathf.Max(payload.maxAssetsPerCategory, 1);
            autoManageSession = payload.autoManageSession;
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
                var interval = Mathf.Max(sampleIntervalSeconds, 0f);
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
            var snapshot = AssetTelemetryUtility.CreateSnapshot(maxAssetsPerCategory);
            yield return AssetTelemetryUtility.PopulateFramePreview(snapshot, framePreviewScale);
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
            var request = new UnityWebRequest(serverEndpoint + path, method)
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
            public int maxAssetsPerCategory;
            public bool autoManageSession;
        }

        [Serializable]
        private struct SessionRegistrationResponse
        {
            public string sessionId;
            public ClientDefaultsPayload clientConfig;
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
