using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;

// RuntimeResourceCollector: runtime-safe resource snapshot for mobile builds.
// Captures textures, render textures, materials, meshes, shaders and shader variants referenced by active scene content.
public static class RuntimeResourceCollector
{
    public static List<ResourceEntry> GetSnapshot()
    {
        var results = new List<ResourceEntry>();
        var textureSeen = new HashSet<int>();
        var materialSeen = new HashSet<int>();
        var meshSeen = new HashSet<int>();
        var shaderSeen = new HashSet<int>();
        var shaderVariantSeen = new HashSet<string>();

        var renderers = UnityEngine.Object.FindObjectsOfType<Renderer>(true);
        foreach (var renderer in renderers)
        {
            var materials = renderer.sharedMaterials;
            if (materials == null) continue;
            foreach (var material in materials)
            {
                if (material == null) continue;
                AddMaterialEntry(material, results, materialSeen, shaderSeen, shaderVariantSeen, renderer);
                CollectMaterialTextures(material, results, textureSeen);
            }
        }

        var cameras = UnityEngine.Object.FindObjectsOfType<Camera>(true);
        foreach (var camera in cameras)
        {
            AddTextureEntry(camera.targetTexture, results, textureSeen, $"{camera.name}.targetTexture");
        }

        var renderTextures = UnityEngine.Object.FindObjectsOfType<RenderTexture>(true);
        foreach (var rt in renderTextures)
        {
            AddTextureEntry(rt, results, textureSeen, "RenderTexture");
        }

        var meshFilters = UnityEngine.Object.FindObjectsOfType<MeshFilter>(true);
        foreach (var meshFilter in meshFilters)
        {
            AddMeshEntry(meshFilter.sharedMesh, results, meshSeen);
        }

        var skinnedRenderers = UnityEngine.Object.FindObjectsOfType<SkinnedMeshRenderer>(true);
        foreach (var skinned in skinnedRenderers)
        {
            AddMeshEntry(skinned.sharedMesh, results, meshSeen);
        }

        return results;
    }

    // Returns list of ResourceWithTexture containing Texture references for runtime thumbnail extraction
    public static List<ResourceWithTexture> GetSnapshotWithTextures()
    {
        var results = new List<ResourceWithTexture>();
        var textureSeen = new HashSet<int>();

        var renderers = UnityEngine.Object.FindObjectsOfType<Renderer>(true);
        foreach (var renderer in renderers)
        {
            var materials = renderer.sharedMaterials;
            if (materials == null) continue;
            foreach (var material in materials)
            {
                if (material == null) continue;
                CollectMaterialTexturesWithHandles(material, results, textureSeen);
            }
        }

        var cameras = UnityEngine.Object.FindObjectsOfType<Camera>(true);
        foreach (var camera in cameras)
        {
            AddTextureEntryWithTex(camera.targetTexture, results, textureSeen, $"{camera.name}.targetTexture");
        }

        var renderTextures = UnityEngine.Object.FindObjectsOfType<RenderTexture>(true);
        foreach (var rt in renderTextures)
        {
            AddTextureEntryWithTex(rt, results, textureSeen, "RenderTexture");
        }

        return results;
    }

    private static void CollectMaterialTextures(Material material, List<ResourceEntry> list, HashSet<int> seen, string note = null)
    {
        if (material == null) return;
        var shader = material.shader;
        var usedProperty = false;
        int propertyCount = 0;
        try { propertyCount = shader != null ? shader.GetPropertyCount() : 0; }
        catch { propertyCount = 0; }

        if (propertyCount > 0)
        {
            for (int i = 0; i < propertyCount; i++)
            {
                try
                {
                    if (shader.GetPropertyType(i) != ShaderPropertyType.Texture) continue;
                    var propertyName = shader.GetPropertyName(i);
                    Texture tex = null;
                    try { tex = material.GetTexture(propertyName); }
                    catch { tex = null; }
                    if (tex != null)
                    {
                        AddTextureEntry(tex, list, seen, $"{material.name}/{propertyName}");
                        usedProperty = true;
                    }
                }
                catch { }
            }
        }

        if (!usedProperty)
        {
            AddTextureEntry(material.GetTexture("_MainTex"), list, seen, $"{material.name}/_MainTex");
            AddTextureEntry(material.GetTexture("_BaseMap"), list, seen, $"{material.name}/_BaseMap");
            AddTextureEntry(material.GetTexture("_BumpMap"), list, seen, $"{material.name}/_BumpMap");
            AddTextureEntry(material.GetTexture("_EmissionMap"), list, seen, $"{material.name}/_EmissionMap");
        }
    }

    private static void CollectMaterialTexturesWithHandles(Material material, List<ResourceWithTexture> list, HashSet<int> seen)
    {
        if (material == null) return;
        var shader = material.shader;
        var usedProperty = false;
        int propertyCount = 0;
        try { propertyCount = shader != null ? shader.GetPropertyCount() : 0; }
        catch { propertyCount = 0; }

        if (propertyCount > 0)
        {
            for (int i = 0; i < propertyCount; i++)
            {
                try
                {
                    if (shader.GetPropertyType(i) != ShaderPropertyType.Texture) continue;
                    var propertyName = shader.GetPropertyName(i);
                    Texture tex = null;
                    try { tex = material.GetTexture(propertyName); }
                    catch { tex = null; }
                    if (tex != null)
                    {
                        AddTextureEntryWithTex(tex, list, seen, $"{material.name}/{propertyName}");
                        usedProperty = true;
                    }
                }
                catch { }
            }
        }

        if (!usedProperty)
        {
            AddTextureEntryWithTex(material.GetTexture("_MainTex"), list, seen, $"{material.name}/_MainTex");
            AddTextureEntryWithTex(material.GetTexture("_BaseMap"), list, seen, $"{material.name}/_BaseMap");
        }
    }

    private static void AddTextureEntry(Texture tex, List<ResourceEntry> list, HashSet<int> seen, string note = null)
    {
        if (tex == null) return;
        int id = tex.GetInstanceID();
        if (!seen.Add(id)) return;

        var entry = CreateTextureEntry(tex, note);
        if (entry != null)
        {
            list.Add(entry);
        }
    }

    private static void AddTextureEntryWithTex(Texture tex, List<ResourceWithTexture> list, HashSet<int> seen, string note = null)
    {
        if (tex == null) return;
        int id = tex.GetInstanceID();
        if (!seen.Add(id)) return;

        var entry = CreateTextureEntry(tex, note);
        if (entry != null)
        {
            list.Add(new ResourceWithTexture { entry = entry, tex = tex });
        }
    }

    private static ResourceEntry CreateTextureEntry(Texture tex, string note)
    {
        if (tex == null) return null;

        var entry = new ResourceEntry();
        entry.id = tex.GetInstanceID().ToString();
        entry.name = string.IsNullOrEmpty(tex.name) ? "<unnamed>" : tex.name;
        entry.type = tex.GetType().Name;
        entry.category = tex is RenderTexture ? "RenderTexture" : "Texture";
        try { entry.width = tex.width; } catch { entry.width = 0; }
        try { entry.height = tex.height; } catch { entry.height = 0; }
        entry.format = GetTextureFormat(tex);
        entry.depth = GetTextureDepth(tex);
        entry.mipCount = GetTextureMips(tex);
        try { entry.sizeKB = (int)(RuntimeEstimateMemoryBytes(tex) / 1024); } catch { entry.sizeKB = 0; }
        entry.notes = note;
        entry.dimension = GetTextureDimension(tex);
        entry.filterMode = GetTextureFilterMode(tex);
        entry.wrapMode = GetTextureWrapMode(tex);
        entry.colorSpace = GetTextureColorSpace(tex);
        entry.metrics = FinalizeMetrics(BuildTextureMetrics(tex, entry));
        return entry;
    }

    private static void AddMaterialEntry(Material mat, List<ResourceEntry> list, HashSet<int> seenMaterials, HashSet<int> seenShaders, HashSet<string> seenVariants, Renderer owner)
    {
        if (mat == null) return;
        int id = mat.GetInstanceID();
        var keywords = SafeKeywords(mat);

        if (seenMaterials.Add(id))
        {
            var entry = new ResourceEntry
            {
                id = id.ToString(),
                name = string.IsNullOrEmpty(mat.name) ? "<unnamed>" : mat.name,
                type = "Material",
                category = "Material",
                shader = mat.shader ? mat.shader.name : null,
                notes = owner ? owner.name : null,
                sizeKB = EstimateMaterialMemoryKB(mat),
                keywords = keywords,
                metrics = FinalizeMetrics(BuildMaterialMetrics(mat))
            };
            list.Add(entry);
        }

        AddShaderEntry(mat.shader, mat, list, seenShaders);
        AddShaderVariantEntry(mat, mat.shader, keywords, list, seenVariants);
    }

    private static void AddShaderEntry(Shader shader, Material owner, List<ResourceEntry> list, HashSet<int> seenShaders)
    {
        if (shader == null) return;
        int id = shader.GetInstanceID();
        if (!seenShaders.Add(id)) return;

        var metrics = new List<ResourceMetric>();
        AddMetric(metrics, "Passes", SafeToString(() => shader.passCount));
        AddMetric(metrics, "LOD", SafeToString(() => shader.maximumLOD));
        AddMetric(metrics, "Supported", shader.isSupported ? "Yes" : "No");

        var entry = new ResourceEntry
        {
            id = id.ToString(),
            name = string.IsNullOrEmpty(shader.name) ? "<unnamed>" : shader.name,
            type = "Shader",
            category = "Shader",
            shader = shader.name,
            notes = owner ? owner.name : null,
            metrics = FinalizeMetrics(metrics)
        };

        list.Add(entry);
    }

    private static void AddShaderVariantEntry(Material material, Shader shader, string[] keywords, List<ResourceEntry> list, HashSet<string> seenVariants)
    {
        if (material == null || shader == null) return;
        if (keywords == null || keywords.Length == 0) return;

        var variantKey = shader.GetInstanceID() + ":" + string.Join("|", keywords);
        if (!seenVariants.Add(variantKey)) return;

        var metrics = new List<ResourceMetric>();
        AddMetric(metrics, "Keywords", string.Join(", ", keywords));
        AddMetric(metrics, "RenderQueue", material.renderQueue.ToString());
        AddMetric(metrics, "Instancing", material.enableInstancing ? "On" : "Off");

        var entry = new ResourceEntry
        {
            id = variantKey,
            name = $"{shader.name} [{string.Join(", ", keywords)}]",
            type = "ShaderVariant",
            category = "ShaderVariant",
            shader = shader.name,
            notes = material.name,
            keywords = keywords,
            parentId = shader.GetInstanceID().ToString(),
            variantKey = variantKey,
            metrics = FinalizeMetrics(metrics)
        };

        list.Add(entry);
    }

    private static void AddMeshEntry(Mesh mesh, List<ResourceEntry> list, HashSet<int> seen)
    {
        if (mesh == null) return;
        int id = mesh.GetInstanceID();
        if (!seen.Add(id)) return;

        var entry = new ResourceEntry
        {
            id = id.ToString(),
            name = string.IsNullOrEmpty(mesh.name) ? "<unnamed>" : mesh.name,
            type = "Mesh",
            category = "Mesh",
            vertexCount = mesh.vertexCount,
            triangleCount = mesh.triangles != null ? mesh.triangles.Length / 3 : 0,
            sizeKB = (int)(EstimateMeshMemoryBytes(mesh) / 1024),
            subMeshCount = mesh.subMeshCount,
            metrics = FinalizeMetrics(BuildMeshMetrics(mesh))
        };

        list.Add(entry);
    }

    private static List<ResourceMetric> BuildTextureMetrics(Texture tex, ResourceEntry entry)
    {
        var metrics = new List<ResourceMetric>();
        if (entry != null)
        {
            AddMetric(metrics, "Size", entry.sizeKB > 0 ? entry.sizeKB + " KB" : null);
            AddMetric(metrics, "MipCount", entry.mipCount > 0 ? entry.mipCount.ToString() : null);
        }
        AddMetric(metrics, "Aniso", SafeToString(() => tex.anisoLevel));
        AddMetric(metrics, "Wrap", entry?.wrapMode);
        AddMetric(metrics, "Filter", entry?.filterMode);

        if (tex is Texture2D tex2D)
        {
            AddMetric(metrics, "Readable", tex2D.isReadable ? "Yes" : "No");
            AddMetric(metrics, "Alpha", tex2D.alphaIsTransparency ? "Yes" : "No");
        }
        else if (tex is Texture3D tex3D)
        {
            AddMetric(metrics, "Depth", tex3D.depth.ToString());
        }
        else if (tex is Texture2DArray tex2DArray)
        {
            AddMetric(metrics, "Slices", tex2DArray.depth.ToString());
        }
        else if (tex is Cubemap)
        {
            AddMetric(metrics, "Cube", "Yes");
        }
        else if (tex is RenderTexture renderTexture)
        {
            AddMetric(metrics, "AA", SafeToString(() => renderTexture.antiAliasing));
            AddMetric(metrics, "Memory", entry != null && entry.sizeKB > 0 ? entry.sizeKB + " KB" : null);
            AddMetric(metrics, "VolumeDepth", SafeToString(() => renderTexture.volumeDepth));
        }

        return metrics;
    }

    private static List<ResourceMetric> BuildMaterialMetrics(Material material)
    {
        var metrics = new List<ResourceMetric>();
        AddMetric(metrics, "RenderQueue", material.renderQueue.ToString());
        AddMetric(metrics, "Passes", SafeToString(() => material.passCount));
        AddMetric(metrics, "Instancing", material.enableInstancing ? "On" : "Off");
        AddMetric(metrics, "DoubleSidedGI", material.doubleSidedGI ? "Yes" : "No");
        return metrics;
    }

    private static List<ResourceMetric> BuildMeshMetrics(Mesh mesh)
    {
        var metrics = new List<ResourceMetric>();
        AddMetric(metrics, "Readable", mesh.isReadable ? "Yes" : "No");
        AddMetric(metrics, "SubMeshes", mesh.subMeshCount.ToString());
        AddMetric(metrics, "UV Channels", CountUvChannels(mesh).ToString());
        AddMetric(metrics, "BlendShapes", SafeToString(() => mesh.blendShapeCount));
        AddMetric(metrics, "Bounds", FormatBounds(mesh.bounds));
        return metrics;
    }

    private static int CountUvChannels(Mesh mesh)
    {
        int count = 0;
        if (mesh.HasVertexAttribute(VertexAttribute.TexCoord0)) count++;
        if (mesh.HasVertexAttribute(VertexAttribute.TexCoord1)) count++;
        if (mesh.HasVertexAttribute(VertexAttribute.TexCoord2)) count++;
        if (mesh.HasVertexAttribute(VertexAttribute.TexCoord3)) count++;
        if (mesh.HasVertexAttribute(VertexAttribute.TexCoord4)) count++;
        if (mesh.HasVertexAttribute(VertexAttribute.TexCoord5)) count++;
        if (mesh.HasVertexAttribute(VertexAttribute.TexCoord6)) count++;
        if (mesh.HasVertexAttribute(VertexAttribute.TexCoord7)) count++;
        return count;
    }

    private static string FormatBounds(Bounds bounds)
    {
        return $"C({bounds.center.x:F2},{bounds.center.y:F2},{bounds.center.z:F2}) S({bounds.size.x:F2},{bounds.size.y:F2},{bounds.size.z:F2})";
    }

    private static string[] SafeKeywords(Material material)
    {
        try
        {
            var raw = material.shaderKeywords;
            if (raw == null || raw.Length == 0) return null;
            var list = new List<string>();
            foreach (var kw in raw)
            {
                if (string.IsNullOrEmpty(kw)) continue;
                list.Add(kw);
            }
            if (list.Count == 0) return null;
            list.Sort(StringComparer.Ordinal);
            return list.ToArray();
        }
        catch
        {
            return null;
        }
    }

    private static void AddMetric(List<ResourceMetric> metrics, string label, string value)
    {
        if (metrics == null) return;
        if (string.IsNullOrEmpty(label)) return;
        if (string.IsNullOrEmpty(value)) return;
        metrics.Add(new ResourceMetric { label = label, value = value });
    }

    private static string SafeToString(Func<int> getter)
    {
        try { return getter().ToString(); }
        catch { return null; }
    }

    private static string SafeToString(Func<float> getter)
    {
        try { return getter().ToString("F2"); }
        catch { return null; }
    }

    private static ResourceMetric[] FinalizeMetrics(List<ResourceMetric> metrics)
    {
        if (metrics == null || metrics.Count == 0) return null;
        return metrics.ToArray();
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

    private static string GetTextureDimension(Texture tex)
    {
        try { return tex.dimension.ToString(); }
        catch { return null; }
    }

    private static string GetTextureFilterMode(Texture tex)
    {
        try { return tex.filterMode.ToString(); }
        catch { return null; }
    }

    private static string GetTextureWrapMode(Texture tex)
    {
        try
        {
            if (tex is Texture2D tex2D)
            {
                return $"{tex2D.wrapModeU}/{tex2D.wrapModeV}";
            }
            return tex.wrapMode.ToString();
        }
        catch { return null; }
    }

    private static string GetTextureColorSpace(Texture tex)
    {
        try { return tex.activeTextureColorSpace.ToString(); }
        catch { return null; }
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
        return GraphicsFormatUtility.GetBlockSize(format);
    }

    private static int EstimateMaterialMemoryKB(Material mat)
    {
        if (mat == null) return 0;
        int keywordCost = 0;
        try
        {
            keywordCost = mat.shaderKeywords != null ? mat.shaderKeywords.Length : 0;
        }
        catch { keywordCost = 0; }

        return 3 + keywordCost;
    }

    private static long EstimateMeshMemoryBytes(Mesh mesh)
    {
        if (mesh == null) return 0;
        int vertexCount = mesh.vertexCount;
        int channels = 0;
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

        long vertexBytes = (long)vertexCount * Mathf.Max(0, channels);
        long indexBytes = 0;
        try
        {
            var indices = mesh.triangles;
            indexBytes = (long)indices.Length * (mesh.indexFormat == IndexFormat.UInt16 ? 2 : 4);
        }
        catch { }

        return vertexBytes + indexBytes;
    }
}
