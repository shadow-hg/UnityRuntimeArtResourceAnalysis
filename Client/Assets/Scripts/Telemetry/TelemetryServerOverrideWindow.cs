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

        private const float ReferenceScreenWidth = 1920f;
        private const float ReferenceScreenHeight = 1080f;

        [SerializeField]
        private Rect _expandedWindowRect = new Rect(20f, 20f, 360f, 220f);

        [SerializeField]
        private Vector2 _collapsedButtonSize = new Vector2(180f, 48f);

        [SerializeField]
        [Min(0.5f)]
        private float _minimumScale = 0.75f;

        [SerializeField]
        [Min(0.1f)]
        private float _maximumScale = 3f;

        private Rect _referenceExpandedWindowRect;
        private Vector2 _referenceCollapsedButtonSize;
        private Rect _scaledExpandedWindowRect;
        private Vector2 _scaledCollapsedButtonSize;
        private Rect _currentWindowRect;
        private float _uiScale = 1f;
        private int _lastScreenWidth;
        private int _lastScreenHeight;
        private bool _isExpanded;
        private string _inputValue = string.Empty;
        private string _statusMessage;
        private float _statusMessageTimestamp;
        private string _autoDetectedEndpoint;
        private float _nextAutoDetectedRefreshTime;

        private void Awake()
        {
            _referenceExpandedWindowRect = _expandedWindowRect;
            _referenceCollapsedButtonSize = _collapsedButtonSize;
            UpdateScaledLayout(true);
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

            if (Screen.width != _lastScreenWidth || Screen.height != _lastScreenHeight)
            {
                UpdateScaledLayout();
            }

            if (_isExpanded)
            {
                if (_currentWindowRect.width < _scaledExpandedWindowRect.width ||
                    _currentWindowRect.height < _scaledExpandedWindowRect.height)
                {
                    _currentWindowRect.width = _scaledExpandedWindowRect.width;
                    _currentWindowRect.height = _scaledExpandedWindowRect.height;
                }

                _currentWindowRect = GUILayout.Window(WindowId, _currentWindowRect, DrawExpandedWindow, _windowTitle);
            }
            else
            {
                _currentWindowRect.width = _scaledCollapsedButtonSize.x;
                _currentWindowRect.height = _scaledCollapsedButtonSize.y;
                var buttonRect = new Rect(_currentWindowRect.x, _currentWindowRect.y, _scaledCollapsedButtonSize.x, _scaledCollapsedButtonSize.y);
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

            GUILayout.Space(4f * _uiScale);

            GUILayout.Label($"当前使用: {_reporter.CurrentServerEndpoint}");
            GUILayout.Label($"自动检测: {_autoDetectedEndpoint}");

            if (!string.IsNullOrEmpty(_statusMessage))
            {
                var originalColor = GUI.color;
                GUI.color = Color.yellow;
                GUILayout.Label(_statusMessage);
                GUI.color = originalColor;
            }

            GUILayout.Space(8f * _uiScale);

            GUILayout.BeginHorizontal();
            if (GUILayout.Button("应用地址", GUILayout.Height(32f * _uiScale)))
            {
                ApplyOverride(_inputValue);
            }

            if (GUILayout.Button("使用自动", GUILayout.Height(32f * _uiScale)))
            {
                ApplyOverride(string.Empty);
            }
            GUILayout.EndHorizontal();

            GUILayout.Space(6f * _uiScale);

            if (GUILayout.Button("折叠", GUILayout.Height(28f * _uiScale)))
            {
                _isExpanded = false;
            }

            GUILayout.EndVertical();

            GUI.DragWindow(new Rect(0f, 0f, 10000f, 24f * _uiScale));
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

        private void UpdateScaledLayout(bool forceReset = false)
        {
            var previousScale = _uiScale;

            var widthScale = Screen.width / ReferenceScreenWidth;
            var heightScale = Screen.height / ReferenceScreenHeight;
            var targetScale = Mathf.Min(widthScale, heightScale);

            if (!float.IsFinite(targetScale) || targetScale <= 0f)
            {
                targetScale = 1f;
            }

            _uiScale = Mathf.Clamp(targetScale, _minimumScale, _maximumScale);

            _scaledExpandedWindowRect = ScaleRect(_referenceExpandedWindowRect, _uiScale);
            _scaledCollapsedButtonSize = _referenceCollapsedButtonSize * _uiScale;

            if (forceReset || _currentWindowRect.width <= 0f)
            {
                _currentWindowRect = _scaledExpandedWindowRect;
            }
            else if (!Mathf.Approximately(previousScale, _uiScale))
            {
                var ratio = _uiScale / previousScale;
                _currentWindowRect = ScaleRect(_currentWindowRect, ratio);
            }

            _lastScreenWidth = Screen.width;
            _lastScreenHeight = Screen.height;
        }

        private static Rect ScaleRect(Rect source, float scale)
        {
            return new Rect(source.x * scale, source.y * scale, source.width * scale, source.height * scale);
        }
    }
}
