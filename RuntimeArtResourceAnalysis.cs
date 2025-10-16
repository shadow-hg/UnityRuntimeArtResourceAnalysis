using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

public class RuntimeArtResourceAnalysis : EditorWindow
{
    // ----------------------------
    // Public config
    // ----------------------------
    private const int DEFAULT_THUMB = 128;
    private const int MIN_THUMB = 48;
    private const int MAX_THUMB = 512;
    private const int DEFAULT_REFRESH_FRAMES = 30;

    // ----------------------------
    // Panels architecture
    // ----------------------------
    public interface IResourcePanel
    {
        string TabName { get; }
        void OnEnable(AnalyzerContext ctx);
        void OnDisable();
        void OnGUI(AnalyzerContext ctx, ref Vector2 scroll);
        void CollectIfNeeded(bool force);
    }

    public class AnalyzerContext
    {
        public int currentFrame;
        public bool liveRefresh;
        public int refreshIntervalFrames;
        public int thumbnailSize;
        public string searchFilter;
        public SortMode sortMode;
        public bool sortDescending;
        // Shared caches (panels may use or maintain their own)
        public List<Texture> cachedTextures = new List<Texture>();
        public List<Material> cachedMaterials = new List<Material>();
        public List<Mesh> cachedMeshes = new List<Mesh>();
        public List<Shader> cachedShaders = new List<Shader>();
        public List<RenderTexture> cachedRTs = new List<RenderTexture>();
        // Tracking
        public Dictionary<UnityEngine.Object, int> lastSeenFrame = new Dictionary<UnityEngine.Object, int>();
        public Dictionary<UnityEngine.Object, int> firstSeenFrame = new Dictionary<UnityEngine.Object, int>();
        // Helper
        public Action requestRepaint;
    }

    public enum SortMode { Resolution, Memory, Name, UpdateFrequency }

    // Window state
    private Vector2 scroll;
    private int thumbnailSize = DEFAULT_THUMB;
    private bool liveRefresh = true;
    private int refreshIntervalFrames = DEFAULT_REFRESH_FRAMES;
    private int currentFrame = 0;
    private int lastCollectFrame = -9999;
    private string searchFilter = "";
    private SortMode sortMode = SortMode.Resolution;
    private bool sortDescending = true;

    // Panels
    private List<IResourcePanel> panels = new List<IResourcePanel>();
    private int currentTabIndex = 0;

    // Context
    private AnalyzerContext ctx;

    // Selection / preview
    public UnityEngine.Object selectedResource = null;
    private bool fullscreenPreview = false;

    // UI style
    private GUIStyle headerStyle;
    private GUIStyle miniLabelCentered;

    [MenuItem("HRP/Analyzer/RuntimeArtResourceAnalysis")]
    public static void OpenWindow()
    {
        var w = GetWindow<RuntimeArtResourceAnalysis>(false, "RuntimeArtResourceAnalysis", true);
        w.minSize = new Vector2(640, 360);
        w.Show();
    }

    private void OnEnable()
    {
        titleContent = new GUIContent("Unity Asset Analyzer");

        InitStyles();
        InitContextAndPanels();   // 新增封装

        EditorApplication.update -= EditorUpdate; // 先取消旧的
        EditorApplication.update += EditorUpdate; // 再注册新的

        CollectAllImmediate();
    }


    // ----------------------------
// Global texture export helper
// ----------------------------
    public static void ExportTextureToFile(Texture t)
    {
        if (t == null) return;
        string ext = "png";
        string path = EditorUtility.SaveFilePanel("Export Texture", "", t.name, ext);
        if (string.IsNullOrEmpty(path)) return;

        Texture2D tex = CopyTextureToTexture2D(t);
        if (tex == null)
        {
            Debug.LogWarning("Export failed: could not create readable copy.");
            return;
        }

        try
        {
            File.WriteAllBytes(path, tex.EncodeToPNG());
            Debug.Log($"Exported texture to {path}");
            if (path.StartsWith(Application.dataPath))
                AssetDatabase.Refresh();
        }
        catch (Exception e)
        {
            Debug.LogException(e);
        }
        finally
        {
            UnityEngine.Object.DestroyImmediate(tex);
        }
    }

    private static Texture2D CopyTextureToTexture2D(Texture t)
    {
        Texture2D tex = null;
        RenderTexture prev = RenderTexture.active;
        try
        {
            if (t is RenderTexture rt)
            {
                RenderTexture tmp = RenderTexture.GetTemporary(rt.width, rt.height, 0, RenderTextureFormat.ARGB32);
                Graphics.Blit(rt, tmp);
                RenderTexture.active = tmp;
                tex = new Texture2D(tmp.width, tmp.height, TextureFormat.RGBA32, false);
                tex.ReadPixels(new Rect(0, 0, tmp.width, tmp.height), 0, 0);
                tex.Apply();
                RenderTexture.ReleaseTemporary(tmp);
            }
            else if (t is Texture2D t2)
            {
                tex = new Texture2D(t2.width, t2.height, TextureFormat.RGBA32, false);
                tex.SetPixels(t2.GetPixels());
                tex.Apply();
            }
        }
        catch (Exception e)
        {
            Debug.LogException(e);
        }
        finally
        {
            RenderTexture.active = prev;
        }
        return tex;
    }

    private void OnDisable()
    {
        EditorApplication.update -= EditorUpdate;
        if (panels != null)
        {
            foreach (var p in panels)
            {
                try { p.OnDisable(); } catch { }
            }
        }
    }


    private void InitStyles()
    {
        headerStyle = new GUIStyle(EditorStyles.boldLabel) { alignment = TextAnchor.MiddleLeft, fontSize = 12 };
        miniLabelCentered = new GUIStyle(EditorStyles.centeredGreyMiniLabel);
    }

    private void EditorUpdate()
    {
        if (ctx == null || panels == null || panels.Count == 0)
            return;

        currentFrame++;
        ctx.currentFrame = currentFrame;
        ctx.liveRefresh = liveRefresh;
        ctx.refreshIntervalFrames = refreshIntervalFrames;
        ctx.thumbnailSize = thumbnailSize;
        ctx.searchFilter = searchFilter;
        ctx.sortMode = sortMode;
        ctx.sortDescending = sortDescending;

        if (liveRefresh && (currentFrame - lastCollectFrame) >= refreshIntervalFrames)
        {
            CollectAllDeferred();
            lastCollectFrame = currentFrame;
        }

        if (liveRefresh) Repaint();
    }


    private void OnGUI()
    {
        DrawTopToolbar();

        if (fullscreenPreview && selectedResource != null)
        {
            DrawFullscreenPreview();
            return;
        }

        // Tabs
        DrawTabs();

        // Current panel GUI
        scroll = EditorGUILayout.BeginScrollView(scroll);
        if (currentTabIndex >= 0 && currentTabIndex < panels.Count)
        {
            var panel = panels[currentTabIndex];
            panel.OnGUI(ctx, ref scroll);
        }
        EditorGUILayout.EndScrollView();

        DrawBottomBar();
    }

    private void InitContextAndPanels()
    {
        if (ctx == null)
        {
            ctx = new AnalyzerContext
            {
                currentFrame = 0,
                liveRefresh = liveRefresh,
                refreshIntervalFrames = refreshIntervalFrames,
                thumbnailSize = thumbnailSize,
                searchFilter = searchFilter,
                sortMode = sortMode,
                sortDescending = sortDescending,
                requestRepaint = () => Repaint()
            };
        }

        if (panels == null)
            panels = new List<IResourcePanel>();

        if (panels.Count == 0)
        {
            panels.Add(new TexturePanel());
            panels.Add(new MaterialPanel());
            panels.Add(new MeshPanel());
            panels.Add(new RenderTexturePanel());
            panels.Add(new GPUAnalyzerPanel());
            panels.Add(new ShaderVariantPanel());
            panels.Add(new ScenePerformancePanel());
        }

        foreach (var p in panels)
        {
            try { p.OnEnable(ctx); }
            catch (Exception e) { Debug.LogException(e); }
        }
    }

    private void DrawTopToolbar()
    {
        EditorGUILayout.BeginHorizontal(EditorStyles.toolbar);
        liveRefresh = GUILayout.Toggle(liveRefresh, "Live", EditorStyles.toolbarButton, GUILayout.Width(64));
        GUILayout.Label("Refresh:", GUILayout.Width(56));
        refreshIntervalFrames = EditorGUILayout.IntField(refreshIntervalFrames, GUILayout.Width(48));
        if (GUILayout.Button("Refresh Now", EditorStyles.toolbarButton, GUILayout.Width(110)))
        {
            CollectAllImmediate();
        }

        GUILayout.Space(6);
        GUILayout.Label("Search:", GUILayout.Width(44));
        searchFilter = GUILayout.TextField(searchFilter, EditorStyles.toolbarTextField, GUILayout.Width(200));

        GUILayout.Space(6);
        GUILayout.Label("Thumb:", GUILayout.Width(44));
        thumbnailSize = EditorGUILayout.IntSlider(thumbnailSize, MIN_THUMB, MAX_THUMB, GUILayout.Width(220));

        GUILayout.Space(6);
        GUILayout.Label("Sort:", GUILayout.Width(36));
        sortMode = (SortMode)EditorGUILayout.EnumPopup(sortMode, GUILayout.Width(140));
        sortDescending = GUILayout.Toggle(sortDescending, sortDescending ? "Desc" : "Asc", EditorStyles.toolbarButton, GUILayout.Width(50));

        GUILayout.FlexibleSpace();

        if (GUILayout.Button("Export CSV", EditorStyles.toolbarButton, GUILayout.Width(96)))
        {
            ExportCsvSummary();
        }

        EditorGUILayout.EndHorizontal();
    }

    private void DrawTabs()
    {
        EditorGUILayout.BeginHorizontal();
        for (int i = 0; i < panels.Count; i++)
        {
            if (GUILayout.Toggle(i == currentTabIndex, panels[i].TabName, EditorStyles.toolbarButton))
            {
                currentTabIndex = i;
            }
        }
        EditorGUILayout.EndHorizontal();
    }

    private void DrawBottomBar()
    {
        EditorGUILayout.BeginHorizontal(EditorStyles.helpBox);
        if (selectedResource != null)
        {
            GUILayout.Label("Selected: " + selectedResource.name);
            GUILayout.FlexibleSpace();
            if (selectedResource is Texture)
            {
                if (GUILayout.Button("Export...")) ExportSelectedTexture();
            }
            if (GUILayout.Button("Ping")) EditorGUIUtility.PingObject(selectedResource);
            if (GUILayout.Button("Select")) Selection.activeObject = selectedResource;
            if (GUILayout.Button("Clear")) selectedResource = null;
        }
        else
        {
            long totalTexMem = ctx.cachedTextures.Sum(t => EstimateMemoryBytes(t));
            GUILayout.Label($"Textures: {ctx.cachedTextures.Count}  Mats: {ctx.cachedMaterials.Count}  Meshes: {ctx.cachedMeshes.Count}  Shaders: {ctx.cachedShaders.Count}  ApproxTexMem: {PrettyBytes(totalTexMem)}");
        }
        EditorGUILayout.EndHorizontal();
    }

    // ----------------------------
    // Collect & caching (central)
    // ----------------------------
    private void CollectAllImmediate()
    {
        CollectTextures();
        CollectMaterials();
        CollectMeshes();
        CollectShaders();
        CollectRTs();
        foreach (var p in panels) p.CollectIfNeeded(true);
        lastCollectFrame = currentFrame;
        ctx.requestRepaint();
    }

    private void CollectAllDeferred()
    {
        // Minimal allocations, update shared caches
        CollectTextures();
        CollectMaterials();
        CollectMeshes();
        CollectShaders();
        CollectRTs();
        foreach (var p in panels) p.CollectIfNeeded(false);
    }

    private void CollectTextures()
    {
        var tex2 = Resources.FindObjectsOfTypeAll<Texture2D>().Cast<Texture>();
        var cubemaps = Resources.FindObjectsOfTypeAll<Cubemap>().Cast<Texture>();
        var all = new List<Texture>();
        all.AddRange(tex2);
        all.AddRange(cubemaps);
        ctx.cachedTextures = all.Distinct().Where(t => t != null).ToList();
        UpdateTracking(ctx.cachedTextures.Cast<UnityEngine.Object>());
    }

    private void CollectMaterials()
    {
        ctx.cachedMaterials = Resources.FindObjectsOfTypeAll<Material>().Where(m => m != null).ToList();
        UpdateTracking(ctx.cachedMaterials.Cast<UnityEngine.Object>());
    }

    private void CollectMeshes()
    {
        ctx.cachedMeshes = Resources.FindObjectsOfTypeAll<Mesh>().Where(m => m != null).ToList();
        UpdateTracking(ctx.cachedMeshes.Cast<UnityEngine.Object>());
    }

    private void CollectShaders()
    {
        ctx.cachedShaders = Resources.FindObjectsOfTypeAll<Shader>().Where(s => s != null).ToList();
        UpdateTracking(ctx.cachedShaders.Cast<UnityEngine.Object>());
    }

    private void CollectRTs()
    {
        ctx.cachedRTs = Resources.FindObjectsOfTypeAll<RenderTexture>().Where(r => r != null).ToList();
        UpdateTracking(ctx.cachedRTs.Cast<UnityEngine.Object>());
    }

    private void UpdateTracking(IEnumerable<UnityEngine.Object> list)
    {
        var arr = list.ToArray();
        var seenIds = new HashSet<int>(arr.Select(o => o.GetInstanceID()));
        foreach (var o in arr)
        {
            ctx.lastSeenFrame[o] = currentFrame;
            if (!ctx.firstSeenFrame.ContainsKey(o)) ctx.firstSeenFrame[o] = currentFrame;
        }
        var keys = ctx.lastSeenFrame.Keys.ToList();
        foreach (var k in keys)
        {
            if (!seenIds.Contains(k.GetInstanceID()))
            {
                ctx.lastSeenFrame.Remove(k);
                if (ctx.firstSeenFrame.ContainsKey(k)) ctx.firstSeenFrame.Remove(k);
            }
        }
    }

    // ----------------------------
    // Utilities
    // ----------------------------
    private static long EstimateMemoryBytes(Texture t)
    {
        try
        {
            int w = t.width;
            int h = t.height;
            // rough default 4 bytes per pixel fallback
            return (long)w * h * 4;
        }
        catch { return 0; }
    }

    private string PrettyBytes(long b)
    {
        if (b > 1024 * 1024) return (b / (1024f * 1024f)).ToString("F2") + " MB";
        if (b > 1024) return (b / 1024f).ToString("F1") + " KB";
        return b + " B";
    }

    private void ExportCsvSummary()
    {
        string path = EditorUtility.SaveFilePanel("Export CSV Summary", Application.dataPath, "AssetSummary.csv", "csv");
        if (string.IsNullOrEmpty(path)) return;

        try
        {
            using (var sw = new StreamWriter(path))
            {
                sw.WriteLine("Type,Name,Details");
                foreach (var t in ctx.cachedTextures)
                {
                    sw.WriteLine($"Texture,{t.name},{t.width}x{t.height}");
                }
                foreach (var m in ctx.cachedMaterials)
                {
                    sw.WriteLine($"Material,{m.name},{m.shader?.name}");
                }
                foreach (var mesh in ctx.cachedMeshes)
                {
                    sw.WriteLine($"Mesh,{mesh.name},Verts:{mesh.vertexCount}");
                }
                foreach (var s in ctx.cachedShaders)
                {
                    sw.WriteLine($"Shader,{s.name},");
                }
            }
            Debug.Log($"Exported CSV summary to {path}");
            if (path.StartsWith(Application.dataPath))
            {
                AssetDatabase.Refresh();
            }
        }
        catch (Exception e)
        {
            Debug.LogException(e);
        }
    }

    private void ExportSelectedTexture()
    {
        if (!(selectedResource is Texture t)) return;
        // reuse panel's export
        RuntimeArtResourceAnalysis.ExportTextureToFile(t);
    }

    private void DrawFullscreenPreview()
    {
        EditorGUILayout.BeginVertical();
        GUILayout.Space(6);
        GUILayout.Label("Full Preview - Double click or press Esc to close", headerStyle);
        GUILayout.Space(6);

        if (selectedResource is Texture tx)
        {
            Rect r = GUILayoutUtility.GetRect(position.width - 20, position.height - 120);
            if (Event.current.type == EventType.Repaint)
            {
                GUI.DrawTexture(r, tx, ScaleMode.ScaleToFit, false);
            }
            if (Event.current.type == EventType.KeyDown && Event.current.keyCode == KeyCode.Escape)
            {
                fullscreenPreview = false; Event.current.Use();
            }
            if (Event.current.type == EventType.MouseDown && r.Contains(Event.current.mousePosition))
            {
                if (Event.current.clickCount == 2)
                {
                    fullscreenPreview = false; Event.current.Use();
                }
            }
        }
        else
        {
            EditorGUILayout.LabelField("Preview not available for this resource type.", miniLabelCentered);
        }

        EditorGUILayout.EndVertical();
    }

    // ----------------------------
    // Panels
    // ----------------------------

    // TexturePanel: main feature-rich panel
    // Texture Panel (only Texture2D & Cubemap, exclude RenderTexture)
private class TexturePanel : IResourcePanel
{
    public string TabName => "Textures";

    private AnalyzerContext ctx;
    private List<TextureInfo> infos = new List<TextureInfo>();
    private int lastCollect = -9999;
    private GUIStyle nameStyle;

    public void OnEnable(AnalyzerContext ctx)
    {
        this.ctx = ctx;
        nameStyle = new GUIStyle(EditorStyles.label) { richText = true, fontSize = 11 };
        CollectIfNeeded(true);
    }

    public void OnDisable() { }

    public void CollectIfNeeded(bool force)
    {
        if (!force && (ctx.currentFrame - lastCollect) < Math.Max(1, ctx.refreshIntervalFrames))
            return;

        // ✅ 只收集 Texture2D 和 Cubemap
        var tex2 = Resources.FindObjectsOfTypeAll<Texture2D>()
            .Where(t => t != null && t is Texture2D)
            .Cast<Texture>()
            .ToList();
        var cubemaps = Resources.FindObjectsOfTypeAll<Cubemap>()
            .Where(t => t != null)
            .Cast<Texture>()
            .ToList();

        // ✅ 合并并去重
        var all = tex2.Concat(cubemaps)
            .GroupBy(t => $"{t.name}_{t.width}x{t.height}_{t.GetType().Name}")
            .Select(g => g.First())
            .ToList();

        ctx.cachedTextures = all;
        infos = all.Select(t => ToInfo(t)).ToList();

        lastCollect = ctx.currentFrame;
        UpdateTracking(all.Cast<UnityEngine.Object>());
    }

    private void UpdateTracking(IEnumerable<UnityEngine.Object> list)
    {
        var arr = list.ToArray();
        foreach (var o in arr)
        {
            ctx.lastSeenFrame[o] = ctx.currentFrame;
            if (!ctx.firstSeenFrame.ContainsKey(o))
                ctx.firstSeenFrame[o] = ctx.currentFrame;
        }
    }

    public void OnGUI(AnalyzerContext ctx, ref Vector2 scroll)
    {
        string sf = ctx.searchFilter?.Trim().ToLowerInvariant();
        var list = infos.Where(i => i.tex != null).ToList();

        if (!string.IsNullOrEmpty(sf))
            list = list.Where(i => i.tex.name.ToLowerInvariant().Contains(sf)).ToList();

        // ✅ 排序方式
        switch (ctx.sortMode)
        {
            case SortMode.Resolution:
                list = ctx.sortDescending ?
                    list.OrderByDescending(i => (long)i.width * i.height).ToList() :
                    list.OrderBy(i => (long)i.width * i.height).ToList();
                break;
            case SortMode.Memory:
                list = ctx.sortDescending ?
                    list.OrderByDescending(i => i.mem).ToList() :
                    list.OrderBy(i => i.mem).ToList();
                break;
            case SortMode.Name:
                list = ctx.sortDescending ?
                    list.OrderByDescending(i => i.tex.name).ToList() :
                    list.OrderBy(i => i.tex.name).ToList();
                break;
            case SortMode.UpdateFrequency:
                list = ctx.sortDescending ?
                    list.OrderByDescending(i => ctx.currentFrame - i.lastSeen).ToList() :
                    list.OrderBy(i => ctx.currentFrame - i.lastSeen).ToList();
                break;
        }

        DrawGrid(list, ctx.thumbnailSize, DrawTextureCard);
    }

    private void DrawGrid(List<TextureInfo> items, int thumbSize, Action<TextureInfo> drawCard)
    {
        if (items == null || items.Count == 0)
        {
            EditorGUILayout.LabelField("No textures found", EditorStyles.centeredGreyMiniLabel);
            return;
        }

        float usableWidth = EditorGUIUtility.currentViewWidth - 24;
        int cellW = thumbSize + 12;
        int cols = Mathf.Max(1, Mathf.FloorToInt(usableWidth / cellW));
        int idx = 0;

        EditorGUILayout.BeginVertical();
        while (idx < items.Count)
        {
            EditorGUILayout.BeginHorizontal();
            for (int c = 0; c < cols && idx < items.Count; c++)
            {
                EditorGUILayout.BeginVertical(GUILayout.Width(thumbSize + 8));
                drawCard(items[idx]);
                EditorGUILayout.EndVertical();
                GUILayout.Space(8);
                idx++;
            }
            EditorGUILayout.EndHorizontal();
            GUILayout.Space(10);
        }
        EditorGUILayout.EndVertical();
    }

    private void DrawTextureCard(TextureInfo info)
    {
        var t = info.tex;
        if (t == null) return;

        EditorGUILayout.BeginVertical(EditorStyles.helpBox, GUILayout.Width(ctx.thumbnailSize + 8));
        Rect rect = GUILayoutUtility.GetRect(ctx.thumbnailSize, ctx.thumbnailSize, GUILayout.Width(ctx.thumbnailSize), GUILayout.Height(ctx.thumbnailSize));

        if (Event.current.type == EventType.Repaint)
        {
            try { GUI.DrawTexture(rect, t, ScaleMode.ScaleToFit, false); } catch { }
        }

        string name = string.IsNullOrEmpty(t.name) ? "<unnamed>" : t.name;
        string dyn = (ctx.currentFrame - info.lastSeen) <= 1 ?
            "<color=lime>(Dynamic)</color>" : "<color=#888888>(Static)</color>";

        string meta = $"{info.width}x{info.height} {PrettyFormat(t)}\nMem~{PrettyBytes(info.mem)} {dyn}";
        GUILayout.Space(4);
        GUILayout.Label(name, nameStyle);
        GUILayout.Label(meta, nameStyle);

        if (Event.current.type == EventType.MouseDown && rect.Contains(Event.current.mousePosition))
        {
            var w = EditorWindow.GetWindow<RuntimeArtResourceAnalysis>();
            var analyzer = w as RuntimeArtResourceAnalysis;
            analyzer.selectedResource = t;
            Event.current.Use();
        }

        if (rect.Contains(Event.current.mousePosition))
            GUI.Label(new Rect(rect.xMax - 110, rect.y, 110, 20), $"ID:{t.GetInstanceID()}", EditorStyles.miniLabel);

        EditorGUILayout.EndVertical();
    }

    private TextureInfo ToInfo(Texture t)
    {
        return new TextureInfo
        {
            tex = t,
            width = SafeWidth(t),
            height = SafeHeight(t),
            mem = EstimateMemoryBytes(t),
            lastSeen = ctx.lastSeenFrame.ContainsKey(t) ? ctx.lastSeenFrame[t] : -99999,
            firstSeen = ctx.firstSeenFrame.ContainsKey(t) ? ctx.firstSeenFrame[t] : ctx.currentFrame
        };
    }

    private int SafeWidth(Texture t) { try { return t.width; } catch { return 0; } }
    private int SafeHeight(Texture t) { try { return t.height; } catch { return 0; } }

    private string PrettyFormat(Texture t)
    {
        if (t is Texture2D tex) return tex.format.ToString();
        if (t is Cubemap cube) return cube.format.ToString();
        return t.GetType().Name;
    }

    private string PrettyBytes(long b)
    {
        if (b > 1024 * 1024) return (b / (1024f * 1024f)).ToString("F2") + " MB";
        if (b > 1024) return (b / 1024f).ToString("F1") + " KB";
        return b + " B";
    }

    class TextureInfo
    {
        public Texture tex;
        public int width;
        public int height;
        public long mem;
        public int firstSeen;
        public int lastSeen;
    }
}


    // Material panel
    private class MaterialPanel : IResourcePanel
    {
        public string TabName => "Materials";
        private AnalyzerContext ctx;
        private List<Material> list = new List<Material>();
        private int lastCollect = -9999;

        public void OnEnable(AnalyzerContext ctx)
        {
            this.ctx = ctx;
            CollectIfNeeded(true);
        }

        public void OnDisable() { }

        public void CollectIfNeeded(bool force)
        {
            if (!force && (ctx.currentFrame - lastCollect) < Math.Max(1, ctx.refreshIntervalFrames)) return;
            list = Resources.FindObjectsOfTypeAll<Material>().Where(m => m != null).ToList();
            lastCollect = ctx.currentFrame;
            UpdateTracking(list.Cast<UnityEngine.Object>());
        }

        private void UpdateTracking(IEnumerable<UnityEngine.Object> list)
        {
            foreach (var o in list) { ctx.lastSeenFrame[o] = ctx.currentFrame; if (!ctx.firstSeenFrame.ContainsKey(o)) ctx.firstSeenFrame[o] = ctx.currentFrame; }
        }

        public void OnGUI(AnalyzerContext ctx, ref Vector2 scroll)
        {
            string sf = ctx.searchFilter?.ToLowerInvariant();
            var filtered = string.IsNullOrEmpty(sf) ? list : list.Where(m => m != null && m.name.ToLowerInvariant().Contains(sf)).ToList();
            filtered = ctx.sortDescending ? filtered.OrderByDescending(m => m.name).ToList() : filtered.OrderBy(m => m.name).ToList();

            foreach (var m in filtered)
            {
                if (m == null) continue;
                EditorGUILayout.BeginHorizontal(EditorStyles.helpBox);
                Texture thumb = AssetPreview.GetMiniThumbnail(m);
                if (GUILayout.Button(thumb, GUILayout.Width(48), GUILayout.Height(48)))
                {
                    var w = EditorWindow.GetWindow<RuntimeArtResourceAnalysis>();
                    w.selectedResource = m;
                }
                EditorGUILayout.BeginVertical();
                EditorGUILayout.LabelField(m.name, EditorStyles.boldLabel);
                EditorGUILayout.LabelField("Shader: " + (m.shader ? m.shader.name : "null"));
                try
                {
                    var texNames = m.GetTexturePropertyNames();
                    if (texNames != null && texNames.Length > 0)
                    {
                        string s = string.Join(", ", texNames.Select(n => {
                            var tx = m.GetTexture(n);
                            return tx != null ? $"{n}:{tx.name}" : $"{n}:null";
                        }));
                        EditorGUILayout.LabelField("Textures: " + s);
                    }
                }
                catch { }
                EditorGUILayout.EndVertical();
                GUILayout.FlexibleSpace();
                if (GUILayout.Button("Ping", GUILayout.Width(64))) EditorGUIUtility.PingObject(m);
                if (GUILayout.Button("Select", GUILayout.Width(64))) Selection.activeObject = m;
                if (GUILayout.Button("Find References", GUILayout.Width(120)))
                {
                    // list gameobjects using this material
                    var gos = FindGameObjectsUsingMaterial(m);
                    ReferenceListWindow.ShowWindow(m, new List<UnityEngine.Object>(), gos.Cast<UnityEngine.Object>().ToList());
                }
                EditorGUILayout.EndHorizontal();
            }
        }

        private static List<GameObject> FindGameObjectsUsingMaterial(Material mat)
        {
            var results = new List<GameObject>();
            var gos = Resources.FindObjectsOfTypeAll<GameObject>();
            foreach (var go in gos)
            {
                try
                {
                    var rends = go.GetComponentsInChildren<Renderer>(true);
                    foreach (var r in rends)
                    {
                        var ms = r.sharedMaterials;
                        if (ms != null && ms.Contains(mat))
                        {
                            results.Add(go);
                            break;
                        }
                    }
                }
                catch { }
            }
            return results.Distinct().ToList();
        }
    }

    // Mesh Panel
    private class MeshPanel : IResourcePanel
    {
        public string TabName => "Meshes";
        private AnalyzerContext ctx;
        private List<Mesh> meshes = new List<Mesh>();
        private int lastCollect = -9999;

        public void OnEnable(AnalyzerContext ctx)
        {
            this.ctx = ctx;
            CollectIfNeeded(true);
        }

        public void OnDisable() { }

        public void CollectIfNeeded(bool force)
        {
            if (!force && (ctx.currentFrame - lastCollect) < Math.Max(1, ctx.refreshIntervalFrames)) return;
            meshes = Resources.FindObjectsOfTypeAll<Mesh>().Where(m => m != null).ToList();
            lastCollect = ctx.currentFrame;
            UpdateTracking(meshes.Cast<UnityEngine.Object>());
        }

        private void UpdateTracking(IEnumerable<UnityEngine.Object> list)
        {
            foreach (var o in list) { ctx.lastSeenFrame[o] = ctx.currentFrame; if (!ctx.firstSeenFrame.ContainsKey(o)) ctx.firstSeenFrame[o] = ctx.currentFrame; }
        }

        public void OnGUI(AnalyzerContext ctx, ref Vector2 scroll)
        {
            string sf = ctx.searchFilter?.ToLowerInvariant();
            var filtered = string.IsNullOrEmpty(sf) ? meshes : meshes.Where(m => m != null && m.name.ToLowerInvariant().Contains(sf)).ToList();
            filtered = ctx.sortDescending ? filtered.OrderByDescending(m => m.vertexCount).ToList() : filtered.OrderBy(m => m.vertexCount).ToList();

            foreach (var m in filtered)
            {
                if (m == null) continue;
                EditorGUILayout.BeginHorizontal(EditorStyles.helpBox);
                Texture thumb = AssetPreview.GetMiniThumbnail(m);
                if (GUILayout.Button(thumb, GUILayout.Width(48), GUILayout.Height(48)))
                {
                    var w = EditorWindow.GetWindow<RuntimeArtResourceAnalysis>();
                    w.selectedResource = m;
                }
                EditorGUILayout.BeginVertical();
                EditorGUILayout.LabelField(m.name, EditorStyles.boldLabel);
                int tris = m.triangles != null ? m.triangles.Length / 3 : 0;
                EditorGUILayout.LabelField($"Verts:{m.vertexCount} Tris:{tris} UVs:{(m.uv != null && m.uv.Length > 0 ? "Yes" : "No")}");
                EditorGUILayout.EndVertical();
                GUILayout.FlexibleSpace();
                if (GUILayout.Button("Ping", GUILayout.Width(64))) EditorGUIUtility.PingObject(m);
                if (GUILayout.Button("Select", GUILayout.Width(64))) Selection.activeObject = m;
                EditorGUILayout.EndHorizontal();
            }
        }
    }

    // RenderTexture Panel
    // RenderTexture Panel
// RenderTexture Panel (Stable Version)
private class RenderTexturePanel : IResourcePanel
{
    public string TabName => "RenderTextures";
    private AnalyzerContext ctx;
    private List<RenderTexture> list = new List<RenderTexture>();
    private int lastCollect = -9999;
    private readonly Dictionary<int, Texture2D> rtThumbnails = new();

    public void OnEnable(AnalyzerContext ctx)
    {
        this.ctx = ctx;
        CollectIfNeeded(true);
    }

    public void OnDisable() { }

    public void CollectIfNeeded(bool force)
    {
        if (!force && (ctx.currentFrame - lastCollect) < Math.Max(1, ctx.refreshIntervalFrames)) return;

        // ✅ 只收集仍存在的 RenderTexture
        list = Resources.FindObjectsOfTypeAll<RenderTexture>()
            .Where(r => r != null && r.IsCreated() && r.width > 0 && r.height > 0)
            .Distinct()
            .ToList();

        lastCollect = ctx.currentFrame;
    }

    private Texture2D GetRenderTextureThumbnail(RenderTexture rt)
    {
        if (rt == null || !rt.IsCreated()) return null;
        int id = rt.GetInstanceID();

        if (!rtThumbnails.TryGetValue(id, out var tex) || tex == null
            || tex.width != rt.width || tex.height != rt.height)
        {
            try
            {
                RenderTexture prev = RenderTexture.active;
                RenderTexture.active = rt;
                tex = new Texture2D(rt.width, rt.height, TextureFormat.RGBA32, false);
                tex.ReadPixels(new Rect(0, 0, rt.width, rt.height), 0, 0);
                tex.Apply();
                RenderTexture.active = prev;
                rtThumbnails[id] = tex;
            }
            catch
            {
                // 有些 RT 已销毁，跳过
                return null;
            }
        }
        return tex;
    }

    public void OnGUI(AnalyzerContext ctx, ref Vector2 scroll)
    {
        try
        {
            string sf = ctx.searchFilter?.ToLowerInvariant();
            var filtered = string.IsNullOrEmpty(sf) ? list :
                list.Where(r => r != null && r.name.ToLowerInvariant().Contains(sf)).ToList();

            // 过滤已销毁 RT
            filtered = filtered.Where(r => r != null && r.IsCreated()).ToList();

            filtered = ctx.sortDescending
                ? filtered.OrderByDescending(r => r.width * r.height).ToList()
                : filtered.OrderBy(r => r.width * r.height).ToList();

            foreach (var r in filtered)
            {
                if (r == null || !r.IsCreated()) continue;

                EditorGUILayout.BeginHorizontal(EditorStyles.helpBox);
                try
                {
                    Rect thumbRect = GUILayoutUtility.GetRect(64, 64, GUILayout.Width(64), GUILayout.Height(64));
                    var thumb = GetRenderTextureThumbnail(r);
                    if (thumb != null)
                        GUI.DrawTexture(thumbRect, thumb, ScaleMode.ScaleToFit, false);

                    EditorGUILayout.BeginVertical();
                    EditorGUILayout.LabelField(r.name, EditorStyles.boldLabel);
                    EditorGUILayout.LabelField($"{r.width}x{r.height}  {r.format}");
                    EditorGUILayout.EndVertical();

                    GUILayout.FlexibleSpace();
                    if (GUILayout.Button("Ping", GUILayout.Width(60))) EditorGUIUtility.PingObject(r);
                    if (GUILayout.Button("Select", GUILayout.Width(60))) Selection.activeObject = r;
                    if (GUILayout.Button("Export", GUILayout.Width(70))) ExportTextureToFile(r);
                }
                catch { /* 某个RT销毁时忽略绘制错误 */ }
                finally
                {
                    EditorGUILayout.EndHorizontal();
                }
            }

            if (filtered.Count == 0)
                EditorGUILayout.HelpBox("No active RenderTextures found.", MessageType.Info);
        }
        catch (System.Exception ex)
        {
            Debug.LogWarning($"[RenderTexturePanel] GUI draw error: {ex.Message}");
        }
    }
}


    // ----------------------------
    // Reference list pop-up window
    // ----------------------------
    public class ReferenceListWindow : EditorWindow
    {
        private UnityEngine.Object target;
        private List<UnityEngine.Object> materialRefs = new List<UnityEngine.Object>();
        private List<UnityEngine.Object> objectRefs = new List<UnityEngine.Object>();
        private Vector2 scroll;

        public static void ShowWindow(UnityEngine.Object target, List<UnityEngine.Object> mats, List<UnityEngine.Object> gos)
        {
            var win = GetWindow<ReferenceListWindow>(true, "References", true);
            win.target = target;
            win.materialRefs = mats ?? new List<UnityEngine.Object>();
            win.objectRefs = gos ?? new List<UnityEngine.Object>();
            win.minSize = new Vector2(420, 260);
            win.Show();
        }

        private void OnGUI()
        {
            EditorGUILayout.LabelField($"References for: {target?.name}", EditorStyles.boldLabel);
            EditorGUILayout.Space();
            scroll = EditorGUILayout.BeginScrollView(scroll);
            if (materialRefs.Count > 0)
            {
                EditorGUILayout.LabelField("Materials:", EditorStyles.boldLabel);
                foreach (var m in materialRefs)
                {
                    EditorGUILayout.BeginHorizontal();
                    EditorGUILayout.ObjectField(m, typeof(Material), false);
                    if (GUILayout.Button("Ping", GUILayout.Width(60))) EditorGUIUtility.PingObject(m);
                    if (GUILayout.Button("Select", GUILayout.Width(60))) Selection.activeObject = m;
                    EditorGUILayout.EndHorizontal();
                }
            }
            if (objectRefs.Count > 0)
            {
                EditorGUILayout.LabelField("GameObjects/Prefabs:", EditorStyles.boldLabel);
                foreach (var o in objectRefs)
                {
                    EditorGUILayout.BeginHorizontal();
                    EditorGUILayout.ObjectField(o, typeof(UnityEngine.Object), true);
                    if (GUILayout.Button("Ping", GUILayout.Width(60))) EditorGUIUtility.PingObject(o);
                    if (GUILayout.Button("Select", GUILayout.Width(60))) Selection.activeObject = o;
                    EditorGUILayout.EndHorizontal();
                }
            }
            if (materialRefs.Count == 0 && objectRefs.Count == 0)
            {
                EditorGUILayout.LabelField("No references found.", EditorStyles.centeredGreyMiniLabel);
            }
            EditorGUILayout.EndScrollView();
        }
    }
}
