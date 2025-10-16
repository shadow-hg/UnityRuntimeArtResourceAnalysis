// File: Assets/TA/AnalyzerRenderFeature_SRP.cs
// SRP overlay injector for AnalyzerGPUResources.OutputRT (no RTHandle constructor)

using UnityEngine;
using UnityEngine.Rendering;

#if UNITY_EDITOR
using UnityEditor;
#endif

[ExecuteAlways]
public class AnalyzerRenderFeature_SRP : MonoBehaviour
{
    [Tooltip("Overlay shader (expects _OverlayTex and _GlobalOpacity)")]
    public Shader overlayShader;

    [Range(0f, 1f)]
    public float globalOpacity = 1.0f;

    [Tooltip("Enable/disable overlay during rendering")]
    public bool live = true;

    private static AnalyzerRenderFeature_SRP _instance;
    private Material _mat;

    private void OnEnable()
    {
        _instance = this;
        EnsureMaterial();

        RenderPipelineManager.endCameraRendering -= OnEndCameraRendering;
        RenderPipelineManager.endCameraRendering += OnEndCameraRendering;
    }

    private void OnDisable()
    {
        RenderPipelineManager.endCameraRendering -= OnEndCameraRendering;
        if (_mat) DestroyImmediate(_mat);
        _instance = null;
    }

    private void EnsureMaterial()
    {
        if (overlayShader == null)
            overlayShader = Shader.Find("Hidden/Analyzer/OverlayBlit");

        if (overlayShader != null && (_mat == null || _mat.shader != overlayShader))
        {
            if (_mat) DestroyImmediate(_mat);
            _mat = new Material(overlayShader);
        }
    }

    private void OnEndCameraRendering(ScriptableRenderContext ctx, Camera cam)
    {
        if (!live || _mat == null) return;
        if (cam == null || cam.cameraType == CameraType.Preview) return;

        var outRT = AnalyzerGPUResources.Instance != null ? AnalyzerGPUResources.Instance.OutputRT : null;
        if (outRT == null || !outRT.IsCreated()) return;

        CommandBuffer cmd = CommandBufferPool.Get("AnalyzerSRPOverlay");

        _mat.SetTexture("_OverlayTex", outRT);
        _mat.SetFloat("_GlobalOpacity", globalOpacity);

        // ✅ 正确方式：使用 BuiltinRenderTextureType.CameraTarget
        CoreUtils.SetRenderTarget(cmd, BuiltinRenderTextureType.CameraTarget);
        CoreUtils.DrawFullScreen(cmd, _mat);

        ctx.ExecuteCommandBuffer(cmd);
        CommandBufferPool.Release(cmd);
    }

#if UNITY_EDITOR
    [MenuItem("HRP/Analyzer/Add SRP Overlay Feature")]
    public static void CreateAnalyzerOverlay()
    {
        var go = new GameObject("AnalyzerRenderFeature_SRP");
        go.AddComponent<AnalyzerRenderFeature_SRP>();
        Selection.activeObject = go;
        Debug.Log("Created AnalyzerRenderFeature_SRP GameObject in scene.");
    }
#endif
}
