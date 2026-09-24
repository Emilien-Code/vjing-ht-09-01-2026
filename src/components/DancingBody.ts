
import Experience from "../Experience"
import * as THREE from 'three/webgpu'
import GUI from "lil-gui"
import World from "../classes/World"
import {
    Fn, If, uniform, uv, instanceIndex, instancedArray, cameraProjectionMatrix,
    float, vec2, vec3, vec4, length, normalize, mix, exp, max, mod, floor,
} from 'three/tsl'
import { snoise4, randd } from "../tsl/noise"

// Centre of the texel this particle used to occupy in the square GPGPU
// texture, in 0..1 — the same per-particle hash input as before.
const particleTexel = (index: any, size: number) => {
    const idx = float(index)
    return vec2(
        mod(idx, size).add(0.5).div(size),
        floor(idx.div(size)).add(0.5).div(size),
    )
}

export default class DancingBody extends World {

    private exp: Experience
    private scene: THREE.Scene
    private gui: GUI

    private gltf: any
    private mixer!: THREE.AnimationMixer
    private points: THREE.Sprite | null = null

    private bonePairs: any[] = []
    private particleBonePairs: any[][] = []
    private particleLerpT: Float32Array = new Float32Array(0)
    private particleScatterOffset: Float32Array = new Float32Array(0)

    declare baseGeometry: { count: number; instance: THREE.BufferGeometry }
    declare material: {
        instance: THREE.SpriteNodeMaterial
        uniforms: { uSize: any; uSizeRandomness: any }
    }
    // Particle state lives in storage buffers (xyz = position, w = distance to
    // its target) and is advanced by a compute node, replacing the old
    // GPUComputationRenderer ping-pong texture.
    declare gpgpu: {
        size: number
        particlesBuffer: any
        targetBuffer: any
        prevTargetBuffer: any
        computeNode: any
        uniforms: {
            uDeltaTime: any
            uDamping: any
            uCentrifugalFactor: any
            uFlowFieldFactor: any
            uModelCenter: any
        }
    }

    public get modelPosition(): THREE.Vector3 { return this.gltf.scene.position }
    public get bodyCenter(): THREE.Vector3 { return this._bodyCenter }
    public get feetY(): number { return this.baseGeometry.instance.boundingBox!.min.y }

    private leftFootBone: THREE.Object3D | null = null
    private rightFootBone: THREE.Object3D | null = null
    private hipsBone: THREE.Object3D | null = null

    public getLeftFootPosition(target: THREE.Vector3): THREE.Vector3 {
        if (this.leftFootBone) this.leftFootBone.getWorldPosition(target)
        return target
    }

    public getRightFootPosition(target: THREE.Vector3): THREE.Vector3 {
        if (this.rightFootBone) this.rightFootBone.getWorldPosition(target)
        return target
    }

    public getHipsPosition(target: THREE.Vector3): THREE.Vector3 {
        if (this.hipsBone) this.hipsBone.getWorldPosition(target)
        return target
    }

    private bodyMaterial: THREE.MeshBasicMaterial
    private _bodyCenter: THREE.Vector3 = new THREE.Vector3()
    private guiFolder!: GUI
    private params = {
        particleCount: 30000,
        size: 0.005,
        sizeRandomness: 0.66,
        scatter: 0.3,
        damping: 1.9,
        centrifugalFactor: 0,
        flowFieldFactor: 0,
        showMesh: true,
        bodyLight: false,
        lightColor: new THREE.Color(0xffffff),
        darkColor: new THREE.Color(0x000000),
    }

    constructor(exp: Experience) {
        super()
        this.exp = exp
        this.scene = exp.scene
        this.gui = this.exp.helpers.GUI

        this.gltf = this.exp.ressources.items.dansing_model

        this.baseGeometry = {} as any
        this.material = {} as any
        this.gpgpu = {} as any
        this.bodyMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 })

        this.setupModel()
        this.createBaseGeometry()
        this.createGPGPU()
        this.createMaterial()
        this.createPoints()
        this.setupGUI()
    }

    private setupModel() {
        const model = this.gltf.scene

        // model.position.y += 0.4
        model.scale.set(0.05, 0.05, 0.05)
        model.position.z += 3
        model.rotation.y = Math.PI / 4
        model.rotation.x = Math.PI / 4

        this.bodyMaterial.color = this.params.bodyLight ? this.params.lightColor : this.params.darkColor

        model.traverse((el: THREE.Object3D) => {
            if (el instanceof THREE.SkinnedMesh) {
                el.material = this.bodyMaterial
                el.visible = this.params.showMesh
            }
        })

        model.traverse((child: THREE.Object3D) => {
            if ((child as any).isBone && (child.parent as any)?.isBone) {
                this.bonePairs.push([child.parent, child])
            }
        })

        model.traverse((child: THREE.Object3D) => {
            if (!child.name) return
            if (child.name.endsWith('LeftFoot')) this.leftFootBone = child
            if (child.name.endsWith('RightFoot')) this.rightFootBone = child
            if (child.name.endsWith('Hips')) this.hipsBone = child
        })

        if (!this.leftFootBone || !this.rightFootBone) {
            console.warn('DancingBody: could not find LeftFoot/RightFoot bones for footstep tracking')
        }
        if (!this.hipsBone) {
            console.warn('DancingBody: could not find Hips bone for body-center tracking')
        }

        this.scene.add(model)

        this.mixer = new THREE.AnimationMixer(model)
        if (this.gltf.animations.length > 0) {
            const action = this.mixer.clipAction(this.gltf.animations[0])
            action.play()
        }
    }

    private createBaseGeometry() {
        this.baseGeometry.instance = new THREE.BufferGeometry()

        const tempPosA = new THREE.Vector3()
        const tempPosB = new THREE.Vector3()

        const boneLengths: number[] = this.bonePairs.map(pair => {
            pair[0].getWorldPosition(tempPosA)
            pair[1].getWorldPosition(tempPosB)
            return tempPosA.distanceTo(tempPosB)
        })
        const totalLength = boneLengths.reduce((sum, l) => sum + l, 0)

        const totalParticles = this.params.particleCount
        const vertices = new Float32Array(totalParticles * 3)
        this.particleBonePairs = []
        this.particleLerpT = new Float32Array(totalParticles)
        this.particleScatterOffset = new Float32Array(totalParticles * 3)
        let idx = 0

        for (let b = 0; b < this.bonePairs.length; b++) {
            const isLast = b === this.bonePairs.length - 1
            const count = isLast
                ? totalParticles - idx
                : Math.round((boneLengths[b] / totalLength) * totalParticles)

            const pair = this.bonePairs[b]
            pair[0].getWorldPosition(tempPosA)
            pair[1].getWorldPosition(tempPosB)

            for (let i = 0; i < count && idx < totalParticles; i++) {
                const t = Math.random()
                const sx = (Math.random() - 0.5) * this.params.scatter
                const sy = (Math.random() - 0.5) * this.params.scatter
                const sz = (Math.random() - 0.5) * this.params.scatter
                const pos = tempPosA.clone().lerp(tempPosB, t)
                vertices[idx * 3 + 0] = pos.x + sx
                vertices[idx * 3 + 1] = pos.y + sy
                vertices[idx * 3 + 2] = pos.z + sz
                this.particleLerpT[idx] = t
                this.particleScatterOffset[idx * 3 + 0] = sx
                this.particleScatterOffset[idx * 3 + 1] = sy
                this.particleScatterOffset[idx * 3 + 2] = sz
                this.particleBonePairs.push(pair)
                idx++
            }
        }

        this.baseGeometry.instance.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
        this.baseGeometry.count = this.baseGeometry.instance.attributes.position.count

        this.baseGeometry.instance.computeBoundingBox()
        this.baseGeometry.instance.boundingBox!.getCenter(this._bodyCenter)
    }

    private createMaterial() {
        const uniforms = this.material.uniforms = {
            uSize: uniform(this.params.size),
            uSizeRandomness: uniform(this.params.sizeRandomness),
        }
        const { particlesBuffer, size } = this.gpgpu

        const particle = particlesBuffer.element(instanceIndex)

        const rand = randd(particleTexel(instanceIndex, size))
        const velocity = particle.w
        const sizeScale = float(1.0).add(rand.sub(0.5).mul(uniforms.uSizeRandomness))
            .mul(float(1.0).add(max(velocity, -3.0).div(3.0)))

        // gl_PointSize was `uSize * resolution.y * sizeScale / -viewZ` pixels,
        // i.e. a fixed world-space size of uSize * sizeScale * 2 * tan(fov / 2)
        // (2 / projection[1][1]). WebGPU points can't be sized, so each
        // particle is an instanced camera-facing quad of that size.
        const worldSize = uniforms.uSize.mul(sizeScale).mul(float(2.0).div((cameraProjectionMatrix as any).element(1).element(1)))

        const material = new THREE.SpriteNodeMaterial()
        material.positionNode = particle.xyz
        material.scaleNode = worldSize
        material.colorNode = vec4(1.0, 1.0, 1.0, 1.0)
        // Round dots: `discard` the quad's corners (was `distanceToCenter > 0.5`).
        material.maskNode = length(uv().sub(0.5)).lessThanEqual(0.5)
        material.transparent = true
        this.material.instance = material
    }

    private createGPGPU() {
        const count = this.baseGeometry.count
        this.gpgpu.size = Math.ceil(Math.sqrt(count))

        const positions = this.baseGeometry.instance.attributes.position.array
        const initial = new Float32Array(count * 4)
        for (let i = 0; i < count; i++) {
            const i3 = i * 3
            const i4 = i * 4
            initial[i4 + 0] = positions[i3 + 0]
            initial[i4 + 1] = positions[i3 + 1]
            initial[i4 + 2] = positions[i3 + 2]
            initial[i4 + 3] = 0
        }

        // Three separate buffers (they must not share an array): live particle
        // state, this frame's bone targets, last frame's bone targets.
        this.gpgpu.particlesBuffer = instancedArray(initial, 'vec4')
        this.gpgpu.targetBuffer = instancedArray(new Float32Array(initial), 'vec4')
        this.gpgpu.prevTargetBuffer = instancedArray(new Float32Array(initial), 'vec4')

        const u = this.gpgpu.uniforms = {
            uDeltaTime: uniform(0),
            uDamping: uniform(this.params.damping),
            uCentrifugalFactor: uniform(this.params.centrifugalFactor),
            uFlowFieldFactor: uniform(this.params.flowFieldFactor),
            uModelCenter: uniform(this.gltf.scene.position.clone()),
        }
        const size = this.gpgpu.size

        this.gpgpu.computeNode = (Fn(() => {
            const particle = this.gpgpu.particlesBuffer.element(instanceIndex)
            const target = this.gpgpu.targetBuffer.element(instanceIndex).xyz
            const prevTarget = this.gpgpu.prevTargetBuffer.element(instanceIndex).xyz

            const boneDelta = target.sub(prevTarget)
            const radialDir = normalize(target.sub(u.uModelCenter))
            const effectiveTarget = target.add(radialDir.mul(length(boneDelta)).mul(u.uCentrifugalFactor))

            const rand = randd(particleTexel(instanceIndex, size))
            const responseSpeed = u.uDamping.mul(float(0.4).add(rand.mul(1.2)))
            const alpha = float(1.0).sub(exp(responseSpeed.negate().mul(u.uDeltaTime)))

            const newPos = mix(particle.xyz, effectiveTarget, alpha).toVar()

            If(u.uFlowFieldFactor.greaterThan(0.0), () => {
                const p = particle.xyz.mul(0.5)
                const flowField = vec3(
                    snoise4(vec4(p.add(0.0), 0.0)),
                    snoise4(vec4(p.add(1.0), 0.0)),
                    snoise4(vec4(p.add(2.0), 0.0)),
                )
                newPos.addAssign(normalize(flowField).mul(u.uFlowFieldFactor))
            })

            const distToTarget = length(target.sub(newPos))
            particle.assign(vec4(newPos as any, distToTarget))
        })() as any).compute(count)
    }

    private createPoints() {
        this.points = new THREE.Sprite(this.material.instance)
        this.points.count = this.baseGeometry.count
        this.points.frustumCulled = false
        this.scene.add(this.points)
    }

    private rebuild() {
        if (this.points) {
            this.scene.remove(this.points)
            this.points = null
        }
        this.createBaseGeometry()
        this.createGPGPU()
        this.createMaterial()
        this.createPoints()
    }

    private setupGUI() {
        this.guiFolder = this.gui.addFolder('DancingBody')
        const folder = this.guiFolder

        folder.add(this.params, 'particleCount', 1000, 50000, 1000)
            .name('Count')
            .onFinishChange(() => this.rebuild())

        folder.add(this.params, 'size', 0.001, 0.05, 0.001)
            .name('Size')
            .onChange((v: number) => { this.material.uniforms.uSize.value = v })

        folder.add(this.params, 'sizeRandomness', 0, 20, 0.01)
            .name('Size Randomness')
            .onChange((v: number) => { this.material.uniforms.uSizeRandomness.value = v })

        folder.add(this.params, 'scatter', 0, 1, 0.01)
            .name('Scatter')

        folder.add(this.params, 'damping', 0.1, 30, 0.1)
            .name('Follow Speed')
            .onChange((v: number) => { this.gpgpu.uniforms.uDamping.value = v })

        folder.add(this.params, 'centrifugalFactor', 0, 20, 0.1)
            .name('Centrifugal')
            .onChange((v: number) => { this.gpgpu.uniforms.uCentrifugalFactor.value = v })

        folder.add(this.params, 'flowFieldFactor', 0.0, 1, 0.001)
            .name('Flow Field')
            .onChange((v: number) => { this.gpgpu.uniforms.uFlowFieldFactor.value = v })

        folder.add(this.params, 'showMesh')
            .name('Show Mesh')
            .onChange((v: boolean) => {
                this.gltf.scene.traverse((el: THREE.Object3D) => {
                    if (el instanceof THREE.SkinnedMesh) el.visible = v
                })
            })

        folder.add(this.params, 'bodyLight')
            .name('Body Light')
            .onChange((v: boolean) => {
                this.bodyMaterial.color = v ? this.params.lightColor : this.params.darkColor
            })

        folder.addColor(this.params, 'lightColor')
            .name('Light Color')
            .onChange((v: THREE.Color) => {
                if (this.params.bodyLight) this.bodyMaterial.color = v
            })

        folder.addColor(this.params, 'darkColor')
            .name('Dark Color')
            .onChange((v: THREE.Color) => {
                if (!this.params.bodyLight) this.bodyMaterial.color = v
            })

        this.guiFolder.hide()
    }

    showGUI(v: boolean) {
        v ? this.guiFolder.show() : this.guiFolder.hide()
    }

    onBPMBeat() {
        if (!this.exp.audioManager || !this.exp.bpmManager) return
    }

    update() {
        this.mixer.update(this.exp.time.delta * 0.000085)

        const tempPosA = new THREE.Vector3()
        const tempPosB = new THREE.Vector3()

        const targetData: Float32Array = this.gpgpu.targetBuffer.value.array
        const prevTargetData: Float32Array = this.gpgpu.prevTargetBuffer.value.array

        prevTargetData.set(targetData)

        for (let i = 0; i < this.baseGeometry.count; i++) {
            const pair = this.particleBonePairs[i]
            pair[0].getWorldPosition(tempPosA)
            pair[1].getWorldPosition(tempPosB)

            const t = this.particleLerpT[i]
            const pos = tempPosA.clone().lerp(tempPosB, t)

            const i4 = i * 4
            const i3 = i * 3
            targetData[i4 + 0] = pos.x + this.particleScatterOffset[i3 + 0] * this.params.scatter
            targetData[i4 + 1] = pos.y + this.particleScatterOffset[i3 + 1] * this.params.scatter
            targetData[i4 + 2] = pos.z + this.particleScatterOffset[i3 + 2] * this.params.scatter
            targetData[i4 + 3] = 0
        }

        this.gpgpu.prevTargetBuffer.value.needsUpdate = true
        this.gpgpu.targetBuffer.value.needsUpdate = true

        this.gpgpu.uniforms.uDeltaTime.value = this.exp.time.delta / 1000
        this.exp.renderer.instance.compute(this.gpgpu.computeNode)
    }

    setVisible(v: boolean) {
        this.gltf.scene.visible = v
        if (this.points) this.points.visible = v
    }

    leave() { }
}
