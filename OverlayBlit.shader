Shader "Hidden/Analyzer/OverlayBlit"
{
    SubShader
    {
        ZWrite Off ZTest Always Cull Off
        Blend SrcAlpha OneMinusSrcAlpha

        Pass
        {
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.yoozoo.owl.rendering.hrp/RenderPipeline/ShaderLibrary/HPipelineData.hlsl"

            struct Attributes { float4 positionOS : POSITION; float2 uv : TEXCOORD0; };
            struct Varyings { float4 positionHCS : SV_POSITION; float2 uv : TEXCOORD0; };

            sampler2D _OverlayTex;
            float4 _OverlayTex_TexelSize;
            float _GlobalOpacity;

            Varyings Vert(Attributes v)
            {
                Varyings o;
                o.positionHCS = TransformObjectToHClip(v.positionOS);
                o.uv = v.uv;
                return o;
            }

            float4 Frag(Varyings i) : SV_Target
            {
                float4 c = tex2D(_OverlayTex, i.uv);
                c.a *= saturate(_GlobalOpacity);
                return c;
            }
            ENDHLSL
        }
    }
}
