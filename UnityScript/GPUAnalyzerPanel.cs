// GPUAnalyzerPanel.cs
// EditorWindow tab panel for previewing AnalyzerGPUResources output and manual sampling.

using UnityEditor;
using UnityEngine;

public class GPUAnalyzerPanel : RuntimeArtResourceAnalysis.IResourcePanel
{
    public string TabName => "GPU Analyzer";

    private RuntimeArtResourceAnalysis.AnalyzerContext ctx;
    private int lastCollect = -9999;
    private bool live = true;

    private GUIStyle _title;
    private Camera _previewCamera; // optional: choose a camera; default uses SceneView or GameView camera

    public void OnEnable(RuntimeArtResourceAnalysis.AnalyzerContext ctx)
    {
        this.ctx = ctx;
        _title = new GUIStyle(EditorStyles.boldLabel) { fontSize = 12 };
        CollectIfNeeded(true);
    }

    public void OnDisable() { }

    public void CollectIfNeeded(bool force)
    {
        if (!force && (ctx.currentFrame - lastCollect) < Mathf.Max(1, ctx.refreshIntervalFrames)) return;
        lastCollect = ctx.currentFrame;
    }

    public void OnGUI(RuntimeArtResourceAnalysis.AnalyzerContext ctx, ref Vector2 scroll)
    {
        EditorGUILayout.BeginVertical(EditorStyles.helpBox);
        EditorGUILayout.LabelField("GPU Heat Overlay", _title);
        EditorGUILayout.Space(4);

        live = EditorGUILayout.Toggle("Live Sample (EndCameraRendering)", live);
        if (live != AnalyzerURPInjector.Live)
        {
            AnalyzerURPInjector.Live = live;
        }

        _previewCamera = (Camera)EditorGUILayout.ObjectField("Target Camera (optional)", _previewCamera, typeof(Camera), true);

        EditorGUILayout.BeginHorizontal();
        if (GUILayout.Button("Sample Now", GUILayout.Width(120)))
        {
            SampleNow(_previewCamera);
        }
        if (GUILayout.Button("Ping Output RT", GUILayout.Width(140)))
        {
            if (AnalyzerGPUResources.Instance.OutputRT != null)
                EditorGUIUtility.PingObject(AnalyzerGPUResources.Instance.OutputRT);
        }
        EditorGUILayout.EndHorizontal();

        EditorGUILayout.Space();

        // Preview output RT
        var rt = AnalyzerGPUResources.Instance.OutputRT;
        if (rt != null && rt.IsCreated())
        {
            float w = Mathf.Clamp(rt.width, 256, 1024);
            float h = w * (rt.height / Mathf.Max(1f, (float)rt.width));
            Rect r = GUILayoutUtility.GetRect(w, h, GUILayout.ExpandWidth(false));
            if (Event.current.type == EventType.Repaint)
            {
                GUI.DrawTexture(r, rt, ScaleMode.ScaleToFit, false);
            }
            EditorGUILayout.LabelField($"{rt.width}x{rt.height}  |  {rt.format}", EditorStyles.miniLabel);
        }
        else
        {
            EditorGUILayout.HelpBox("No output RT yet. Click 'Sample Now' or enable Live.", MessageType.Info);
        }

        EditorGUILayout.EndVertical();
    }

    private static void SampleNow(Camera explicitCam)
    {
        Camera cam = explicitCam;
        if (cam == null)
        {
            // try get SceneView camera (Editor) or MainCamera
            if (SceneView.lastActiveSceneView != null)
                cam = SceneView.lastActiveSceneView.camera;
            if (cam == null)
                cam = Camera.main;
        }

        AnalyzerGPUResources.Instance.EnsureOutputLike(cam);
        // run the IEnumerator once (it only yields a single null in our implementation)
        var it = AnalyzerGPUResources.Instance.SampleGPUAsync(cam);
        while (it.MoveNext()) { }
    }
}
