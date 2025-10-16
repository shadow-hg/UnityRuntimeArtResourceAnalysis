using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

public class ShaderVariantPanel : RuntimeArtResourceAnalysis.IResourcePanel
{
    public string TabName => "Shaders";

    private RuntimeArtResourceAnalysis.AnalyzerContext ctx;
    private List<Shader> list = new List<Shader>();
    private int lastCollect = -9999;

    private readonly Dictionary<int, int> shaderUsageCount = new();
    private readonly Dictionary<int, ShaderVariantInfo> shaderVariants = new();

    private GUIStyle shaderNameStyle;

    private enum SortMode { PassCount, KeywordCount, MaterialCount }
    private SortMode sortMode = SortMode.KeywordCount;
    private bool sortDescending = true;

    public void OnEnable(RuntimeArtResourceAnalysis.AnalyzerContext ctx)
    {
        this.ctx = ctx;
        shaderNameStyle = new GUIStyle(EditorStyles.boldLabel)
        {
            fontSize = 12,
            wordWrap = true
        };
        CollectIfNeeded(true);
    }

    public void OnDisable() { }

    public void CollectIfNeeded(bool force)
    {
        if (!force && (ctx.currentFrame - lastCollect) < Math.Max(1, ctx.refreshIntervalFrames))
            return;

        // ✅ 只收集运行时已加载材质引用的 Shader
        var loadedMaterials = Resources.FindObjectsOfTypeAll<Material>()
            .Where(m => m != null && m.shader != null)
            .Distinct()
            .ToList();

        ctx.cachedMaterials = loadedMaterials;
        list = loadedMaterials.Select(m => m.shader).Where(s => s != null).Distinct().ToList();

        shaderUsageCount.Clear();
        shaderVariants.Clear();

        foreach (var mat in loadedMaterials)
        {
            int id = mat.shader.GetInstanceID();
            shaderUsageCount.TryGetValue(id, out int count);
            shaderUsageCount[id] = count + 1;
        }

        foreach (var shader in list)
        {
            shaderVariants[shader.GetInstanceID()] = AnalyzeShaderKeywords(shader);
        }

        lastCollect = ctx.currentFrame;
    }

    private ShaderVariantInfo AnalyzeShaderKeywords(Shader shader)
    {
        ShaderVariantInfo info = new ShaderVariantInfo();
        if (shader == null) return info;

        try
        {
            Type shaderUtilType = typeof(ShaderUtil);
            int passCount = 0;
            try { passCount = shader.passCount; } catch { passCount = 0; }

            string[] globalKeywords = Array.Empty<string>();
            string[] localKeywords = Array.Empty<string>();

            var globalMethod = shaderUtilType.GetMethod("GetShaderGlobalKeywords",
                System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
            if (globalMethod != null)
            {
                var raw = globalMethod.Invoke(null, new object[] { shader });
                if (raw is string[] sarr) globalKeywords = sarr;
                else if (raw is ShaderKeyword[] kw) globalKeywords = kw.Select(k => k.name).ToArray();
            }

            var localMethod = shaderUtilType.GetMethod("GetShaderLocalKeywords",
                System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
            if (localMethod != null)
            {
                try
                {
                    var raw = localMethod.Invoke(null, new object[] { shader, 0 });
                    if (raw is string[] sarr) localKeywords = sarr;
                    else if (raw is ShaderKeyword[] kw) localKeywords = kw.Select(k => k.name).ToArray();
                }
                catch { }
            }

            info.passCount = passCount;
            info.keywordCount = globalKeywords.Length + localKeywords.Length;
            info.globalKeywords = globalKeywords;
            info.localKeywords = localKeywords;
        }
        catch (Exception e)
        {
            Debug.LogWarning($"[ShaderVariantPanel] Failed to analyze {shader.name}: {e.Message}");
        }

        return info;
    }

    public void OnGUI(RuntimeArtResourceAnalysis.AnalyzerContext ctx, ref Vector2 scroll)
    {
        EditorGUILayout.Space(4);
        EditorGUILayout.BeginHorizontal(EditorStyles.helpBox);
        EditorGUILayout.LabelField("Sort by:", GUILayout.Width(60));
        sortMode = (SortMode)EditorGUILayout.EnumPopup(sortMode, GUILayout.Width(140));
        if (GUILayout.Button(sortDescending ? "↓ Desc" : "↑ Asc", GUILayout.Width(70)))
            sortDescending = !sortDescending;
        EditorGUILayout.EndHorizontal();

        string sf = ctx.searchFilter?.ToLowerInvariant();
        var filtered = string.IsNullOrEmpty(sf)
            ? list
            : list.Where(s => s != null && s.name.ToLowerInvariant().Contains(sf)).ToList();

        Func<Shader, int> keySelector = s => 0;
        switch (sortMode)
        {
            case SortMode.PassCount:
                keySelector = s => shaderVariants.TryGetValue(s.GetInstanceID(), out var info1) ? info1.passCount : 0;
                break;
            case SortMode.KeywordCount:
                keySelector = s => shaderVariants.TryGetValue(s.GetInstanceID(), out var info2) ? info2.keywordCount : 0;
                break;
            case SortMode.MaterialCount:
                keySelector = s => shaderUsageCount.TryGetValue(s.GetInstanceID(), out var c) ? c : 0;
                break;
        }

        filtered = sortDescending
            ? filtered.OrderByDescending(keySelector).ToList()
            : filtered.OrderBy(keySelector).ToList();

        foreach (var s in filtered)
        {
            if (s == null) continue;
            EditorGUILayout.BeginHorizontal(EditorStyles.helpBox);
            Texture thumb = AssetPreview.GetMiniThumbnail(s);
            if (GUILayout.Button(thumb, GUILayout.Width(48), GUILayout.Height(48)))
            {
                var w = EditorWindow.GetWindow<RuntimeArtResourceAnalysis>();
                w.selectedResource = s;
            }

            EditorGUILayout.BeginVertical();
            EditorGUILayout.LabelField(s.name, shaderNameStyle);
            shaderVariants.TryGetValue(s.GetInstanceID(), out ShaderVariantInfo info);
            shaderUsageCount.TryGetValue(s.GetInstanceID(), out int useCount);

            EditorGUILayout.LabelField(
                $"Passes: {info.passCount} | Keywords: {info.keywordCount} | Materials: {useCount}",
                EditorStyles.miniLabel);

            if (info.globalKeywords != null && info.globalKeywords.Length > 0)
            {
                string gk = string.Join(", ", info.globalKeywords.Take(8));
                if (info.globalKeywords.Length > 8) gk += "...";
                EditorGUILayout.LabelField($"Global: {gk}", EditorStyles.miniLabel);
            }
            if (info.localKeywords != null && info.localKeywords.Length > 0)
            {
                string lk = string.Join(", ", info.localKeywords.Take(8));
                if (info.localKeywords.Length > 8) lk += "...";
                EditorGUILayout.LabelField($"Local: {lk}", EditorStyles.miniLabel);
            }

            EditorGUILayout.EndVertical();
            GUILayout.FlexibleSpace();
            if (GUILayout.Button("Ping", GUILayout.Width(60))) EditorGUIUtility.PingObject(s);
            if (GUILayout.Button("Select", GUILayout.Width(60))) Selection.activeObject = s;
            EditorGUILayout.EndHorizontal();
            GUILayout.Space(3);
        }
    }

    private class ShaderVariantInfo
    {
        public int passCount;
        public int keywordCount;
        public string[] globalKeywords;
        public string[] localKeywords;
    }
}
