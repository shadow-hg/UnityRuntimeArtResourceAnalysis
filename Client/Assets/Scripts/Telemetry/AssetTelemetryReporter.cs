using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace UnityProfileV2.Telemetry
{
    [DisallowMultipleComponent]
    public class AssetTelemetryReporter : MonoBehaviour
    {
        [Tooltip("HTTP endpoint of the telemetry server (e.g. http://localhost:48080)")]
        [SerializeField] private string serverEndpoint = "http://localhost:48080";

        [Tooltip("Interval in seconds between telemetry snapshots.")]
        [SerializeField] private float sampleIntervalSeconds = 2f;

        [Tooltip("Maximum number of assets to send per payload per category to reduce payload size.")]
        [SerializeField] private int maxAssetsPerCategory = 200;

        [Tooltip("Automatically register and deregister telemetry sessions when play mode changes.")]
        [SerializeField] private bool autoManageSession = true;

        private string _sessionId;
        private float _lastSampleTime;
        private float _lastSampleRealtime;
        private int _lastFrameCount;
        private int _snapshotSequence;
        private Coroutine _sampleCoroutine;

        private static CoroutineRunner _coroutineRunner;

        private void OnEnable()
        {
            if (autoManageSession)
            {
                StartCoroutine(RegisterSessionCoroutine());
            }
        }

        private void OnDisable()
        {
            if (_sampleCoroutine != null)
            {
                StopCoroutine(_sampleCoroutine);
                _sampleCoroutine = null;
            }

            if (autoManageSession && !string.IsNullOrEmpty(_sessionId))
            {
                var sessionId = _sessionId;
                _sessionId = null;
                EnsureCoroutineRunner().StartCoroutine(EndSessionCoroutine(sessionId));
            }
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
                deviceName = SystemInfo.deviceName
            };

            using var request = BuildJsonRequest("/sessions", UnityWebRequest.kHttpVerbPOST, payload);
            yield return request.SendWebRequest();

            if (request.result != UnityWebRequest.Result.Success)
            {
                Debug.LogError($"[UnityProfileV2] Failed to register telemetry session: {request.error}");
                yield break;
            }

            var response = JsonUtility.FromJson<SessionRegistrationResponse>(request.downloadHandler.text);
            _sessionId = response.sessionId;
            _lastSampleTime = Time.realtimeSinceStartup;
            _lastSampleRealtime = _lastSampleTime;
            _lastFrameCount = Time.frameCount;
            _snapshotSequence = 0;
            _sampleCoroutine = StartCoroutine(SampleCoroutine());
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
                if (Time.realtimeSinceStartup - _lastSampleTime >= sampleIntervalSeconds)
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

        [Serializable]
        private struct SessionRegistration
        {
            public string buildGuid;
            public string unityVersion;
            public string platform;
            public string productName;
            public string deviceModel;
            public string deviceName;
        }

        [Serializable]
        private struct SessionRegistrationResponse
        {
            public string sessionId;
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
