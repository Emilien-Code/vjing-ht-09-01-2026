import Experience from "../Experience"
import * as THREE from 'three/webgpu'
import GUI from "lil-gui";
import World from "../classes/World";
import {
    Fn, If, uniform, instanceIndex,
    float, vec3, vec4, length, normalize, mix, exp, max, min,
} from 'three/tsl'
import { snoise4, randd } from "../tsl/noise"
import { createParticleBuffers, createParticleSpriteMaterial, particleTexel } from "../tsl/gpuParticles"
import { SkeletonHelper } from 'three/webgpu'





export default class ParticleHumanDancing extends World {


    private exp: Experience;
    private scene: THREE.Scene
    private gui: GUI
    private holder: THREE.Object3D
    private points: THREE.Sprite | null = null
    private action: THREE.AnimationAction
    private mixer: THREE.AnimationMixer
    private bonePairs: any[] = []
    private particleBonePairs: any[][] = []
    private particleLerpT: Float32Array = new Float32Array(0)
    private particleScatterOffset: Float32Array = new Float32Array(0)

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
        size: 0.01,
        sizeRandomness: 0.5,
        scatter: 0.2,
        damping: 8.0,
        centrifugalFactor: 6.0,
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

        model.scale.set(0.15, 0.15, 0.15)
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

        // Compute each bone segment length for proportional distribution
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
            { flattenZ: false, prev: false },
        )
        this.gpgpu.particlesBuffer = buffers.particlesBuffer
        this.gpgpu.targetBuffer = buffers.targetBuffer
        this.gpgpu.prevTargetBuffer = buffers.prevTargetBuffer

        const u = this.gpgpu.uniforms = {
            uDeltaTime: uniform(0),
            uDamping: uniform(this.params.damping),
            uFlowFieldFactor: uniform(this.params.flowFieldFactor),
            uOffset: uniform(this.params.offset),
        }

        this.gpgpu.computeNode = (Fn(() => {
            const particle = this.gpgpu.particlesBuffer.element(instanceIndex)
            const target = this.gpgpu.targetBuffer.element(instanceIndex).xyz

            // Per-particle random response speed variation
            const rand = randd(particleTexel(instanceIndex, size))
            const responseSpeed = u.uDamping.mul(rand.mul(1.2).add(0.4))
            const alpha = float(1.0).sub(exp(responseSpeed.negate().mul(u.uDeltaTime)))

            const newPos = mix(particle.xyz, target, alpha).toVar()

            // Subtle flow field disturbance for organic trailing feel
            If(u.uFlowFieldFactor.greaterThan(0.0), () => {
                const p = particle.xyz.mul(0.5)
                const flowField = vec3(
                    snoise4(vec4(p.add(0.0), 0.0)),
                    snoise4(vec4(p.add(1.0), 0.0)),
                    snoise4(vec4(p.add(2.0), 0.0)),
                )
                newPos.addAssign(normalize(flowField).mul(u.uFlowFieldFactor))
            })

            // Store distance to target so the sprite size can react to fast motion
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
        const folder = this.gui.addFolder('Particles')

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

        folder.add(this.params, 'damping', 0.1, 30, 0.1)
            .name('Damping')
            .onChange((v: number) => {
                this.gpgpu.uniforms.uDamping.value = v
            })

        folder.add(this.params, 'flowFieldFactor', 0, 0.05, 0.001)
            .name('Flow Field')
            .onChange((v: number) => {
                this.gpgpu.uniforms.uFlowFieldFactor.value = v
            })
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


        const tempPosA = new THREE.Vector3()
        const tempPosB = new THREE.Vector3()

        const targetData: Float32Array = this.gpgpu.targetBuffer.value.array

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
            targetData[i4 + 0] = tempPos.x + this.particleScatterOffset[i3 + 0] * this.params.scatter + this.params.offset.x
            targetData[i4 + 1] = tempPos.y + this.particleScatterOffset[i3 + 1] * this.params.scatter + this.params.offset.y
            targetData[i4 + 2] = tempPos.z + this.particleScatterOffset[i3 + 2] * this.params.scatter + this.params.offset.z
            targetData[i4 + 3] = 0
        }

        this.gpgpu.targetBuffer.value.needsUpdate = true

        this.gpgpu.uniforms.uDeltaTime.value = this.exp.time.delta / 1000

        this.exp.renderer.instance.compute(this.gpgpu.computeNode)

        this.mixer.update(this.exp.time.delta)

        this.destroyMesh()


        // this.holder.rotation.y += 0.01

    }


}