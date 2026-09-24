import { NodeMaterial } from 'three/webgpu'
import {
    Fn, varying, positionLocal, normalLocal, modelWorldMatrix, cameraPosition,
    cameraViewMatrix, cameraProjectionMatrix, screenCoordinate,
    float, vec2, vec3, vec4, normalize, dot, length, floor, clamp, mix, pow, select,
} from 'three/tsl'
import { cnoise3, randd, smoothstepAny } from './noise'

// Shared by Sphere (the levitating sphere scene) and the WaterDancing floor:
// a high-frequency Perlin noise displaces every vertex along its normal,
// scaled by a fresnel term, and the noise also drives a 3-colour gradient
// that gets grainy pixel-noise on top. The floor additionally lifts / reveals
// itself around the dancer's feet and hips (`footsteps: true`).

// `u` is the caller's uniform map (each entry a TSL uniform node). Required:
//   uTime, uElevation, uElevationIntensity, uColor1..3, uGrainAmount, uGrainDensity
// and, with footsteps: uLeftFootPos, uRightFootPos, uFootTouchL/R,
//   uLeftFootRadius, uRightFootRadius, uFootBumpHeight, uBodyCirclePos,
//   uBodyCircleRadius
export function createNoiseSurfaceMaterial(u: Record<string, any>, opts: { footsteps: boolean }) {
    const exponentialIn = (t: any) =>
        select(t.equal(0.0), t, pow(float(2.0), t.sub(1.0).mul(10.0)))

    const footGlowAt = (xz: any) => {
        const footDistL = length(xz.sub(u.uLeftFootPos.xz))
        const footDistR = length(xz.sub(u.uRightFootPos.xz))
        const footGlowL = u.uFootTouchL.mul(smoothstepAny(u.uLeftFootRadius, 0.0, footDistL))
        const footGlowR = u.uFootTouchR.mul(smoothstepAny(u.uRightFootRadius, 0.0, footDistR))
        return { footGlowL, footGlowR }
    }

    // ---- vertex ----
    // (Plain expressions only: .assign() is only legal inside an Fn().)
    const modelPosition = modelWorldMatrix.mul(vec4(positionLocal, 1.0))

    // FRESNEL
    const viewDirection = normalize(modelPosition.xyz.sub(cameraPosition))
    const fresnel = dot(viewDirection, normalLocal).add(1.0)

    const noiseValue = cnoise3(vec3(modelPosition.xz.mul(200000.0), u.uTime.mul(0.5)))
    let displaced = normalize(normalLocal)
        .mul(exponentialIn(noiseValue)).mul(fresnel).mul(u.uElevation)

    if (opts.footsteps) {
        // FOOTSTEPS
        const { footGlowL, footGlowR } = footGlowAt(modelPosition.xz)
        const footGlow = clamp(footGlowL.add(footGlowR), 0.0, 1.0)
        displaced = displaced.add(normalize(normalLocal).mul(footGlow).mul(u.uFootBumpHeight))
    }

    // modelPosition.xyz += displaced
    const displacedPosition = vec4(modelPosition.xyz.add(displaced), modelPosition.w)

    const vElevation: any = varying(noiseValue.mul(fresnel))
    const vWorldPos = varying(displacedPosition.xyz)

    const colorNoise = cnoise3(displacedPosition.xyz.mul(0.5).add(u.uTime.mul(0.2)))
    const colorLow = mix(u.uColor1, u.uColor2, colorNoise)
    const colorHigh = mix(u.uColor2, u.uColor3, colorNoise)
    const vColor = varying(mix(colorLow, colorHigh, colorNoise))

    // ---- fragment ----
    const fragment = Fn(() => {
        const brightness = float(1.0).add(vElevation.mul(u.uElevationIntensity))
        const noiseColor = clamp(vColor.mul(brightness), 0.0, 1.0).toVar()

        const resolution = float(1.0).div(u.uGrainDensity)
        const uvp = screenCoordinate.add(u.uTime)
        const lowres = vec2(floor(uvp.x.div(resolution)), floor(uvp.y.div(resolution)))
        const grain = randd(lowres).mul(2.0).sub(1.0)
        noiseColor.assign(clamp(noiseColor.add(grain.mul(u.uGrainAmount)), 0.0, 1.0))

        if (!opts.footsteps) return vec4(noiseColor as any, 1.0)

        // FOOTSTEPS (per-pixel so the glow stays smooth regardless of mesh resolution)
        const { footGlowL, footGlowR } = footGlowAt(vWorldPos.xz)

        // BODY CIRCLE (same reveal technique, always on, centered under the body)
        const bodyDist = length(vWorldPos.xz.sub(u.uBodyCirclePos.xz))
        const bodyGlow = smoothstepAny(u.uBodyCircleRadius, 0.0, bodyDist)

        const footGlow = clamp(footGlowL.add(footGlowR).add(bodyGlow), 0.0, 1.0)
        return vec4(mix(vec3(0.0), noiseColor, footGlow), 1.0)
    })

    const material = new NodeMaterial()
    material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(displacedPosition)
    material.fragmentNode = fragment()
    return material
}
