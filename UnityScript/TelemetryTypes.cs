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
    public int runtimeSizeKB;
    public int compressedSizeKB;
    public int sizeAfterCompressionKB;
    public string format;
    public int depth;
    public int mipCount;
    public int vertexCount;
    public int triangleCount;
    public string shader;
    public string notes;
    public string thumbnailUrl;
    public string dimension;
    public string wrapMode;
    public string filterMode;
    public int anisoLevel;
    public bool isReadable;
    public int antiAliasing;
    public string colorSpace;
    public int passCount;
    public int keywordCount;
    public string[] keywords;
    public string renderQueue;
    public string variantId;
    public int variantCount;
    public int subMeshCount;
    public float boundsX;
    public float boundsY;
    public float boundsZ;
    public string usage;
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
public class ResourceCategoryStat
{
    public string category;
    public int count;
    public int sizeKB;
}
