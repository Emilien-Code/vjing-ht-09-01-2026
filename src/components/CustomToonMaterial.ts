import * as THREE from "three/webgpu"
import {
    Fn, uniform, varying, normalLocal, modelWorldMatrix, screenCoordinate, materialOpacity,
    float, vec2, vec3, vec4, normalize, dot, floor, step, clamp, mix, pow, select,
} from 'three/tsl'
import { randd } from "../tsl/noise"

// Stippled "toon" material: the surface is lit by a single directional light
// (uLightDir), and everything darker than `threshold` is broken up into
// screen-space noise dots instead of a smooth shading ramp.
//
// Exposes the same `uniforms` map (each entry a TSL uniform node, so
// `mat.uniforms.threshold.value = v` keeps working) as the GLSL version did.
// The old uvSprite/uvOrigin uniforms only remapped UVs for a colour/normal map
// that this material never has, so they're gone.

const remap = (value: any, inMin: any, inMax: any, outMin: number, outMax: number) =>
    value.sub(inMin).div(float(inMax).sub(inMin)).mul(outMax - outMin).add(outMin)

const exponentialInOut = (t: any) => {
    const lower = pow(float(2.0), t.mul(20.0).sub(10.0)).mul(0.5)
    const upper = pow(float(2.0), float(10.0).sub(t.mul(20.0))).mul(-0.5).add(1.0)
    return select(t.equal(0.0).or(t.equal(1.0)), t, select(t.lessThan(0.5), lower, upper))
}

export default class CustomToonMaterial extends THREE.MeshBasicNodeMaterial {
    uniforms: { [key: string]: { value: any } }

    constructor(color: {
        baseColor: THREE.ColorRepresentation
        noiseColor: THREE.ColorRepresentation
        color: THREE.ColorRepresentation
    }, threshold = 0.7) {
        super()

        const uniforms = {
            diffuse: uniform(new THREE.Color(color.color)),
            noiseColor: uniform(new THREE.Color(color.noiseColor)),
            baseColor: uniform(new THREE.Color(color.baseColor)),
            time: uniform(0),
            threshold: uniform(threshold),
            noiseDensity: uniform(1.0),
            uLightDir: uniform(new THREE.Vector3(2, 4, 3).normalize()),
            uLightColor: uniform(new THREE.Color(0xffffff)),
            uLightIntensity: uniform(2.0),
        }
        this.uniforms = uniforms

        // World-space normal, computed the way the GLSL did:
        // `normalize(vec3(vec4(normal, 0.0) * modelMatrix))` (row-vector
        // multiply, i.e. the transposed matrix).
        const vNormalW = varying(normalize(modelWorldMatrix.transpose().mul(vec4(normalLocal, 0.0)).xyz))

        const getGradientIrradiance = (normal: any, lightDirection: any) => {
            const coordX = dot(normal, lightDirection).mul(0.5).add(0.5)

            const resolution = float(1.0).div(uniforms.noiseDensity)
            const uvp = screenCoordinate.add(uniforms.time)
            const lowres = vec2(floor(uvp.x.div(resolution)), floor(uvp.y.div(resolution)))
            const gradient = clamp(
                remap(float(1.0).sub(coordX), float(1.0).sub(uniforms.threshold), 1.0, 0.0, 1.0),
                0.0, 1.0,
            )
            const noiseAmount = exponentialInOut(gradient)
            const n = step(noiseAmount, randd(lowres))

            return select(coordX.lessThan(uniforms.threshold), vec3(n), vec3(1.0))
        }

        this.fragmentNode = Fn(() => {
            const diffuseRgb: any = (uniforms.diffuse as any).pow(vec3(0.8))

            const directDiffuse = getGradientIrradiance(vNormalW, normalize(uniforms.uLightDir))
                .mul(uniforms.uLightColor)
                .mul(uniforms.uLightIntensity)

            const outgoingLight = mix(
                uniforms.noiseColor,
                uniforms.baseColor.mul(diffuseRgb),
                clamp(directDiffuse as any, 0.0, 1.0),
            )

            return vec4(outgoingLight, materialOpacity)
        })()
    }
}
