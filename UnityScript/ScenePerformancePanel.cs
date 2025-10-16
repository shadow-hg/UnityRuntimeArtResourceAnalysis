// ScenePerformancePanel.cs
// Simple per-object stats with clear overlay labels (no dependency on GPU resources).

using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;

public class ScenePerformancePanel : RuntimeArtResourceAnalysis.IResourcePanel
{
    public string TabName => "Scene Perf";
    private RuntimeArtResourceAnalysis.AnalyzerContext ctx;
    private int lastCollect = -9999;

    private struct Entry
    {
        public GameObject go;
        public int verts;
        public int tris;
        public float score;
    }

    private List<Entry> _entries = new List<Entry>();
    private bool _showOverlay = true;

    public void OnEnable(RuntimeArtResourceAnalysis.AnalyzerContext ctx)
    {
        this.ctx = ctx;
        CollectIfNeeded(true);
#if UNITY_EDITOR
        SceneView.duringSceneGui -= OnSceneGUI;
        SceneView.duringSceneGui += OnSceneGUI;
#endif
    }

    public void OnDisable()
    {
#if UNITY_EDITOR
        SceneView.duringSceneGui -= OnSceneGUI;
#endif
    }

    public void CollectIfNeeded(bool force)
    {
        if (!force && (ctx.currentFrame - lastCollect) < Mathf.Max(1, ctx.refreshIntervalFrames)) return;

        var rends = Object.FindObjectsOfType<Renderer>();
        var list = new List<Entry>(rends.Length);

        foreach (var r in rends)
        {
            if (r == null) continue;
            int v = 0, t = 0;
            var mats = r.sharedMaterials;

            // verts/tris approx
            if (r is SkinnedMeshRenderer sk)
            {
                var m = sk.sharedMesh;
                if (m != null) { v = m.vertexCount; t = (m.triangles != null ? m.triangles.Length / 3 : 0); }
            }
            else if (r is MeshRenderer mr)
            {
                var mf = r.GetComponent<MeshFilter>();
                var m = mf != null ? mf.sharedMesh : null;
                if (m != null) { v = m.vertexCount; t = (m.triangles != null ? m.triangles.Length / 3 : 0); }
            }

            float score = v * Mathf.Max(1, (mats != null ? mats.Length : 1));
            list.Add(new Entry { go = r.gameObject, verts = v, tris = t, score = score });
        }

        _entries = list.OrderByDescending(e => e.score).ToList();
        lastCollect = ctx.currentFrame;
    }

    public void OnGUI(RuntimeArtResourceAnalysis.AnalyzerContext ctx, ref Vector2 scroll)
    {
        _showOverlay = EditorGUILayout.Toggle("Show Overlay In SceneView", _showOverlay);

        string sf = ctx.searchFilter?.ToLowerInvariant();
        var view = string.IsNullOrEmpty(sf) ? _entries : _entries.Where(e => e.go && e.go.name.ToLowerInvariant().Contains(sf)).ToList();

        int show = Mathf.Min(100, view.Count);
        for (int i = 0; i < show; i++)
        {
            var e = view[i];
            if (e.go == null) continue;

            EditorGUILayout.BeginHorizontal(EditorStyles.helpBox);
            EditorGUILayout.LabelField($"{i + 1}. {e.go.name}", EditorStyles.boldLabel);
            GUILayout.FlexibleSpace();
            EditorGUILayout.LabelField($"Verts:{e.verts}  Tris:{e.tris}  Score:{e.score:0}", GUILayout.Width(260));
            if (GUILayout.Button("Ping", GUILayout.Width(60))) EditorGUIUtility.PingObject(e.go);
            if (GUILayout.Button("Select", GUILayout.Width(60))) Selection.activeObject = e.go;
            EditorGUILayout.EndHorizontal();
        }
    }

#if UNITY_EDITOR
    private void OnSceneGUI(SceneView sv)
    {
        if (!_showOverlay) return;
        if (_entries == null || _entries.Count == 0) return;

        Handles.BeginGUI();
        int max = Mathf.Min(50, _entries.Count);
        for (int i = 0; i < max; i++)
        {
            var e = _entries[i];
            if (e.go == null) continue;

            Vector3 pos = e.go.transform.position;
            Vector2 p = HandleUtility.WorldToGUIPoint(pos);
            Rect rect = new Rect(p.x - 46, p.y - 14, 92, 28);

            Color heat = HeatColor(e.score);
            EditorGUI.DrawRect(rect, heat);

            float brightness = (0.299f * heat.r + 0.587f * heat.g + 0.114f * heat.b);
            Color text = (brightness > 0.5f) ? Color.black : Color.white;

            var style = new GUIStyle(EditorStyles.boldLabel)
            {
                alignment = TextAnchor.MiddleCenter,
                fontSize = 10,
                normal = { textColor = text }
            };
            GUI.Label(rect, $"{(e.verts / 1000f):F1}kV\n{e.score:0}", style);
        }
        Handles.EndGUI();
    }

    private static Color HeatColor(float s)
    {
        // simple heat ramp
        float v = Mathf.Clamp01(Mathf.Log10(Mathf.Max(1f, s)) / 5f);
        return new Color(v, 1f - Mathf.Abs(v - 0.5f) * 2f, 1f - v, 0.85f);
    }
#endif
}
