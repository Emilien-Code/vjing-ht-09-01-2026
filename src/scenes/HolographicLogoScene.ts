import Experience from "../Experience"
import World from "../classes/World"
import GUI from "lil-gui"
import * as THREE from 'three/webgpu'
import {
    Fn, uniform, positionWorld, positionGeometry, positionLocal, cameraPosition,
    modelWorldMatrix, vec2, vec3, vec4, dot, mod, normalize, abs, pow, sin, smoothstep, clamp, mix,
} from 'three/tsl'
import { snoise3 } from "../tsl/noise"

// Holographic HT logo — the real ht_logo.glb asset (loaded via
// Ressources/sources.ts, same pattern as LightStorm's storm_light model)
// wearing a holographic shader: scrolling world-space stripes, a fresnel
// glow and a glitchy vertex displacement. The fresnel uses a "radial normal"
// (direction from the model's bounding-box centre to the fragment) instead of
// the mesh normals, so the glow reads as a volume around the whole logo
// rather than following each flat face of the glb.
//
// Motion mirrors LogoLedScene: the logo faces the camera head-on with a slow
// vertical float, plus a slow circular wobble on X and Z. Shape params
// (scale, offset, float amount) are in LogoLed's screen units (1 = full screen height) and
// converted to world units at the logo's distance, so both logos frame and
// move identically when the director swaps one for the other.

// ht_logo.glb's mesh is ~2.7 units tall (LogoLed's logo space is 1 tall).
const LOGO_WORLD_HEIGHT = 2.7

const random2D = Fn(([value]: [any]) => {
    return sin(dot(value, vec2(12.9898, 78.233))).mul(43758.5453123).fract()
})

export default class HolographicLogoScene extends World {

    private exp: Experience
    private scene: THREE.Scene
    private gui: GUI

    private group!: THREE.Group
    private material!: THREE.MeshBasicNodeMaterial
    private uniforms: Record<string, any>
    private modelBox = new THREE.Box3()

    private folder!: GUI
    private visible = false
    private guiState = { visible: false }

    // Set by the owning world so the GUI toggle can also swap out whatever
    // other full-screen scene is running — mirrors LogoLedScene.onToggle.
    public onToggle: ((v: boolean) => void) | null = null

    private punch = 0
    private smoothVolume = 0


    public params = {
        // shape / motion — same defaults and units as LogoLedScene
        scale: 0.62,
        offsetX: 0,
        offsetY: 0.04,
        rotation: 0,
        floatSpeed: 0.25,
        floatAmount: 0.02,
        camDistance: 7,
        // circular wobble: X and Z tilt a quarter-cycle apart
        circleAmount: 12, // degrees
        circleSpeed: 0.1, // cycles/sec
        // vertex glitch
        glitchStrength: 0.07,
        glitchThreshold: 0.3,
        // look
        color: '#07991a',
        fresnelPower1: 10,
        fresnelPower2: 2,
        stripeFrequency: 20,
        stripeSpeed: 0.1,
        // inner veins: flowing noise filling the centre the fresnel leaves empty
        innerIntensity: 0.6,
        innerScale: 1.2,
        innerSpeed: 0.25,    // how fast the pattern morphs in place
        innerFlowX: 0.15,    // drift direction/speed of the whole pattern
        innerFlowY: 0.3,
        innerWarp: 0.8,      // domain warp: 0 = plain noise, higher = smoky/twisted
        innerWarpScale: 0.5, // size of the warp relative to the veins
        innerDetail: 0.35,   // second, finer octave mixed in
        innerSharpness: 2.2, // high = thin electric lines, low = soft fill
        innerSharpnessLoud: 1.5, // sharpness reached at full volume / on the beat
        innerThreshold: 0.05,// cuts faint values so the dark gaps stay dark
        innerContrast: 1,
        innerStripeMix: 0.5, // how much the scanlines cut through the veins
        centerFocus: 0.25,   // 0 = even fill everywhere, 1 = only the centre (visible disc)
        centerFalloff: 0.5,  // softness of that centre mask
        innerAudio: 1.5,     // extra intensity at full volume / on each beat
        // audio
        soundReactive: true,
        volumeAttack: 8,
        punchRelease: 6,
        glitchVolume: 0.25,    // extra glitch amplitude at full volume
        glitchKick: 0.12,      // extra glitch amplitude on each beat
        glitchKickSpread: 0.5, // lowers the glitch threshold on each beat so more of the logo breaks up
        opacityKick: 0.6,      // opacity punch on each beat
    }

    constructor(exp: Experience) {
        super()
        this.exp = exp
        this.scene = exp.scene
        this.gui = exp.helpers.GUI

        this.uniforms = {
            uTime: uniform(0),
            uModelCenter: uniform(new THREE.Vector3()),
            uColor: uniform(new THREE.Color(this.params.color)),
            uFresnelPower1: uniform(this.params.fresnelPower1),
            uFresnelPower2: uniform(this.params.fresnelPower2),
            uStripeFrequency: uniform(this.params.stripeFrequency),
            uStripeSpeed: uniform(this.params.stripeSpeed),
            uGlitchStrength: uniform(this.params.glitchStrength),
            uGlitchThreshold: uniform(this.params.glitchThreshold),
            uGlitchVolume: uniform(this.params.glitchVolume),
            uGlitchKick: uniform(this.params.glitchKick),
            uGlitchKickSpread: uniform(this.params.glitchKickSpread),
            uOpacityKick: uniform(this.params.opacityKick),
            uInnerIntensity: uniform(this.params.innerIntensity),
            uInnerScale: uniform(this.params.innerScale),
            uInnerSpeed: uniform(this.params.innerSpeed),
            uInnerFlow: uniform(new THREE.Vector2(this.params.innerFlowX, this.params.innerFlowY)),
            uInnerWarp: uniform(this.params.innerWarp),
            uInnerWarpScale: uniform(this.params.innerWarpScale),
            uInnerDetail: uniform(this.params.innerDetail),
            uInnerSharpness: uniform(this.params.innerSharpness),
            uInnerSharpnessLoud: uniform(this.params.innerSharpnessLoud),
            uInnerThreshold: uniform(this.params.innerThreshold),
            uInnerContrast: uniform(this.params.innerContrast),
            uInnerStripeMix: uniform(this.params.innerStripeMix),
            uCenterFocus: uniform(this.params.centerFocus),
            uCenterFalloff: uniform(this.params.centerFalloff),
            uInnerAudio: uniform(this.params.innerAudio),
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

        this.material = new THREE.MeshBasicNodeMaterial()
        this.material.transparent = true
        this.material.side = THREE.DoubleSide

        // ---- fragment: stripes + fresnel ----
        const stripes = pow(
            mod(positionWorld.y.add(u.uTime.mul(u.uStripeSpeed).negate()).mul(u.uStripeFrequency), 1),
            3,
        )

        const radialNormal = normalize(positionWorld.sub(u.uModelCenter))
        const viewDirection = normalize(cameraPosition.sub(positionWorld))
        const f = abs(dot(viewDirection, radialNormal)).oneMinus().pow(u.uFresnelPower1)
        const fresnel = pow(f, u.uFresnelPower2)
        const holographic = stripes.mul(fresnel).add(fresnel.mul(1.25))

        // Inner veins: ridged, domain-warped simplex noise in the mesh's own
        // space (so it travels with the logo). Pattern drifts with uInnerFlow
        // and morphs in place along z with uInnerSpeed.
        const morph = u.uTime.mul(u.uInnerSpeed)
        const flow = vec3(u.uInnerFlow.mul(u.uTime), 0)
        const q = positionGeometry.mul(u.uInnerScale).sub(flow)
        const warp = snoise3(q.mul(u.uInnerWarpScale).add(vec3(0, 0, morph.mul(0.6))))
        const wq = q.add(warp.mul(u.uInnerWarp))
        const n = snoise3(wq.add(vec3(0, 0, morph)))
            .add(snoise3(wq.mul(2.7).add(vec3(0, 0, morph.mul(1.7)))).mul(u.uInnerDetail))
            .div(u.uInnerDetail.add(1))
        // Sound softens the veins: sharpness slides from uInnerSharpness
        // (quiet) towards uInnerSharpnessLoud (loud / on the beat).
        const loudness = clamp(u.uVolume.add(u.uPunch.mul(0.5)), 0, 1)
        const sharpness = mix(u.uInnerSharpness, u.uInnerSharpnessLoud, loudness)
        const ridged = abs(n).oneMinus().pow(sharpness)
        const veins = smoothstep(u.uInnerThreshold, 1, ridged).pow(u.uInnerContrast)

        // Optional bias towards the middle, where the fresnel leaves a dark
        // hole. Kept weak by default: at full strength it reads as a disc.
        const facing = abs(dot(viewDirection, radialNormal)).pow(u.uCenterFalloff)
        const centerMask = facing.sub(1).mul(u.uCenterFocus).add(1)

        const stripeMask = stripes.sub(1).mul(u.uInnerStripeMix).add(1)
        const innerAudio = u.uVolume.add(u.uPunch.mul(0.5)).mul(u.uInnerAudio).add(1)
        const inner = veins.mul(centerMask).mul(stripeMask).mul(u.uInnerIntensity).mul(innerAudio)

        this.material.colorNode = u.uColor
        this.material.opacityNode = holographic.add(inner).mul(u.uPunch.mul(u.uOpacityKick).add(1))

        // ---- vertex: glitchy horizontal displacement travelling up the logo ----
        // Sound-reactive: volume and the beat punch both raise the amplitude,
        // and the punch also lowers the threshold so a beat spreads the
        // glitch over more of the logo instead of only the wave's peaks.
        this.material.positionNode = Fn(() => {
            const modelPosition = modelWorldMatrix.mul(vec4(positionGeometry, 1)).xyz

            const glitchTime = u.uTime.sub(modelPosition.y)
            const glitchStrength = sin(glitchTime)
                .add(sin(glitchTime.mul(2.34)))
                .add(sin(glitchTime.mul(5.67)))
                .div(3)
                .toVar()

            // Only keep the peaks, then scale
            const threshold = u.uGlitchThreshold.sub(u.uPunch.mul(u.uGlitchKickSpread))
            const amplitude = u.uGlitchStrength
                .add(u.uVolume.mul(u.uGlitchVolume))
                .add(u.uPunch.mul(u.uGlitchKick))
            glitchStrength.assign(smoothstep(threshold, 1.0, glitchStrength).mul(amplitude))

            const offset = vec3(
                random2D(modelPosition.xz.add(u.uTime)).sub(0.5),
                0,
                random2D(modelPosition.zx.add(u.uTime)).sub(0.5),
            ).mul(glitchStrength)

            return positionLocal.add(offset)
        })()
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
        shape.add(this.params, 'scale', 0.1, 2, 0.001).name('scale')
        shape.add(this.params, 'offsetX', -1, 1, 0.001).name('offset x')
        shape.add(this.params, 'offsetY', -1, 1, 0.001).name('offset y')
        shape.add(this.params, 'rotation', -180, 180, 0.1).name('rotation (deg)')
        shape.add(this.params, 'floatSpeed', 0, 2, 0.01).name('float speed')
        shape.add(this.params, 'floatAmount', 0, 0.2, 0.001).name('float amount')
        shape.add(this.params, 'circleAmount', 0, 45, 0.1).name('circle amount (deg)')
        shape.add(this.params, 'circleSpeed', 0, 1, 0.005).name('circle speed')
        shape.add(this.params, 'camDistance', 2, 20, 0.1).name('camera distance')

        shape.close()

        const glitch = this.folder.addFolder('vertex glitch')
        glitch.add(this.params, 'glitchStrength', 0, 1, 0.001).name('base strength')
            .onChange((v: number) => { u.uGlitchStrength.value = v })
        glitch.add(this.params, 'glitchThreshold', 0, 0.99, 0.01).name('threshold')
            .onChange((v: number) => { u.uGlitchThreshold.value = v })
        glitch.close()

        const look = this.folder.addFolder('look')
        look.addColor(this.params, 'color').name('color')
            .onChange((v: string) => { u.uColor.value.set(v) })
        look.add(this.params, 'fresnelPower1', 0, 20, 0.01).name('fresnel power 1')
            .onChange((v: number) => { u.uFresnelPower1.value = v })
        look.add(this.params, 'fresnelPower2', 0, 10, 0.01).name('fresnel power 2')
            .onChange((v: number) => { u.uFresnelPower2.value = v })
        look.add(this.params, 'stripeFrequency', 0.5, 60, 0.1).name('stripe frequency')
            .onChange((v: number) => { u.uStripeFrequency.value = v })
        look.add(this.params, 'stripeSpeed', -2, 2, 0.01).name('stripe speed')
            .onChange((v: number) => { u.uStripeSpeed.value = v })
        look.close()

        const inner = this.folder.addFolder('inner veins')
        inner.add(this.params, 'innerIntensity', 0, 3, 0.01).name('intensity')
            .onChange((v: number) => { u.uInnerIntensity.value = v })
        inner.add(this.params, 'innerScale', 0.1, 6, 0.01).name('scale')
            .onChange((v: number) => { u.uInnerScale.value = v })
        inner.add(this.params, 'innerSpeed', 0, 2, 0.01).name('morph speed')
            .onChange((v: number) => { u.uInnerSpeed.value = v })
        inner.add(this.params, 'innerFlowX', -2, 2, 0.01).name('flow x')
            .onChange((v: number) => { u.uInnerFlow.value.x = v })
        inner.add(this.params, 'innerFlowY', -2, 2, 0.01).name('flow y')
            .onChange((v: number) => { u.uInnerFlow.value.y = v })
        inner.add(this.params, 'innerWarp', 0, 3, 0.01).name('warp')
            .onChange((v: number) => { u.uInnerWarp.value = v })
        inner.add(this.params, 'innerWarpScale', 0.05, 3, 0.01).name('warp scale')
            .onChange((v: number) => { u.uInnerWarpScale.value = v })
        inner.add(this.params, 'innerDetail', 0, 1, 0.01).name('detail')
            .onChange((v: number) => { u.uInnerDetail.value = v })
        inner.add(this.params, 'innerSharpness', 1, 30, 0.1).name('sharpness')
            .onChange((v: number) => { u.uInnerSharpness.value = v })
        inner.add(this.params, 'innerSharpnessLoud', 1, 30, 0.1).name('sharpness (loud)')
            .onChange((v: number) => { u.uInnerSharpnessLoud.value = v })
        inner.add(this.params, 'innerThreshold', 0, 0.95, 0.01).name('threshold')
            .onChange((v: number) => { u.uInnerThreshold.value = v })
        inner.add(this.params, 'innerContrast', 0.2, 5, 0.01).name('contrast')
            .onChange((v: number) => { u.uInnerContrast.value = v })
        inner.add(this.params, 'innerStripeMix', 0, 1, 0.01).name('stripe mix')
            .onChange((v: number) => { u.uInnerStripeMix.value = v })
        inner.add(this.params, 'centerFocus', 0, 1, 0.01).name('center focus')
            .onChange((v: number) => { u.uCenterFocus.value = v })
        inner.add(this.params, 'centerFalloff', 0.05, 4, 0.01).name('center falloff')
            .onChange((v: number) => { u.uCenterFalloff.value = v })
        inner.add(this.params, 'innerAudio', 0, 5, 0.01).name('audio amount')
            .onChange((v: number) => { u.uInnerAudio.value = v })
        inner.close()

        const audio = this.folder.addFolder('audio')
        audio.add(this.params, 'soundReactive').name('sound reactive')
        audio.add(this.params, 'glitchVolume', 0, 2, 0.01).name('glitch volume')
            .onChange((v: number) => { u.uGlitchVolume.value = v })
        audio.add(this.params, 'glitchKick', 0, 2, 0.01).name('glitch kick')
            .onChange((v: number) => { u.uGlitchKick.value = v })
        audio.add(this.params, 'glitchKickSpread', 0, 1, 0.01).name('glitch kick spread')
            .onChange((v: number) => { u.uGlitchKickSpread.value = v })
        audio.add(this.params, 'opacityKick', 0, 3, 0.01).name('opacity kick')
            .onChange((v: number) => { u.uOpacityKick.value = v })
        audio.add(this.params, 'volumeAttack', 0.5, 20, 0.1).name('volume attack')
        audio.add(this.params, 'punchRelease', 0.5, 20, 0.1).name('punch release')
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

    onBPMBeat() {
        if (!this.visible || !this.params.soundReactive) return
        this.punch = 1
    }

    // -----------------------------------------------------------------------

    update() {
        if (!this.visible) return

        const dt = Math.min(this.exp.time.delta * 0.001, 0.1)
        const t = this.exp.time.elapsedTime * 0.001

        this.uniforms.uTime.value = t

        this.updateAudio(dt)
        this.updateMotion(t)
    }

    private updateAudio(dt: number) {
        const p = this.params
        const volume = p.soundReactive ? (this.exp.audioManager?.volumeSmooth ?? 0) : 0
        this.smoothVolume += (volume - this.smoothVolume) * Math.min(1, dt * p.volumeAttack)
        this.punch += (0 - this.punch) * Math.min(1, dt * p.punchRelease)

        this.uniforms.uVolume.value = this.smoothVolume
        this.uniforms.uPunch.value = this.punch
    }

    private updateMotion(t: number) {
        const p = this.params
        const camera = this.exp.camera.instance

        // Fixed, head-on camera; the logo does the moving.
        camera.position.set(0, 0, p.camDistance)
        camera.lookAt(0, 0, 0)

        // World units per LogoLed screen unit (1 = full screen height) at the
        // logo's plane.
        const screenHeight = 2 * p.camDistance * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5)

        this.group.scale.setScalar(p.scale * screenHeight / LOGO_WORLD_HEIGHT)
        this.group.position.set(
            p.offsetX * screenHeight,
            (p.offsetY + Math.sin(t * p.floatSpeed * Math.PI * 2) * p.floatAmount) * screenHeight,
            0,
        )
        const deg = THREE.MathUtils.degToRad
        const angle = t * p.circleSpeed * Math.PI * 2
        this.group.rotation.set(
            deg(Math.sin(angle) * p.circleAmount),
            0,
            deg(p.rotation + Math.cos(angle) * p.circleAmount),
        )

        // Keep the fresnel's radial centre in sync with the moving logo
        this.modelBox.setFromObject(this.group).getCenter(this.uniforms.uModelCenter.value)
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
