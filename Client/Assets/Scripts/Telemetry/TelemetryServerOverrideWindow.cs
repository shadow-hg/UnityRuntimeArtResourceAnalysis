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
        private const int BaseSectionHeaderFontSize = 19;
        private const float WindowPadding = 12f;
        private const float SectionSpacing = 10f;
        private const float ControlSpacing = 6f;

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
        private Vector2 _contentScrollPosition;
        private GUIStyle _labelStyle;
        private GUIStyle _statusLabelStyle;
        private GUIStyle _buttonStyle;
        private GUIStyle _textFieldStyle;
        private GUIStyle _windowStyle;
        private GUIStyle _sectionBoxStyle;
        private GUIStyle _sectionHeaderStyle;

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

            _contentScrollPosition = GUILayout.BeginScrollView(_contentScrollPosition, GUILayout.ExpandHeight(true));

            GUILayout.BeginVertical(_sectionBoxStyle);
            GUILayout.Label("服务器地址覆盖", _sectionHeaderStyle);
            GUILayout.Space(ControlSpacing * _uiScale);
            GUILayout.Label("输入覆盖的服务器地址 (留空以使用自动检测)", _labelStyle);
            GUILayout.Space(ControlSpacing * 0.5f * _uiScale);
            GUI.SetNextControlName("TelemetryServerOverrideField");
            _inputValue = GUILayout.TextField(_inputValue ?? string.Empty, _textFieldStyle,
                GUILayout.ExpandWidth(true), GUILayout.MinHeight(36f * _uiScale));
            GUILayout.EndVertical();

            GUILayout.Space(SectionSpacing * _uiScale);

            GUILayout.BeginVertical(_sectionBoxStyle);
            GUILayout.Label("当前状态", _sectionHeaderStyle);
            GUILayout.Space(ControlSpacing * _uiScale);
            GUILayout.Label($"当前使用: {_reporter.CurrentServerEndpoint}", _labelStyle);
            GUILayout.Label($"自动检测: {_autoDetectedEndpoint}", _labelStyle);

            if (!string.IsNullOrEmpty(_statusMessage))
            {
                GUILayout.Space(ControlSpacing * _uiScale);
                GUILayout.Label(_statusMessage, _statusLabelStyle);
            }
            GUILayout.EndVertical();

            GUILayout.Space(SectionSpacing * _uiScale);

            GUILayout.BeginVertical(_sectionBoxStyle);
            GUILayout.Label("操作", _sectionHeaderStyle);
            GUILayout.Space(ControlSpacing * _uiScale);
            if (GUILayout.Button("应用地址", _buttonStyle, GUILayout.Height(40f * _uiScale)))
            {
                ApplyOverride(_inputValue);
            }

            GUILayout.Space(ControlSpacing * _uiScale);

            if (GUILayout.Button("使用自动", _buttonStyle, GUILayout.Height(40f * _uiScale)))
            {
                ApplyOverride(string.Empty);
            }

            GUILayout.Space(ControlSpacing * _uiScale);

            if (GUILayout.Button("折叠", _buttonStyle, GUILayout.Height(32f * _uiScale)))
            {
                _isExpanded = false;
                _currentWindowRect = ClampRectToScreen(GetCenteredRect(_scaledCollapsedButtonSize.x, _scaledCollapsedButtonSize.y));
            }
            GUILayout.EndVertical();

            GUILayout.EndScrollView();

            GUILayout.EndVertical();

            GUI.DragWindow(new Rect(0f, 0f, 10000f, 36f * _uiScale));
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

            var scaledWidth = _referenceExpandedWindowRect.width * _uiScale;
            var scaledHeight = _referenceExpandedWindowRect.height * _uiScale;
            var horizontalMargin = Mathf.Clamp(Screen.width * 0.05f, 12f, 48f);
            var verticalMargin = Mathf.Clamp(Screen.height * 0.1f, 18f, 96f);
            var maxWidth = Mathf.Min(Mathf.Max(240f, Screen.width - horizontalMargin), Screen.width - 8f);
            var maxHeight = Mathf.Min(Mathf.Max(220f, Screen.height - verticalMargin), Screen.height - 8f);

            _scaledExpandedWindowRect = new Rect(0f, 0f, Mathf.Min(scaledWidth, maxWidth), Mathf.Min(scaledHeight, maxHeight));

            var collapsedWidth = _referenceCollapsedButtonSize.x * _uiScale;
            var collapsedHeight = _referenceCollapsedButtonSize.y * _uiScale;
            _scaledCollapsedButtonSize = new Vector2(Mathf.Min(collapsedWidth, Screen.width * 0.8f), collapsedHeight);

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
            if (!_stylesDirty && _labelStyle != null && _buttonStyle != null && _textFieldStyle != null && _windowStyle != null &&
                _sectionBoxStyle != null && _sectionHeaderStyle != null && _statusLabelStyle != null)
            {
                return;
            }

            var labelFontSize = Mathf.RoundToInt(BaseLabelFontSize * _uiScale);
            var buttonFontSize = Mathf.RoundToInt(BaseButtonFontSize * _uiScale);
            var textFieldFontSize = Mathf.RoundToInt(BaseTextFieldFontSize * _uiScale);
            var windowTitleFontSize = Mathf.RoundToInt(BaseWindowTitleFontSize * _uiScale);
            var sectionHeaderFontSize = Mathf.RoundToInt(BaseSectionHeaderFontSize * _uiScale);
            var padding = Mathf.RoundToInt(WindowPadding * _uiScale);

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
                fontSize = buttonFontSize,
                wordWrap = true,
                alignment = TextAnchor.MiddleCenter
            };

            _textFieldStyle = new GUIStyle(GUI.skin.textField)
            {
                fontSize = textFieldFontSize
            };

            _windowStyle = new GUIStyle(GUI.skin.window)
            {
                fontSize = windowTitleFontSize,
                padding = new RectOffset(padding, padding, padding, padding)
            };

            _sectionBoxStyle = new GUIStyle(GUI.skin.box)
            {
                fontSize = labelFontSize,
                padding = new RectOffset(padding, padding, padding, padding),
                margin = new RectOffset(0, 0, Mathf.RoundToInt(ControlSpacing * _uiScale), Mathf.RoundToInt(ControlSpacing * _uiScale))
            };
            _sectionBoxStyle.stretchWidth = true;

            _sectionHeaderStyle = new GUIStyle(_labelStyle)
            {
                fontSize = sectionHeaderFontSize,
                fontStyle = FontStyle.Bold
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
