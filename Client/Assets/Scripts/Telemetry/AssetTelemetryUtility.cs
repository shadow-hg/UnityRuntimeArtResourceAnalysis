using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace UnityProfileV2.Telemetry
{
    public static class AssetTelemetryUtility
    {
        public static TelemetrySnapshot CreateSnapshot(int maxAssetsPerCategory)
        {
            var textures = EnumerateRuntimeObjects<Texture>()
                .Where(texture => !IsRenderTextureLike(texture))
                .Where(texture => texture is not Texture2D tex || !tex.hideFlags.HasFlag(HideFlags.DontSave))
                .Select(TextureInfo.FromTexture)
                .Where(info => info.IsValid && !info.isRenderTexture)
                .Where(info => !IsTinyTexture(info.width, info.height))
                .OrderByDescending(info => info.EstimatedBytes)
                .GroupBy(info => info.name, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First())
                .Take(maxAssetsPerCategory)
                .ToArray();

            var meshes = EnumerateRuntimeObjects<Mesh>()
                .Select(MeshInfo.FromMesh)
                .Where(info => info.IsValid)
                .OrderByDescending(info => info.EstimatedBytes)
                .Take(maxAssetsPerCategory)
                .ToArray();

            var renderTextures = EnumerateRuntimeObjects<RenderTexture>()
                .Select(RenderTextureInfo.FromRenderTexture)
                .Where(info => info.IsValid)
                .OrderByDescending(info => info.EstimatedBytes)
                .GroupBy(info => info.name, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First())
                .Take(maxAssetsPerCategory)
                .ToArray();

            var materials = EnumerateRuntimeObjects<Material>()
                .Select(MaterialInfo.FromMaterial)
                .Where(info => info.IsValid)
                .OrderByDescending(info => info.memoryBytes)
                .GroupBy(info => info.name, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First())
                .Take(maxAssetsPerCategory)
                .ToArray();

            var shaders = EnumerateRuntimeObjects<Shader>()
                .Select(ShaderInfo.FromShader)
                .Where(info => info.IsValid)
                .Take(maxAssetsPerCategory)
                .ToArray();

            return new TelemetrySnapshot
            {
                textures = textures,
                meshes = meshes,
                renderTextures = renderTextures,
                materials = materials,
                shaders = shaders,
                totalTextureBytes = textures.Sum(t => t.EstimatedBytes),
                totalMeshBytes = meshes.Sum(m => m.EstimatedBytes),
                totalRenderTextureBytes = renderTextures.Sum(r => r.EstimatedBytes),
                totalMaterialBytes = materials.Sum(m => m.memoryBytes)
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

        internal static bool IsRenderTextureLike(Texture texture)
        {
            if (texture == null)
            {
                return false;
            }

            if (texture is RenderTexture)
            {
                return true;
            }

            var typeName = texture.GetType().Name;
            if (string.IsNullOrEmpty(typeName))
            {
                return false;
            }

            return typeName.IndexOf("RenderTexture", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static IEnumerable<T> EnumerateRuntimeObjects<T>() where T : UnityEngine.Object
        {
            var objects = Resources.FindObjectsOfTypeAll<T>();
#if UNITY_EDITOR
            HashSet<int> runtimeInstanceIds = null;
#endif

            foreach (var obj in objects)
            {
                if (obj == null)
                {
                    continue;
                }

#if UNITY_EDITOR
                runtimeInstanceIds ??= GetRuntimeDependencyInstanceIds();
                if (!ShouldIncludeRuntimeObject(obj, runtimeInstanceIds))
                {
                    continue;
                }
#endif

                yield return obj;
            }
        }

#if UNITY_EDITOR
        private static readonly List<GameObject> RootGameObjectBuffer = new();
        private static readonly HashSet<int> RootInstanceIdSet = new();
        private static readonly HashSet<int> RuntimeDependencyInstanceIds = new();
        private static int RuntimeDependencyCacheFrame = -1;

        private static HashSet<int> GetRuntimeDependencyInstanceIds()
        {
            if (!Application.isPlaying)
            {
                return RuntimeDependencyInstanceIds;
            }

            var currentFrame = Time.frameCount;
            if (RuntimeDependencyCacheFrame == currentFrame)
            {
                return RuntimeDependencyInstanceIds;
            }

            RuntimeDependencyCacheFrame = currentFrame;
            RuntimeDependencyInstanceIds.Clear();
            RootGameObjectBuffer.Clear();
            RootInstanceIdSet.Clear();

            var sceneCount = SceneManager.sceneCount;
            for (var index = 0; index < sceneCount; index += 1)
            {
                var scene = SceneManager.GetSceneAt(index);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }

                foreach (var root in scene.GetRootGameObjects())
                {
                    if (root == null)
                    {
                        continue;
                    }

                    if (RootInstanceIdSet.Add(root.GetInstanceID()))
                    {
                        RootGameObjectBuffer.Add(root);
                    }
                }
            }

            CollectDontDestroyOnLoadRoots();

            if (RootGameObjectBuffer.Count == 0)
            {
                return RuntimeDependencyInstanceIds;
            }

            var dependencies = EditorUtility.CollectDependencies(RootGameObjectBuffer.Cast<UnityEngine.Object>().ToArray());
            foreach (var dependency in dependencies)
            {
                if (dependency == null)
                {
                    continue;
                }

                RuntimeDependencyInstanceIds.Add(dependency.GetInstanceID());
            }

            return RuntimeDependencyInstanceIds;
        }

        private static void CollectDontDestroyOnLoadRoots()
        {
            var sentinel = new GameObject("TelemetryRuntimeCollectorSentinel")
            {
                hideFlags = HideFlags.HideAndDontSave
            };

            try
            {
                UnityEngine.Object.DontDestroyOnLoad(sentinel);
                var dontDestroyScene = sentinel.scene;
                foreach (var root in dontDestroyScene.GetRootGameObjects())
                {
                    if (root == null || root == sentinel)
                    {
                        continue;
                    }

                    if (RootInstanceIdSet.Add(root.GetInstanceID()))
                    {
                        RootGameObjectBuffer.Add(root);
                    }
                }

                SceneManager.MoveGameObjectToScene(sentinel, SceneManager.GetActiveScene());
            }
            finally
            {
                if (Application.isPlaying)
                {
                    UnityEngine.Object.Destroy(sentinel);
                }
                else
                {
                    UnityEngine.Object.DestroyImmediate(sentinel);
                }
            }
        }

        private static bool ShouldIncludeRuntimeObject(UnityEngine.Object obj, HashSet<int> runtimeInstanceIds)
        {
            if (obj == null)
            {
                return false;
            }

            if (!Application.isPlaying)
            {
                return false;
            }

            if (!EditorUtility.IsPersistent(obj))
            {
                return true;
            }

            return runtimeInstanceIds.Count == 0 || runtimeInstanceIds.Contains(obj.GetInstanceID());
        }
#endif

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

        private static bool IsTinyTexture(int width, int height)
        {
            return width <= 4 && height <= 4;
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

        internal static bool TryCaptureTexturePreview(Texture texture, out string base64)
        {
            base64 = null;
            if (texture is not Texture2D tex2D)
            {
                return false;
            }

            RenderTexture renderTexture = null;

            try
            {
                const int previewSize = 128;
                var width = Mathf.Clamp(previewSize, 16, tex2D.width);
                var height = Mathf.Clamp(previewSize, 16, tex2D.height);

                renderTexture = RenderTexture.GetTemporary(width, height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
                Graphics.Blit(tex2D, renderTexture);

                return TryEncodeRenderTarget(renderTexture, out base64);
            }
            catch
            {
                return false;
            }
            finally
            {
                if (renderTexture != null)
                {
                    RenderTexture.ReleaseTemporary(renderTexture);
                }
            }
        }

        internal static bool TryCaptureRenderTexturePreview(RenderTexture renderTexture, out string base64)
        {
            base64 = null;
            if (renderTexture == null)
            {
                return false;
            }

            RenderTexture previewTarget = null;

            try
            {
                const int previewSize = 128;
                var width = Mathf.Clamp(previewSize, 16, renderTexture.width);
                var height = Mathf.Clamp(previewSize, 16, renderTexture.height);

                previewTarget = RenderTexture.GetTemporary(width, height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
                Graphics.Blit(renderTexture, previewTarget);

                return TryEncodeRenderTarget(previewTarget, out base64);
            }
            catch
            {
                return false;
            }
            finally
            {
                if (previewTarget != null)
                {
                    RenderTexture.ReleaseTemporary(previewTarget);
                }
            }
        }

        private static bool TryEncodeRenderTarget(RenderTexture renderTarget, out string base64)
        {
            base64 = null;
            if (renderTarget == null)
            {
                return false;
            }

            Texture2D previewTexture = null;
            var previousActive = RenderTexture.active;

            try
            {
                RenderTexture.active = renderTarget;

                var width = Mathf.Max(1, renderTarget.width);
                var height = Mathf.Max(1, renderTarget.height);

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

                if (previewTexture != null)
                {
                    UnityEngine.Object.Destroy(previewTexture);
                }
            }
        }

        internal static MaterialTextureReference[] GetMaterialTextureReferences(Material material)
        {
            if (material == null)
            {
                return Array.Empty<MaterialTextureReference>();
            }

            var shader = material.shader;
            if (shader == null)
            {
                return Array.Empty<MaterialTextureReference>();
            }

            var propertyCount = shader.GetPropertyCount();
            if (propertyCount <= 0)
            {
                return Array.Empty<MaterialTextureReference>();
            }

            List<MaterialTextureReference> references = null;

            for (var index = 0; index < propertyCount; index += 1)
            {
                if (shader.GetPropertyType(index) != ShaderPropertyType.Texture)
                {
                    continue;
                }

                var propertyName = shader.GetPropertyName(index);
                if (string.IsNullOrEmpty(propertyName))
                {
                    continue;
                }

                Texture texture = null;
                try
                {
                    texture = material.GetTexture(propertyName);
                }
                catch
                {
                    texture = null;
                }

                if (texture == null)
                {
                    continue;
                }

                references ??= new List<MaterialTextureReference>();
                references.Add(new MaterialTextureReference
                {
                    propertyName = propertyName,
                    textureName = texture.name,
                    texturePath = GetAssetPath(texture),
                    textureClass = texture.GetType().Name,
                });
            }

            return references != null ? references.ToArray() : Array.Empty<MaterialTextureReference>();
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
        public long totalMaterialBytes;
        public TextureInfo[] textures = Array.Empty<TextureInfo>();
        public MeshInfo[] meshes = Array.Empty<MeshInfo>();
        public RenderTextureInfo[] renderTextures = Array.Empty<RenderTextureInfo>();
        public MaterialInfo[] materials = Array.Empty<MaterialInfo>();
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
        public bool isRenderTexture;
        public string textureClass;
        public bool IsValid => width > 0 && height > 0;

        public static TextureInfo FromTexture(Texture texture)
        {
            var tex2D = texture as Texture2D;
            var format = tex2D != null ? tex2D.format : TextureFormat.RGBA32;
            var mipCount = tex2D != null ? tex2D.mipmapCount : 1;
            var typeName = texture != null ? texture.GetType().Name : string.Empty;
            var isRenderTexture = AssetTelemetryUtility.IsRenderTextureLike(texture);
            AssetTelemetryUtility.TryCaptureTexturePreview(texture, out var previewBase64);

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
                isRenderTexture = isRenderTexture,
                textureClass = typeName,
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
    public struct MaterialTextureReference
    {
        public string propertyName;
        public string textureName;
        public string texturePath;
        public string textureClass;
    }

    [Serializable]
    public struct MaterialInfo
    {
        public string name;
        public string path;
        public string shaderName;
        public string shaderPath;
        public int renderQueue;
        public bool enableInstancing;
        public bool doubleSidedGI;
        public string[] keywords;
        public long memoryBytes;
        public MaterialTextureReference[] textures;
        public bool IsValid => !string.IsNullOrEmpty(name) || !string.IsNullOrEmpty(shaderName);

        public static MaterialInfo FromMaterial(Material material)
        {
            if (material == null)
            {
                return default;
            }

            var shader = material.shader;
            var shaderKeywords = material.shaderKeywords ?? Array.Empty<string>();
            var normalizedKeywords = shaderKeywords
                .Where(keyword => !string.IsNullOrWhiteSpace(keyword))
                .Select(keyword => keyword.Trim())
                .Where(keyword => keyword.Length > 0)
                .Distinct(StringComparer.Ordinal)
                .ToArray();

            var doubleSidedGi = false;
            try
            {
                doubleSidedGi = material.doubleSidedGI;
            }
            catch
            {
                doubleSidedGi = false;
            }

            return new MaterialInfo
            {
                name = material.name,
                path = AssetTelemetryUtility.GetAssetPath(material),
                shaderName = shader != null ? shader.name : string.Empty,
                shaderPath = shader != null ? AssetTelemetryUtility.GetAssetPath(shader) : string.Empty,
                renderQueue = material.renderQueue,
                enableInstancing = material.enableInstancing,
                doubleSidedGI = doubleSidedGi,
                keywords = normalizedKeywords,
                memoryBytes = UnityEngine.Profiling.Profiler.GetRuntimeMemorySizeLong(material),
                textures = AssetTelemetryUtility.GetMaterialTextureReferences(material),
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
        public string previewBase64;
        public string previewUrl;
        public bool IsValid => width > 0 && height > 0;

        public static RenderTextureInfo FromRenderTexture(RenderTexture renderTexture)
        {
            AssetTelemetryUtility.TryCaptureRenderTexturePreview(renderTexture, out var previewBase64);

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
                previewBase64 = previewBase64,
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
