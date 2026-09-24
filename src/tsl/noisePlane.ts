import * as THREE from 'three/webgpu'
import * as TSL from 'three/tsl'

// Untyped: @types/three's TSL typings can't follow this kind of graph building.
const {
    Fn, If, Loop, Break, uniform, uv, float, vec2, vec4,
    floor, fract, mix, sin, dot,
} = TSL as any

// Scrolling fbm value-noise plane (a black -> `uColor` ramp).
export interface NoisePlaneInit {
    noiseScale: number
    noiseSpeed: number
    noiseOctaves: number
    noisePersistence: number
    color: THREE.ColorRepresentation
}

export function createNoisePlaneUniforms(init: NoisePlaneInit) {
    return {
        uTime: uniform(0),
        uNoiseScale: uniform(init.noiseScale),
        uNoiseSpeed: uniform(init.noiseSpeed),
        uNoiseOctaves: uniform(init.noiseOctaves),
        uNoisePersistence: uniform(init.noisePersistence),
        uColor: uniform(new THREE.Color(init.color)),
    }
}

export function createNoisePlaneMaterial(u: ReturnType<typeof createNoisePlaneUniforms>) {
    const hash = (p: any) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453123))

    const noise = (p: any) => {
        const i = floor(p)
        const f = fract(p)
        const s = f.mul(f).mul(float(3.0).sub(f.mul(2.0)))
        return mix(
            mix(hash(i), hash(i.add(vec2(1.0, 0.0))), s.x),
            mix(hash(i.add(vec2(0.0, 1.0))), hash(i.add(vec2(1.0, 1.0))), s.x),
            s.y,
        )
    }

    const fbm = (p: any) => {
        const value = float(0.0).toVar()
        const amplitude = float(0.5).toVar()
        const frequency = float(1.0).toVar()
        Loop(8, ({ i }: any) => {
            If(float(i).greaterThanEqual(u.uNoiseOctaves), () => { Break() })
            value.addAssign(amplitude.mul(noise(p.mul(frequency))))
            amplitude.mulAssign(u.uNoisePersistence)
            frequency.mulAssign(2.0)
        })
        return value
    }

    const fragment = Fn(() => {
        const scrolled = uv().mul(u.uNoiseScale)
            .add(vec2(u.uTime.mul(u.uNoiseSpeed), u.uTime.mul(u.uNoiseSpeed).mul(0.7)))
        const n = fbm(scrolled)
        return vec4(mix(TSL.vec3(0.0), u.uColor, n), 1.0)
    })

    const material = new THREE.NodeMaterial()
    material.fragmentNode = fragment()
    return material
}
