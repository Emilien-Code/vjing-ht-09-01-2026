import Experience from "../Experience"
import * as THREE from 'three/webgpu'
import GUI from "lil-gui";
import World from "../classes/World";
import {
    Fn, If, uniform, instanceIndex,
    float, vec3, vec4, length, normalize, mix, exp, min,
} from 'three/tsl'
import { snoise4, randd } from "../tsl/noise"
import { createParticleBuffers, createParticleSpriteMaterial, particleTexel } from "../tsl/gpuParticles"
import { SkeletonHelper } from 'three/webgpu'





export default class ParticleHumanDancing extends World {


    private exp: Experience;
    private scene: THREE.Scene
    private gui: GUI
    private guiFolder!: GUI
    private holder: THREE.Object3D
    private model!: THREE.Object3D
    private points: THREE.Sprite | null = null
    private action: THREE.AnimationAction
    private mixer: THREE.AnimationMixer
    private bonePairs: any[] = []
    private particleBonePairs: any[][] = []
    private particleLerpT: Float32Array = new Float32Array(0)
    private particleScatterOffset: Float32Array = new Float32Array(0)
    private particleScatterRadius: Float32Array = new Float32Array(0)

    declare baseGeometry: {
        count: number;
        instance: THREE.BufferGeometry
    }
    declare material: {
        instance: THREE.SpriteNodeMaterial
        uniforms: { uSize: any, uSizeRandomness: any }
    }

    // Particle state lives in storage buffers advanced by a compute node
    // (was a GPUComputationRenderer ping-pong texture).
    declare gpgpu: {
        size: number
        particlesBuffer: any
        targetBuffer: any
        prevTargetBuffer: any
        computeNode: any
        uniforms: Record<string, any>
        debug?: THREE.Mesh
    }



    private params = {
        metalness: 1,
        roughness: 0,
        particleCount: 15000,
        size: 0.001,
        sizeRandomness: 0,
        scatter: 0,
        boneWidth: 0.014,
        damping: 8.0,
        centrifugalFactor: 0,
        flowFieldFactor: 0.003,
        uColor: "",
        offset: new THREE.Vector3(0, -0.9, 4)
    }

    constructor(exp: Experience) {
        super();
        this.exp = exp;
        (window as any).exp = exp
        this.scene = exp.scene
        this.gui = this.exp.helpers.GUI


        const gltf = this.exp.ressources.items.hiphop_dance_rig//break_dance_rig
        const model = gltf.scene
        this.model = model

        model.scale.set(1, 1, 1)
        this.mixer = new THREE.AnimationMixer(model)
        this.action = this.mixer.clipAction(gltf.animations[0])
        this.action.play()



        const helper = new SkeletonHelper(gltf.scene)
        helper.setColors(new THREE.Color(0xff0000), new THREE.Color(0x000000))
        // this.scene.add(helper)


        this.action.timeScale = 0.00085 //hiphop_dance_rig
        this.scene.add(model)

        model.traverse((child) => {

            if (child.isBone && child.parent?.isBone) {
                this.bonePairs.push([child.parent, child])
            }

        })

        this.holder = new THREE.Object3D()
        this.scene.add(this.holder);

        this.baseGeometry = {} as any
        this.material = {} as any
        this.gpgpu = {} as any

        this.createBaseGeometry()
        this.createGPGPU()
        this.createMaterial()
        this.createPoints()
        this.setupGUI()
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
        this.particleScatterRadius = new Float32Array(totalParticles)
        let idx = 0

        const boneDir = new THREE.Vector3()
        const arbitrary = new THREE.Vector3()
        const perp1 = new THREE.Vector3()
        const perp2 = new THREE.Vector3()

        for (let b = 0; b < this.bonePairs.length; b++) {
            const isLast = b === this.bonePairs.length - 1
            const count = isLast
                ? totalParticles - idx
                : Math.round((boneLengths[b] / totalLength) * totalParticles)

            const pair = this.bonePairs[b]
            pair[0].getWorldPosition(tempPosA)
            pair[1].getWorldPosition(tempPosB)

            // Build perpendicular basis for this bone so scatter forms a cylindrical shell
            boneDir.subVectors(tempPosB, tempPosA)
            if (boneDir.lengthSq() > 0) boneDir.normalize()
            if (Math.abs(boneDir.x) < 0.9) {
                arbitrary.set(1, 0, 0)
            } else {
                arbitrary.set(0, 1, 0)
            }
            perp1.crossVectors(boneDir, arbitrary).normalize()
            perp2.crossVectors(boneDir, perp1)

            for (let i = 0; i < count && idx < totalParticles; i++) {
                const t = Math.random()
                const angle = Math.random() * Math.PI * 2
                const cosA = Math.cos(angle)
                const sinA = Math.sin(angle)

                // Normalized direction perpendicular to the bone
                const px = cosA * perp1.x + sinA * perp2.x
                const py = cosA * perp1.y + sinA * perp2.y
                const pz = cosA * perp1.z + sinA * perp2.z

                const radius = this.params.boneWidth / 2
                const pos = tempPosA.clone().lerp(tempPosB, t)

                vertices[idx * 3 + 0] = pos.x + px * radius
                vertices[idx * 3 + 1] = pos.y + py * radius
                vertices[idx * 3 + 2] = 0//pos.z + pz * radius

                this.particleLerpT[idx] = t
                this.particleScatterOffset[idx * 3 + 0] = px
                this.particleScatterOffset[idx * 3 + 1] = py
                this.particleScatterOffset[idx * 3 + 2] = pz
                this.particleScatterRadius[idx] = 0
                this.particleBonePairs.push(pair)
                idx++
            }
        }

        this.baseGeometry.instance.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
        this.baseGeometry.count = this.baseGeometry.instance.attributes.position.count

    }

    private createMaterial() {
        const { material, uniforms } = createParticleSpriteMaterial({
            particlesBuffer: this.gpgpu.particlesBuffer,
            textureSize: this.gpgpu.size,
            size: this.params.size,
            sizeRandomness: this.params.sizeRandomness,
            sizeScale: (particle: any, rand: any, uSizeRandomness: any) =>
                rand.sub(0.5).mul(uSizeRandomness).add(1.0)
                    .mul(min(particle.w.mul(1.5), 1.5).add(1.0)),
        })
        this.material.instance = material
        this.material.uniforms = uniforms
    }

    private createGPGPU() {
        const count = this.baseGeometry.count
        this.gpgpu.size = Math.ceil(Math.sqrt(count))
        const size = this.gpgpu.size

        const buffers = createParticleBuffers(
            this.baseGeometry.instance.attributes.position.array,
            count,
            { flattenZ: true, prev: true },
        )
        this.gpgpu.particlesBuffer = buffers.particlesBuffer
        this.gpgpu.targetBuffer = buffers.targetBuffer
        this.gpgpu.prevTargetBuffer = buffers.prevTargetBuffer

        const u = this.gpgpu.uniforms = {
            uDeltaTime: uniform(0),
            uDamping: uniform(this.params.damping),
            uCentrifugalFactor: uniform(this.params.centrifugalFactor),
            uFlowFieldFactor: uniform(this.params.flowFieldFactor),
            uModelCenter: uniform(this.params.offset.clone()),
        }

        this.gpgpu.computeNode = (Fn(() => {
            const particle = this.gpgpu.particlesBuffer.element(instanceIndex)
            const target = this.gpgpu.targetBuffer.element(instanceIndex).xyz
            const prevTarget = this.gpgpu.prevTargetBuffer.element(instanceIndex).xyz

            // Fling particles radially away from model center, scaled by bone velocity
            const boneDelta = target.sub(prevTarget)
            const radialDir = normalize(target.sub(u.uModelCenter))
            const effectiveTarget = target.add(radialDir.mul(length(boneDelta)).mul(u.uCentrifugalFactor))

            // Per-particle random response speed so the cloud feels organic
            const rand = randd(particleTexel(instanceIndex, size))
            const responseSpeed = u.uDamping.mul(rand.mul(1.2).add(0.4))
            const alpha = float(1.0).sub(exp(responseSpeed.negate().mul(u.uDeltaTime)))

            const newPos = mix(particle.xyz, effectiveTarget, alpha).toVar()

            // Subtle flow field noise for organic feel
            If(u.uFlowFieldFactor.greaterThan(0.0), () => {
                const p = particle.xyz.mul(0.5)
                const flowField = vec3(
                    snoise4(vec4(p.add(0.0), 0.0)),
                    snoise4(vec4(p.add(1.0), 0.0)),
                    snoise4(vec4(p.add(2.0), 0.0)),
                )
                newPos.addAssign(normalize(flowField).mul(u.uFlowFieldFactor))
            })

            // Distance to real bone target — used by the sprite size boost
            const distToTarget = length(target.sub(newPos))

            particle.assign(vec4(newPos as any, distToTarget))
        })() as any).compute(count)
    }

    private createPoints() {

        this.points = new THREE.Sprite(this.material.instance)
        this.points.count = this.baseGeometry.count
        this.points.frustumCulled = false
        this.holder.add(this.points)

    }

    private rebuild() {
        if (this.points) {
            this.scene.remove(this.points)
            this.points = null
        }
        if (this.gpgpu.debug) {
            this.scene.remove(this.gpgpu.debug)
        }
        this.createBaseGeometry()
        this.createGPGPU()
        this.createMaterial()
        this.createPoints()
    }

    private setupGUI() {
        this.guiFolder = this.gui.addFolder('Particles')
        const folder = this.guiFolder

        folder.add(this.params, 'particleCount', 1000, 50000, 1000)
            .name('Count')
            .onFinishChange(() => this.rebuild())

        folder.add(this.params, 'size', 0.001, 0.05, 0.001)
            .name('Size')
            .onChange((v: number) => {
                this.material.uniforms.uSize.value = v
            })

        folder.add(this.params, 'sizeRandomness', 0, 20, 0.01)
            .name('Size Randomness')
            .onChange((v: number) => {
                this.material.uniforms.uSizeRandomness.value = v
            })

        folder.add(this.params, 'scatter', 0, 1, 0.01)
            .name('Scatter')

        folder.add(this.params, 'boneWidth', 0, 0.5, 0.001)
            .name('Bone Width')
            .onFinishChange(() => this.rebuild())

        folder.add(this.params, 'damping', 0.1, 30, 0.1)
            .name('Follow Speed')
            .onChange((v: number) => {
                this.gpgpu.uniforms.uDamping.value = v
            })

        folder.add(this.params, 'centrifugalFactor', 0, 20, 0.1)
            .name('Centrifugal')
            .onChange((v: number) => {
                this.gpgpu.uniforms.uCentrifugalFactor.value = v
            })

        folder.add(this.params, 'flowFieldFactor', 0, 0.05, 0.001)
            .name('Flow Field')
            .onChange((v: number) => {
                this.gpgpu.uniforms.uFlowFieldFactor.value = v
            })

        this.guiFolder.hide()
    }

    showGUI(v: boolean) {
        v ? this.guiFolder.show() : this.guiFolder.hide()
    }

    destroyMesh() {

    }


    onBPMBeat() {
        if (!this.exp.audioManager) return
        if (!this.exp.bpmManager) return

        // Calculate a reduced duration based on the BPM (beats per minute) duration
        const duration = this.exp.bpmManager.getBPMDuration() / 1000
        if (this.exp.audioManager.isPlaying) {
            if (Math.random() < 0.3) {
                // gsap.to(this.holder.rotation, {
                //     duration: Math.random() < 0.8 ? 15 : duration, // Either a longer or BPM-synced duration
                //     y: Math.random() * Math.PI * 2,
                //     z: Math.random() * Math.PI,
                //     ease: 'elastic.out(0.2)',
                // })
            }



            // Pause the animation timeline
            // advance in the animation timeline 
            //
            if (Math.random() < 0.3) {
                // this.createPoints()
            }
        }
    }

    update() {
        if (!this.exp.audioManager) return
        this.points.frustumCulled = false;

        // Advance skeleton first so bone world positions are current
        this.mixer.update(this.exp.time.delta)

        const tempPosA = new THREE.Vector3()
        const tempPosB = new THREE.Vector3()

        // Snapshot previous targets before overwriting
        const targetData: Float32Array = this.gpgpu.targetBuffer.value.array
        this.gpgpu.prevTargetBuffer && this.gpgpu.prevTargetBuffer.value.array.set(targetData)

        for (let i = 0; i < this.baseGeometry.count; i++) {
            const pair = this.particleBonePairs[i]
            const boneA = pair[0]
            const boneB = pair[1]

            boneA.getWorldPosition(tempPosA)
            boneB.getWorldPosition(tempPosB)

            const t = this.particleLerpT[i]
            const tempPos = tempPosA.clone().lerp(tempPosB, t)

            const i4 = i * 4
            const i3 = i * 3
            const shellRadius = this.params.boneWidth / 2

            targetData[i4 + 0] = tempPos.x + this.particleScatterOffset[i3 + 0] * shellRadius + this.params.offset.x
            targetData[i4 + 1] = tempPos.y + this.particleScatterOffset[i3 + 1] * shellRadius + this.params.offset.y
            targetData[i4 + 2] = 0 //tempPos.z + this.particleScatterOffset[i3 + 2] * shellRadius + this.params.offset.z
            targetData[i4 + 3] = 0
        }

        // Upload the buffers to the GPU
        this.gpgpu.prevTargetBuffer.value.needsUpdate = true
        this.gpgpu.targetBuffer.value.needsUpdate = true

        const dt = this.exp.time.delta / 1000
        this.gpgpu.uniforms.uDeltaTime.value = dt
        this.gpgpu.uniforms.uModelCenter.value.copy(this.params.offset)

        this.exp.renderer.instance.compute(this.gpgpu.computeNode)
    }

    setVisible(v: boolean) {
        this.model.visible = v
        this.holder.visible = v
    }


}