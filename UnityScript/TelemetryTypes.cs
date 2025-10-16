using System;
using UnityEngine;

[Serializable]
public class ResourceEntry
{
    public string id;
    public string name;
    public string type;
    public int width;
    public int height;
    public int sizeKB;
    public string thumbnailUrl;
}

[Serializable]
public class ResourceWithTexture
{
    public ResourceEntry entry;
    // Texture reference not serialized when sending to server; used at runtime only
    [NonSerialized]
    public Texture tex;
}
