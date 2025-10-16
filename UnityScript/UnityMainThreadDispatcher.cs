using System;
using System.Collections.Generic;
using UnityEngine;

// Very small main-thread dispatcher for Unity. Attach to a GameObject or call Instance() once in code.
public class UnityMainThreadDispatcher : MonoBehaviour
{
    private static UnityMainThreadDispatcher _instance;
    private readonly Queue<Action> _jobs = new Queue<Action>();

    public static UnityMainThreadDispatcher Instance()
    {
        if (_instance == null)
        {
            var go = new GameObject("__UnityMainThreadDispatcher");
            DontDestroyOnLoad(go);
            _instance = go.AddComponent<UnityMainThreadDispatcher>();
        }
        return _instance;
    }

    public void Enqueue(Action a)
    {
        if (a == null) return;
        lock (_jobs) { _jobs.Enqueue(a); }
    }

    void Update()
    {
        while (true)
        {
            Action a = null;
            lock (_jobs) { if (_jobs.Count > 0) a = _jobs.Dequeue(); }
            if (a == null) break;
            try { a(); } catch (Exception ex) { Debug.LogException(ex); }
        }
    }
}
