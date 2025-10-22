using UnityEngine;

namespace UnityProfileV2.Telemetry
{
    public class TelemetryServerOverrideWindow : MonoBehaviour
    {
        private const int WindowId = 0x554154;
        private const float StatusMessageDuration = 3f;

        [SerializeField]
        private AssetTelemetryReporter _reporter;

        [SerializeField]
        private string _windowTitle = "Telemetry Server";

        [SerializeField]
        private Rect _expandedWindowRect = new Rect(20f, 20f, 360f, 220f);

        [SerializeField]
        private Vector2 _collapsedButtonSize = new Vector2(180f, 48f);

        private Rect _currentWindowRect;
        private bool _isExpanded;
        private string _inputValue = string.Empty;
        private string _statusMessage;
        private float _statusMessageTimestamp;
        private string _autoDetectedEndpoint;
        private float _nextAutoDetectedRefreshTime;

        private void Awake()
        {
            _currentWindowRect = _expandedWindowRect;
        }

        private void Start()
        {
            if (_reporter == null)
            {
                _reporter = GetComponent<AssetTelemetryReporter>();
            }

            if (_reporter == null)
            {
                _reporter = FindObjectOfType<AssetTelemetryReporter>();
            }

            if (_reporter != null)
            {
                var overrideValue = _reporter.ServerEndpointOverride;
                _inputValue = string.IsNullOrEmpty(overrideValue) ? string.Empty : overrideValue;
                RefreshAutoDetectedEndpoint();
            }
        }

        private void Update()
        {
            if (!string.IsNullOrEmpty(_statusMessage) &&
                Time.realtimeSinceStartup - _statusMessageTimestamp >= StatusMessageDuration)
            {
                _statusMessage = null;
            }

            if (_reporter != null && Time.realtimeSinceStartup >= _nextAutoDetectedRefreshTime)
            {
                RefreshAutoDetectedEndpoint();
            }
        }

        private void OnGUI()
        {
            if (_reporter == null)
            {
                return;
            }

            if (_isExpanded)
            {
                _currentWindowRect = GUILayout.Window(WindowId, _currentWindowRect, DrawExpandedWindow, _windowTitle);
            }
            else
            {
                var buttonRect = new Rect(_currentWindowRect.x, _currentWindowRect.y, _collapsedButtonSize.x, _collapsedButtonSize.y);
                if (GUI.Button(buttonRect, _windowTitle))
                {
                    _isExpanded = true;
                }
            }
        }

        private void DrawExpandedWindow(int id)
        {
            GUILayout.BeginVertical();

            GUILayout.Label("服务器地址覆盖 (留空以使用自动检测)");
            GUI.SetNextControlName("TelemetryServerOverrideField");
            _inputValue = GUILayout.TextField(_inputValue ?? string.Empty, GUILayout.ExpandWidth(true));

            GUILayout.Space(4f);

            GUILayout.Label($"当前使用: {_reporter.CurrentServerEndpoint}");
            GUILayout.Label($"自动检测: {_autoDetectedEndpoint}");

            if (!string.IsNullOrEmpty(_statusMessage))
            {
                var originalColor = GUI.color;
                GUI.color = Color.yellow;
                GUILayout.Label(_statusMessage);
                GUI.color = originalColor;
            }

            GUILayout.Space(8f);

            GUILayout.BeginHorizontal();
            if (GUILayout.Button("应用地址", GUILayout.Height(32f)))
            {
                ApplyOverride(_inputValue);
            }

            if (GUILayout.Button("使用自动", GUILayout.Height(32f)))
            {
                ApplyOverride(string.Empty);
            }
            GUILayout.EndHorizontal();

            GUILayout.Space(6f);

            if (GUILayout.Button("折叠", GUILayout.Height(28f)))
            {
                _isExpanded = false;
            }

            GUILayout.EndVertical();

            GUI.DragWindow(new Rect(0f, 0f, 10000f, 24f));
        }

        private void ApplyOverride(string value)
        {
            if (_reporter == null)
            {
                return;
            }

            _reporter.ApplyServerEndpointOverride(value, true);
            _inputValue = _reporter.ServerEndpointOverride;

            if (string.IsNullOrEmpty(_inputValue))
            {
                RefreshAutoDetectedEndpoint();
                _statusMessage = $"已恢复自动地址：{_autoDetectedEndpoint}";
            }
            else
            {
                _statusMessage = $"已保存服务器地址：{_inputValue}";
            }

            _statusMessageTimestamp = Time.realtimeSinceStartup;
        }

        private void RefreshAutoDetectedEndpoint()
        {
            if (_reporter == null)
            {
                return;
            }

            _autoDetectedEndpoint = _reporter.GetAutoDetectedServerEndpoint();
            _nextAutoDetectedRefreshTime = Time.realtimeSinceStartup + 2f;
        }
    }
}
