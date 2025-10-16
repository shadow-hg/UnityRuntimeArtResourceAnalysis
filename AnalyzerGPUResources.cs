// AnalyzerGPUResources.cs
// GPU resource sampler for Analyzer toolset (URP/SRP compatible)

using System.Collections;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

#if UNITY_EDITOR
using UnityEditor;
#endif

[ExecuteAlways]
public class AnalyzerGPUResources
{
    // ----------------------------
    // Singleton
    // ----------------------------
    private static AnalyzerGPUResources _instance;
    public static AnalyzerGPUResources Instance
    {
        get
        {
            if (_instance == null)
                _instance = new AnalyzerGPUResources();
            return _instance;
        }
    }

    // ----------------------------
    // Public Properties
    // ----------------------------
    public RenderTexture OutputRT { get; private set; }
    public ComputeShader Compute { get; private set; }

    // ----------------------------
    // Private fields
    // ----------------------------
    private int _kernel;
    private int _width = 0, _height = 0;

    private static readonly int ID_TexSize = Shader.PropertyToID("_TexSize");
    private static readonly int ID_Output = Shader.PropertyToID("_Output");

    // ----------------------------
    // Init
    // ----------------------------
    public AnalyzerGPUResources()
    {
        LoadComputeShader();
    }

    private void LoadComputeShader()
    {
        if (Compute == null)
        {
            Compute = Resources.Load<ComputeShader>("AnalyzerCompute");
            if (Compute == null)
            {
#if UNITY_EDITOR
                string[] found = AssetDatabase.FindAssets("AnalyzerCompute t:ComputeShader");
                if (found != null && found.Length > 0)
                {
                    string path = AssetDatabase.GUIDToAssetPath(found[0]);
                    Compute = AssetDatabase.LoadAssetAtPath<ComputeShader>(path);
                    Debug.Log($"[AnalyzerGPUResources] Loaded compute from {path}");
                }
#endif
            }
        }

        if (Compute != null)
            _kernel = Compute.FindKernel("CSMain");
    }

    // ----------------------------
    // Ensure Output Texture
    // ----------------------------
    public void EnsureOutputLike(Camera cam)
    {
        if (cam == null) return;
        if (Compute == null) LoadComputeShader();

        int targetW = Mathf.Max(64, cam.pixelWidth);
        int targetH = Mathf.Max(64, cam.pixelHeight);

        if (OutputRT == null || !OutputRT.IsCreated() ||
            _width != targetW || _height != targetH)
        {
            SafeRelease(OutputRT);
            OutputRT = new RenderTexture(targetW, targetH, 0, RenderTextureFormat.ARGB32)
            {
                name = "Analyzer_GPUHeat",
                enableRandomWrite = true
            };
            OutputRT.Create();
            _width = targetW;
            _height = targetH;
        }
    }

    private void SafeRelease(RenderTexture rt)
    {
        if (rt != null)
        {
#if UNITY_EDITOR
            Object.DestroyImmediate(rt);
#else
            Object.Destroy(rt);
#endif
        }
    }

    // ----------------------------
    // Main Sampling Entry
    // ----------------------------
    public IEnumerator SampleGPUAsync(Camera cam)
    {
        if (Compute == null)
            LoadComputeShader();

        if (Compute == null)
        {
            Debug.LogWarning("[AnalyzerGPUResources] Missing AnalyzerCompute.compute!");
            yield break;
        }

        if (cam == null)
        {
            Debug.LogWarning("[AnalyzerGPUResources] No camera provided!");
            yield break;
        }

        EnsureOutputLike(cam);

        var kernel = _kernel;
        if (kernel < 0)
        {
            Debug.LogWarning("[AnalyzerGPUResources] Kernel not found!");
            yield break;
        }

        // ----------------------------
        // Bind compute resources
        // ----------------------------

        try
        {
            Compute.SetVector(ID_TexSize, new Vector2(_width, _height));

            // SceneColor
            var sceneColor = Shader.GetGlobalTexture("_CameraColorTexture");
            Compute.SetTexture(kernel, "_SceneColor", sceneColor ?? Texture2D.blackTexture);

            // Depth
            var sceneDepth = Shader.GetGlobalTexture("_CameraDepthTexture");
            Compute.SetTexture(kernel, "_SceneDepth", sceneDepth ?? Texture2D.blackTexture);

            // Normal
            var sceneNormal = Shader.GetGlobalTexture("_CameraNormalsTexture");
            Compute.SetTexture(kernel, "_SceneNormal", sceneNormal ?? Texture2D.blackTexture);

            // MotionVectors
            var motionVectors = Shader.GetGlobalTexture("_CameraMotionVectorsTexture");
            if (motionVectors != null)
                Compute.SetTexture(kernel, "_MotionVectors", motionVectors);
            else
                Compute.SetTexture(kernel, "_MotionVectors", Texture2D.blackTexture);

            // Output
            Compute.SetTexture(kernel, ID_Output, OutputRT);
        }
        catch (System.Exception e)
        {
            Debug.LogWarning($"[AnalyzerGPUResources] SetTexture error: {e.Message}");
        }

        // ----------------------------
        // Dispatch
        // ----------------------------
        int tgx = Mathf.CeilToInt(_width / 8f);
        int tgy = Mathf.CeilToInt(_height / 8f);

        try
        {
            Compute.Dispatch(kernel, tgx, tgy, 1);
        }
        catch (System.Exception e)
        {
            Debug.LogWarning($"[AnalyzerGPUResources] Dispatch failed: {e.Message}");
        }

        yield return null;
    }

    // ----------------------------
    // Optional utility for debug info
    // ----------------------------
#if UNITY_EDITOR
    [MenuItem("HRP/Analyzer/Force GPU Sample")]
    private static void ForceSample()
    {
        var cam = SceneView.lastActiveSceneView?.camera ?? Camera.main;
        if (cam == null)
        {
            Debug.LogWarning("[AnalyzerGPUResources] No camera found for sampling.");
            return;
        }

        Instance.EnsureOutputLike(cam);
        var it = Instance.SampleGPUAsync(cam);
        while (it.MoveNext()) { }
        Debug.Log("[AnalyzerGPUResources] GPU Sample completed.");
    }
#endif
}
