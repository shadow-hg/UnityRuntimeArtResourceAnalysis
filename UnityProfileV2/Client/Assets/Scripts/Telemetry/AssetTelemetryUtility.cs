using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
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
            var bitsPerPixel = EstimateBitsPerPixel(tex.format);
            return (long)(tex.width * tex.height * bitsPerPixel / 8f);
#else
            return 0;
#endif
        }

#if UNITY_EDITOR
        private static readonly Dictionary<TextureFormat, int> TextureFormatBits = new()
        {
            { TextureFormat.Alpha8, 8 },
            { TextureFormat.R8, 8 },
            { TextureFormat.R16, 16 },
            { TextureFormat.RGB24, 24 },
            { TextureFormat.RGBA32, 32 },
            { TextureFormat.ARGB32, 32 },
            { TextureFormat.BGRA32, 32 },
            { TextureFormat.RG16, 16 },
            { TextureFormat.RG32, 32 },
            { TextureFormat.RGBA4444, 16 },
            { TextureFormat.RGB565, 16 },
            { TextureFormat.RGFloat, 64 },
            { TextureFormat.RGHalf, 32 },
            { TextureFormat.RFloat, 32 },
            { TextureFormat.RHalf, 16 },
            { TextureFormat.RGBAFloat, 128 },
            { TextureFormat.RGBAHalf, 64 },
            { TextureFormat.BC4, 4 },
            { TextureFormat.BC5, 8 },
            { TextureFormat.BC6H, 8 },
            { TextureFormat.BC7, 8 },
            { TextureFormat.DXT1, 4 },
            { TextureFormat.DXT1Crunched, 4 },
            { TextureFormat.DXT5, 8 },
            { TextureFormat.DXT5Crunched, 8 },
            { TextureFormat.ETC_RGB4, 4 },
            { TextureFormat.ETC_RGB4Crunched, 4 },
            { TextureFormat.ETC2_RGBA8, 8 },
            { TextureFormat.ETC2_RGB, 4 },
            { TextureFormat.ETC2_RGBA1, 4 },
            { TextureFormat.ASTC_4x4, 8 },
            { TextureFormat.ASTC_5x5, 5 },
            { TextureFormat.ASTC_6x6, 3 },
            { TextureFormat.ASTC_8x8, 2 },
            { TextureFormat.ASTC_10x10, 1 },
            { TextureFormat.ASTC_12x12, 1 },
        };

        private static int EstimateBitsPerPixel(TextureFormat format)
        {
            if (TextureFormatBits.TryGetValue(format, out var bits))
            {
                return bits;
            }

            // Fallback to 32 bits per pixel for unlisted formats.
            return 32;
        }

        internal static string[] GetShaderKeywords(Shader shader)
        {
            if (shader == null)
            {
                return Array.Empty<string>();
            }

            try
            {
                var keywordSpace = shader.keywordSpace;
                var keywordSpaceType = keywordSpace.GetType();

                var namesProperty = keywordSpaceType.GetProperty("keywordNames", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                if (namesProperty?.GetValue(keywordSpace) is string[] names && names.Length > 0)
                {
                    return names;
                }

                var getKeywords = keywordSpaceType.GetMethod("GetKeywords", BindingFlags.Instance | BindingFlags.NonPublic);
                if (getKeywords != null && getKeywords.Invoke(keywordSpace, null) is Array keywordArray)
                {
                    return keywordArray.Cast<object>()
                        .Select(k => k?.ToString())
                        .Where(s => !string.IsNullOrEmpty(s))
                        .Distinct()
                        .ToArray();
                }
            }
            catch
            {
                // ignored - fall back to empty keyword list when reflection fails
            }

            return Array.Empty<string>();
        }
#else
        private static int EstimateBitsPerPixel(TextureFormat format) => 32;

        internal static string[] GetShaderKeywords(Shader shader) => Array.Empty<string>();
#endif
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
                keywords = AssetTelemetryUtility.GetShaderKeywords(shader)
            };
        }
    }
}
