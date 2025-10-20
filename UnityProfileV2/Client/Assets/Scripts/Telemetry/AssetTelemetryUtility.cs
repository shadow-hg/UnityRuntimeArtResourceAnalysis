using System;
using System.Linq;
using UnityEngine;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace UnityProfileV2.Telemetry
{
    public static class AssetTelemetryUtility
    {
        public static TelemetrySnapshot CreateSnapshot(int maxAssetsPerCategory)
        {
            var textures = Resources.FindObjectsOfTypeAll<Texture>()
                .Where(t => !(t is Texture2D tex && tex.hideFlags.HasFlag(HideFlags.DontSave)))
                .Select(TextureInfo.FromTexture)
                .Where(info => info.IsValid)
                .OrderByDescending(info => info.EstimatedBytes)
                .Take(maxAssetsPerCategory)
                .ToArray();

            var meshes = Resources.FindObjectsOfTypeAll<Mesh>()
                .Select(MeshInfo.FromMesh)
                .Where(info => info.IsValid)
                .OrderByDescending(info => info.EstimatedBytes)
                .Take(maxAssetsPerCategory)
                .ToArray();

            var shaders = Resources.FindObjectsOfTypeAll<Shader>()
                .Select(ShaderInfo.FromShader)
                .Where(info => info.IsValid)
                .Take(maxAssetsPerCategory)
                .ToArray();

            return new TelemetrySnapshot
            {
                textures = textures,
                meshes = meshes,
                shaders = shaders,
                totalTextureBytes = textures.Sum(t => t.EstimatedBytes),
                totalMeshBytes = meshes.Sum(m => m.EstimatedBytes)
            };
        }

        internal static string GetAssetPath(UnityEngine.Object obj)
        {
#if UNITY_EDITOR
            return AssetDatabase.GetAssetPath(obj);
#else
            return string.Empty;
#endif
        }

        internal static long GetTextureOriginalBytes(Texture2D tex)
        {
#if UNITY_EDITOR
            if (tex == null) return 0;
            var bitsPerPixel = TextureUtil.GetBitsPerPixel(tex.format);
            return (long)(tex.width * tex.height * bitsPerPixel / 8f);
#else
            return 0;
#endif
        }
    }

    [Serializable]
    public class TelemetrySnapshot
    {
        public string timestampUtc;
        public int frameNumber;
        public float fps;
        public float deltaTime;
        public long totalTextureBytes;
        public long totalMeshBytes;
        public TextureInfo[] textures = Array.Empty<TextureInfo>();
        public MeshInfo[] meshes = Array.Empty<MeshInfo>();
        public ShaderInfo[] shaders = Array.Empty<ShaderInfo>();
    }

    [Serializable]
    public struct TextureInfo
    {
        public string name;
        public string path;
        public int width;
        public int height;
        public TextureFormat format;
        public TextureWrapMode wrapMode;
        public FilterMode filterMode;
        public long originalBytes;
        public long EstimatedBytes;
        public bool IsValid => width > 0 && height > 0;

        public static TextureInfo FromTexture(Texture texture)
        {
            var tex2D = texture as Texture2D;
            return new TextureInfo
            {
                name = texture.name,
                path = AssetTelemetryUtility.GetAssetPath(texture),
                width = texture.width,
                height = texture.height,
                wrapMode = texture.wrapMode,
                filterMode = texture.filterMode,
                format = tex2D != null ? tex2D.format : TextureFormat.RGBA32,
                originalBytes = AssetTelemetryUtility.GetTextureOriginalBytes(tex2D),
                EstimatedBytes = UnityEngine.Profiling.Profiler.GetRuntimeMemorySizeLong(texture)
            };
        }
    }

    [Serializable]
    public struct MeshInfo
    {
        public string name;
        public string path;
        public int vertexCount;
        public int subMeshCount;
        public long EstimatedBytes;
        public bool IsValid => vertexCount > 0;

        public static MeshInfo FromMesh(Mesh mesh)
        {
            return new MeshInfo
            {
                name = mesh.name,
                path = AssetTelemetryUtility.GetAssetPath(mesh),
                vertexCount = mesh.vertexCount,
                subMeshCount = mesh.subMeshCount,
                EstimatedBytes = UnityEngine.Profiling.Profiler.GetRuntimeMemorySizeLong(mesh)
            };
        }
    }

    [Serializable]
    public struct ShaderInfo
    {
        public string name;
        public string path;
        public int passCount;
        public string[] keywords;
        public bool IsValid => !string.IsNullOrEmpty(name);

        public static ShaderInfo FromShader(Shader shader)
        {
            return new ShaderInfo
            {
                name = shader.name,
                path = AssetTelemetryUtility.GetAssetPath(shader),
                passCount = shader.passCount,
                keywords = shader.keywordSpace.GetKeywords()
            };
        }
    }
}
