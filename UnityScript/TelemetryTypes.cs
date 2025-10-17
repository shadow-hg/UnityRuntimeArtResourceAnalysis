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
    public string dimension;
    public string filterMode;
    public string wrapMode;
    public string colorSpace;
    public string[] keywords;
    public ResourceMetric[] metrics;
    public string parentId;
    public string variantKey;
    public int subMeshCount;
}

[Serializable]
public class ResourceWithTexture
{
    public ResourceEntry entry;
    // Texture reference not serialized when sending to server; used at runtime only
    [NonSerialized]
    public Texture tex;
}

[Serializable]
public class ResourceMetric
{
    public string label;
    public string value;
}

[Serializable]
public class ResourceCategoryStat
{
    public string category;
    public int count;
    public int sizeKB;
}
