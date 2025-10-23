using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.Profiling;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;
#if UNITY_2017_1_OR_NEWER
using UnityEngine.Video;
#endif
#if UNITY_2020_2_OR_NEWER
using Unity.Profiling;
#endif

namespace UnityProfileV2.Telemetry
{
    public static partial class AssetTelemetryUtility
    {
        private const int MaxRecentIoEvents = 50;
        private static readonly FrameTiming[] FrameTimingBuffer = new FrameTiming[1];
        private static readonly List<StageRecorder> StageRecorders = new();
        private static readonly StageRecorderDefinition[] StageDefinitions =
        {
            new StageRecorderDefinition("脚本更新", new[] { "BehaviourUpdate", "PlayerLoop/Update/ScriptRunBehaviourUpdate" }),
            new StageRecorderDefinition("批处理", new[] { "BatchRenderer.Flush", "DrawDynamicBatching" }),
            new StageRecorderDefinition("阴影", new[] { "ShadowMap.Draw", "ShadowMap.RenderShadowmap" }),
            new StageRecorderDefinition("渲染", new[] { "Camera.Render", "RenderLoop.Draw" }),
            new StageRecorderDefinition("后处理", new[] { "PostLateUpdate.PresentAfterDraw", "PostProcessLayer.Render" }),
        };
#if UNITY_2020_2_OR_NEWER
        private static ProfilerRecorder s_drawCallsRecorder;
        private static ProfilerRecorder s_setPassCallsRecorder;
        private static ProfilerRecorder s_shadowDrawCallsRecorder;
        private static ProfilerRecorder s_transparentDrawCallsRecorder;
        private static ProfilerRecorder s_instancedBatchesRecorder;
        private static ProfilerRecorder s_dynamicBatchesRecorder;
#endif
        private static Transform s_cachedPlayerTransform;
        private static float s_lastPlayerLookupTime;

        static AssetTelemetryUtility()
        {
            InitializeStageRecorders();
#if UNITY_2020_2_OR_NEWER
            InitializeProfilerRecorders();
#endif
        }

        private static FrameTimingInfo CaptureFrameTimingInfo()
        {
            var info = new FrameTimingInfo
            {
                pipelineStages = Array.Empty<PipelineStageTiming>(),
                drawCalls = new DrawCallStats(),
                bottleneckHints = Array.Empty<BottleneckHint>()
            };

            FrameTimingManager.CaptureFrameTimings();
            if (FrameTimingManager.GetLatestTimings(1, FrameTimingBuffer) > 0)
            {
                var timing = FrameTimingBuffer[0];
                info.cpuFrameTimeMs = (float)timing.cpuFrameTime;
                info.gpuFrameTimeMs = (float)timing.gpuFrameTime;
#if UNITY_2020_2_OR_NEWER
                info.cpuMainThreadTimeMs = (float)timing.cpuMainThreadTime;
                info.cpuRenderThreadTimeMs = (float)timing.cpuRenderThreadTime;
#elif UNITY_2017_2_OR_NEWER
                info.cpuMainThreadTimeMs = (float)timing.cpuMainThreadFrameTime;
                info.cpuRenderThreadTimeMs = (float)timing.cpuRenderThreadFrameTime;
#else
                info.cpuMainThreadTimeMs = 0f;
                info.cpuRenderThreadTimeMs = 0f;
#endif
            }

            info.drawCalls = CaptureDrawCallStats();
            info.pipelineStages = CapturePipelineStages(info);
            info.bottleneckHints = DeriveBottleneckHints(info);
            return info;
        }

        private static MemoryStats CaptureMemoryStats(SnapshotData snapshotData)
        {
            var stats = new MemoryStats
            {
                unityHeapBytes = Profiler.GetMonoUsedSizeLong(),
                nativeMemoryBytes = Math.Max(0, Profiler.GetTotalAllocatedMemoryLong() - Profiler.GetMonoUsedSizeLong()),
                gpuMemoryBytes = Profiler.GetAllocatedMemoryForGraphicsDriver(),
                texturePoolBytes = snapshotData.textures.Sum(info => info.EstimatedBytes),
                meshPoolBytes = snapshotData.meshes.Sum(info => info.EstimatedBytes),
                gc = new GarbageCollectionStats
                {
                    totalCollections = GC.CollectionCount(0) + GC.CollectionCount(1) + GC.CollectionCount(2),
                    lastCollectionDurationMs = 0f,
                    recentCollectionDurationMs = 0f,
                    managedHeapSizeBytes = Profiler.GetMonoHeapSizeLong(),
                }
            };

            var totalAllocated = Profiler.GetTotalAllocatedMemoryLong();
            var knownPools = stats.texturePoolBytes + stats.meshPoolBytes;
            stats.otherMemoryBytes = Math.Max(0, totalAllocated - knownPools);

            return stats;
        }

        private static ThreadStats CaptureThreadStats(FrameTimingInfo frameTiming)
        {
            if (frameTiming == null)
            {
                return new ThreadStats
                {
                    utilization = Array.Empty<ThreadUtilizationSample>()
                };
            }

            var stats = new ThreadStats();
            var cpuFrame = Math.Max(frameTiming.cpuFrameTimeMs, 0f);
            var main = Math.Max(frameTiming.cpuMainThreadTimeMs, 0f);
            var render = Math.Max(frameTiming.cpuRenderThreadTimeMs, 0f);
            var remaining = Math.Max(0f, cpuFrame - main - render);
            stats.mainThreadPercent = cpuFrame > 1e-3f ? Mathf.Clamp01(main / cpuFrame) : 0f;
            stats.renderThreadPercent = cpuFrame > 1e-3f ? Mathf.Clamp01(render / cpuFrame) : 0f;
            stats.jobWorkerPercent = cpuFrame > 1e-3f ? Mathf.Clamp01(remaining / cpuFrame) : 0f;
            stats.utilization = new[]
            {
                new ThreadUtilizationSample { threadName = "Main Thread", utilizationPercent = stats.mainThreadPercent, frameTimeMs = main },
                new ThreadUtilizationSample { threadName = "Render Thread", utilizationPercent = stats.renderThreadPercent, frameTimeMs = render },
                new ThreadUtilizationSample { threadName = "Job Workers", utilizationPercent = stats.jobWorkerPercent, frameTimeMs = remaining },
            };
            return stats;
        }

        private static AssetIoStats CaptureAssetIoStats(TelemetryCollectionState state, SnapshotData snapshotData)
        {
            var stats = new AssetIoStats
            {
                recentLoads = Array.Empty<AssetLoadSample>(),
                resourceInstances = Array.Empty<ResourceInstanceStats>(),
                unloadEvents = Array.Empty<ResourceUnloadEvent>(),
                streamingStatuses = Array.Empty<StreamingStatus>()
            };

            var asyncOperations = Resources.FindObjectsOfTypeAll(typeof(AsyncOperation));
            if (asyncOperations != null)
            {
                stats.asyncQueueLength = asyncOperations
                    .OfType<AsyncOperation>()
                    .Count(op => op != null && !op.isDone);
            }

            if (state != null)
            {
                var textureLookup = CreateLookup(snapshotData.textures);
                UpdateResourceTracker(state, "Texture", textureLookup.Keys,
                    id => ResolveResourceName(textureLookup, id),
                    id => ResolveResourceSize(textureLookup, id));

                var meshLookup = CreateLookup(snapshotData.meshes);
                UpdateResourceTracker(state, "Mesh", meshLookup.Keys,
                    id => ResolveResourceName(meshLookup, id),
                    id => ResolveResourceSize(meshLookup, id));

                var renderTextureLookup = CreateLookup(snapshotData.renderTextures);
                UpdateResourceTracker(state, "RenderTexture", renderTextureLookup.Keys,
                    id => ResolveResourceName(renderTextureLookup, id),
                    id => ResolveResourceSize(renderTextureLookup, id));

                var materialLookup = CreateLookup(snapshotData.materials);
                UpdateResourceTracker(state, "Material", materialLookup.Keys,
                    id => ResolveResourceName(materialLookup, id),
                    id => ResolveResourceSize(materialLookup, id));

                var shaderLookup = CreateLookup(snapshotData.shaders);
                UpdateResourceTracker(state, "Shader", shaderLookup.Keys,
                    id => ResolveResourceName(shaderLookup, id),
                    id => ResolveResourceSize(shaderLookup, id));

                stats.resourceInstances = state.ResourceTrackers
                    .Select(pair => new ResourceInstanceStats
                    {
                        resourceType = pair.Key,
                        activeCount = pair.Value.ActiveIds.Count,
                        peakCount = pair.Value.PeakCount,
                    })
                    .OrderByDescending(entry => entry.activeCount)
                    .ToArray();

                stats.recentLoads = state.RecentLoads.ToArray();
                stats.unloadEvents = state.RecentUnloads.Count <= MaxRecentIoEvents
                    ? state.RecentUnloads.ToArray()
                    : state.RecentUnloads.Skip(Math.Max(0, state.RecentUnloads.Count - MaxRecentIoEvents)).ToArray();
            }
            else
            {
                stats.resourceInstances = new[]
                {
                    new ResourceInstanceStats { resourceType = "Texture", activeCount = snapshotData.textures.Length, peakCount = snapshotData.textures.Length },
                    new ResourceInstanceStats { resourceType = "Mesh", activeCount = snapshotData.meshes.Length, peakCount = snapshotData.meshes.Length },
                    new ResourceInstanceStats { resourceType = "RenderTexture", activeCount = snapshotData.renderTextures.Length, peakCount = snapshotData.renderTextures.Length },
                    new ResourceInstanceStats { resourceType = "Material", activeCount = snapshotData.materials.Length, peakCount = snapshotData.materials.Length },
                    new ResourceInstanceStats { resourceType = "Shader", activeCount = snapshotData.shaders.Length, peakCount = snapshotData.shaders.Length },
                };
            }

            stats.streamingStatuses = CaptureStreamingStatuses();

            return stats;
        }

        private static EnvironmentInfo CaptureEnvironmentInfo()
        {
            var info = new EnvironmentInfo
            {
                gpuModel = SafeTrim(SystemInfo.graphicsDeviceName),
                gpuDriverVersion = SafeTrim(SystemInfo.graphicsDeviceVersion),
                cpuModel = SafeTrim(SystemInfo.processorType),
                cpuCoreCount = SystemInfo.processorCount,
                platform = Application.platform.ToString(),
                qualitySetting = ResolveQualityLabel(),
                screenResolution = ResolveScreenResolution(),
                screenRefreshRate = Screen.currentResolution.refreshRate,
            };

            var scene = SceneManager.GetActiveScene();
            if (scene.IsValid())
            {
                info.sceneName = SafeTrim(scene.name);
                info.sceneId = scene.buildIndex >= 0 ? scene.buildIndex.ToString() : string.Empty;
            }

            var player = ResolvePlayerTransform();
            if (player != null)
            {
                info.playerPosition = new PositionInfo
                {
                    x = player.position.x,
                    y = player.position.y,
                    z = player.position.z,
                };
            }

            var camera = Camera.main;
            if (camera != null)
            {
                info.cameraHeight = camera.transform.position.y;
            }

            var extras = new List<EnvironmentExtraEntry>();
            if (!string.IsNullOrEmpty(SystemInfo.deviceModel))
            {
                extras.Add(new EnvironmentExtraEntry { key = "Device Model", value = SafeTrim(SystemInfo.deviceModel) });
            }

            extras.Add(new EnvironmentExtraEntry { key = "Graphics API", value = SystemInfo.graphicsDeviceType.ToString() });
            extras.Add(new EnvironmentExtraEntry { key = "System Memory", value = $"{SystemInfo.systemMemorySize} MB" });
            extras.Add(new EnvironmentExtraEntry { key = "Graphics Memory", value = $"{SystemInfo.graphicsMemorySize} MB" });

            info.extra = extras.Count > 0 ? extras.ToArray() : null;

            return info;
        }

        private static DrawCallStats CaptureDrawCallStats()
        {
            var stats = new DrawCallStats();
#if UNITY_2020_2_OR_NEWER
            if (s_drawCallsRecorder.Valid)
            {
                stats.drawCalls = s_drawCallsRecorder.LastValue;
            }
            if (s_setPassCallsRecorder.Valid)
            {
                stats.setPassCalls = s_setPassCallsRecorder.LastValue;
            }
            if (s_shadowDrawCallsRecorder.Valid)
            {
                stats.shadowDrawCalls = s_shadowDrawCallsRecorder.LastValue;
            }
            if (s_transparentDrawCallsRecorder.Valid)
            {
                stats.transparentDrawCalls = s_transparentDrawCallsRecorder.LastValue;
            }
            if (s_instancedBatchesRecorder.Valid)
            {
                stats.instancedBatches = s_instancedBatchesRecorder.LastValue;
            }
            if (s_dynamicBatchesRecorder.Valid)
            {
                stats.dynamicBatches = s_dynamicBatchesRecorder.LastValue;
            }
#endif
            return stats;
        }

        private static PipelineStageTiming[] CapturePipelineStages(FrameTimingInfo frameTiming)
        {
            if (StageRecorders.Count == 0)
            {
                return Array.Empty<PipelineStageTiming>();
            }

            var stages = new List<PipelineStageTiming>(StageRecorders.Count);
            var total = 0f;
            foreach (var stage in StageRecorders)
            {
                if (stage.Recorder == null || !stage.Recorder.valid)
                {
                    continue;
                }

                var elapsedNanoseconds = stage.Recorder.elapsedNanoseconds;
                if (elapsedNanoseconds <= 0)
                {
                    continue;
                }

                var timeMs = (float)(elapsedNanoseconds / 1_000_000.0);
                if (timeMs <= 0f)
                {
                    continue;
                }

                total += timeMs;
                stages.Add(new PipelineStageTiming
                {
                    stage = stage.Label,
                    timeMs = timeMs,
                });
            }

            if (stages.Count == 0)
            {
                return Array.Empty<PipelineStageTiming>();
            }

            var frameTime = frameTiming != null && frameTiming.cpuFrameTimeMs > 1e-3f
                ? frameTiming.cpuFrameTimeMs
                : total;

            foreach (var stage in stages)
            {
                stage.contributionPercent = frameTime > 1e-3f ? Mathf.Clamp(stage.timeMs / frameTime, 0f, 1f) : 0f;
            }

            return stages.ToArray();
        }

        private static BottleneckHint[] DeriveBottleneckHints(FrameTimingInfo frameTiming)
        {
            var hints = new List<BottleneckHint>();
            if (frameTiming == null)
            {
                return hints.ToArray();
            }

            if (frameTiming.gpuFrameTimeMs > frameTiming.cpuFrameTimeMs + 1f)
            {
                hints.Add(new BottleneckHint
                {
                    type = "gpu",
                    severity = "warning",
                    message = "GPU 帧耗时高于 CPU，可能存在 GPU 瓶颈",
                    source = "FrameTiming"
                });
            }
            else if (frameTiming.cpuFrameTimeMs > frameTiming.gpuFrameTimeMs + 1f)
            {
                hints.Add(new BottleneckHint
                {
                    type = "cpu",
                    severity = "warning",
                    message = "CPU 帧耗时高于 GPU，关注脚本或主线程负载",
                    source = "FrameTiming"
                });
            }

            if (frameTiming.drawCalls != null && frameTiming.drawCalls.drawCalls > 2000)
            {
                hints.Add(new BottleneckHint
                {
                    type = "rendering",
                    severity = "warning",
                    message = "Draw Call 数量较高，考虑合批或裁剪",
                    source = "DrawCalls"
                });
            }

            return hints.ToArray();
        }

        private static StreamingStatus[] CaptureStreamingStatuses()
        {
            var statuses = new List<StreamingStatus>();
#if UNITY_2017_1_OR_NEWER
            foreach (var player in Resources.FindObjectsOfTypeAll<VideoPlayer>())
            {
                if (player == null)
                {
                    continue;
                }

                var status = new StreamingStatus
                {
                    type = string.IsNullOrEmpty(player.name) ? "Video" : $"Video:{player.name}",
                    droppedFrames =
#if UNITY_2018_2_OR_NEWER
                        (int)player.droppedFrameCount,
#else
                        0,
#endif
                    isStalled = player.isPrepared && player.isPlaying && player.frameRate > 0 && player.isPaused,
                };

                if (player.frameRate > 0 && player.frameCount > 0)
                {
                    var remainingFrames = Math.Max(0L, (long)player.frameCount - (long)player.frame);
                    status.bufferedSeconds = (float)(remainingFrames / player.frameRate);
                }

                statuses.Add(status);
            }
#endif
            return statuses.ToArray();
        }

        private static void InitializeStageRecorders()
        {
            StageRecorders.Clear();
            foreach (var definition in StageDefinitions)
            {
                foreach (var sampleName in definition.SampleNames)
                {
                    Recorder recorder = null;
                    try
                    {
                        recorder = Recorder.Get(sampleName);
                    }
                    catch
                    {
                        recorder = null;
                    }

                    if (recorder != null && recorder.valid)
                    {
                        recorder.enabled = true;
                        StageRecorders.Add(new StageRecorder { Label = definition.Label, Recorder = recorder });
                        break;
                    }
                }
            }
        }

#if UNITY_2020_2_OR_NEWER
        private static void InitializeProfilerRecorders()
        {
            TryStartRecorder(ref s_drawCallsRecorder, ProfilerCategory.Render, "Draw Calls Count");
            TryStartRecorder(ref s_setPassCallsRecorder, ProfilerCategory.Render, "SetPass Calls Count");
            TryStartRecorder(ref s_shadowDrawCallsRecorder, ProfilerCategory.Render, "Shadow Draw Calls Count");
            TryStartRecorder(ref s_transparentDrawCallsRecorder, ProfilerCategory.Render, "Transparent Renderers");
            TryStartRecorder(ref s_instancedBatchesRecorder, ProfilerCategory.Render, "Instanced Batches Count");
            TryStartRecorder(ref s_dynamicBatchesRecorder, ProfilerCategory.Render, "Dynamic Batches Count");
        }

        private static void TryStartRecorder(ref ProfilerRecorder recorder, ProfilerCategory category, string name)
        {
            if (recorder.Valid)
            {
                return;
            }

            try
            {
                recorder = ProfilerRecorder.StartNew(category, name);
            }
            catch
            {
                recorder = default;
            }
        }
#endif

        private static Dictionary<int, TInfo> CreateLookup<TInfo>(IEnumerable<TInfo> items) where TInfo : struct
        {
            var lookup = new Dictionary<int, TInfo>();
            if (items == null)
            {
                return lookup;
            }

            foreach (var item in items)
            {
                if (TryGetInstanceId(item, out var id))
                {
                    lookup[id] = item;
                }
            }

            return lookup;
        }

        private static string ResolveResourceName<TInfo>(Dictionary<int, TInfo> lookup, int instanceId) where TInfo : struct
        {
            if (lookup != null && lookup.TryGetValue(instanceId, out var item))
            {
                return TryGetName(item);
            }

            return string.Empty;
        }

        private static long ResolveResourceSize<TInfo>(Dictionary<int, TInfo> lookup, int instanceId) where TInfo : struct
        {
            if (lookup != null && lookup.TryGetValue(instanceId, out var item))
            {
                return TryGetSize(item);
            }

            return 0L;
        }

        private static bool TryGetInstanceId<TInfo>(TInfo item, out int instanceId)
        {
            switch (item)
            {
                case TextureInfo textureInfo:
                    instanceId = textureInfo.instanceId;
                    return true;
                case MeshInfo meshInfo:
                    instanceId = meshInfo.instanceId;
                    return true;
                case RenderTextureInfo renderTextureInfo:
                    instanceId = renderTextureInfo.instanceId;
                    return true;
                case MaterialInfo materialInfo:
                    instanceId = materialInfo.instanceId;
                    return true;
                case ShaderInfo shaderInfo:
                    instanceId = shaderInfo.instanceId;
                    return true;
                default:
                    instanceId = 0;
                    return false;
            }
        }

        private static string TryGetName<TInfo>(TInfo item)
        {
            return item switch
            {
                TextureInfo textureInfo => SafeTrim(textureInfo.name),
                MeshInfo meshInfo => SafeTrim(meshInfo.name),
                RenderTextureInfo renderTextureInfo => SafeTrim(renderTextureInfo.name),
                MaterialInfo materialInfo => SafeTrim(materialInfo.name),
                ShaderInfo shaderInfo => SafeTrim(shaderInfo.name),
                _ => string.Empty,
            };
        }

        private static long TryGetSize<TInfo>(TInfo item)
        {
            return item switch
            {
                TextureInfo textureInfo => textureInfo.EstimatedBytes,
                MeshInfo meshInfo => meshInfo.EstimatedBytes,
                RenderTextureInfo renderTextureInfo => renderTextureInfo.EstimatedBytes,
                MaterialInfo materialInfo => materialInfo.memoryBytes,
                ShaderInfo _ => 0L,
                _ => 0L,
            };
        }

        private static void UpdateResourceTracker(
            TelemetryCollectionState state,
            string resourceType,
            IEnumerable<int> instanceIds,
            Func<int, string> resolveName,
            Func<int, long> resolveSize)
        {
            if (state == null)
            {
                return;
            }

            if (!state.ResourceTrackers.TryGetValue(resourceType, out var tracker))
            {
                tracker = new ResourceTracker();
                state.ResourceTrackers[resourceType] = tracker;
            }

            tracker.Scratch.Clear();
            foreach (var id in tracker.ActiveIds)
            {
                tracker.Scratch.Add(id);
            }

            var now = DateTime.UtcNow.ToString("o");
            foreach (var id in instanceIds)
            {
                tracker.ActiveIds.Add(id);
                tracker.Scratch.Remove(id);

                var name = resolveName?.Invoke(id) ?? string.Empty;
                var size = resolveSize != null ? resolveSize(id) : 0L;

                if (!tracker.Descriptors.TryGetValue(id, out var descriptor))
                {
                    descriptor = new ResourceDescriptor();
                    tracker.Descriptors[id] = descriptor;
                    EnqueueRecentLoad(state, new AssetLoadSample
                    {
                        name = name,
                        sizeBytes = size,
                        status = "success",
                        type = resourceType,
                        timestampUtc = now,
                        durationMs = 0f,
                    });
                }

                descriptor.Name = name;
                descriptor.SizeBytes = size;
            }

            foreach (var removedId in tracker.Scratch)
            {
                tracker.ActiveIds.Remove(removedId);
                if (tracker.Descriptors.TryGetValue(removedId, out var descriptor))
                {
                    state.RecentUnloads.Add(new ResourceUnloadEvent
                    {
                        resourceType = resourceType,
                        name = descriptor.Name,
                        timestampUtc = now,
                    });
                    tracker.Descriptors.Remove(removedId);
                }
            }

            if (state.RecentUnloads.Count > MaxRecentIoEvents)
            {
                state.RecentUnloads.RemoveRange(0, state.RecentUnloads.Count - MaxRecentIoEvents);
            }

            tracker.PeakCount = Mathf.Max(tracker.PeakCount, tracker.ActiveIds.Count);
            tracker.Scratch.Clear();
        }

        private static void EnqueueRecentLoad(TelemetryCollectionState state, AssetLoadSample sample)
        {
            if (state == null || sample == null)
            {
                return;
            }

            state.RecentLoads.Enqueue(sample);
            while (state.RecentLoads.Count > MaxRecentIoEvents)
            {
                state.RecentLoads.Dequeue();
            }
        }

        private static Transform ResolvePlayerTransform()
        {
            if (s_cachedPlayerTransform != null)
            {
                return s_cachedPlayerTransform;
            }

            if (Time.realtimeSinceStartup - s_lastPlayerLookupTime < 1f)
            {
                return s_cachedPlayerTransform;
            }

            s_lastPlayerLookupTime = Time.realtimeSinceStartup;
            try
            {
                var player = GameObject.FindGameObjectWithTag("Player");
                if (player != null)
                {
                    s_cachedPlayerTransform = player.transform;
                    return s_cachedPlayerTransform;
                }
            }
            catch
            {
                // ignored
            }

            return s_cachedPlayerTransform;
        }

        private static string ResolveQualityLabel()
        {
            try
            {
                var level = QualitySettings.GetQualityLevel();
                var names = QualitySettings.names;
                if (names != null && level >= 0 && level < names.Length)
                {
                    return names[level];
                }
            }
            catch
            {
                // ignored
            }

            return string.Empty;
        }

        private static string ResolveScreenResolution()
        {
            try
            {
                var resolution = Screen.currentResolution;
                if (resolution.width > 0 && resolution.height > 0)
                {
                    return $"{resolution.width}x{resolution.height}";
                }
            }
            catch
            {
                // ignored
            }

            return string.Empty;
        }

        private static string SafeTrim(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
        }

        internal sealed class ResourceTracker
        {
            public int PeakCount;
            public HashSet<int> ActiveIds { get; } = new();
            public HashSet<int> Scratch { get; } = new();
            public Dictionary<int, ResourceDescriptor> Descriptors { get; } = new();

            public void Reset()
            {
                PeakCount = 0;
                ActiveIds.Clear();
                Scratch.Clear();
                Descriptors.Clear();
            }
        }

        internal sealed class ResourceDescriptor
        {
            public string Name;
            public long SizeBytes;
        }

        private readonly struct StageRecorderDefinition
        {
            public StageRecorderDefinition(string label, string[] sampleNames)
            {
                Label = label;
                SampleNames = sampleNames;
            }

            public string Label { get; }
            public string[] SampleNames { get; }
        }

        private sealed class StageRecorder
        {
            public string Label;
            public Recorder Recorder;
        }
    }
}
