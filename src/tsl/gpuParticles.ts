import * as THREE from 'three/webgpu'
import * as TSL from 'three/tsl'
import { randd } from './noise'

// Shared plumbing for the bone-following particle systems (the *ParticleHuman*
// components). They used to run on GPUComputationRenderer (a ping-pong float
// texture updated by a fragment shader) and draw gl_Points; now particle state
// lives in storage buffers advanced by a compute node, and every particle is an
// instanced camera-facing sprite (WebGPU points can't be sized).

// Untyped: @types/three's TSL typings can't follow this kind of graph building.
const {
    uniform, uv, instanceIndex, instancedArray, cameraProjectionMatrix, varying,
    float, vec2, vec3, length, mix, mod, floor,
} = TSL as any

// Centre of the texel a particle used to occupy in the square GPGPU texture,
// in 0..1 — the per-particle hash input the old shaders used (`aParticlesUv`).
export const particleTexel = (index: any, size: number) => {
    const idx = float(index)
    return vec2(
        mod(idx, size).add(0.5).div(size),
        floor(idx.div(size)).add(0.5).div(size),
    )
}

// Live particle state (xyz = position, w = per-kernel scalar), this frame's
// bone targets and — for kernels that need the bone velocity — last frame's.
// Three separate typed arrays: they must not share memory.
export function createParticleBuffers(
    positions: ArrayLike<number>,
    count: number,
    opts: { flattenZ?: boolean, prev?: boolean } = {},
) {
    const initial = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
        initial[i * 4 + 0] = positions[i * 3 + 0]
        initial[i * 4 + 1] = positions[i * 3 + 1]
        initial[i * 4 + 2] = opts.flattenZ ? 0 : positions[i * 3 + 2]
        initial[i * 4 + 3] = 0
    }
    // Targets always start on the real bone positions.
    const target = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
        target[i * 4 + 0] = positions[i * 3 + 0]
        target[i * 4 + 1] = positions[i * 3 + 1]
        target[i * 4 + 2] = positions[i * 3 + 2]
        target[i * 4 + 3] = 0
    }

    return {
        particlesBuffer: instancedArray(initial, 'vec4'),
        targetBuffer: instancedArray(target, 'vec4'),
        // Previous frame's targets start identical — no delta on the first frame.
        prevTargetBuffer: opts.prev ? instancedArray(new Float32Array(target), 'vec4') : null,
    }
}

// Round, camera-facing sprite per particle, coloured by the purple ramp the
// three variants share. `sizeScale(particle, rand)` is the per-variant part of
// the point size (what fed gl_PointSize).
export function createParticleSpriteMaterial(opts: {
    particlesBuffer: any
    textureSize: number
    sizeScale: (particle: any, rand: any, uSizeRandomness: any) => any
    size: number
    sizeRandomness: number
}) {
    const uniforms = {
        uSize: uniform(opts.size),
        uSizeRandomness: uniform(opts.sizeRandomness),
    }
    const particle = opts.particlesBuffer.element(instanceIndex)
    const texel = particleTexel(instanceIndex, opts.textureSize)
    const rand = randd(texel)

    // gl_PointSize was `uSize * resolution.y * sizeScale / -viewZ` pixels, i.e.
    // a fixed world-space size of uSize * sizeScale * 2 * tan(fov / 2)
    // (2 / projection[1][1]).
    const worldSize = uniforms.uSize
        .mul(opts.sizeScale(particle, rand, uniforms.uSizeRandomness))
        .mul(float(2.0).div(cameraProjectionMatrix.element(1).element(1)))

    const material = new THREE.SpriteNodeMaterial()
    material.positionNode = particle.xyz
    material.scaleNode = worldSize
    material.colorNode = varying(mix(
        vec3(207 / 255, 162 / 255, 202 / 255),
        vec3(157 / 255, 53 / 255, 119 / 255),
        rand,
    ))
    // Round dots: `discard` the quad's corners.
    material.maskNode = length(uv().sub(0.5)).lessThanEqual(0.5)
    material.transparent = true

    return { material, uniforms }
}

