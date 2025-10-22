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
        private const int BaseLabelFontSize = 16;
        private const int BaseButtonFontSize = 18;
        private const int BaseTextFieldFontSize = 18;
        private const int BaseWindowTitleFontSize = 20;

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
        private bool _stylesDirty = true;
        private bool _isExpanded;
        private string _inputValue = string.Empty;
        private string _statusMessage;
        private float _statusMessageTimestamp;
        private string _autoDetectedEndpoint;
        private float _nextAutoDetectedRefreshTime;
        private GUIStyle _labelStyle;
        private GUIStyle _statusLabelStyle;
        private GUIStyle _buttonStyle;
        private GUIStyle _textFieldStyle;
        private GUIStyle _windowStyle;

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

            EnsureGuiStyles();

            if (_isExpanded)
            {
                if (_currentWindowRect.width < _scaledExpandedWindowRect.width ||
                    _currentWindowRect.height < _scaledExpandedWindowRect.height)
                {
                    var centeredRect = GetCenteredRect(Mathf.Max(_currentWindowRect.width, _scaledExpandedWindowRect.width),
                        Mathf.Max(_currentWindowRect.height, _scaledExpandedWindowRect.height));
                    _currentWindowRect.x = centeredRect.x;
                    _currentWindowRect.y = centeredRect.y;
                    _currentWindowRect.width = _scaledExpandedWindowRect.width;
                    _currentWindowRect.height = _scaledExpandedWindowRect.height;
                }

                _currentWindowRect = ClampRectToScreen(_currentWindowRect);
                _currentWindowRect = GUILayout.Window(WindowId, _currentWindowRect, DrawExpandedWindow, _windowTitle, _windowStyle);
                _currentWindowRect = ClampRectToScreen(_currentWindowRect);
            }
            else
            {
                var buttonRect = ClampRectToScreen(GetCenteredRect(_scaledCollapsedButtonSize.x, _scaledCollapsedButtonSize.y));
                if (GUI.Button(buttonRect, _windowTitle, _buttonStyle))
                {
                    _isExpanded = true;
                    _currentWindowRect = ClampRectToScreen(GetCenteredRect(_scaledExpandedWindowRect.width, _scaledExpandedWindowRect.height));
                }
            }
        }

        private void DrawExpandedWindow(int id)
        {
            GUILayout.BeginVertical();

            GUILayout.Label("服务器地址覆盖 (留空以使用自动检测)", _labelStyle);
            GUI.SetNextControlName("TelemetryServerOverrideField");
            _inputValue = GUILayout.TextField(_inputValue ?? string.Empty, _textFieldStyle, GUILayout.ExpandWidth(true));

            GUILayout.Space(4f * _uiScale);

            GUILayout.Label($"当前使用: {_reporter.CurrentServerEndpoint}", _labelStyle);
            GUILayout.Label($"自动检测: {_autoDetectedEndpoint}", _labelStyle);

            if (!string.IsNullOrEmpty(_statusMessage))
            {
                GUILayout.Label(_statusMessage, _statusLabelStyle);
            }

            GUILayout.Space(8f * _uiScale);

            GUILayout.BeginHorizontal();
            if (GUILayout.Button("应用地址", _buttonStyle, GUILayout.Height(32f * _uiScale)))
            {
                ApplyOverride(_inputValue);
            }

            if (GUILayout.Button("使用自动", _buttonStyle, GUILayout.Height(32f * _uiScale)))
            {
                ApplyOverride(string.Empty);
            }
            GUILayout.EndHorizontal();

            GUILayout.Space(6f * _uiScale);

            if (GUILayout.Button("折叠", _buttonStyle, GUILayout.Height(28f * _uiScale)))
            {
                _isExpanded = false;
                _currentWindowRect = ClampRectToScreen(GetCenteredRect(_scaledCollapsedButtonSize.x, _scaledCollapsedButtonSize.y));
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

            _scaledExpandedWindowRect = new Rect(0f, 0f, _referenceExpandedWindowRect.width * _uiScale,
                _referenceExpandedWindowRect.height * _uiScale);
            _scaledCollapsedButtonSize = _referenceCollapsedButtonSize * _uiScale;

            _stylesDirty = true;

            if (forceReset || _currentWindowRect.width <= 0f)
            {
                _currentWindowRect = ClampRectToScreen(GetCenteredRect(_scaledExpandedWindowRect.width, _scaledExpandedWindowRect.height));
            }
            else if (!Mathf.Approximately(previousScale, _uiScale))
            {
                var ratio = _uiScale / previousScale;
                _currentWindowRect = ScaleRectAroundCenter(_currentWindowRect, ratio);
                _currentWindowRect = ClampRectToScreen(_currentWindowRect);
            }

            if (!_isExpanded)
            {
                _currentWindowRect = ClampRectToScreen(GetCenteredRect(_scaledCollapsedButtonSize.x, _scaledCollapsedButtonSize.y));
            }

            _lastScreenWidth = Screen.width;
            _lastScreenHeight = Screen.height;
        }

        private void EnsureGuiStyles()
        {
            if (!_stylesDirty && _labelStyle != null && _buttonStyle != null && _textFieldStyle != null && _windowStyle != null)
            {
                return;
            }

            var labelFontSize = Mathf.RoundToInt(BaseLabelFontSize * _uiScale);
            var buttonFontSize = Mathf.RoundToInt(BaseButtonFontSize * _uiScale);
            var textFieldFontSize = Mathf.RoundToInt(BaseTextFieldFontSize * _uiScale);
            var windowTitleFontSize = Mathf.RoundToInt(BaseWindowTitleFontSize * _uiScale);

            _labelStyle = new GUIStyle(GUI.skin.label)
            {
                fontSize = labelFontSize,
                wordWrap = true
            };

            _statusLabelStyle = new GUIStyle(_labelStyle)
            {
                normal = { textColor = Color.yellow }
            };

            _buttonStyle = new GUIStyle(GUI.skin.button)
            {
                fontSize = buttonFontSize
            };

            _textFieldStyle = new GUIStyle(GUI.skin.textField)
            {
                fontSize = textFieldFontSize
            };

            _windowStyle = new GUIStyle(GUI.skin.window)
            {
                fontSize = windowTitleFontSize
            };

            _stylesDirty = false;
        }

        private static Rect GetCenteredRect(float width, float height)
        {
            var x = (Screen.width - width) * 0.5f;
            var y = (Screen.height - height) * 0.5f;
            return new Rect(x, y, width, height);
        }

        private static Rect ScaleRectAroundCenter(Rect rect, float scale)
        {
            var width = rect.width * scale;
            var height = rect.height * scale;
            var centerX = rect.x + rect.width * 0.5f;
            var centerY = rect.y + rect.height * 0.5f;
            var x = centerX - width * 0.5f;
            var y = centerY - height * 0.5f;
            return new Rect(x, y, width, height);
        }

        private static Rect ClampRectToScreen(Rect rect)
        {
            var maxX = Mathf.Max(0f, Screen.width - rect.width);
            var maxY = Mathf.Max(0f, Screen.height - rect.height);
            var clampedX = Mathf.Clamp(rect.x, 0f, maxX);
            var clampedY = Mathf.Clamp(rect.y, 0f, maxY);
            return new Rect(clampedX, clampedY, rect.width, rect.height);
        }
    }
}
