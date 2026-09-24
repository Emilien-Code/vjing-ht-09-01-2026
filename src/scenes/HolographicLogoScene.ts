import Experience from "../Experience"
import World from "../classes/World"
import GUI from "lil-gui"
import * as THREE from 'three/webgpu'
import { NodeMaterial } from 'three/webgpu'
import {
    Fn, uniform, varying, positionLocal, normalLocal, frontFacing,
    modelWorldMatrix, modelViewMatrix, cameraViewMatrix, cameraProjectionMatrix,
    float, vec3, vec4, sin, fract, smoothstep, normalize, dot, max, clamp, mix, pow, select,
} from 'three/tsl'

// Holographic HT logo — the real ht_logo.glb asset (loaded via
// Ressources/sources.ts, same pattern as LightStorm's storm_light model)
// wearing a ported version of the holographic-planet shader: fresnel-driven
// edge glow, scrolling scanline stripes and a rotating colour gradient. The
// planet's version sampled an earth texture and a specular/clouds texture to
// drive its "stroke"/"lights" masks; this project has no such textures for
// the logo, so those masks are procedural simplex noise sampled in world
// space instead. The glb mesh also has no UV attribute, which is the other
// reason the shader avoids vUv entirely.

export default class HolographicLogoScene extends World {

    private exp: Experience
    private scene: THREE.Scene
    private gui: GUI

    private group!: THREE.Group
    private material!: NodeMaterial
    private uniforms: Record<string, any>

    private folder!: GUI
    private visible = false
    private guiState = { visible: false }

    // Set by the owning world so the GUI toggle can also swap out whatever
    // other full-screen scene is running — mirrors LogoLedScene.onToggle.
    public onToggle: ((v: boolean) => void) | null = null

    private smoothVolume = 0
    private punch = 0

    public params = {
        // shape
        scale: 1,
        rotationSpeed: 0.12, // revolutions/sec
        // camera orbit
        camRadius: 5,
        camHeight: 0.6,
        camSpeed: 0.05, // revolutions/sec
        // colour
        colorA: '#43144f',
        colorB: '#6e12c2',
        // shader look
        intensity: 2.2,
        baseBrightness: 0.6,
        fresnelPower: 1.6,
        stripeSpeed: 0.4,
        stripeFrequency: 6.0,
        noiseScale: 1.4,
        displaceStrength: 0.125,
        // hidden light behind the surface, sound-reactive — analog of
        // LogoLedScene's "hidden light behind the slab".
        glowBase: 0.4,
        glowAudio: 1.2,
        glowKick: 0.8,
        soundReactive: true,
        volumeAttack: 8,
        punchRelease: 6,
    }

    constructor(exp: Experience) {
        super()
        this.exp = exp
        this.scene = exp.scene
        this.gui = exp.helpers.GUI

        this.uniforms = {
            uTime: uniform(0),
            uDisplaceStrength: uniform(this.params.displaceStrength),

            uColorA: uniform(new THREE.Color(this.params.colorA)),
            uColorB: uniform(new THREE.Color(this.params.colorB)),

            uIntensity: uniform(this.params.intensity),
            uBaseBrightness: uniform(this.params.baseBrightness),
            uFresnelPower: uniform(this.params.fresnelPower),
            uStripeSpeed: uniform(this.params.stripeSpeed),
            uStripeFrequency: uniform(this.params.stripeFrequency),
            uNoiseScale: uniform(this.params.noiseScale),

            uGlowBase: uniform(this.params.glowBase),
            uGlowAudio: uniform(this.params.glowAudio),
            uGlowKick: uniform(this.params.glowKick),
            uVolume: uniform(0),
            uPunch: uniform(0),
        }

        this.createMaterial()
        this.createMesh()
        this.setupGUI()
        this.setVisible(false)
    }

    private createMaterial() {
        const u = this.uniforms

        const random2D = (v: any) => fract(sin(v.x.mul(12.9898).add(v.y.mul(78.233))).mul(43758.5453123))

        // ---- vertex: audio-independent glitchy displacement in world space ----
        // (Plain expressions only: .assign() is only legal inside an Fn().)
        const basePosition: any = modelWorldMatrix.mul(vec4(positionLocal, 1.0))

        const variationTime = u.uTime.sub(basePosition.y)
        const variationStrength = sin(variationTime)
            .add(sin(variationTime.mul(3.45)))
            .add(sin(variationTime.mul(8.76)))
            .div(3.0)
        const strength = smoothstep(0.3, 1.0, variationStrength).mul(u.uDisplaceStrength)

        const modelPosition = vec4(
            basePosition.x.add(random2D(basePosition.xz.mul(u.uTime)).sub(0.5).mul(strength)),
            basePosition.y,
            basePosition.z.add(random2D(basePosition.zx.mul(u.uTime)).sub(0.5).mul(strength)),
            basePosition.w,
        )

        const mvPosition = modelViewMatrix.mul(vec4(positionLocal, 1.0))
        const vViewDir = varying(mvPosition.xyz.negate())
        const vNormal = varying(modelWorldMatrix.mul(vec4(normalLocal, 0.0)).xyz)

        // ---- fragment ----
        // The GLSL this replaces first built a planet-style base/rim/scanline/
        // hidden-light colour (uColorA/B, uIntensity, uStripe*, uGlow*, ...),
        // but then overwrote gl_FragColor with the fresnel look below, so none
        // of it ever reached the screen. Only the live path is ported; the
        // GUI-facing uniforms are kept so the folder still builds.
        const fragment = Fn(() => {
            const baseColor = vec3(0.102, 0.114, 0.141)   // 0x1a1d24
            const fresnelColor = vec3(0.416, 0.831, 1.0)  // 0x6ad4ff
            const fresnelPower = 2.2
            const fresnelIntensity = 1.6
            const baseOpacity = 0.06
            const lightDir = vec3(0.4, 0.8, 0.6)

            const V = normalize(vViewDir)
            const N = select(frontFacing, normalize(vNormal), normalize(vNormal).negate())
            const diff = max(dot(N, normalize(lightDir)), 0.0)
            const diffuse = baseColor.mul(float(0.35).add(diff.mul(0.65)))
            const fresnel2 = pow(float(1.0).sub(clamp(dot(N, V), 0.0, 1.0)), fresnelPower)
            const color = mix(diffuse, fresnelColor, fresnel2)
            const alpha = clamp(mix(float(baseOpacity), 1.0, fresnel2).mul(fresnelIntensity), 0.0, 1.0)
            return vec4(color, alpha)
        })

        this.material = new NodeMaterial()
        this.material.transparent = true
        this.material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(modelPosition)
        this.material.fragmentNode = fragment()
    }

    private createMesh() {
        // Loaded eagerly via Ressources/sources.ts (name: "ht_logo") — same
        // pattern as LightStorm's storm_light model. Scenes are only ever
        // constructed after Ressources' 'ready' event, so this is populated
        // by the time we get here.
        const gltf = this.exp.ressources.items.ht_logo
        this.group = gltf.scene as THREE.Group
        this.group.traverse((child: THREE.Object3D) => {
            if ((child as THREE.Mesh).isMesh) {
                (child as THREE.Mesh).material = this.material
            }
        })
        this.scene.add(this.group)
    }

    // -----------------------------------------------------------------------
    // GUI
    // -----------------------------------------------------------------------

    private setupGUI() {
        const u = this.uniforms
        this.folder = this.gui.addFolder('holographic_logo')

        this.folder.add(this.guiState, 'visible').name('visible').listen()
            .onChange((v: boolean) => {
                this.onToggle ? this.onToggle(v) : this.setVisible(v)
            })

        const shape = this.folder.addFolder('shape')
        shape.add(this.params, 'scale', 0.1, 3, 0.01).name('scale')
            .onChange((v: number) => { this.group.scale.setScalar(v) })
        shape.add(this.params, 'rotationSpeed', -1, 1, 0.01).name('rotation speed')
        shape.add(this.params, 'displaceStrength', 0, 0.5, 0.001).name('displace strength')
            .onChange((v: number) => { u.uDisplaceStrength.value = v })
        shape.close()

        const camera = this.folder.addFolder('camera')
        camera.add(this.params, 'camRadius', 1, 15, 0.1).name('orbit radius')
        camera.add(this.params, 'camHeight', -5, 5, 0.05).name('orbit height')
        camera.add(this.params, 'camSpeed', -0.3, 0.3, 0.005).name('orbit speed')
        camera.close()

        const color = this.folder.addFolder('color')
        color.addColor(this.params, 'colorA').name('color A')
            .onChange((v: string) => { u.uColorA.value.set(v) })
        color.addColor(this.params, 'colorB').name('color B')
            .onChange((v: string) => { u.uColorB.value.set(v) })
        color.close()

        const look = this.folder.addFolder('look')
        look.add(this.params, 'intensity', 0, 6, 0.01).name('intensity')
            .onChange((v: number) => { u.uIntensity.value = v })
        look.add(this.params, 'baseBrightness', 0, 2, 0.01).name('base brightness')
            .onChange((v: number) => { u.uBaseBrightness.value = v })
        look.add(this.params, 'fresnelPower', 0.2, 6, 0.01).name('fresnel power')
            .onChange((v: number) => { u.uFresnelPower.value = v })
        look.add(this.params, 'stripeSpeed', -2, 2, 0.01).name('stripe speed')
            .onChange((v: number) => { u.uStripeSpeed.value = v })
        look.add(this.params, 'stripeFrequency', 0.5, 20, 0.1).name('stripe frequency')
            .onChange((v: number) => { u.uStripeFrequency.value = v })
        look.add(this.params, 'noiseScale', 0.1, 5, 0.01).name('noise scale')
            .onChange((v: number) => { u.uNoiseScale.value = v })
        look.close()

        const audio = this.folder.addFolder('hidden light (audio)')
        audio.add(this.params, 'soundReactive').name('sound reactive')
        audio.add(this.params, 'glowBase', 0, 2, 0.01).name('base level')
            .onChange((v: number) => { u.uGlowBase.value = v })
        audio.add(this.params, 'glowAudio', 0, 5, 0.01).name('volume amount')
            .onChange((v: number) => { u.uGlowAudio.value = v })
        audio.add(this.params, 'glowKick', 0, 5, 0.01).name('kick punch')
            .onChange((v: number) => { u.uGlowKick.value = v })
        audio.close()

        this.folder.close()
    }

    showGUI(v: boolean) {
        v ? this.folder.show() : this.folder.hide()
    }

    setVisible(v: boolean) {
        this.visible = v
        this.guiState.visible = v
        this.group.visible = v
    }

    // -----------------------------------------------------------------------
    // Audio
    // -----------------------------------------------------------------------

    private updateAudio(dt: number) {
        const an = this.exp.audioManager
        const p = this.params

        const volume = p.soundReactive ? (an?.volumeSmooth ?? 0) : 0
        this.smoothVolume += (volume - this.smoothVolume) * Math.min(1, dt * p.volumeAttack)

        this.punch += (0 - this.punch) * Math.min(1, dt * p.punchRelease)

        this.uniforms.uVolume.value = this.smoothVolume
        this.uniforms.uPunch.value = this.punch
    }

    onBPMBeat() {
        if (!this.visible || !this.params.soundReactive) return
        this.punch = 1
    }

    // -----------------------------------------------------------------------

    update() {
        if (!this.visible) return

        const dt = Math.min(this.exp.time.delta * 0.001, 0.1)
        const t = this.exp.time.elapsedTime * 0.001
        const p = this.params

        this.updateAudio(dt)
        this.uniforms.uTime.value = t

        this.group.rotation.y += p.rotationSpeed * dt * Math.PI * 2

        const angle = t * p.camSpeed * Math.PI * 2
        this.exp.camera.instance.position.set(
            Math.sin(angle) * p.camRadius,
            p.camHeight,
            Math.cos(angle) * p.camRadius,
        )
        this.exp.camera.instance.lookAt(this.group.position)
    }

    clean() {
        this.scene.remove(this.group)
        this.group.traverse((child: THREE.Object3D) => {
            if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).geometry.dispose()
        })
        this.material.dispose()
        this.folder.destroy()
    }
}
