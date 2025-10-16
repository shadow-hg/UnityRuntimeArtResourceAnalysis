using System.Collections.Generic;
using UnityEngine;

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
                            if (propType == UnityEngine.ShaderPropertyType.Texture)
                            {
                                var propName = m.shader.GetPropertyName(i);
                                var tex = m.GetTexture(propName);
                                AddTextureEntry(tex, list, seen);
                            }
                        }
                        catch { }
                    }
                }
                else
                {
                    // fallback common names
                    AddTextureEntry(m.GetTexture("_MainTex"), list, seen);
                    AddTextureEntry(m.GetTexture("_BaseMap"), list, seen);
                    AddTextureEntry(m.GetTexture("_BumpMap"), list, seen);
                    AddTextureEntry(m.GetTexture("_EmissionMap"), list, seen);
                }
            }
        }

        // Cameras target RenderTexture
        var cams = Object.FindObjectsOfType<Camera>(true);
        foreach (var c in cams)
        {
            var rt = c.targetTexture;
            AddTextureEntry(rt, list, seen);
        }

        // Optionally, include any loaded RenderTextures (may include temporary RTs)
        var allRTs = Object.FindObjectsOfType<RenderTexture>(true);
        foreach (var r in allRTs)
        {
            AddTextureEntry(r, list, seen);
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
                            if (propType == UnityEngine.ShaderPropertyType.Texture)
                            {
                                var propName = m.shader.GetPropertyName(i);
                                var tex = m.GetTexture(propName);
                                AddTextureEntryWithTex(tex, list, seen);
                            }
                        }
                        catch { }
                    }
                }
                else
                {
                    AddTextureEntryWithTex(m.GetTexture("_MainTex"), list, seen);
                    AddTextureEntryWithTex(m.GetTexture("_BaseMap"), list, seen);
                }
            }
        }

        var cams = Object.FindObjectsOfType<Camera>(true);
        foreach (var c in cams)
        {
            AddTextureEntryWithTex(c.targetTexture, list, seen);
        }

        var allRTs = Object.FindObjectsOfType<RenderTexture>(true);
        foreach (var r in allRTs)
        {
            AddTextureEntryWithTex(r, list, seen);
        }

        return list;
    }

    private static void AddTextureEntry(Texture tex, List<ResourceEntry> list, HashSet<int> seen)
    {
        if (tex == null) return;
        int id = tex.GetInstanceID();
        if (seen.Contains(id)) return;
        seen.Add(id);
        var entry = new ResourceEntry();
        entry.id = id.ToString();
        entry.name = tex.name ?? "<unnamed>";
        entry.type = tex.GetType().Name;
        try { entry.width = tex.width; } catch { entry.width = 0; }
        try { entry.height = tex.height; } catch { entry.height = 0; }
        try { entry.sizeKB = (int)(RuntimeEstimateMemoryBytes(tex) / 1024); } catch { entry.sizeKB = 0; }
        list.Add(entry);
    }

    private static void AddTextureEntryWithTex(Texture tex, List<ResourceWithTexture> list, HashSet<int> seen)
    {
        if (tex == null) return;
        int id = tex.GetInstanceID();
        if (seen.Contains(id)) return;
        seen.Add(id);

        var entry = new ResourceEntry();
        entry.id = id.ToString();
        entry.name = tex.name ?? "<unnamed>";
        entry.type = tex.GetType().Name;
        try { entry.width = tex.width; } catch { entry.width = 0; }
        try { entry.height = tex.height; } catch { entry.height = 0; }
        try { entry.sizeKB = (int)(RuntimeEstimateMemoryBytes(tex) / 1024); } catch { entry.sizeKB = 0; }

        list.Add(new ResourceWithTexture { entry = entry, tex = tex });
    }

    private static long RuntimeEstimateMemoryBytes(Texture t)
    {
        try
        {
            int w = t.width;
            int h = t.height;
            return (long)w * h * 4; // rough 4 bytes per pixel
        }
        catch { return 0; }
    }
}
