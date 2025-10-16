// AnalyzerURPInjector.cs
// Hooks into URP via RenderPipelineManager.endCameraRendering and triggers one compute pass.
// Editor-only live hook by default; you can enable in Player as well by removing UNITY_EDITOR guards.

using UnityEngine;
using UnityEngine.Rendering;
#if UNITY_EDITOR
using UnityEditor;
#endif

[ExecuteAlways]
public static class AnalyzerURPInjector
{
    private static bool _isHooked = false;
    public static bool Live
    {
        get => _live;
        set
        {
            if (_live == value) return;
            _live = value;
            UpdateHook();
        }
    }
    private static bool _live = true;

    static AnalyzerURPInjector()
    {
        UpdateHook();
    }

    private static void UpdateHook()
    {
        if (_live && !_isHooked)
        {
            RenderPipelineManager.endCameraRendering -= OnEndCameraRendering;
            RenderPipelineManager.endCameraRendering += OnEndCameraRendering;
            _isHooked = true;
        }
        else if (!_live && _isHooked)
        {
            RenderPipelineManager.endCameraRendering -= OnEndCameraRendering;
            _isHooked = false;
        }
    }

    private static void OnEndCameraRendering(ScriptableRenderContext ctx, Camera cam)
    {
        if (!_live) return;
        if (cam == null) return;

        // Only sample game/scene cameras you care about. You can filter by camera type here if needed.
#if UNITY_EDITOR
        // Avoid sampling for Preview cameras in inspector, etc.
        if (cam.cameraType == CameraType.Preview) return;
#endif
        AnalyzerGPUResources.Instance.EnsureOutputLike(cam);
        var it = AnalyzerGPUResources.Instance.SampleGPUAsync(cam);
        while (it.MoveNext()) { }
    }
}