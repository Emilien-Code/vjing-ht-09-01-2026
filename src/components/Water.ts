import * as THREE from 'three/webgpu'
import {
    Fn, uniform, uv, texture, reflector,
    float, vec2, vec3, vec4, select,
} from 'three/tsl'
import Experience from "../Experience"

interface BodyParams {
    geometry?: "circle" | "plane"
    color: THREE.ColorRepresentation
    speed: number
    width?: number
    height?: number
    radius?: number
    waveStrength?: number
}

// Overlay blend, per channel.
const blendOverlay = (base: any, blend: any) => {
    const channel = (b: any, l: any) => select(
        b.lessThan(0.5),
        b.mul(l).mul(2.0),
        float(1.0).sub(float(2.0).mul(float(1.0).sub(b)).mul(float(1.0).sub(l))),
    )
    return vec3(
        channel(base.r, blend.r),
        channel(base.g, blend.g),
        channel(base.b, blend.b),
    )
}

export default class Body {
    experience: Experience

    speed: number

    dudvMap: THREE.Texture

    geometry: THREE.CircleGeometry | THREE.PlaneGeometry

    // A plain mesh with a planar-reflection node material (was a WebGL
    // `Reflector` with a hand-patched ReflectorShader).
    water: THREE.Mesh

    uniforms: {
        color: any
        time: any
        waveStrength: any
    }

    constructor(experience: Experience, params: BodyParams) {
        this.experience = experience

        const {
            geometry,
            color,
            speed,
            width,
            height,
            radius,
            waveStrength = 0.5
        } = params

        this.speed = speed

        // Create displacement texture
        this.dudvMap =
            this.experience.ressources.items.water_displacement

        this.dudvMap.wrapS = THREE.RepeatWrapping
        this.dudvMap.wrapT = THREE.RepeatWrapping

        this.uniforms = {
            color: uniform(new THREE.Color(color)),
            time: uniform(0),
            waveStrength: uniform(waveStrength),
        }
        const u = this.uniforms

        if (geometry === "circle" || radius) {
            this.geometry = new THREE.CircleGeometry(radius ?? 1)
        } else {
            this.geometry = new THREE.PlaneGeometry(
                width ?? 1,
                height ?? 1
            )
        }

        const reflection = reflector({ resolutionScale: 1 })

        const fragment = Fn(() => {
            const waveSpeed = 0.03
            const vUv = uv()

            const dudv = (coords: any) => texture(this.dudvMap, coords)

            const distortedUv0 = dudv(vec2(vUv.x.add(u.time.mul(waveSpeed)), vUv.y)).rg.mul(u.waveStrength)

            const distortedUv = vUv.add(vec2(distortedUv0.x, distortedUv0.y.add(u.time.mul(waveSpeed))))

            const distortion = dudv(distortedUv).rg.mul(1.0).sub(1.0).mul(u.waveStrength)

            // The reflection is sampled in screen space (see ReflectorNode);
            // the wobble is added on top of that, like the old `uv.xy += distortion`.
            const base = reflection.sample(reflection.uvNode.add(distortion))

            return vec4(blendOverlay(base.rgb, u.color), 1.0)
        })

        const material = new THREE.NodeMaterial()
        material.fragmentNode = fragment()

        this.water = new THREE.Mesh(this.geometry, material)
        // The reflector mirrors across the plane of this object (its local +Z).
        this.water.add(reflection.target)
    }

    update(): void {
        this.uniforms.time.value += this.speed
    }
}
