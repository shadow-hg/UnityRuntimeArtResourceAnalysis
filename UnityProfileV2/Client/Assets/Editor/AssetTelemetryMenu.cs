#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;

namespace UnityProfileV2.Telemetry.Editor
{
    public static class AssetTelemetryMenu
    {
        [MenuItem("Tools/UnityProfileV2/Add Telemetry Reporter", priority = 0)]
        private static void AddReporter()
        {
            var reporter = Object.FindObjectOfType<AssetTelemetryReporter>();
            if (reporter == null)
            {
                var go = new GameObject("AssetTelemetryReporter");
                reporter = go.AddComponent<AssetTelemetryReporter>();
                Undo.RegisterCreatedObjectUndo(go, "Create AssetTelemetryReporter");
            }

            Selection.activeObject = reporter.gameObject;
        }
    }
}
#endif
