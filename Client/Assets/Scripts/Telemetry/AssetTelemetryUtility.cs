using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Profiling;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace UnityProfileV2.Telemetry
{
    [Serializable]
    public struct TelemetrySnapshotOptions
    {
        public bool includeTextures;
        public bool includeMeshes;
        public bool includeRenderTextures;
        public bool includeMaterials;
        public bool includeShaders;
        public bool includeFrameInsights;
        public bool includeSystemStats;
        public bool includeAssetIo;
        public bool includeEnvironment;
        public bool hasExplicitSelection;

        public static TelemetrySnapshotOptions Default => new TelemetrySnapshotOptions
        {
            includeTextures = true,
            includeMeshes = true,
            includeRenderTextures = true,
            includeMaterials = true,
            includeShaders = true,
            includeFrameInsights = true,
            includeSystemStats = true,
            includeAssetIo = true,
            includeEnvironment = true,
            hasExplicitSelection = true
        };
    }

    public static partial class AssetTelemetryUtility
    {
        private static int s_mainThreadId = -1;

        internal static void MarkMainThread()
        {
            if (SynchronizationContext.Current == null)
            {
                return;
            }

            var currentId = Thread.CurrentThread.ManagedThreadId;
            if (s_mainThreadId == -1 || s_mainThreadId == currentId)
            {
                s_mainThreadId = currentId;
            }
        }

        private static bool IsMainThread()
        {
            var currentId = Thread.CurrentThread.ManagedThreadId;

            if (s_mainThreadId == -1)
            {
                if (SynchronizationContext.Current != null)
                {
                    s_mainThreadId = currentId;
                    return true;
                }

                return false;
            }

            return currentId == s_mainThreadId;
        }

        public sealed class TelemetryCollectionState
        {
            internal Dictionary<int, TextureInfo> Textures { get; } = new();
            internal Dictionary<int, MeshInfo> Meshes { get; } = new();
            internal Dictionary<int, RenderTextureInfo> RenderTextures { get; } = new();
            internal Dictionary<int, MaterialInfo> Materials { get; } = new();
            internal Dictionary<int, ShaderInfo> Shaders { get; } = new();
            internal Dictionary<string, ResourceTracker> ResourceTrackers { get; } = new();
            internal Queue<AssetLoadSample> RecentLoads { get; } = new();
            internal List<ResourceUnloadEvent> RecentUnloads { get; } = new();
            internal bool HasBaseline { get; set; }

            public void Reset()
            {
                Textures.Clear();
                Meshes.Clear();
                RenderTextures.Clear();
                Materials.Clear();
                Shaders.Clear();
                foreach (var tracker in ResourceTrackers.Values)
                {
                    tracker.Reset();
                }
                ResourceTrackers.Clear();
                RecentLoads.Clear();
                RecentUnloads.Clear();
                HasBaseline = false;
            }
        }

        public struct ShaderVariantInfo
        {
            public int TotalVariantCount;
        }

        public static TelemetrySnapshot CreateSnapshot(int maxAssetsPerCategory)
        {
            return CreateSnapshot(maxAssetsPerCategory, TelemetrySnapshotOptions.Default);
        }

        public static TelemetrySnapshot CreateSnapshot(int maxAssetsPerCategory, TelemetrySnapshotOptions options, TelemetryCollectionState state = null)
        {
            var normalizedOptions = NormalizeOptions(options);
            var snapshotData = CaptureSnapshotData(normalizedOptions, state);
            return BuildSnapshot(state, maxAssetsPerCategory, normalizedOptions, snapshotData);
        }

        public static Task<TelemetrySnapshot> CreateSnapshotAsync(int maxAssetsPerCategory)
        {
            return CreateSnapshotAsync(maxAssetsPerCategory, TelemetrySnapshotOptions.Default);
        }

        public static Task<TelemetrySnapshot> CreateSnapshotAsync(int maxAssetsPerCategory, TelemetrySnapshotOptions options, TelemetryCollectionState state = null)
        {
            var normalizedOptions = NormalizeOptions(options);
            var snapshotData = CaptureSnapshotData(normalizedOptions, state);
            return Task.Run(() => BuildSnapshot(state, maxAssetsPerCategory, normalizedOptions, snapshotData));
        }

        private static TelemetrySnapshotOptions NormalizeOptions(TelemetrySnapshotOptions options)
        {
            if (!options.hasExplicitSelection &&
                !options.includeTextures && !options.includeMeshes && !options.includeRenderTextures &&
                !options.includeMaterials && !options.includeShaders)
            {
                return TelemetrySnapshotOptions.Default;
            }

            return new TelemetrySnapshotOptions
            {
                includeTextures = options.includeTextures,
                includeMeshes = options.includeMeshes,
                includeRenderTextures = options.includeRenderTextures,
                includeMaterials = options.includeMaterials,
                includeShaders = options.includeShaders,
                includeFrameInsights = options.includeFrameInsights,
                includeSystemStats = options.includeSystemStats,
                includeAssetIo = options.includeAssetIo,
                includeEnvironment = options.includeEnvironment,
                hasExplicitSelection = options.hasExplicitSelection
            };
        }

        private static int SafeConvertToInt(object value)
        {
            if (value == null)
            {
                return 0;
            }

            switch (value)
            {
                case int intValue:
                    return intValue;
                case long longValue when longValue > int.MaxValue:
                    return int.MaxValue;
                case long longValue when longValue < int.MinValue:
                    return int.MinValue;
                case long longValue:
                    return (int)longValue;
                case float floatValue when float.IsNaN(floatValue) || float.IsInfinity(floatValue):
                    return 0;
                case float floatValue:
                    return Mathf.RoundToInt(floatValue);
                case double doubleValue when double.IsNaN(doubleValue) || double.IsInfinity(doubleValue):
                    return 0;
                case double doubleValue:
                    if (doubleValue > int.MaxValue)
                    {
                        return int.MaxValue;
                    }

                    if (doubleValue < int.MinValue)
                    {
                        return int.MinValue;
                    }

                    return (int)Math.Round(doubleValue);
                default:
                    if (int.TryParse(value.ToString(), out var parsed))
                    {
                        return parsed;
                    }

                    return 0;
            }
        }

        private static int ClampToInt(long value)
        {
            if (value > int.MaxValue)
            {
                return int.MaxValue;
            }

            if (value < int.MinValue)
            {
                return int.MinValue;
            }

            return (int)value;
        }

        private static ShaderVariantInfo GetShaderVariantInfo(Shader shader)
        {
#if UNITY_EDITOR
            var totalVariantCount = GetShaderVariantCountFromEditor(shader);
            if (totalVariantCount < 0)
            {
                totalVariantCount = 0;
            }

            return new ShaderVariantInfo
            {
                TotalVariantCount = totalVariantCount,
            };
#else
            return default;
#endif
        }

#if UNITY_EDITOR
        private static readonly MethodInfo ShaderVariantCountWithBoolMethod =
            typeof(ShaderUtil).GetMethod(
                "GetShaderVariantCount",
                BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic,
                null,
                new[] { typeof(Shader), typeof(bool) },
                null)
            ?? typeof(ShaderUtil).GetMethod(
                "GetVariantCount",
                BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic,
                null,
                new[] { typeof(Shader), typeof(bool) },
                null);

        private static readonly MethodInfo ShaderVariantCountSingleMethod =
            typeof(ShaderUtil).GetMethod(
                "GetShaderVariantCount",
                BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic,
                null,
                new[] { typeof(Shader) },
                null)
            ?? typeof(ShaderUtil).GetMethod(
                "GetVariantCount",
                BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic,
                null,
                new[] { typeof(Shader) },
                null);

        private static int GetShaderVariantCountFromEditor(Shader shader)
        {
            if (shader == null)
            {
                return 0;
            }

            var total = 0;

            if (ShaderVariantCountWithBoolMethod != null)
            {
                total = Math.Max(total, InvokeShaderVariantCount(ShaderVariantCountWithBoolMethod, shader, true));
            }

            if (total <= 0 && ShaderVariantCountSingleMethod != null)
            {
                total = Math.Max(total, InvokeShaderVariantCount(ShaderVariantCountSingleMethod, shader, true));
            }

            return total;
        }

        private static int InvokeShaderVariantCount(MethodInfo method, Shader shader, bool includeAllVariants)
        {
            if (method == null || shader == null)
            {
                return 0;
            }

            try
            {
                var parameters = method.GetParameters();
                object result;

                if (parameters.Length == 1)
                {
                    result = method.Invoke(null, new object[] { shader });
                }
                else if (parameters.Length == 2)
                {
                    result = method.Invoke(null, new object[] { shader, includeAllVariants });
                }
                else
                {
                    return 0;
                }

                return SafeConvertToInt(result);
            }
            catch
            {
                return 0;
            }
        }
#endif

        private readonly struct CategoryDiff<TInfo>
            where TInfo : struct
        {
            public CategoryDiff(int[] order, TInfo[] updates)
            {
                Order = order ?? Array.Empty<int>();
                Updates = updates ?? Array.Empty<TInfo>();
            }

            public int[] Order { get; }
            public TInfo[] Updates { get; }
        }

        private static ShaderVariantStats CalculateShaderVariantStats(IReadOnlyList<ShaderInfo> shaders)
        {
            if (shaders == null || shaders.Count == 0)
            {
                return default;
            }

            long totalVariants = 0;

            for (var index = 0; index < shaders.Count; index += 1)
            {
                var shader = shaders[index];
                totalVariants += Math.Max(0, shader.totalVariantCount);
            }

            return new ShaderVariantStats
            {
                shaderCount = shaders.Count,
                totalVariants = ClampToInt(totalVariants)
            };
        }

        private static CategoryDiff<TInfo> ComputeCategoryDiff<TInfo>(
            Dictionary<int, TInfo> state,
            IReadOnlyList<TInfo> next,
            bool hasBaseline,
            Func<TInfo, int> getId)
            where TInfo : struct
        {
            if (next == null)
            {
                next = Array.Empty<TInfo>();
            }

            var order = new int[next.Count];
            var updates = new List<TInfo>(next.Count);
            var nextMap = new Dictionary<int, TInfo>(next.Count);

            for (var index = 0; index < next.Count; index += 1)
            {
                var info = next[index];
                var id = getId(info);
                order[index] = id;
                nextMap[id] = info;

                if (!hasBaseline || state == null || !state.TryGetValue(id, out var existing) || !info.Equals(existing))
                {
                    updates.Add(info);
                }
            }

            if (state != null)
            {
                state.Clear();
                foreach (var pair in nextMap)
                {
                    state[pair.Key] = pair.Value;
                }
            }

            return new CategoryDiff<TInfo>(order, updates.ToArray());
        }

        private static TelemetrySnapshot BuildSnapshot(
            TelemetryCollectionState state,
            int maxAssetsPerCategory,
            TelemetrySnapshotOptions options,
            SnapshotData snapshotData)
        {
            var maxPerCategory = Mathf.Max(1, maxAssetsPerCategory);
            var hasBaseline = state?.HasBaseline ?? false;

            var textures = options.includeTextures
                ? DistinctBy(
                        snapshotData.textures
                            .OrderByDescending(info => info.EstimatedBytes),
                        info => info.name,
                        StringComparison.OrdinalIgnoreCase)
                    .Take(maxPerCategory)
                    .ToArray()
                : Array.Empty<TextureInfo>();

            var meshes = options.includeMeshes
                ? snapshotData.meshes
                    .OrderByDescending(info => info.EstimatedBytes)
                    .Take(maxPerCategory)
                    .ToArray()
                : Array.Empty<MeshInfo>();

            var renderTextures = options.includeRenderTextures
                ? DistinctBy(
                        snapshotData.renderTextures
                            .OrderByDescending(info => info.EstimatedBytes),
                        info => info.name,
                        StringComparison.OrdinalIgnoreCase)
                    .Take(maxPerCategory)
                    .ToArray()
                : Array.Empty<RenderTextureInfo>();

            var materials = options.includeMaterials
                ? DistinctBy(
                        snapshotData.materials
                            .OrderByDescending(info => info.memoryBytes),
                        info => info.name,
                        StringComparison.OrdinalIgnoreCase)
                    .Take(maxPerCategory)
                    .ToArray()
                : Array.Empty<MaterialInfo>();

            var shaders = options.includeShaders
                ? snapshotData.shaders
                    .Take(maxPerCategory)
                    .ToArray()
                : Array.Empty<ShaderInfo>();

            var shaderVariantStats = options.includeShaders
                ? CalculateShaderVariantStats(snapshotData.shaders)
                : default;

            var textureDiff = ComputeCategoryDiff(state?.Textures, textures, hasBaseline, info => info.instanceId);
            var meshDiff = ComputeCategoryDiff(state?.Meshes, meshes, hasBaseline, info => info.instanceId);
            var renderTextureDiff = ComputeCategoryDiff(state?.RenderTextures, renderTextures, hasBaseline, info => info.instanceId);
            var materialDiff = ComputeCategoryDiff(state?.Materials, materials, hasBaseline, info => info.instanceId);
            var shaderDiff = ComputeCategoryDiff(state?.Shaders, shaders, hasBaseline, info => info.instanceId);

            var snapshot = new TelemetrySnapshot
            {
                isIncremental = hasBaseline,
                textures = textureDiff.Updates,
                textureOrder = textureDiff.Order,
                meshes = meshDiff.Updates,
                meshOrder = meshDiff.Order,
                renderTextures = renderTextureDiff.Updates,
                renderTextureOrder = renderTextureDiff.Order,
                materials = materialDiff.Updates,
                materialOrder = materialDiff.Order,
                shaders = shaderDiff.Updates,
                shaderOrder = shaderDiff.Order,
                shaderVariantStats = shaderVariantStats
            };

            if (options.includeFrameInsights)
            {
                snapshot.frameTiming = snapshotData.frameTiming;
            }

            if (options.includeSystemStats)
            {
                snapshot.memoryStats = snapshotData.memoryStats ?? new MemoryStats
                {
                    gc = new GarbageCollectionStats()
                };
                snapshot.threadStats = snapshotData.threadStats ?? new ThreadStats
                {
                    utilization = Array.Empty<ThreadUtilizationSample>()
                };
            }

            if (options.includeAssetIo)
            {
                snapshot.assetIo = snapshotData.assetIo ?? new AssetIoStats
                {
                    recentLoads = Array.Empty<AssetLoadSample>(),
                    resourceInstances = Array.Empty<ResourceInstanceStats>(),
                    unloadEvents = Array.Empty<ResourceUnloadEvent>(),
                    streamingStatuses = Array.Empty<StreamingStatus>()
                };
            }

            if (options.includeEnvironment)
            {
                snapshot.environment = snapshotData.environment ?? new EnvironmentInfo();
            }

            if (state != null)
            {
                state.HasBaseline = true;
            }

            return snapshot;
        }

        private static IEnumerable<T> DistinctBy<T>(IEnumerable<T> source, Func<T, string> keySelector, StringComparison comparison = StringComparison.Ordinal)
        {
            if (source == null)
            {
                yield break;
            }

            var seenKeys = new HashSet<string>(StringComparerFromComparison(comparison));
            foreach (var element in source)
            {
                var key = keySelector != null ? keySelector(element) : null;
                key = key ?? string.Empty;

                if (seenKeys.Add(key))
                {
                    yield return element;
                }
            }
        }

        private static StringComparer StringComparerFromComparison(StringComparison comparison)
        {
            switch (comparison)
            {
                case StringComparison.CurrentCulture:
                    return StringComparer.CurrentCulture;
                case StringComparison.CurrentCultureIgnoreCase:
                    return StringComparer.CurrentCultureIgnoreCase;
                case StringComparison.InvariantCulture:
                    return StringComparer.InvariantCulture;
                case StringComparison.InvariantCultureIgnoreCase:
                    return StringComparer.InvariantCultureIgnoreCase;
                case StringComparison.OrdinalIgnoreCase:
                    return StringComparer.OrdinalIgnoreCase;
                case StringComparison.Ordinal:
                default:
                    return StringComparer.Ordinal;
            }
        }

        private static SnapshotData CaptureSnapshotData(TelemetrySnapshotOptions options, TelemetryCollectionState state)
        {
            var data = new SnapshotData();

            if (options.includeTextures)
            {
                data.textures = CaptureTextureInfos();
            }

            if (options.includeMeshes)
            {
                data.meshes = CaptureMeshInfos();
            }

            if (options.includeRenderTextures)
            {
                data.renderTextures = CaptureRenderTextureInfos();
            }

            if (options.includeMaterials)
            {
                data.materials = CaptureMaterialInfos();
            }

            if (options.includeShaders)
            {
                data.shaders = CaptureShaderInfos();
            }

            if (options.includeFrameInsights)
            {
                data.frameTiming = CaptureFrameTimingInfo();
            }

            if (options.includeSystemStats)
            {
                data.memoryStats = CaptureMemoryStats(data);
                data.threadStats = CaptureThreadStats(data.frameTiming);
            }

            if (options.includeAssetIo)
            {
                data.assetIo = CaptureAssetIoStats(state, data);
            }

            if (options.includeEnvironment)
            {
                data.environment = CaptureEnvironmentInfo();
            }

            return data;
        }

        private static TextureInfo[] CaptureTextureInfos()
        {
            TextureInfoBuffer.Clear();
            TextureSeenIds.Clear();

            foreach (var texture in EnumerateRuntimeObjects<Texture>())
            {
                if (texture == null)
                {
                    continue;
                }

                if (IsRenderTextureLike(texture))
                {
                    continue;
                }

                if (texture is Texture2D tex && tex.hideFlags.HasFlag(HideFlags.DontSave))
                {
                    continue;
                }

                var info = GetOrCreateTextureInfo(texture);
                if (!info.IsValid || info.isRenderTexture)
                {
                    continue;
                }

                if (IsTinyTexture(info.width, info.height))
                {
                    continue;
                }

                TextureInfoBuffer.Add(info);
                TextureSeenIds.Add(texture.GetInstanceID());
            }

            PruneCache(TextureCache, TextureSeenIds);

            var result = TextureInfoBuffer.ToArray();
            TextureInfoBuffer.Clear();
            return result;
        }

        private static MeshInfo[] CaptureMeshInfos()
        {
            MeshInfoBuffer.Clear();
            MeshSeenIds.Clear();

            foreach (var mesh in EnumerateRuntimeObjects<Mesh>())
            {
                if (mesh == null)
                {
                    continue;
                }

                var info = GetOrCreateMeshInfo(mesh);
                if (!info.IsValid)
                {
                    continue;
                }

                MeshInfoBuffer.Add(info);
                MeshSeenIds.Add(mesh.GetInstanceID());
            }

            PruneCache(MeshCache, MeshSeenIds);

            var result = MeshInfoBuffer.ToArray();
            MeshInfoBuffer.Clear();
            return result;
        }

        private static RenderTextureInfo[] CaptureRenderTextureInfos()
        {
            RenderTextureInfoBuffer.Clear();
            RenderTextureSeenIds.Clear();

            foreach (var renderTexture in EnumerateRuntimeObjects<RenderTexture>())
            {
                if (renderTexture == null)
                {
                    continue;
                }

                var info = GetOrCreateRenderTextureInfo(renderTexture);
                if (!info.IsValid)
                {
                    continue;
                }

                RenderTextureInfoBuffer.Add(info);
                RenderTextureSeenIds.Add(renderTexture.GetInstanceID());
            }

            PruneCache(RenderTextureCache, RenderTextureSeenIds);

            var result = RenderTextureInfoBuffer.ToArray();
            RenderTextureInfoBuffer.Clear();
            return result;
        }

        private static MaterialInfo[] CaptureMaterialInfos()
        {
            MaterialInfoBuffer.Clear();
            MaterialSeenIds.Clear();

            foreach (var material in EnumerateRuntimeObjects<Material>())
            {
                if (material == null)
                {
                    continue;
                }

                var info = GetOrCreateMaterialInfo(material);
                if (!info.IsValid)
                {
                    continue;
                }

                MaterialInfoBuffer.Add(info);
                MaterialSeenIds.Add(material.GetInstanceID());
            }

            PruneCache(MaterialCache, MaterialSeenIds);

            var result = MaterialInfoBuffer.ToArray();
            MaterialInfoBuffer.Clear();
            return result;
        }

        private static ShaderInfo[] CaptureShaderInfos()
        {
            ShaderInfoBuffer.Clear();
            ShaderSeenIds.Clear();

            foreach (var shader in EnumerateRuntimeObjects<Shader>())
            {
                if (shader == null)
                {
                    continue;
                }

                var info = GetOrCreateShaderInfo(shader);
                if (!info.IsValid)
                {
                    continue;
                }

                ShaderInfoBuffer.Add(info);
                ShaderSeenIds.Add(shader.GetInstanceID());
            }

            PruneCache(ShaderCache, ShaderSeenIds);

            var result = ShaderInfoBuffer.ToArray();
            ShaderInfoBuffer.Clear();
            return result;
        }

        private static TextureInfo GetOrCreateTextureInfo(Texture texture)
        {
            var instanceId = texture.GetInstanceID();
            var signature = TextureSignature.FromTexture(texture);

            if (TextureCache.TryGetValue(instanceId, out var cached) && cached.Signature.Equals(signature))
            {
                var cachedInfo = cached.Info;
                cachedInfo.instanceId = instanceId;
                return cachedInfo;
            }

            var info = TextureInfo.FromTexture(texture);
            info.instanceId = instanceId;
            TextureCache[instanceId] = new CachedEntry<TextureInfo, TextureSignature>
            {
                Info = info,
                Signature = signature
            };

            return info;
        }

        private static MeshInfo GetOrCreateMeshInfo(Mesh mesh)
        {
            var instanceId = mesh.GetInstanceID();
            var signature = MeshSignature.FromMesh(mesh);

            if (MeshCache.TryGetValue(instanceId, out var cached) && cached.Signature.Equals(signature))
            {
                var cachedInfo = cached.Info;
                cachedInfo.instanceId = instanceId;
                return cachedInfo;
            }

            var info = MeshInfo.FromMesh(mesh);
            info.instanceId = instanceId;
            MeshCache[instanceId] = new CachedEntry<MeshInfo, MeshSignature>
            {
                Info = info,
                Signature = signature
            };

            return info;
        }

        private static RenderTextureInfo GetOrCreateRenderTextureInfo(RenderTexture renderTexture)
        {
            var instanceId = renderTexture.GetInstanceID();
            var signature = RenderTextureSignature.FromRenderTexture(renderTexture);

            if (RenderTextureCache.TryGetValue(instanceId, out var cached) && cached.Signature.Equals(signature))
            {
                var cachedInfo = cached.Info;
                cachedInfo.instanceId = instanceId;
                return cachedInfo;
            }

            var info = RenderTextureInfo.FromRenderTexture(renderTexture);
            info.instanceId = instanceId;
            RenderTextureCache[instanceId] = new CachedEntry<RenderTextureInfo, RenderTextureSignature>
            {
                Info = info,
                Signature = signature
            };

            return info;
        }

        private static MaterialInfo GetOrCreateMaterialInfo(Material material)
        {
            var instanceId = material.GetInstanceID();
            var signature = MaterialSignature.FromMaterial(material);

            if (MaterialCache.TryGetValue(instanceId, out var cached) && cached.Signature.Equals(signature))
            {
                var cachedInfo = cached.Info;
                cachedInfo.instanceId = instanceId;
                return cachedInfo;
            }

            var info = MaterialInfo.FromMaterial(material);
            info.instanceId = instanceId;
            MaterialCache[instanceId] = new CachedEntry<MaterialInfo, MaterialSignature>
            {
                Info = info,
                Signature = signature
            };

            return info;
        }

        private static ShaderInfo GetOrCreateShaderInfo(Shader shader)
        {
            var instanceId = shader.GetInstanceID();
            var variantInfo = GetShaderVariantInfo(shader);
            var signature = ShaderSignature.FromShader(shader, variantInfo);

            if (ShaderCache.TryGetValue(instanceId, out var cached) && cached.Signature.Equals(signature))
            {
                var cachedInfo = cached.Info;
                cachedInfo.instanceId = instanceId;
                return cachedInfo;
            }

            var info = ShaderInfo.FromShader(shader, variantInfo);
            info.instanceId = instanceId;
            ShaderCache[instanceId] = new CachedEntry<ShaderInfo, ShaderSignature>
            {
                Info = info,
                Signature = signature
            };

            return info;
        }

        private static void PruneCache<TInfo, TSignature>(Dictionary<int, CachedEntry<TInfo, TSignature>> cache, HashSet<int> seenIds)
        {
            RemovalBuffer.Clear();
            foreach (var key in cache.Keys)
            {
                if (!seenIds.Contains(key))
                {
                    RemovalBuffer.Add(key);
                }
            }

            foreach (var key in RemovalBuffer)
            {
                cache.Remove(key);
            }

            RemovalBuffer.Clear();
            seenIds.Clear();
        }

        private sealed class SnapshotData
        {
            public TextureInfo[] textures = Array.Empty<TextureInfo>();
            public MeshInfo[] meshes = Array.Empty<MeshInfo>();
            public RenderTextureInfo[] renderTextures = Array.Empty<RenderTextureInfo>();
            public MaterialInfo[] materials = Array.Empty<MaterialInfo>();
            public ShaderInfo[] shaders = Array.Empty<ShaderInfo>();
            public FrameTimingInfo frameTiming;
            public MemoryStats memoryStats;
            public ThreadStats threadStats;
            public AssetIoStats assetIo;
            public EnvironmentInfo environment;
        }

        private struct CachedEntry<TInfo, TSignature>
        {
            public TInfo Info;
            public TSignature Signature;
        }

        private struct TextureSignature : IEquatable<TextureSignature>
        {
            public string name;
            public string path;
            public int width;
            public int height;
            public TextureFormat format;
            public TextureWrapMode wrapMode;
            public FilterMode filterMode;
            public int mipCount;
            public bool isRenderTexture;
            public string textureClass;
            public string contentHash;

            public static TextureSignature FromTexture(Texture texture)
            {
                var signature = new TextureSignature
                {
                    name = texture != null ? texture.name : string.Empty,
                    path = GetAssetPath(texture),
                    width = texture != null ? texture.width : 0,
                    height = texture != null ? texture.height : 0,
                    wrapMode = texture != null ? texture.wrapMode : TextureWrapMode.Clamp,
                    filterMode = texture != null ? texture.filterMode : FilterMode.Bilinear,
                    isRenderTexture = texture != null && IsRenderTextureLike(texture),
                    textureClass = texture != null ? texture.GetType().Name : string.Empty,
                    mipCount = 1,
                    format = TextureFormat.RGBA32,
                    contentHash = string.Empty
                };

                if (texture is Texture2D tex2D)
                {
                    signature.format = tex2D.format;
                    signature.mipCount = tex2D.mipmapCount;
#if UNITY_2018_2_OR_NEWER
                    signature.contentHash = tex2D.imageContentsHash.ToString();
#endif
                }

                return signature;
            }

            public bool Equals(TextureSignature other)
            {
                return width == other.width &&
                    height == other.height &&
                    format == other.format &&
                    wrapMode == other.wrapMode &&
                    filterMode == other.filterMode &&
                    mipCount == other.mipCount &&
                    isRenderTexture == other.isRenderTexture &&
                    string.Equals(name, other.name, StringComparison.Ordinal) &&
                    string.Equals(path, other.path, StringComparison.Ordinal) &&
                    string.Equals(textureClass, other.textureClass, StringComparison.Ordinal) &&
                    string.Equals(contentHash, other.contentHash, StringComparison.Ordinal);
            }

            public override bool Equals(object obj)
            {
                return obj is TextureSignature other && Equals(other);
            }

            public override int GetHashCode()
            {
                unchecked
                {
                    var hashCode = width;
                    hashCode = (hashCode * 397) ^ height;
                    hashCode = (hashCode * 397) ^ (int)format;
                    hashCode = (hashCode * 397) ^ (int)wrapMode;
                    hashCode = (hashCode * 397) ^ (int)filterMode;
                    hashCode = (hashCode * 397) ^ mipCount;
                    hashCode = (hashCode * 397) ^ isRenderTexture.GetHashCode();
                    hashCode = (hashCode * 397) ^ (name != null ? StringComparer.Ordinal.GetHashCode(name) : 0);
                    hashCode = (hashCode * 397) ^ (path != null ? StringComparer.Ordinal.GetHashCode(path) : 0);
                    hashCode = (hashCode * 397) ^ (textureClass != null ? StringComparer.Ordinal.GetHashCode(textureClass) : 0);
                    hashCode = (hashCode * 397) ^ (contentHash != null ? StringComparer.Ordinal.GetHashCode(contentHash) : 0);
                    return hashCode;
                }
            }
        }

        private struct MeshSignature : IEquatable<MeshSignature>
        {
            public string name;
            public string path;
            public int vertexCount;
            public int subMeshCount;
            public float boundsSizeX;
            public float boundsSizeY;
            public float boundsSizeZ;
            public int blendShapeCount;

            public static MeshSignature FromMesh(Mesh mesh)
            {
                var bounds = mesh.bounds.size;
                return new MeshSignature
                {
                    name = mesh != null ? mesh.name : string.Empty,
                    path = GetAssetPath(mesh),
                    vertexCount = mesh != null ? mesh.vertexCount : 0,
                    subMeshCount = mesh != null ? mesh.subMeshCount : 0,
                    boundsSizeX = bounds.x,
                    boundsSizeY = bounds.y,
                    boundsSizeZ = bounds.z,
                    blendShapeCount = mesh != null ? mesh.blendShapeCount : 0
                };
            }

            public bool Equals(MeshSignature other)
            {
                return vertexCount == other.vertexCount &&
                    subMeshCount == other.subMeshCount &&
                    Mathf.Approximately(boundsSizeX, other.boundsSizeX) &&
                    Mathf.Approximately(boundsSizeY, other.boundsSizeY) &&
                    Mathf.Approximately(boundsSizeZ, other.boundsSizeZ) &&
                    blendShapeCount == other.blendShapeCount &&
                    string.Equals(name, other.name, StringComparison.Ordinal) &&
                    string.Equals(path, other.path, StringComparison.Ordinal);
            }

            public override bool Equals(object obj)
            {
                return obj is MeshSignature other && Equals(other);
            }

            public override int GetHashCode()
            {
                unchecked
                {
                    var hashCode = vertexCount;
                    hashCode = (hashCode * 397) ^ subMeshCount;
                    hashCode = (hashCode * 397) ^ Mathf.RoundToInt(boundsSizeX * 1000f);
                    hashCode = (hashCode * 397) ^ Mathf.RoundToInt(boundsSizeY * 1000f);
                    hashCode = (hashCode * 397) ^ Mathf.RoundToInt(boundsSizeZ * 1000f);
                    hashCode = (hashCode * 397) ^ blendShapeCount;
                    hashCode = (hashCode * 397) ^ (name != null ? StringComparer.Ordinal.GetHashCode(name) : 0);
                    hashCode = (hashCode * 397) ^ (path != null ? StringComparer.Ordinal.GetHashCode(path) : 0);
                    return hashCode;
                }
            }
        }

        private struct RenderTextureSignature : IEquatable<RenderTextureSignature>
        {
            public string name;
            public int width;
            public int height;
            public int depth;
            public int mipCount;
            public bool useMipMap;
            public TextureDimension dimension;
            public RenderTextureFormat format;
            public GraphicsFormat graphicsFormat;
            public int antiAliasing;

            public static RenderTextureSignature FromRenderTexture(RenderTexture renderTexture)
            {
                return new RenderTextureSignature
                {
                    name = renderTexture != null ? renderTexture.name : string.Empty,
                    width = renderTexture != null ? renderTexture.width : 0,
                    height = renderTexture != null ? renderTexture.height : 0,
                    depth = renderTexture != null ? renderTexture.depth : 0,
                    mipCount = renderTexture != null ? renderTexture.mipmapCount : 0,
                    useMipMap = renderTexture != null && renderTexture.useMipMap,
                    dimension = renderTexture != null ? renderTexture.dimension : TextureDimension.Unknown,
                    format = renderTexture != null ? renderTexture.format : RenderTextureFormat.Default,
                    graphicsFormat = renderTexture != null ? renderTexture.graphicsFormat : GraphicsFormat.None,
                    antiAliasing = renderTexture != null ? renderTexture.antiAliasing : 1
                };
            }

            public bool Equals(RenderTextureSignature other)
            {
                return width == other.width &&
                    height == other.height &&
                    depth == other.depth &&
                    mipCount == other.mipCount &&
                    useMipMap == other.useMipMap &&
                    dimension == other.dimension &&
                    format == other.format &&
                    graphicsFormat == other.graphicsFormat &&
                    antiAliasing == other.antiAliasing &&
                    string.Equals(name, other.name, StringComparison.Ordinal);
            }

            public override bool Equals(object obj)
            {
                return obj is RenderTextureSignature other && Equals(other);
            }

            public override int GetHashCode()
            {
                unchecked
                {
                    var hashCode = width;
                    hashCode = (hashCode * 397) ^ height;
                    hashCode = (hashCode * 397) ^ depth;
                    hashCode = (hashCode * 397) ^ mipCount;
                    hashCode = (hashCode * 397) ^ useMipMap.GetHashCode();
                    hashCode = (hashCode * 397) ^ (int)dimension;
                    hashCode = (hashCode * 397) ^ (int)format;
                    hashCode = (hashCode * 397) ^ (int)graphicsFormat;
                    hashCode = (hashCode * 397) ^ antiAliasing;
                    hashCode = (hashCode * 397) ^ (name != null ? StringComparer.Ordinal.GetHashCode(name) : 0);
                    return hashCode;
                }
            }
        }

        private struct MaterialSignature : IEquatable<MaterialSignature>
        {
            public string name;
            public string path;
            public string shaderName;
            public int renderQueue;
            public bool enableInstancing;
            public bool doubleSidedGi;
            public string keywordHash;

            public static MaterialSignature FromMaterial(Material material)
            {
                var shader = material != null ? material.shader : null;
                var keywords = material != null ? material.shaderKeywords ?? Array.Empty<string>() : Array.Empty<string>();
                var normalizedKeywords = keywords
                    .Where(keyword => !string.IsNullOrWhiteSpace(keyword))
                    .Select(keyword => keyword.Trim())
                    .Where(keyword => keyword.Length > 0)
                    .Distinct(StringComparer.Ordinal)
                    .OrderBy(keyword => keyword, StringComparer.Ordinal)
                    .ToArray();

                var keywordHash = normalizedKeywords.Length > 0 ? string.Join("|", normalizedKeywords) : string.Empty;

                var doubleSidedGi = false;
                if (material != null)
                {
                    try
                    {
                        doubleSidedGi = material.doubleSidedGI;
                    }
                    catch
                    {
                        doubleSidedGi = false;
                    }
                }

                return new MaterialSignature
                {
                    name = material != null ? material.name : string.Empty,
                    path = GetAssetPath(material),
                    shaderName = shader != null ? shader.name : string.Empty,
                    renderQueue = material != null ? material.renderQueue : 0,
                    enableInstancing = material != null && material.enableInstancing,
                    doubleSidedGi = doubleSidedGi,
                    keywordHash = keywordHash
                };
            }

            public bool Equals(MaterialSignature other)
            {
                return renderQueue == other.renderQueue &&
                    enableInstancing == other.enableInstancing &&
                    doubleSidedGi == other.doubleSidedGi &&
                    string.Equals(name, other.name, StringComparison.Ordinal) &&
                    string.Equals(path, other.path, StringComparison.Ordinal) &&
                    string.Equals(shaderName, other.shaderName, StringComparison.Ordinal) &&
                    string.Equals(keywordHash, other.keywordHash, StringComparison.Ordinal);
            }

            public override bool Equals(object obj)
            {
                return obj is MaterialSignature other && Equals(other);
            }

            public override int GetHashCode()
            {
                unchecked
                {
                    var hashCode = renderQueue;
                    hashCode = (hashCode * 397) ^ enableInstancing.GetHashCode();
                    hashCode = (hashCode * 397) ^ doubleSidedGi.GetHashCode();
                    hashCode = (hashCode * 397) ^ (name != null ? StringComparer.Ordinal.GetHashCode(name) : 0);
                    hashCode = (hashCode * 397) ^ (path != null ? StringComparer.Ordinal.GetHashCode(path) : 0);
                    hashCode = (hashCode * 397) ^ (shaderName != null ? StringComparer.Ordinal.GetHashCode(shaderName) : 0);
                    hashCode = (hashCode * 397) ^ (keywordHash != null ? StringComparer.Ordinal.GetHashCode(keywordHash) : 0);
                    return hashCode;
                }
            }
        }

        private struct ShaderSignature : IEquatable<ShaderSignature>
        {
            public string name;
            public string path;
            public int passCount;
            public string keywordHash;
            public int totalVariantCount;

            public static ShaderSignature FromShader(Shader shader, ShaderVariantInfo variantInfo)
            {
                var keywords = GetShaderKeywords(shader) ?? Array.Empty<string>();
                var normalizedKeywords = keywords
                    .Where(keyword => !string.IsNullOrWhiteSpace(keyword))
                    .Select(keyword => keyword.Trim())
                    .Where(keyword => keyword.Length > 0)
                    .Distinct(StringComparer.Ordinal)
                    .OrderBy(keyword => keyword, StringComparer.Ordinal)
                    .ToArray();

                var keywordHash = normalizedKeywords.Length > 0 ? string.Join("|", normalizedKeywords) : string.Empty;

                return new ShaderSignature
                {
                    name = shader != null ? shader.name : string.Empty,
                    path = GetAssetPath(shader),
                    passCount = shader != null ? shader.passCount : 0,
                    keywordHash = keywordHash,
                    totalVariantCount = variantInfo.TotalVariantCount,
                };
            }

            public bool Equals(ShaderSignature other)
            {
                return passCount == other.passCount &&
                    string.Equals(name, other.name, StringComparison.Ordinal) &&
                    string.Equals(path, other.path, StringComparison.Ordinal) &&
                    string.Equals(keywordHash, other.keywordHash, StringComparison.Ordinal) &&
                    totalVariantCount == other.totalVariantCount;
            }

            public override bool Equals(object obj)
            {
                return obj is ShaderSignature other && Equals(other);
            }

            public override int GetHashCode()
            {
                unchecked
                {
                    var hashCode = passCount;
                    hashCode = (hashCode * 397) ^ (name != null ? StringComparer.Ordinal.GetHashCode(name) : 0);
                    hashCode = (hashCode * 397) ^ (path != null ? StringComparer.Ordinal.GetHashCode(path) : 0);
                    hashCode = (hashCode * 397) ^ (keywordHash != null ? StringComparer.Ordinal.GetHashCode(keywordHash) : 0);
                    hashCode = (hashCode * 397) ^ totalVariantCount;
                    return hashCode;
                }
            }
        }

        private static readonly Dictionary<int, CachedEntry<TextureInfo, TextureSignature>> TextureCache = new();
        private static readonly Dictionary<int, CachedEntry<MeshInfo, MeshSignature>> MeshCache = new();
        private static readonly Dictionary<int, CachedEntry<RenderTextureInfo, RenderTextureSignature>> RenderTextureCache = new();
        private static readonly Dictionary<int, CachedEntry<MaterialInfo, MaterialSignature>> MaterialCache = new();
        private static readonly Dictionary<int, CachedEntry<ShaderInfo, ShaderSignature>> ShaderCache = new();

        private static readonly HashSet<int> TextureSeenIds = new();
        private static readonly HashSet<int> MeshSeenIds = new();
        private static readonly HashSet<int> RenderTextureSeenIds = new();
        private static readonly HashSet<int> MaterialSeenIds = new();
        private static readonly HashSet<int> ShaderSeenIds = new();

        private static readonly List<int> RemovalBuffer = new();

        private static readonly List<TextureInfo> TextureInfoBuffer = new();
        private static readonly List<MeshInfo> MeshInfoBuffer = new();
        private static readonly List<RenderTextureInfo> RenderTextureInfoBuffer = new();
        private static readonly List<MaterialInfo> MaterialInfoBuffer = new();
        private static readonly List<ShaderInfo> ShaderInfoBuffer = new();

        public static IEnumerator PopulateFramePreview(TelemetrySnapshot snapshot, float framePreviewScale)
        {
            if (snapshot == null)
            {
                yield break;
            }

            if (framePreviewScale <= 0f)
            {
                yield break;
            }

            yield return new WaitForEndOfFrame();

            Texture2D screenshot = null;
            Texture2D scaledScreenshot = null;

            try
            {
                screenshot = ScreenCapture.CaptureScreenshotAsTexture();
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[UnityProfileV2] Failed to capture frame preview: {ex.Message}\n{ex.StackTrace}");
            }

            var normalizedScale = Mathf.Clamp01(framePreviewScale);
            if (screenshot != null && normalizedScale > 0f && normalizedScale < 0.999f)
            {
                scaledScreenshot = TryScaleFramePreview(screenshot, normalizedScale);
                if (scaledScreenshot != null)
                {
                    UnityEngine.Object.Destroy(screenshot);
                    screenshot = scaledScreenshot;
                }
            }

            if (screenshot == null)
            {
                yield break;
            }

            try
            {
                var pngData = ImageConversion.EncodeToPNG(screenshot);
                if (pngData != null && pngData.Length > 0)
                {
                    var base64 = Convert.ToBase64String(pngData);
                    var orientation = DetermineOrientation(screenshot.width, screenshot.height);
                    snapshot.framePreview = new FramePreviewInfo
                    {
                        width = screenshot.width,
                        height = screenshot.height,
                        captureTimestampUtc = DateTime.UtcNow.ToString("o"),
                        previewBase64 = $"data:image/png;base64,{base64}",
                        orientation = string.IsNullOrEmpty(orientation) ? null : orientation
                    };
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[UnityProfileV2] Failed to encode frame preview: {ex.Message}\n{ex.StackTrace}");
            }
            finally
            {
                UnityEngine.Object.Destroy(screenshot);
            }
        }

        private static Texture2D TryScaleFramePreview(Texture2D source, float scale)
        {
            if (source == null)
            {
                return null;
            }

            scale = Mathf.Clamp(scale, 0.001f, 1f);
            var targetWidth = Mathf.Max(1, Mathf.RoundToInt(source.width * scale));
            var targetHeight = Mathf.Max(1, Mathf.RoundToInt(source.height * scale));

            if (targetWidth <= 0 || targetHeight <= 0)
            {
                return null;
            }

            if (targetWidth == source.width && targetHeight == source.height)
            {
                return null;
            }

            RenderTexture temporary = null;
            var previousActive = RenderTexture.active;
            try
            {
                temporary = RenderTexture.GetTemporary(targetWidth, targetHeight, 0, RenderTextureFormat.Default);
                Graphics.Blit(source, temporary);
                RenderTexture.active = temporary;
                var scaled = new Texture2D(targetWidth, targetHeight, TextureFormat.RGBA32, false)
                {
                    hideFlags = HideFlags.HideAndDontSave
                };
                scaled.ReadPixels(new Rect(0, 0, targetWidth, targetHeight), 0, 0);
                scaled.Apply(false, false);
                return scaled;
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[UnityProfileV2] Failed to scale frame preview: {ex.Message}\n{ex.StackTrace}");
                return null;
            }
            finally
            {
                RenderTexture.active = previousActive;
                if (temporary != null)
                {
                    RenderTexture.ReleaseTemporary(temporary);
                }
            }
        }

        private static string DetermineOrientation(int width, int height)
        {
            if (width <= 0 || height <= 0)
            {
                return string.Empty;
            }

            if (Mathf.Abs(width - height) <= 1)
            {
                return "square";
            }

            return width >= height ? "landscape" : "portrait";
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
    public struct ShaderVariantStats
    {
        public int shaderCount;
        public int totalVariants;
    }

    [Serializable]
    public class TelemetrySnapshot
    {
        public string timestampUtc;
        public int frameNumber;
        public float fps;
        public float deltaTime;
        public bool isIncremental;
        public int[] textureOrder = Array.Empty<int>();
        public TextureInfo[] textures = Array.Empty<TextureInfo>();
        public int[] meshOrder = Array.Empty<int>();
        public MeshInfo[] meshes = Array.Empty<MeshInfo>();
        public int[] renderTextureOrder = Array.Empty<int>();
        public RenderTextureInfo[] renderTextures = Array.Empty<RenderTextureInfo>();
        public int[] materialOrder = Array.Empty<int>();
        public MaterialInfo[] materials = Array.Empty<MaterialInfo>();
        public int[] shaderOrder = Array.Empty<int>();
        public ShaderInfo[] shaders = Array.Empty<ShaderInfo>();
        public ShaderVariantStats shaderVariantStats;
        public FrameTimingInfo frameTiming;
        public MemoryStats memoryStats;
        public ThreadStats threadStats;
        public AssetIoStats assetIo;
        public EnvironmentInfo environment;
        public FramePreviewInfo framePreview;
    }

    [Serializable]
    public class FramePreviewInfo
    {
        public string previewBase64;
        public string imageBase64;
        public int width;
        public int height;
        public string captureTimestampUtc;
        public string orientation;
    }

    [Serializable]
    public class PipelineStageTiming
    {
        public string stage;
        public float timeMs;
        public float contributionPercent;
    }

    [Serializable]
    public class DrawCallStats
    {
        public long drawCalls;
        public long setPassCalls;
        public long shadowDrawCalls;
        public long transparentDrawCalls;
        public long instancedBatches;
        public long dynamicBatches;
    }

    [Serializable]
    public class BottleneckHint
    {
        public string type;
        public string message;
        public string severity;
        public string source;
    }

    [Serializable]
    public class FrameTimingInfo
    {
        public float cpuFrameTimeMs;
        public float gpuFrameTimeMs;
        public float cpuMainThreadTimeMs;
        public float cpuRenderThreadTimeMs;
        public PipelineStageTiming[] pipelineStages;
        public DrawCallStats drawCalls;
        public BottleneckHint[] bottleneckHints;
    }

    [Serializable]
    public class GarbageCollectionStats
    {
        public int totalCollections;
        public float lastCollectionDurationMs;
        public float recentCollectionDurationMs;
        public long managedHeapSizeBytes;
    }

    [Serializable]
    public class MemoryStats
    {
        public long unityHeapBytes;
        public long nativeMemoryBytes;
        public long gpuMemoryBytes;
        public long texturePoolBytes;
        public long meshPoolBytes;
        public long otherMemoryBytes;
        public GarbageCollectionStats gc;
    }

    [Serializable]
    public class ThreadUtilizationSample
    {
        public string threadName;
        public float utilizationPercent;
        public float frameTimeMs;
    }

    [Serializable]
    public class ThreadStats
    {
        public float mainThreadPercent;
        public float renderThreadPercent;
        public float jobWorkerPercent;
        public ThreadUtilizationSample[] utilization;
    }

    [Serializable]
    public class AssetLoadSample
    {
        public string name;
        public float durationMs;
        public string status;
        public long sizeBytes;
        public string type;
        public string timestampUtc;
    }

    [Serializable]
    public class ResourceInstanceStats
    {
        public string resourceType;
        public int activeCount;
        public int peakCount;
    }

    [Serializable]
    public class ResourceUnloadEvent
    {
        public string resourceType;
        public string name;
        public string timestampUtc;
    }

    [Serializable]
    public class StreamingStatus
    {
        public string type;
        public float bufferedSeconds;
        public int droppedFrames;
        public bool isStalled;
    }

    [Serializable]
    public class AssetIoStats
    {
        public float assetBundleAverageLoadMs;
        public float addressableAverageLoadMs;
        public int asyncQueueLength;
        public float loadFailureRate;
        public AssetLoadSample[] recentLoads;
        public ResourceInstanceStats[] resourceInstances;
        public ResourceUnloadEvent[] unloadEvents;
        public StreamingStatus[] streamingStatuses;
    }

    [Serializable]
    public class PositionInfo
    {
        public float x;
        public float y;
        public float z;
    }

    [Serializable]
    public class EnvironmentExtraEntry
    {
        public string key;
        public string value;
    }

    [Serializable]
    public class EnvironmentInfo
    {
        public string gpuModel;
        public string gpuDriverVersion;
        public string cpuModel;
        public int cpuCoreCount;
        public string qualitySetting;
        public string screenResolution;
        public int screenRefreshRate;
        public string platform;
        public string sceneId;
        public string sceneName;
        public PositionInfo playerPosition;
        public float cameraHeight;
        public EnvironmentExtraEntry[] extra;
    }

    [Serializable]
    public struct TextureInfo
    {
        public int instanceId;
        public string name;
        public string path;
        public string textureId;
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

            var assetPath = AssetTelemetryUtility.GetAssetPath(texture);
            var normalizedPath = string.IsNullOrEmpty(assetPath)
                ? string.Empty
                : assetPath.Replace('\\', '/');
            var stableId = !string.IsNullOrEmpty(normalizedPath)
                ? $"path:{normalizedPath.ToLowerInvariant()}"
                : $"instance:{(texture != null ? texture.GetInstanceID().ToString(CultureInfo.InvariantCulture) : "0")}";

            return new TextureInfo
            {
                instanceId = texture != null ? texture.GetInstanceID() : 0,
                name = texture.name,
                path = assetPath,
                textureId = stableId,
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
        public int instanceId;
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
                instanceId = mesh != null ? mesh.GetInstanceID() : 0,
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
        public int instanceId;
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
                instanceId = material.GetInstanceID(),
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
        public int instanceId;
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
                instanceId = renderTexture != null ? renderTexture.GetInstanceID() : 0,
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
        public int instanceId;
        public string name;
        public string path;
        public int passCount;
        public string[] keywords;
        public int totalVariantCount;
        public bool IsValid => !string.IsNullOrEmpty(name);

        public static ShaderInfo FromShader(Shader shader, AssetTelemetryUtility.ShaderVariantInfo variantInfo)
        {
            return new ShaderInfo
            {
                instanceId = shader != null ? shader.GetInstanceID() : 0,
                name = shader.name,
                path = AssetTelemetryUtility.GetAssetPath(shader),
                passCount = shader.passCount,
                keywords = AssetTelemetryUtility.GetShaderKeywords(shader),
                totalVariantCount = variantInfo.TotalVariantCount,
            };
        }
    }
}
