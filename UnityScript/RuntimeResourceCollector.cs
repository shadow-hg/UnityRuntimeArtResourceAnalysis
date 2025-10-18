using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;
#if UNITY_EDITOR
using UnityEditor;
#endif

// RuntimeResourceCollector: lightweight, runtime-safe resource snapshot for mobile builds.
// It collects textures referenced by active Renderers' materials and active Cameras' target RenderTextures.
public static class RuntimeResourceCollector
{
    private class ShaderAggregate
    {
        public readonly HashSet<string> keywords = new HashSet<string>(StringComparer.Ordinal);
        public readonly HashSet<string> variants = new HashSet<string>(StringComparer.Ordinal);
        public int materialCount;
    }

    private class SnapshotContext
    {
        public readonly List<ResourceEntry> entries = new List<ResourceEntry>();
        public readonly HashSet<int> textureSeen = new HashSet<int>();
        public readonly HashSet<int> materialSeen = new HashSet<int>();
        public readonly HashSet<int> meshSeen = new HashSet<int>();
        public readonly HashSet<int> shaderSeen = new HashSet<int>();
        public readonly Dictionary<Shader, ShaderAggregate> shaderAggregates = new Dictionary<Shader, ShaderAggregate>();
    }

    public static List<ResourceEntry> GetSnapshot()
    {
        var ctx = new SnapshotContext();
        CollectRenderers(ctx);
        CollectCameras(ctx);
        CollectRenderTextures(ctx);
        CollectMeshFilters(ctx);
        CollectSkinnedMeshes(ctx);
        FinalizeShaders(ctx);
        SortEntries(ctx.entries);
        return ctx.entries;
    }

    public static IEnumerator CaptureSnapshotAsync(Action<List<ResourceEntry>> onCompleted, int batchSize = 32)
    {
        if (onCompleted == null)
        {
            yield break;
        }

        var ctx = new SnapshotContext();
        yield return CollectRenderersAsync(ctx, batchSize);
        yield return CollectCamerasAsync(ctx, batchSize);
        yield return CollectRenderTexturesAsync(ctx, batchSize);
        yield return CollectMeshFiltersAsync(ctx, batchSize);
        yield return CollectSkinnedMeshesAsync(ctx, batchSize);
        yield return FinalizeShadersAsync(ctx, batchSize);
        onCompleted(ctx.entries);
    }

    private static void CollectRenderers(SnapshotContext ctx)
    {
        var renderers = UnityEngine.Object.FindObjectsOfType<Renderer>(true);
        for (int i = 0; i < renderers.Length; i++)
        {
            ProcessRenderer(renderers[i], ctx);
        }
    }

    private static IEnumerator CollectRenderersAsync(SnapshotContext ctx, int batchSize)
    {
        var renderers = UnityEngine.Object.FindObjectsOfType<Renderer>(true);
        int processed = 0;
        for (int i = 0; i < renderers.Length; i++)
        {
            ProcessRenderer(renderers[i], ctx);
            if (++processed >= batchSize)
            {
                processed = 0;
                yield return null;
            }
        }
    }

    private static void ProcessRenderer(Renderer renderer, SnapshotContext ctx)
    {
        if (renderer == null)
        {
            return;
        }

        var mats = renderer.sharedMaterials;
        if (mats == null) return;
        foreach (var m in mats)
        {
            ProcessMaterial(m, ctx);
        }
    }

    private static void ProcessMaterial(Material m, SnapshotContext ctx)
    {
        if (m == null || m.shader == null) return;

        int propCount = 0;
        try { propCount = m.shader.GetPropertyCount(); } catch { propCount = 0; }
        if (propCount > 0)
        {
            for (int i = 0; i < propCount; i++)
            {
                try
                {
                    var propType = m.shader.GetPropertyType(i);
                    if (propType == ShaderPropertyType.Texture)
                    {
                        var propName = m.shader.GetPropertyName(i);
                        var tex = m.GetTexture(propName);
                        AddTextureEntry(tex, ctx.entries, ctx.textureSeen, $"{m.name}/{propName}");
                    }
                }
                catch { }
            }
        }
        else
        {
            AddTextureEntry(m.GetTexture("_MainTex"), ctx.entries, ctx.textureSeen, $"{m.name}/_MainTex");
            AddTextureEntry(m.GetTexture("_BaseMap"), ctx.entries, ctx.textureSeen, $"{m.name}/_BaseMap");
            AddTextureEntry(m.GetTexture("_BumpMap"), ctx.entries, ctx.textureSeen, $"{m.name}/_BumpMap");
            AddTextureEntry(m.GetTexture("_EmissionMap"), ctx.entries, ctx.textureSeen, $"{m.name}/_EmissionMap");
        }

        bool addedMaterial = AddMaterialEntry(m, ctx.entries, ctx.materialSeen);
        RegisterShaderUsage(m, ctx.entries, ctx.shaderAggregates, addedMaterial);
    }

    private static void CollectCameras(SnapshotContext ctx)
    {
        var cams = UnityEngine.Object.FindObjectsOfType<Camera>(true);
        for (int i = 0; i < cams.Length; i++)
        {
            ProcessCamera(cams[i], ctx);
        }
    }

    private static IEnumerator CollectCamerasAsync(SnapshotContext ctx, int batchSize)
    {
        var cams = UnityEngine.Object.FindObjectsOfType<Camera>(true);
        int processed = 0;
        for (int i = 0; i < cams.Length; i++)
        {
            ProcessCamera(cams[i], ctx);
            if (++processed >= batchSize)
            {
                processed = 0;
                yield return null;
            }
        }
    }

    private static void ProcessCamera(Camera cam, SnapshotContext ctx)
    {
        if (cam == null) return;
        var rt = cam.targetTexture;
        AddTextureEntry(rt, ctx.entries, ctx.textureSeen, $"{cam.name}.targetTexture");
    }

    private static void CollectRenderTextures(SnapshotContext ctx)
    {
        var allRTs = UnityEngine.Object.FindObjectsOfType<RenderTexture>(true);
        for (int i = 0; i < allRTs.Length; i++)
        {
            AddTextureEntry(allRTs[i], ctx.entries, ctx.textureSeen, "RenderTexture");
        }
    }

    private static IEnumerator CollectRenderTexturesAsync(SnapshotContext ctx, int batchSize)
    {
        var allRTs = UnityEngine.Object.FindObjectsOfType<RenderTexture>(true);
        int processed = 0;
        for (int i = 0; i < allRTs.Length; i++)
        {
            AddTextureEntry(allRTs[i], ctx.entries, ctx.textureSeen, "RenderTexture");
            if (++processed >= batchSize)
            {
                processed = 0;
                yield return null;
            }
        }
    }

    private static void CollectMeshFilters(SnapshotContext ctx)
    {
        var meshFilters = UnityEngine.Object.FindObjectsOfType<MeshFilter>(true);
        for (int i = 0; i < meshFilters.Length; i++)
        {
            AddMeshEntry(meshFilters[i].sharedMesh, ctx.entries, ctx.meshSeen);
        }
    }

    private static IEnumerator CollectMeshFiltersAsync(SnapshotContext ctx, int batchSize)
    {
        var meshFilters = UnityEngine.Object.FindObjectsOfType<MeshFilter>(true);
        int processed = 0;
        for (int i = 0; i < meshFilters.Length; i++)
        {
            AddMeshEntry(meshFilters[i].sharedMesh, ctx.entries, ctx.meshSeen);
            if (++processed >= batchSize)
            {
                processed = 0;
                yield return null;
            }
        }
    }

    private static void CollectSkinnedMeshes(SnapshotContext ctx)
    {
        var skinnedRenderers = UnityEngine.Object.FindObjectsOfType<SkinnedMeshRenderer>(true);
        for (int i = 0; i < skinnedRenderers.Length; i++)
        {
            AddMeshEntry(skinnedRenderers[i].sharedMesh, ctx.entries, ctx.meshSeen);
        }
    }

    private static IEnumerator CollectSkinnedMeshesAsync(SnapshotContext ctx, int batchSize)
    {
        var skinnedRenderers = UnityEngine.Object.FindObjectsOfType<SkinnedMeshRenderer>(true);
        int processed = 0;
        for (int i = 0; i < skinnedRenderers.Length; i++)
        {
            AddMeshEntry(skinnedRenderers[i].sharedMesh, ctx.entries, ctx.meshSeen);
            if (++processed >= batchSize)
            {
                processed = 0;
                yield return null;
            }
        }
    }

    private static void FinalizeShaders(SnapshotContext ctx)
    {
        foreach (var kvp in ctx.shaderAggregates.OrderBy(k => k.Key != null ? k.Key.name : string.Empty, StringComparer.Ordinal))
        {
            AddShaderEntry(kvp.Key, kvp.Value, ctx.entries, ctx.shaderSeen);
        }
    }

    private static IEnumerator FinalizeShadersAsync(SnapshotContext ctx, int batchSize)
    {
        var ordered = ctx.shaderAggregates.OrderBy(k => k.Key != null ? k.Key.name : string.Empty, StringComparer.Ordinal).ToArray();
        int processed = 0;
        for (int i = 0; i < ordered.Length; i++)
        {
            var kvp = ordered[i];
            AddShaderEntry(kvp.Key, kvp.Value, ctx.entries, ctx.shaderSeen);
            if (++processed >= batchSize)
            {
                processed = 0;
                yield return null;
            }
        }
    }

    private static void SortEntries(List<ResourceEntry> list)
    {
        list.Sort((a, b) =>
        {
            var catA = a.category ?? a.type ?? string.Empty;
            var catB = b.category ?? b.type ?? string.Empty;
            int catCompare = string.CompareOrdinal(catA, catB);
            if (catCompare != 0) return catCompare;
            int sizeCompare = b.sizeKB.CompareTo(a.sizeKB);
            if (sizeCompare != 0) return sizeCompare;
            return string.CompareOrdinal(a.name ?? string.Empty, b.name ?? string.Empty);
        });
    }

    // Returns list of ResourceWithTexture containing Texture references for runtime thumbnail extraction
    public static List<ResourceWithTexture> GetSnapshotWithTextures()
    {
        var list = new List<ResourceWithTexture>();
        var seen = new HashSet<int>();

        var renderers = UnityEngine.Object.FindObjectsOfType<Renderer>(true);
        foreach (var r in renderers)
        {
            var mats = r.sharedMaterials;
            if (mats == null) continue;
            foreach (var m in mats)
            {
                if (m == null || m.shader == null) continue;
                int propCount = 0;
                try { propCount = m.shader.GetPropertyCount(); } catch { propCount = 0; }
                if (propCount > 0)
                {
                    for (int i = 0; i < propCount; i++)
                    {
                        try
                        {
                            var propType = m.shader.GetPropertyType(i);
                            if (propType == ShaderPropertyType.Texture)
                            {
                                var propName = m.shader.GetPropertyName(i);
                                var tex = m.GetTexture(propName);
                                AddTextureEntryWithTex(tex, list, seen, $"{m.name}/{propName}");
                            }
                        }
                        catch { }
                    }
                }
                else
                {
                    AddTextureEntryWithTex(m.GetTexture("_MainTex"), list, seen, $"{m.name}/_MainTex");
                    AddTextureEntryWithTex(m.GetTexture("_BaseMap"), list, seen, $"{m.name}/_BaseMap");
                }
            }
        }

        var cams = UnityEngine.Object.FindObjectsOfType<Camera>(true);
        foreach (var c in cams)
        {
            AddTextureEntryWithTex(c.targetTexture, list, seen, $"{c.name}.targetTexture");
        }

        var allRTs = UnityEngine.Object.FindObjectsOfType<RenderTexture>(true);
        foreach (var r in allRTs)
        {
            AddTextureEntryWithTex(r, list, seen, "RenderTexture");
        }

        list.Sort((a, b) => string.CompareOrdinal(a.entry?.name ?? string.Empty, b.entry?.name ?? string.Empty));

        return list;
    }

    private static void AddTextureEntry(Texture tex, List<ResourceEntry> list, HashSet<int> seen, string usage = null)
    {
        if (tex == null) return;
        int id = tex.GetInstanceID();
        if (seen.Contains(id)) return;
        seen.Add(id);
        var entry = BuildTextureEntry(tex, usage);
        if (entry != null)
        {
            list.Add(entry);
        }
    }

    private static void AddTextureEntryWithTex(Texture tex, List<ResourceWithTexture> list, HashSet<int> seen, string usage = null)
    {
        if (tex == null) return;
        int id = tex.GetInstanceID();
        if (seen.Contains(id)) return;
        seen.Add(id);

        var entry = BuildTextureEntry(tex, usage);
        if (entry != null)
        {
            list.Add(new ResourceWithTexture { entry = entry, tex = tex });
        }
    }

    private static bool AddMaterialEntry(Material mat, List<ResourceEntry> list, HashSet<int> seen)
    {
        if (mat == null) return false;
        int id = mat.GetInstanceID();
        if (seen.Contains(id)) return false;
        seen.Add(id);

        int runtimeKB = EstimateMaterialMemoryKB(mat);
        var entry = new ResourceEntry
        {
            id = id.ToString(),
            name = mat.name ?? "<unnamed>",
            type = "Material",
            category = "Material",
            shader = mat.shader ? mat.shader.name : null,
            notes = mat.IsKeywordEnabled("_ALPHATEST_ON") ? "AlphaTest" : null,
            passCount = mat.shader ? SafeGetShaderPassCount(mat.shader) : 0,
            keywordCount = mat.shaderKeywords != null ? mat.shaderKeywords.Length : 0,
            keywords = mat.shaderKeywords != null && mat.shaderKeywords.Length > 0 ? mat.shaderKeywords.ToArray() : null,
            renderQueue = mat.renderQueue.ToString(),
            usage = mat.name
        };

        SetSizeEstimates(entry, runtimeKB);

        list.Add(entry);
        return true;
    }

    private static void AddMeshEntry(Mesh mesh, List<ResourceEntry> list, HashSet<int> seen)
    {
        if (mesh == null) return;
        int id = mesh.GetInstanceID();
        if (seen.Contains(id)) return;
        seen.Add(id);

        bool canAccess = SafeCanAccessMesh(mesh);
        int vertexCount = SafeGetMeshVertexCount(mesh);
        int indexCount = SafeGetMeshIndexCount(mesh);
        int triangleCount = indexCount > 0 ? indexCount / 3 : 0;
        int subMeshCount = SafeGetMeshSubMeshCount(mesh);
        Vector3 boundsSize = SafeGetMeshBoundsSize(mesh);
        int indexElementSize = SafeGetMeshIndexElementSize(mesh);

        long meshBytes = EstimateMeshMemoryBytes(mesh, vertexCount, indexCount, indexElementSize);
        int runtimeKB = BytesToKilobytes(meshBytes);

        var entry = new ResourceEntry
        {
            id = id.ToString(),
            name = mesh.name ?? "<unnamed>",
            type = "Mesh",
            category = "Mesh",
            vertexCount = vertexCount,
            triangleCount = triangleCount,
            subMeshCount = subMeshCount,
            boundsX = boundsSize.x,
            boundsY = boundsSize.y,
            boundsZ = boundsSize.z,
            usage = mesh.name,
            isReadable = canAccess,
            notes = canAccess ? null : "NotReadable"
        };

        SetSizeEstimates(entry, runtimeKB);

        list.Add(entry);
    }

    private static ResourceEntry BuildTextureEntry(Texture tex, string usage)
    {
        if (tex == null) return null;
        var entry = new ResourceEntry();
        int id = tex.GetInstanceID();
        entry.id = id.ToString();
        entry.name = tex.name ?? "<unnamed>";
        entry.type = tex.GetType().Name;
        entry.category = tex is RenderTexture ? "RenderTexture" : "Texture";
        try { entry.width = tex.width; } catch { entry.width = 0; }
        try { entry.height = tex.height; } catch { entry.height = 0; }
        entry.format = GetTextureFormat(tex);
        entry.depth = GetTextureDepth(tex);
        entry.mipCount = GetTextureMips(tex);
        entry.dimension = SafeGetDimension(tex);
        entry.wrapMode = SafeGetWrapMode(tex);
        entry.filterMode = SafeGetFilterMode(tex);
        entry.anisoLevel = SafeGetAnisoLevel(tex);
        entry.isReadable = IsTextureReadable(tex);
        entry.colorSpace = QualitySettings.activeColorSpace.ToString();
        entry.usage = usage;

        long runtimeBytes = RuntimeEstimateMemoryBytes(tex);
        long storageBytes = EstimateTextureStorageBytes(tex);
        int runtimeKB = BytesToKilobytes(runtimeBytes);
        int compressedKB = BytesToKilobytes(storageBytes);
        if (compressedKB <= 0 && runtimeKB > 0)
        {
            compressedKB = runtimeKB;
        }

        SetSizeEstimates(entry, runtimeKB, compressedKB);

        if (tex is RenderTexture rt)
        {
            entry.antiAliasing = rt.antiAliasing;
            entry.depth = rt.depth;
            entry.notes = CombineNotes(usage, rt.graphicsFormat.ToString(), rt.antiAliasing > 1 ? "MSAA" + rt.antiAliasing : null);
        }
        else
        {
            entry.notes = usage;
        }

        return entry;
    }

    private static string CombineNotes(params string[] parts)
    {
        if (parts == null) return null;
        var filtered = parts.Where(p => !string.IsNullOrEmpty(p)).ToArray();
        if (filtered.Length == 0) return null;
        return string.Join(" | ", filtered);
    }

    private static string SafeGetDimension(Texture tex)
    {
        try { return tex.dimension.ToString(); } catch { return null; }
    }

    private static string SafeGetWrapMode(Texture tex)
    {
        try { return tex.wrapMode.ToString(); } catch { return null; }
    }

    private static string SafeGetFilterMode(Texture tex)
    {
        try { return tex.filterMode.ToString(); } catch { return null; }
    }

    private static int SafeGetAnisoLevel(Texture tex)
    {
        try { return tex.anisoLevel; } catch { return 0; }
    }

    private static bool IsTextureReadable(Texture tex)
    {
        try
        {
            if (tex is Texture2D t2) return t2.isReadable;
            if (tex is Texture3D t3) return t3.isReadable;
#if UNITY_2018_2_OR_NEWER
            if (tex is Texture2DArray t2a) return t2a.isReadable;
            if (tex is Cubemap cube) return cube.isReadable;
#endif
        }
        catch { }
        return tex is RenderTexture;
    }

    private static void RegisterShaderUsage(Material mat, List<ResourceEntry> list, Dictionary<Shader, ShaderAggregate> shaderAggregates, bool countMaterial)
    {
        if (mat == null) return;
        var shader = mat.shader;
        if (shader == null) return;

        if (!shaderAggregates.TryGetValue(shader, out var aggregate))
        {
            aggregate = new ShaderAggregate();
            shaderAggregates[shader] = aggregate;
        }

        if (countMaterial)
        {
            aggregate.materialCount++;
        }

        var keywords = FilterKeywords(mat.shaderKeywords);
        foreach (var keyword in keywords)
        {
            aggregate.keywords.Add(keyword);
        }

        var variantKey = BuildVariantKey(shader, keywords);
        if (aggregate.variants.Add(variantKey))
        {
            AddShaderVariantEntry(shader, mat, keywords, list, variantKey);
        }
    }

    private static string[] FilterKeywords(string[] keywords)
    {
        if (keywords == null || keywords.Length == 0) return Array.Empty<string>();
        return keywords.Where(k => !string.IsNullOrEmpty(k)).Distinct(StringComparer.Ordinal).OrderBy(k => k, StringComparer.Ordinal).ToArray();
    }

    private static string BuildVariantKey(Shader shader, string[] keywords)
    {
        var shaderId = shader != null ? shader.GetInstanceID().ToString() : "unknown";
        if (keywords == null || keywords.Length == 0) return shaderId + "::default";
        return shaderId + "::" + string.Join("|", keywords);
    }

    private static void AddShaderEntry(Shader shader, ShaderAggregate aggregate, List<ResourceEntry> list, HashSet<int> seen)
    {
        if (shader == null) return;
        int id = shader.GetInstanceID();
        if (seen.Contains(id)) return;
        seen.Add(id);

        var keywords = aggregate != null ? aggregate.keywords.OrderBy(k => k, StringComparer.Ordinal).ToArray() : Array.Empty<string>();
        int runtimeKB = EstimateShaderMemoryKB(shader, aggregate);
        var entry = new ResourceEntry
        {
            id = id.ToString(),
            name = shader.name ?? "<unnamed>",
            type = "Shader",
            category = "Shader",
            shader = shader.name,
            passCount = SafeGetShaderPassCount(shader),
            keywordCount = keywords.Length,
            keywords = keywords.Length > 0 ? keywords : null,
            variantCount = aggregate != null ? aggregate.variants.Count : 0,
            notes = CombineNotes(aggregate != null && aggregate.materialCount > 0 ? $"Materials×{aggregate.materialCount}" : null, shader.isSupported ? null : "Unsupported"),
            usage = shader.name
        };

        SetSizeEstimates(entry, runtimeKB);

        list.Add(entry);
    }

    private static void AddShaderVariantEntry(Shader shader, Material mat, string[] keywords, List<ResourceEntry> list, string variantKey)
    {
        int runtimeKB = EstimateShaderVariantMemoryKB(mat, keywords != null ? keywords.Length : 0);
        var entry = new ResourceEntry
        {
            id = variantKey,
            name = shader != null ? shader.name : mat != null ? mat.name : "<variant>",
            type = "ShaderVariant",
            category = "ShaderVariant",
            shader = shader != null ? shader.name : null,
            keywordCount = keywords != null ? keywords.Length : 0,
            keywords = keywords != null && keywords.Length > 0 ? keywords : null,
            passCount = shader != null ? SafeGetShaderPassCount(shader) : 0,
            notes = CombineNotes(mat != null ? mat.name : null, keywords != null && keywords.Length > 0 ? string.Join(",", keywords) : "Default"),
            variantId = variantKey,
            usage = mat != null ? mat.name : null
        };

        SetSizeEstimates(entry, runtimeKB);

        list.Add(entry);
    }

    private static int SafeGetShaderPassCount(Shader shader)
    {
        try { return Mathf.Max(0, shader.passCount); } catch { return 0; }
    }

    private static int EstimateShaderMemoryKB(Shader shader, ShaderAggregate aggregate)
    {
        int passCount = SafeGetShaderPassCount(shader);
        int keywordCount = aggregate != null ? aggregate.keywords.Count : 0;
        int variantCount = aggregate != null ? aggregate.variants.Count : 0;
        int estimate = (passCount + 1) * 2 + keywordCount + variantCount * 2;
        return Mathf.Clamp(estimate, 1, 4096);
    }

    private static int EstimateShaderVariantMemoryKB(Material mat, int keywordCount)
    {
        int passCount = 1;
        try { if (mat != null && mat.shader != null) passCount = Mathf.Max(1, mat.shader.passCount); } catch { }
        int estimate = Mathf.Max(1, keywordCount + 1) * passCount;
        return Mathf.Clamp(estimate, 1, 2048);
    }

    private static string GetTextureFormat(Texture tex)
    {
        try
        {
            if (tex is Texture2D t2) return t2.format.ToString();
            if (tex is Texture3D t3) return t3.format.ToString();
            if (tex is Texture2DArray t2a) return t2a.format.ToString();
            if (tex is Cubemap cube) return cube.format.ToString();
            if (tex is RenderTexture rt) return rt.graphicsFormat.ToString();
        }
        catch { }
        return null;
    }

    private static int GetTextureDepth(Texture tex)
    {
        try
        {
            if (tex is RenderTexture rt) return rt.depth;
            if (tex is Texture3D t3) return t3.depth;
        }
        catch { }
        return 0;
    }

    private static int GetTextureMips(Texture tex)
    {
        try
        {
            return tex.mipmapCount;
        }
        catch { }
        return 0;
    }

    private static long RuntimeEstimateMemoryBytes(Texture t)
    {
        try
        {
            int w = t.width;
            int h = t.height;
            int mips = Mathf.Max(1, GetTextureMips(t));
            int bytesPerPixel = 4;
            if (t is Texture2D tex2D)
            {
                bytesPerPixel = GetTextureFormatBytes(tex2D.format);
            }
            else if (t is RenderTexture rt)
            {
                bytesPerPixel = GetGraphicsFormatBytes(rt.graphicsFormat);
            }
            long baseLevel = (long)w * h * Mathf.Max(1, bytesPerPixel);
            return baseLevel * mips;
        }
        catch { return 0; }
    }

    private static long EstimateTextureStorageBytes(Texture tex)
    {
        if (tex == null) return 0;
#if UNITY_EDITOR
        try
        {
            // 通过反射访问 internal 的 TextureUtil
            var textureUtilType = typeof(UnityEditor.Editor).Assembly.GetType("UnityEditor.TextureUtil");
            var method = textureUtilType?.GetMethod("GetStorageMemorySizeLong",
                System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
            if (method != null)
            {
                object result = method.Invoke(null, new object[] { tex });
                if (result is long bytes && bytes > 0)
                    return bytes;
            }
        }
        catch { }
#endif
        return RuntimeEstimateMemoryBytes(tex);
    }

    private static int BytesToKilobytes(long bytes)
    {
        if (bytes <= 0) return 0;
        return Mathf.Max(1, Mathf.RoundToInt(bytes / 1024f));
    }

    private static void SetSizeEstimates(ResourceEntry entry, int runtimeKB, int compressedKB = 0)
    {
        int runtime = Mathf.Max(0, runtimeKB);
        entry.sizeKB = runtime;
        entry.runtimeSizeKB = runtime;

        int compressed = Mathf.Max(0, compressedKB);
        if (compressed > 0)
        {
            entry.compressedSizeKB = compressed;
            entry.sizeAfterCompressionKB = compressed;
        }
        else
        {
            entry.compressedSizeKB = 0;
            entry.sizeAfterCompressionKB = 0;
        }
    }

    private static int GetTextureFormatBytes(TextureFormat format)
    {
        switch (format)
        {
            case TextureFormat.RGBA32:
            case TextureFormat.ARGB32:
            case TextureFormat.BGRA32:
                return 4;
            case TextureFormat.RGB24:
                return 3;
#if UNITY_2020_1_OR_NEWER
            case TextureFormat.RGBAHalf:
                return 8;
            case TextureFormat.RGBAFloat:
                return 16;
#endif
            default:
                return 4;
        }
    }

    private static int GetGraphicsFormatBytes(GraphicsFormat format)
    {
        return (int)GraphicsFormatUtility.GetBlockSize(format);
    }

    private static int EstimateMaterialMemoryKB(Material mat)
    {
        if (mat == null) return 0;
        // Rough estimate: shader constant buffer (2 KB) + keywords (1 KB) + texture references (ignored)
        return 3;
    }

    private static long EstimateMeshMemoryBytes(Mesh mesh, int vertexCount, int indexCount, int indexElementSize)
    {
        if (mesh == null) return 0;
        int channels = 0;

        try
        {
            if (mesh.HasVertexAttribute(VertexAttribute.Position)) channels += 12;
            if (mesh.HasVertexAttribute(VertexAttribute.Normal)) channels += 12;
            if (mesh.HasVertexAttribute(VertexAttribute.Tangent)) channels += 16;
            if (mesh.HasVertexAttribute(VertexAttribute.Color)) channels += 16;
            if (mesh.HasVertexAttribute(VertexAttribute.TexCoord0)) channels += 8;
            if (mesh.HasVertexAttribute(VertexAttribute.TexCoord1)) channels += 8;
            if (mesh.HasVertexAttribute(VertexAttribute.TexCoord2)) channels += 8;
            if (mesh.HasVertexAttribute(VertexAttribute.TexCoord3)) channels += 8;
            if (mesh.HasVertexAttribute(VertexAttribute.TexCoord4)) channels += 8;
            if (mesh.HasVertexAttribute(VertexAttribute.TexCoord5)) channels += 8;
            if (mesh.HasVertexAttribute(VertexAttribute.TexCoord6)) channels += 8;
            if (mesh.HasVertexAttribute(VertexAttribute.TexCoord7)) channels += 8;
            if (mesh.HasVertexAttribute(VertexAttribute.BlendWeight)) channels += 16;
            if (mesh.HasVertexAttribute(VertexAttribute.BlendIndices)) channels += 4;
        }
        catch
        {
            channels = 0;
        }

        long vertexBytes = (long)vertexCount * Mathf.Max(0, channels);
        long indexBytes = (long)Mathf.Max(0, indexCount) * Mathf.Max(2, indexElementSize);

        return vertexBytes + indexBytes;
    }

    private static bool SafeCanAccessMesh(Mesh mesh)
    {
        try
        {
            return mesh.isReadable;
        }
        catch
        {
            return true;
        }
    }

    private static int SafeGetMeshVertexCount(Mesh mesh)
    {
        try { return mesh.vertexCount; }
        catch { return 0; }
    }

    private static int SafeGetMeshSubMeshCount(Mesh mesh)
    {
        try { return mesh.subMeshCount; }
        catch { return 0; }
    }

    private static int SafeGetMeshIndexElementSize(Mesh mesh)
    {
        try
        {
#if UNITY_2017_3_OR_NEWER
            var format = mesh.indexFormat;
            return format == IndexFormat.UInt16 ? 2 : 4;
#else
            return 2;
#endif
        }
        catch
        {
            return 2;
        }
    }

    private static int SafeGetMeshIndexCount(Mesh mesh)
    {
        if (mesh == null) return 0;

#if UNITY_2017_3_OR_NEWER
        try
        {
            int subMeshCount = mesh.subMeshCount;
            if (subMeshCount > 0)
            {
                long total = 0;
                for (int i = 0; i < subMeshCount; i++)
                {
                    total += (long)mesh.GetIndexCount(i);
                }
                if (total > 0)
                {
                    return total > int.MaxValue ? int.MaxValue : (int)total;
                }
            }
        }
        catch
        {
            // fall back to triangles API below
        }
#endif

        try
        {
            var tris = mesh.triangles;
            return tris != null ? tris.Length : 0;
        }
        catch
        {
            return 0;
        }
    }

    private static Vector3 SafeGetMeshBoundsSize(Mesh mesh)
    {
        try { return mesh.bounds.size; }
        catch { return Vector3.zero; }
    }
}
