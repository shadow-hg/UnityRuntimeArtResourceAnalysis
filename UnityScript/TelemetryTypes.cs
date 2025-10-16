using System;
using UnityEngine;

[Serializable]
public class ResourceEntry
{
    public string id;
    public string name;
    public string type;
    public string category;
    public int width;
    public int height;
    public int sizeKB;
    public string format;
    public int depth;
    public int mipCount;
    public int vertexCount;
    public int triangleCount;
    public string shader;
    public string notes;
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
