using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using UnityEngine;
using UnityEngine.Rendering;
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

            var renderTextures = Resources.FindObjectsOfTypeAll<RenderTexture>()
                .Where(rt => rt != null)
                .Select(RenderTextureInfo.FromRenderTexture)
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
                renderTextures = renderTextures,
                shaders = shaders,
                totalTextureBytes = textures.Sum(t => t.EstimatedBytes),
                totalMeshBytes = meshes.Sum(m => m.EstimatedBytes),
                totalRenderTextureBytes = renderTextures.Sum(r => r.EstimatedBytes)
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

        private static long CalculateMipChainPixelCount(int width, int height, int mipCount)
        {
            if (width <= 0 || height <= 0)
            {
                return 0;
            }

            if (mipCount <= 0)
            {
                mipCount = 1;
            }

            long total = 0;
            var currentWidth = width;
            var currentHeight = height;

            for (var level = 0; level < mipCount; level += 1)
            {
                total += (long)Mathf.Max(1, currentWidth) * Mathf.Max(1, currentHeight);
                if (currentWidth == 1 && currentHeight == 1)
                {
                    break;
                }

                currentWidth = Mathf.Max(1, currentWidth / 2);
                currentHeight = Mathf.Max(1, currentHeight / 2);
            }

            return total;
        }

        internal static long GetTextureOriginalBytes(Texture2D tex)
        {
            if (tex == null) return 0;
            var mipPixels = CalculateMipChainPixelCount(tex.width, tex.height, tex.mipmapCount);
            const int uncompressedBitsPerPixel = 32;
            return mipPixels * uncompressedBitsPerPixel / 8;
        }

        internal static long GetTextureCompressedBytes(Texture texture, TextureFormat format, int width, int height, int mipCount)
        {
            if (texture == null)
            {
                return 0;
            }

            if (texture is Texture2D tex2D)
            {
                var mipPixels = CalculateMipChainPixelCount(width, height, mipCount);
                var bitsPerPixel = EstimateBitsPerPixel(format);
                if (bitsPerPixel > 0)
                {
                    return mipPixels * bitsPerPixel / 8;
                }

                return UnityEngine.Profiling.Profiler.GetRuntimeMemorySizeLong(tex2D);
            }

            return UnityEngine.Profiling.Profiler.GetRuntimeMemorySizeLong(texture);
        }

        private static bool TryCaptureTexturePreview(Texture texture, out string base64)
        {
            base64 = null;
            if (texture is not Texture2D tex2D)
            {
                return false;
            }

            RenderTexture renderTexture = null;
            Texture2D previewTexture = null;
            var previousActive = RenderTexture.active;

            try
            {
                const int previewSize = 128;
                var width = Mathf.Clamp(previewSize, 16, tex2D.width);
                var height = Mathf.Clamp(previewSize, 16, tex2D.height);

                renderTexture = RenderTexture.GetTemporary(width, height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
                Graphics.Blit(tex2D, renderTexture);

                RenderTexture.active = renderTexture;

                previewTexture = new Texture2D(width, height, TextureFormat.RGBA32, false, false);
                previewTexture.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                previewTexture.Apply(false, false);

                var pngData = previewTexture.EncodeToPNG();
                if (pngData != null && pngData.Length > 0)
                {
                    base64 = Convert.ToBase64String(pngData);
                }

                return !string.IsNullOrEmpty(base64);
            }
            catch
            {
                return false;
            }
            finally
            {
                RenderTexture.active = previousActive;

                if (renderTexture != null)
                {
                    RenderTexture.ReleaseTemporary(renderTexture);
                }

                if (previewTexture != null)
                {
                    UnityEngine.Object.Destroy(previewTexture);
                }
            }
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

            return 32;
        }

        internal static string[] GetShaderKeywords(Shader shader) => Array.Empty<string>();
#endif

        internal static string[] GetMeshVertexAttributes(Mesh mesh)
        {
            if (mesh == null)
            {
                return Array.Empty<string>();
            }

            try
            {
                var descriptors = mesh.GetVertexAttributes();
                if (descriptors == null || descriptors.Length == 0)
                {
                    return Array.Empty<string>();
                }

                return descriptors
                    .Select(descriptor =>
                    {
                        var attribute = descriptor.attribute.ToString();
                        var streamSuffix = descriptor.stream > 0 ? $" (Stream {descriptor.stream})" : string.Empty;
                        var dimensionSuffix = descriptor.dimension > 0 ? $" x{descriptor.dimension}" : string.Empty;
                        return attribute + streamSuffix + dimensionSuffix;
                    })
                    .ToArray();
            }
            catch
            {
                return Array.Empty<string>();
            }
        }

        internal static long EstimateMeshAssetBytes(Mesh mesh)
        {
            if (mesh == null)
            {
                return 0;
            }

            long vertexBytes = 0;
            try
            {
                var descriptors = mesh.GetVertexAttributes();
                foreach (var descriptor in descriptors)
                {
                    var componentSize = descriptor.format switch
                    {
                        VertexAttributeFormat.Float32 => 4,
                        VertexAttributeFormat.Float16 => 2,
                        VertexAttributeFormat.UNorm8 => 1,
                        VertexAttributeFormat.SNorm8 => 1,
                        VertexAttributeFormat.UInt8 => 1,
                        VertexAttributeFormat.SInt8 => 1,
                        VertexAttributeFormat.UInt16 => 2,
                        VertexAttributeFormat.SInt16 => 2,
                        VertexAttributeFormat.UInt32 => 4,
                        VertexAttributeFormat.SInt32 => 4,
                        _ => 4,
                    };

                    vertexBytes += (long)mesh.vertexCount * descriptor.dimension * componentSize;
                }
            }
            catch
            {
                vertexBytes = 0;
            }

            long indexBytes = 0;
            try
            {
                var indexSize = mesh.indexFormat == IndexFormat.UInt32 ? 4 : 2;
                for (var subMesh = 0; subMesh < mesh.subMeshCount; subMesh += 1)
                {
                    indexBytes += (long)mesh.GetIndexCount(subMesh) * indexSize;
                }
            }
            catch
            {
                indexBytes = 0;
            }

            return vertexBytes + indexBytes;
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
        public long totalRenderTextureBytes;
        public TextureInfo[] textures = Array.Empty<TextureInfo>();
        public MeshInfo[] meshes = Array.Empty<MeshInfo>();
        public RenderTextureInfo[] renderTextures = Array.Empty<RenderTextureInfo>();
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
        public string formatName;
        public string graphicsFormat;
        public string compressionFormat;
        public TextureWrapMode wrapMode;
        public FilterMode filterMode;
        public int mipCount;
        public long originalBytes;
        public long EstimatedBytes;
        public string previewBase64;
        public bool IsValid => width > 0 && height > 0;

        public static TextureInfo FromTexture(Texture texture)
        {
            var tex2D = texture as Texture2D;
            var format = tex2D != null ? tex2D.format : TextureFormat.RGBA32;
            var mipCount = tex2D != null ? tex2D.mipmapCount : 1;
            TryCaptureTexturePreview(texture, out var previewBase64);

            return new TextureInfo
            {
                name = texture.name,
                path = AssetTelemetryUtility.GetAssetPath(texture),
                width = texture.width,
                height = texture.height,
                wrapMode = texture.wrapMode,
                filterMode = texture.filterMode,
                format = format,
                formatName = format.ToString(),
                graphicsFormat = tex2D != null ? tex2D.graphicsFormat.ToString() : string.Empty,
                compressionFormat = format.ToString(),
                mipCount = mipCount,
                originalBytes = AssetTelemetryUtility.GetTextureOriginalBytes(tex2D),
                EstimatedBytes = AssetTelemetryUtility.GetTextureCompressedBytes(texture, format, texture.width, texture.height, mipCount),
                previewBase64 = previewBase64,
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
        public float boundsSizeX;
        public float boundsSizeY;
        public float boundsSizeZ;
        public string[] vertexAttributes;
        public long assetBytes;
        public long EstimatedBytes;
        public bool IsValid => vertexCount > 0;

        public static MeshInfo FromMesh(Mesh mesh)
        {
            var boundsSize = mesh.bounds.size;
            return new MeshInfo
            {
                name = mesh.name,
                path = AssetTelemetryUtility.GetAssetPath(mesh),
                vertexCount = mesh.vertexCount,
                subMeshCount = mesh.subMeshCount,
                boundsSizeX = boundsSize.x,
                boundsSizeY = boundsSize.y,
                boundsSizeZ = boundsSize.z,
                vertexAttributes = AssetTelemetryUtility.GetMeshVertexAttributes(mesh),
                assetBytes = AssetTelemetryUtility.EstimateMeshAssetBytes(mesh),
                EstimatedBytes = UnityEngine.Profiling.Profiler.GetRuntimeMemorySizeLong(mesh)
            };
        }
    }

    [Serializable]
    public struct RenderTextureInfo
    {
        public string name;
        public int width;
        public int height;
        public int depth;
        public int mipCount;
        public bool useMipMap;
        public string dimension;
        public string format;
        public string graphicsFormat;
        public int antiAliasing;
        public long EstimatedBytes;
        public bool IsValid => width > 0 && height > 0;

        public static RenderTextureInfo FromRenderTexture(RenderTexture renderTexture)
        {
            return new RenderTextureInfo
            {
                name = renderTexture.name,
                width = renderTexture.width,
                height = renderTexture.height,
                depth = renderTexture.depth,
                mipCount = renderTexture.useMipMap ? renderTexture.mipmapCount : 1,
                useMipMap = renderTexture.useMipMap,
                dimension = renderTexture.dimension.ToString(),
                format = renderTexture.format.ToString(),
                graphicsFormat = renderTexture.graphicsFormat.ToString(),
                antiAliasing = renderTexture.antiAliasing,
                EstimatedBytes = UnityEngine.Profiling.Profiler.GetRuntimeMemorySizeLong(renderTexture),
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
