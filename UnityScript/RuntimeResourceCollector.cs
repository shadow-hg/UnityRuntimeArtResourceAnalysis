using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;

// RuntimeResourceCollector: lightweight, runtime-safe resource snapshot for mobile builds.
// It collects textures referenced by active Renderers' materials and active Cameras' target RenderTextures.
public static class RuntimeResourceCollector
{
    public static List<ResourceEntry> GetSnapshot()
    {
        var list = new List<ResourceEntry>();
        var seen = new HashSet<int>();

        // Collect from Renderers' materials
        var renderers = Object.FindObjectsOfType<Renderer>(true);
        foreach (var r in renderers)
        {
            var mats = r.sharedMaterials;
            if (mats == null) continue;
            foreach (var m in mats)
            {
                if (m == null || m.shader == null) continue;
                // try iterate shader properties if available
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
                                AddTextureEntry(tex, list, seen, $"{m.name}/{propName}");
                            }
                        }
                        catch { }
                    }
                }
                else
                {
                    // fallback common names
                    AddTextureEntry(m.GetTexture("_MainTex"), list, seen, $"{m.name}/_MainTex");
                    AddTextureEntry(m.GetTexture("_BaseMap"), list, seen, $"{m.name}/_BaseMap");
                    AddTextureEntry(m.GetTexture("_BumpMap"), list, seen, $"{m.name}/_BumpMap");
                    AddTextureEntry(m.GetTexture("_EmissionMap"), list, seen, $"{m.name}/_EmissionMap");
                }
            }
        }

        // Cameras target RenderTexture
        var cams = Object.FindObjectsOfType<Camera>(true);
        foreach (var c in cams)
        {
            var rt = c.targetTexture;
            AddTextureEntry(rt, list, seen, $"{c.name}.targetTexture");
        }

        // Optionally, include any loaded RenderTextures (may include temporary RTs)
        var allRTs = Object.FindObjectsOfType<RenderTexture>(true);
        foreach (var r in allRTs)
        {
            AddTextureEntry(r, list, seen, "RenderTexture");
        }

        // Materials referenced by renderers
        foreach (var renderer in renderers)
        {
            var mats = renderer.sharedMaterials;
            if (mats == null) continue;
            foreach (var mat in mats)
            {
                AddMaterialEntry(mat, list, seen);
            }
        }

        // Meshes referenced by MeshFilter / SkinnedMeshRenderer
        var meshFilters = Object.FindObjectsOfType<MeshFilter>(true);
        foreach (var mf in meshFilters)
        {
            AddMeshEntry(mf.sharedMesh, list, seen);
        }

        var skinnedRenderers = Object.FindObjectsOfType<SkinnedMeshRenderer>(true);
        foreach (var smr in skinnedRenderers)
        {
            AddMeshEntry(smr.sharedMesh, list, seen);
        }

        return list;
    }

    // Returns list of ResourceWithTexture containing Texture references for runtime thumbnail extraction
    public static List<ResourceWithTexture> GetSnapshotWithTextures()
    {
        var list = new List<ResourceWithTexture>();
        var seen = new HashSet<int>();

        var renderers = Object.FindObjectsOfType<Renderer>(true);
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

        var cams = Object.FindObjectsOfType<Camera>(true);
        foreach (var c in cams)
        {
            AddTextureEntryWithTex(c.targetTexture, list, seen, $"{c.name}.targetTexture");
        }

        var allRTs = Object.FindObjectsOfType<RenderTexture>(true);
        foreach (var r in allRTs)
        {
            AddTextureEntryWithTex(r, list, seen, "RenderTexture");
        }

        return list;
    }

    private static void AddTextureEntry(Texture tex, List<ResourceEntry> list, HashSet<int> seen, string note = null)
    {
        if (tex == null) return;
        int id = tex.GetInstanceID();
        if (seen.Contains(id)) return;
        seen.Add(id);
        var entry = new ResourceEntry();
        entry.id = id.ToString();
        entry.name = tex.name ?? "<unnamed>";
        entry.type = tex.GetType().Name;
        entry.category = tex is RenderTexture ? "RenderTexture" : "Texture";
        try { entry.width = tex.width; } catch { entry.width = 0; }
        try { entry.height = tex.height; } catch { entry.height = 0; }
        entry.format = GetTextureFormat(tex);
        entry.depth = GetTextureDepth(tex);
        entry.mipCount = GetTextureMips(tex);
        try { entry.sizeKB = (int)(RuntimeEstimateMemoryBytes(tex) / 1024); } catch { entry.sizeKB = 0; }
        entry.notes = note;
        list.Add(entry);
    }

    private static void AddTextureEntryWithTex(Texture tex, List<ResourceWithTexture> list, HashSet<int> seen, string note = null)
    {
        if (tex == null) return;
        int id = tex.GetInstanceID();
        if (seen.Contains(id)) return;
        seen.Add(id);

        var entry = new ResourceEntry();
        entry.id = id.ToString();
        entry.name = tex.name ?? "<unnamed>";
        entry.type = tex.GetType().Name;
        entry.category = tex is RenderTexture ? "RenderTexture" : "Texture";
        try { entry.width = tex.width; } catch { entry.width = 0; }
        try { entry.height = tex.height; } catch { entry.height = 0; }
        entry.format = GetTextureFormat(tex);
        entry.depth = GetTextureDepth(tex);
        entry.mipCount = GetTextureMips(tex);
        try { entry.sizeKB = (int)(RuntimeEstimateMemoryBytes(tex) / 1024); } catch { entry.sizeKB = 0; }
        entry.notes = note;

        list.Add(new ResourceWithTexture { entry = entry, tex = tex });
    }

    private static void AddMaterialEntry(Material mat, List<ResourceEntry> list, HashSet<int> seen)
    {
        if (mat == null) return;
        int id = mat.GetInstanceID();
        if (seen.Contains(id)) return;
        seen.Add(id);

        var entry = new ResourceEntry
        {
            id = id.ToString(),
            name = mat.name ?? "<unnamed>",
            type = "Material",
            category = "Material",
            shader = mat.shader ? mat.shader.name : null,
            notes = mat.IsKeywordEnabled("_ALPHATEST_ON") ? "AlphaTest" : null,
            sizeKB = EstimateMaterialMemoryKB(mat)
        };

        list.Add(entry);
    }

    private static void AddMeshEntry(Mesh mesh, List<ResourceEntry> list, HashSet<int> seen)
    {
        if (mesh == null) return;
        int id = mesh.GetInstanceID();
        if (seen.Contains(id)) return;
        seen.Add(id);

        var entry = new ResourceEntry
        {
            id = id.ToString(),
            name = mesh.name ?? "<unnamed>",
            type = "Mesh",
            category = "Mesh",
            vertexCount = mesh.vertexCount,
            triangleCount = mesh.triangles != null ? mesh.triangles.Length / 3 : 0,
            sizeKB = (int)(EstimateMeshMemoryBytes(mesh) / 1024)
        };

        list.Add(entry);
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
        // Rough estimate: shader constant buffer (2 KB) + keywords (1 KB) + texture references (ignored)
        return 3;
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
            indexBytes = (long)indices.Length * (mesh.indexFormat == UnityEngine.Rendering.IndexFormat.UInt16 ? 2 : 4);
        }
        catch { }

        return vertexBytes + indexBytes;
    }
}
