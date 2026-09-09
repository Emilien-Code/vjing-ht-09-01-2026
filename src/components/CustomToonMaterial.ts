import * as THREE from "three"

const vertexShader = `
#define TOON

varying vec3 vViewPosition;

#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

float map(float value, float inMin, float inMax, float outMin, float outMax) {
    return outMin + (outMax - outMin) * (value - inMin) / (inMax - inMin);
}

float cmap(float oldValue, float oldMin, float oldMax, float newMin, float newMax) {
    return clamp(map(oldValue, oldMin, oldMax, newMin, newMax), min(newMax, newMin), max(newMin, newMax));
}

uniform vec4 uvSprite;
uniform vec4 uvOrigin;

varying vec3 vPositionW;
varying vec3 vNormalW;

void main() {
    #include <uv_vertex>

    #ifdef USE_MAP
        vMapUv.x = cmap(vMapUv.x, uvOrigin.x, uvOrigin.y, uvSprite.x, uvSprite.y);
        vMapUv.y = cmap(vMapUv.y, uvOrigin.z, uvOrigin.w, uvSprite.z, uvSprite.w);
    #endif
    #ifdef USE_NORMALMAP
        vNormalMapUv.x = cmap(vNormalMapUv.x, uvOrigin.x, uvOrigin.y, uvSprite.x, uvSprite.y);
        vNormalMapUv.y = cmap(vNormalMapUv.y, uvOrigin.z, uvOrigin.w, uvSprite.z, uvSprite.w);
    #endif

    #include <batching_vertex>
    #include <beginnormal_vertex>
    #include <morphnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <defaultnormal_vertex>
    #include <normal_vertex>
    #include <begin_vertex>
    #include <morphtarget_vertex>
    #include <skinning_vertex>
    #include <project_vertex>
    #include <logdepthbuf_vertex>
    #include <clipping_planes_vertex>

    vViewPosition = - mvPosition.xyz;

    #include <worldpos_vertex>
    #include <shadowmap_vertex>

    vPositionW = vec3( vec4( position, 1.0 ) * modelMatrix);
    vNormalW = normalize( vec3( vec4( normal, 0.0 ) * modelMatrix ) );
}
`

const fragmentShader = `
#define TOON

uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
uniform float time;
uniform float threshold;
uniform float noiseDensity;
uniform vec3 noiseColor;
uniform vec3 baseColor;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uLightIntensity;

float remap(float value, float inMin, float inMax, float outMin, float outMax) {
    return outMin + (outMax - outMin) * (value - inMin) / (inMax - inMin);
}

float cremap(float oldValue, float oldMin, float oldMax, float newMin, float newMax) {
    return clamp(remap(oldValue, oldMin, oldMax, newMin, newMax), min(newMax, newMin), max(newMin, newMax));
}

float randd(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

varying vec3 vPositionW;
varying vec3 vNormalW;

float exponentialInOut(float t) {
    return t == 0.0 || t == 1.0
        ? t
        : t < 0.5
            ? +0.5 * pow(2.0, (20.0 * t) - 10.0)
            : -0.5 * pow(2.0, 10.0 - (t * 20.0)) + 1.0;
}

#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphahash_pars_fragment>
#include <lightmap_pars_fragment>

#ifdef USE_GRADIENTMAP
    uniform sampler2D gradientMap;
#endif

vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
    float dotNL = dot( normal, lightDirection );
    vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );

    #ifdef USE_GRADIENTMAP
        return texture2D( gradientMap, coord ).rgb;
    #else
        float t = threshold;
        vec3 g = vec3(1.0);
        if( coord.x < t ) {
            float resolution = 1.0 / noiseDensity;
            vec2 uv = gl_FragCoord.xy + time;
            vec2 lowresxy = vec2(
                floor(uv.x / resolution),
                floor(uv.y / resolution)
            );
            float gradient = cremap(1.0 - coord.x, 1.0 - threshold, 1.0, 0.0, 1.0);
            gradient = exponentialInOut(gradient);
            float noiseAmount = gradient;
            float n = step(noiseAmount, randd(lowresxy));
            g = vec3(n);
        }
        return g;
    #endif
}

#include <bsdfs>
#include <normal_pars_fragment>

varying vec3 vViewPosition;

#include <shadowmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

void main() {
    #include <clipping_planes_fragment>

    vec4 diffuseColor = vec4( diffuse, opacity );

    #include <logdepthbuf_fragment>
    #include <map_fragment>
    diffuseColor.rgb = pow(diffuseColor.rgb, vec3(0.8));

    #include <alphahash_fragment>
    #include <normal_fragment_begin>
    #include <normal_fragment_maps>

    vec3 directDiffuse = getGradientIrradiance(vNormalW, normalize(uLightDir)) * uLightColor * uLightIntensity;

    vec3 outgoingLight = mix(noiseColor, baseColor * diffuseColor.rgb, saturate(directDiffuse));

    #include <opaque_fragment>

    gl_FragColor = vec4( outgoingLight, diffuseColor.a );

    #include <colorspace_fragment>
}
`

export default class CustomToonMaterial extends THREE.MeshToonMaterial {
    uniforms: { [key: string]: { value: any } }
    declare vertexShader: string
    declare fragmentShader: string

    constructor(color: {
        baseColor: THREE.ColorRepresentation
        noiseColor: THREE.ColorRepresentation
        color: THREE.ColorRepresentation
    }, threshold = 0.7) {
        super()
        this.lights = false

        this.uniforms = {
            ...THREE.ShaderLib.toon.uniforms,
            diffuse: { value: new THREE.Color(color.color) },
            noiseColor: { value: new THREE.Color(color.noiseColor) },
            baseColor: { value: new THREE.Color(color.baseColor) },
            time: { value: 0 },
            threshold: { value: threshold },
            noiseDensity: { value: 1.0 },
            uvSprite: { value: new THREE.Vector4(0, 1, 0, 1) },
            uvOrigin: { value: new THREE.Vector4(0, 1, 0, 1) },
            uLightDir: { value: new THREE.Vector3(2, 4, 3).normalize() },
            uLightColor: { value: new THREE.Color(0xffffff) },
            uLightIntensity: { value: 2.0 },
        }

        this.vertexShader = vertexShader
        this.fragmentShader = fragmentShader
            ; (this as any).type = "ShaderMaterial"
    }
}
