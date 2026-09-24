import Experience from "../Experience"
import * as THREE from 'three/webgpu'
import GUI from "lil-gui"
import World from "../classes/World"
import {
    NodeMaterial,
} from 'three/webgpu'
import {
    Fn, If, uniform, uv, positionGeometry, float, vec2, vec3, vec4,
    length, pow, max, exp, mix, smoothstep, fract, sin, cos,
} from 'three/tsl'
import { LOGO_POLYGONS, type Pt } from "../utils/logoGeometry"
import {
    LOGO_EDGE_COUNT,
    createLogoLedUniforms,
    createLogoEval,
    updateLogoEdgeAudio,
    type LogoEdgeAudioParams,
} from "../tsl/logoLed"
import { snoise3, hash12 } from "../tsl/noise"

// Logo LED scene — the "triangle-led-front" idea (vgpu.sh) applied to the HT
// logo: the logo is an opaque slab that *hides* a light source, and each of its
// edges is an LED strip. The strips can be driven by the audio spectrum (per
// edge), and a comet of light chases around each shape's perimeter — driven
// either by the real mouse, or (by default) by a virtual cursor auto-orbiting
// the logo, both going through the exact same nearest-point projection, so
// the automatic animation moves exactly like it would if you dragged your
// mouse around the shape.
//
// The whole thing is one full-screen fragment shader (TSL). The logo/edge
// geometry and the per-edge distance/glow graph (logoEval/ledFalloff/pulseGlow)
// live in tsl/logoLed.ts, shared with FallingBody's edge lights so both use
// the exact same LED technique instead of two different ones that just look
// similar.

// Per-polygon arc-length table (JS-side mirror of the literals baked into the
// shared shader) — lets "follow mouse" mode project the cursor onto the
// nearest point of each shape's outline without touching the GPU.
type PolyArc = { a: Pt, b: Pt, arcStart: number, len: number }
const POLY_ARCS: { edges: PolyArc[], perimeter: number }[] = LOGO_POLYGONS.map(poly => {
    let arc = 0
    const edges = poly.map((_, i) => {
        const a = poly[i]
        const b = poly[(i + 1) % poly.length]
        const len = Math.hypot(b.x - a.x, b.y - a.y)
        const edge = { a, b, arcStart: arc, len }
        arc += len
        return edge
    })
    return { edges, perimeter: arc }
})

// Nearest point on polygon `pi`'s outline to (x, y), as that outline's own
// 0..1 arc-length fraction — the same space the shader's chase light moves
// through, so this can just replace uTime as the light's position.
function nearestArcU(pi: number, x: number, y: number): number {
    const { edges, perimeter } = POLY_ARCS[pi]
    let best = Infinity
    let bestArc = 0
    for (const { a, b, arcStart, len } of edges) {
        const ex = b.x - a.x, ey = b.y - a.y
        const wx = x - a.x, wy = y - a.y
        const denom = ex * ex + ey * ey
        const h = denom > 1e-12 ? Math.min(1, Math.max(0, (wx * ex + wy * ey) / denom)) : 0
        const d = Math.hypot(wx - ex * h, wy - ey * h)
        if (d < best) { best = d; bestArc = (arcStart + h * len) / perimeter }
    }
    return bestArc
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export default class LogoLedScene extends World {

    private exp: Experience
    private scene: THREE.Scene
    private gui: GUI

    private material!: NodeMaterial
    private mesh!: THREE.Mesh
    private uniforms: Record<string, any>

    private folder!: GUI
    private visible = false
    private guiState = { visible: false }

    // Set by the owning world so the GUI toggle can also swap out whatever
    // other full-screen scene is running.
    public onToggle: ((v: boolean) => void) | null = null

    private edgeAudio = new Float32Array(LOGO_EDGE_COUNT)
    private smoothVolume = 0
    private flash = 0
    private punch = 0
    private backPunch = 0

    // Raw pointer position, in the same aspect-corrected screen space as the
    // shader's `p` (origin centre, y up) — updated on every pointermove.
    private mouseScreen = { x: 0, y: 0 }
    private mouseU = new Float32Array(LOGO_POLYGONS.length)
    // Auto-chase position: 0..1 arc-length fraction, shared by every polygon
    // and advanced uniformly with time — see update(). Deliberately *not*
    // derived from a projected virtual cursor: these letter shapes are
    // concave, so a cursor orbiting the logo and projected onto each
    // outline's nearest point jumps discontinuously (by up to a third of a
    // shape's perimeter in one frame) whenever the nearest edge flips across
    // the shape's medial axis — that read as the comet stuttering/teleporting
    // instead of gliding. A direct time-based advance is always continuous.
    private autoU = 0

    // Beat-travel variant: the LogoLed equivalent of
    // LightStormLevitatingScene's camera-stepping transition. This scene has
    // no real camera, but rotation/scale of the logo are effectively the
    // "framing". LightStorm's version reads as coherent rather than chaotic
    // because the camera always looks at the same fixed subject — only the
    // vantage hops, the subject itself never drifts. So here the logo's
    // position (offsetX/offsetY) stays pinned to the resting pose at all
    // times; only rotation/scale punch on the beat, around one gentle orbit
    // so neighbouring shots stay close together too. Net effect: a snappy
    // pulse on one steady, anchored shot instead of the logo wandering
    // around the screen.
    private beatTravelMode = false
    private travelShots: { offsetX: number, offsetY: number, rotation: number, scale: number }[] =
        Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2
            return {
                offsetX: 0,
                offsetY: 0.04,
                rotation: Math.sin(a) * 5,
                scale: 0.62 + Math.cos(a * 2) * 0.03,
            }
        })
    private travelIndex = 0
    private stepsPerBeat = 4
    private intraBeatTimeoutIds: number[] = []

    // Public so the owning world can put a quick-access control (pulse speed)
    // directly on the root GUI, next to the scene's visibility toggle.
    public params = {
        // shape
        scale: 0.62,
        offsetX: 0,
        offsetY: 0.04,
        rotation: 0,
        floatSpeed: 0.25,
        floatAmount: 0.02,
        swaySpeed: 0.18,
        swayAmount: 3,
        // colour
        color: '#3dff7a',
        bodyColor: '#2c3f34',
        bgColor: '#02050a',
        // led
        ledWidth: 0.045,
        ledCore: 1.4,
        ledHalo: 0.28,
        ledIntensity: 0.3,
        // hidden light behind the slab
        backRadius: 0.22,
        backIntensity: 0.25,
        backBase: 0,
        backAudio: 0.9,
        backKick: 0.3,
        backAttack: 0.35,
        backRelease: 0.12,
        rimRadius: 0.012,
        rimIntensity: 0,
        interior: 0.22,
        // chase light — same mechanism as mouse-follow below, but driven by
        // a virtual cursor auto-orbiting the logo instead of the real mouse
        pulseOn: true,
        pulseSpeed: 0.197, // orbits/sec
        pulseWidth: 0.06,
        pulseCount: 2,
        pulseIntensity: 2.2,
        pulseAudioSpeed: 0.04,
        pulseKick: 0.08,
        mouseFollow: false, // true = driven by the real mouse instead of the auto-chase
        // floor
        floorOn: true,
        floorY: -0.28,
        floorStrength: 0.6,
        floorSquash: 0.55,
        floorSpread: 0.9,
        floorBlur: 5.0,
        floorFalloff: 3.0,
        floorNoiseScale: 7.0,
        // atmosphere
        haze: 0.21,
        vignette: 0.35,
        grain: 0.056,
        exposure: 1.0,
        soundReactive: true,
        baseLevel: 0,
        audioAmount: 0,
        volumeAmount: 0,
        kickPunch: 0,
        kickFlash: 0.8,
        attack: 0.01,
        release: 0.02,
        bandStart: 0.0,
        bandEnd: 0.0,
        bandCurve: 0.2,
        chaseSpeed: 0,
    }

    constructor(exp: Experience) {
        super()
        this.exp = exp
        this.scene = exp.scene
        this.gui = exp.helpers.GUI

        this.uniforms = {
            uTime: uniform(0),
            uAspect: uniform(exp.sizes.width / exp.sizes.height),
            uAA: uniform(0.002),

            uScale: uniform(this.params.scale),
            uOffset: uniform(new THREE.Vector2(this.params.offsetX, this.params.offsetY)),
            uRot: uniform(0),

            uColor: uniform(new THREE.Color(this.params.color)),
            uBodyColor: uniform(new THREE.Color(this.params.bodyColor)),
            uBgColor: uniform(new THREE.Color(this.params.bgColor)),

            ...createLogoLedUniforms(this.edgeAudio, this.mouseU, {
                ledWidth: this.params.ledWidth,
                ledCore: this.params.ledCore,
                ledHalo: this.params.ledHalo,
                pulseOn: this.params.pulseOn,
                pulseWidth: this.params.pulseWidth,
                pulseCount: this.params.pulseCount,
                pulseIntensity: this.params.pulseIntensity,
            }),
            uLedIntensity: uniform(this.params.ledIntensity),

            uBackRadius: uniform(this.params.backRadius),
            uBackIntensity: uniform(this.params.backIntensity),
            uBackBase: uniform(this.params.backBase),
            uBackAudio: uniform(this.params.backAudio),
            uBackKick: uniform(this.params.backKick),
            uPunch: uniform(0),
            uRimRadius: uniform(this.params.rimRadius),
            uRimIntensity: uniform(this.params.rimIntensity),
            uInterior: uniform(this.params.interior),

            uFloorOn: uniform(1),
            uFloorY: uniform(this.params.floorY),
            uFloorStrength: uniform(this.params.floorStrength),
            uFloorSquash: uniform(this.params.floorSquash),
            uFloorSpread: uniform(this.params.floorSpread),
            uFloorBlur: uniform(this.params.floorBlur),
            uFloorFalloff: uniform(this.params.floorFalloff),
            uFloorNoiseScale: uniform(this.params.floorNoiseScale),

            uHaze: uniform(this.params.haze),
            uVignette: uniform(this.params.vignette),
            uGrain: uniform(this.params.grain),
            uExposure: uniform(this.params.exposure),

            uVolume: uniform(0),
            uFlash: uniform(0),
        }

        this.createMaterial()
        this.createMesh()
        this.setupGUI()
        this.setVisible(false)
        this.resize()

        window.addEventListener('pointermove', this.onPointerMove)
    }

    // Tracked always (cheap), but only projected onto the outline in update()
    // when mouse-follow is actually on.
    private onPointerMove = (e: PointerEvent) => {
        const aspect = this.exp.sizes.width / this.exp.sizes.height
        this.mouseScreen.x = (e.clientX / this.exp.sizes.width - 0.5) * aspect
        this.mouseScreen.y = 0.5 - e.clientY / this.exp.sizes.height
    }

    private createMaterial() {
        const u = this.uniforms
        const logoEval = createLogoEval(u as any)

        // Logo-space transform: undo offset, rotation and scale.
        const toLogo = (q: any) => {
            const qo = q.sub(u.uOffset)
            const c: any = cos(u.uRot.negate())
            const s: any = sin(u.uRot.negate())
            // mat2(c, -s, s, c) * q
            const r = vec2(c.mul(qo.x).add(s.mul(qo.y)), s.negate().mul(qo.x).add(c.mul(qo.y)))
            return r.div(max(u.uScale, 1e-4))
        }

        const fragment = Fn(() => {
            const vUv: any = uv()
            // Aspect-corrected screen space: y in [-0.5, 0.5].
            const p: any = vUv.sub(0.5).mul(vec2(u.uAspect, 1.0))

            // Back wall: near-black with a soft bounce toward the centre.
            const wall = float(0.55).add(
                pow(max(float(1.0).sub(length(p.mul(vec2(0.65, 1.0))).mul(1.15)), 0.0), 2.0).mul(0.45)
            )
            const col: any = u.uBgColor.mul(wall).toVar()

            // ---- the logo, and the light it hides ----
            const lp = toLogo(p)
            const r: any = logoEval(lp, 1.0)
            const sd: any = r.x
            const glow: any = r.y

            const outside = smoothstep(u.uAA.negate(), u.uAA, sd)

            // Light escaping from behind the slab: a broad halo hugging
            // the silhouette, breathing with the overall level.
            const backLevel = u.uBackBase
                .add(u.uVolume.mul(u.uBackAudio))
                .add(u.uPunch.mul(u.uBackKick))
            const back = exp(max(sd, 0.0).negate().div(max(u.uBackRadius, 1e-3)))
                .mul(u.uBackIntensity).mul(backLevel)

            const light = u.uColor.mul(glow.mul(u.uLedIntensity).add(back))
            col.addAssign(light.mul(outside).mul(u.uFlash.add(1.0)))

            // ---- floor radiance ----
            If(u.uFloorOn.greaterThan(0.5), () => {
                const g = u.uFloorY.sub(p.y)
                If(g.greaterThan(0.0), () => {
                    // Cheap ground plane: mirror the scene under the
                    // horizon, squashed and spread with depth, and blur
                    // the LED falloff the further away it lands.
                    const depth = g.div(max(float(0.5).sub(u.uFloorY), 1e-3))
                    const fp: any = vec2(
                        p.x.mul(depth.mul(u.uFloorSpread).add(1.0)),
                        u.uFloorY.add(g.mul(u.uFloorSquash)),
                    )
                    const fr = logoEval(toLogo(fp), depth.mul(u.uFloorBlur).add(1.0))

                    const fBack = exp(max(fr.x, 0.0).negate().div(max(u.uBackRadius, 1e-3)))
                        .mul(u.uBackIntensity).mul(backLevel).mul(0.6)
                    const atten = exp(depth.mul(u.uFloorFalloff).negate())
                    const n = float(0.6).add(
                        float(0.4).mul(snoise3(vec3(fp.mul(u.uFloorNoiseScale), u.uTime.mul(0.06))))
                    )

                    col.assign(mix(col, col.mul(0.7), smoothstep(0.0, 0.015, g)))
                    col.addAssign(
                        u.uColor.mul(fr.y.mul(u.uLedIntensity).add(fBack))
                            .mul(atten).mul(u.uFloorStrength).mul(n).mul(u.uFlash.add(1.0))
                    )
                })
            })

            // ---- the slab itself (the occluder) ----
            const inside = float(1.0).sub(outside)
            const rim = exp(max(sd.negate(), 0.0).negate().div(max(u.uRimRadius, 1e-4)))
            const body = u.uBodyColor.add(u.uColor.mul(rim).mul(u.uRimIntensity).mul(0.12))
            col.assign(mix(col, body, inside))

            // The three shapes overlap, so their union is one blob. Let
            // the buried seams glow faintly through the slab, otherwise
            // the logo reads as a silhouette instead of the logo.
            col.addAssign(u.uColor.mul(glow).mul(u.uLedIntensity).mul(u.uInterior).mul(inside).mul(u.uFlash.add(1.0)))

            // ---- atmosphere ----
            col.addAssign(u.uColor.mul(glow).mul(u.uHaze).mul(0.12))

            const vig = float(1.0).sub(
                u.uVignette.mul(pow(length(vUv.sub(0.5).mul(vec2(1.1, 1.0))).mul(1.35), 2.2))
            )
            col.mulAssign(vig.clamp(0.0, 1.0))

            col.mulAssign(u.uExposure)
            col.addAssign(
                hash12(vUv.mul(1024.0).add(fract(u.uTime).mul(91.7))).sub(0.5).mul(u.uGrain)
            )

            return vec4(col.max(0.0), 1.0)
        })

        this.material = new NodeMaterial()
        this.material.depthTest = false
        this.material.depthWrite = false
        this.material.vertexNode = vec4(positionGeometry.xy, 0.9999, 1.0)
        this.material.fragmentNode = fragment()
    }

    private createMesh() {
        this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
        this.mesh.frustumCulled = false
        this.mesh.renderOrder = -999
        this.scene.add(this.mesh)
    }

    // -----------------------------------------------------------------------
    // GUI
    // -----------------------------------------------------------------------

    private setupGUI() {
        const u = this.uniforms
        this.folder = this.gui.addFolder('logo_led')

        this.folder.add(this.guiState, 'visible').name('visible').listen()
            .onChange((v: boolean) => {
                this.onToggle ? this.onToggle(v) : this.setVisible(v)
            })

        const shape = this.folder.addFolder('shape')
        shape.add(this.params, 'scale', 0.1, 2, 0.005).name('scale')
            .onChange((v: number) => { u.uScale.value = v; this.resize() })
        shape.add(this.params, 'offsetX', -1, 1, 0.005).name('offset X')
            .onChange((v: number) => { u.uOffset.value.x = v })
        shape.add(this.params, 'offsetY', -1, 1, 0.005).name('offset Y')
            .onChange((v: number) => { u.uOffset.value.y = v })
        shape.add(this.params, 'rotation', -180, 180, 0.5).name('rotation (deg)')
        shape.add(this.params, 'floatSpeed', 0, 2, 0.01).name('float speed')
        shape.add(this.params, 'floatAmount', 0, 0.2, 0.001).name('float amount')
        shape.add(this.params, 'swaySpeed', 0, 2, 0.01).name('sway speed')
        shape.add(this.params, 'swayAmount', 0, 20, 0.1).name('sway amount (deg)')
        shape.close()

        const led = this.folder.addFolder('led')
        led.addColor(this.params, 'color').name('light color')
            .onChange((v: string) => { u.uColor.value.set(v) })
        led.add(this.params, 'ledIntensity', 0, 6, 0.01).name('intensity')
            .onChange((v: number) => { u.uLedIntensity.value = v })
        led.add(this.params, 'ledWidth', 0.005, 0.4, 0.001).name('width')
            .onChange((v: number) => { u.uLedWidth.value = v })
        led.add(this.params, 'ledCore', 0, 4, 0.01).name('core')
            .onChange((v: number) => { u.uLedCore.value = v })
        led.add(this.params, 'ledHalo', 0, 4, 0.01).name('halo')
            .onChange((v: number) => { u.uLedHalo.value = v })
        led.add(this.params, 'rimRadius', 0.001, 0.1, 0.001).name('front rim size')
            .onChange((v: number) => { u.uRimRadius.value = v })
        led.add(this.params, 'rimIntensity', 0, 6, 0.01).name('front rim')
            .onChange((v: number) => { u.uRimIntensity.value = v })
        led.add(this.params, 'interior', 0, 2, 0.01).name('inner seams')
            .onChange((v: number) => { u.uInterior.value = v })

        const pulse = this.folder.addFolder('pulse (edge chase)')
        pulse.add(this.params, 'pulseOn').name('enabled')
            .onChange((v: boolean) => { u.uPulseOn.value = v ? 1 : 0 })
        pulse.add(this.params, 'pulseSpeed', -0.3, 0.3, 0.001).name('speed (loops/s)').listen()
        pulse.add(this.params, 'pulseWidth', 0.01, 0.5, 0.005).name('comet width')
            .onChange((v: number) => { u.uPulseWidth.value = v })
        pulse.add(this.params, 'pulseCount', 1, 8, 1).name('count per loop')
            .onChange((v: number) => { u.uPulseCount.value = v })
        pulse.add(this.params, 'pulseIntensity', 0, 8, 0.05).name('intensity')
            .onChange((v: number) => { u.uPulseIntensity.value = v })
        pulse.add(this.params, 'pulseAudioSpeed', 0, 0.15, 0.001).name('volume -> speed')
        pulse.add(this.params, 'pulseKick', 0, 0.25, 0.002).name('kick -> speed burst')
        pulse.add(this.params, 'mouseFollow').name('follow real mouse (off = auto-chase)')

        const hidden = this.folder.addFolder('hidden light')
        hidden.add(this.params, 'backIntensity', 0, 5, 0.01).name('intensity')
            .onChange((v: number) => { u.uBackIntensity.value = v })
        hidden.add(this.params, 'backRadius', 0.02, 2, 0.005).name('radius')
            .onChange((v: number) => { u.uBackRadius.value = v })
        hidden.add(this.params, 'backBase', 0, 2, 0.01).name('base level')
            .onChange((v: number) => { u.uBackBase.value = v })
        hidden.add(this.params, 'backAudio', 0, 5, 0.01).name('audio amount')
            .onChange((v: number) => { u.uBackAudio.value = v })
        hidden.add(this.params, 'backKick', 0, 5, 0.01).name('kick punch')
            .onChange((v: number) => { u.uBackKick.value = v })
        hidden.add(this.params, 'backAttack', 0.01, 1, 0.01).name('kick attack')
        hidden.add(this.params, 'backRelease', 0.01, 1, 0.01).name('kick release')
        hidden.close()

        const floor = this.folder.addFolder('floor')
        floor.add(this.params, 'floorOn').name('enabled')
            .onChange((v: boolean) => { u.uFloorOn.value = v ? 1 : 0 })
        floor.add(this.params, 'floorY', -0.5, 0.5, 0.005).name('horizon Y')
            .onChange((v: number) => { u.uFloorY.value = v })
        floor.add(this.params, 'floorStrength', 0, 3, 0.01).name('strength')
            .onChange((v: number) => { u.uFloorStrength.value = v })
        floor.add(this.params, 'floorSquash', 0.05, 2, 0.01).name('squash')
            .onChange((v: number) => { u.uFloorSquash.value = v })
        floor.add(this.params, 'floorSpread', 0, 4, 0.01).name('spread')
            .onChange((v: number) => { u.uFloorSpread.value = v })
        floor.add(this.params, 'floorBlur', 0, 20, 0.1).name('blur')
            .onChange((v: number) => { u.uFloorBlur.value = v })
        floor.add(this.params, 'floorFalloff', 0, 8, 0.01).name('falloff')
            .onChange((v: number) => { u.uFloorFalloff.value = v })
        floor.add(this.params, 'floorNoiseScale', 0, 40, 0.1).name('noise scale')
            .onChange((v: number) => { u.uFloorNoiseScale.value = v })
        floor.close()

        const atmo = this.folder.addFolder('atmosphere')
        atmo.addColor(this.params, 'bgColor').name('background')
            .onChange((v: string) => { u.uBgColor.value.set(v) })
        atmo.addColor(this.params, 'bodyColor').name('logo body')
            .onChange((v: string) => { u.uBodyColor.value.set(v) })
        atmo.add(this.params, 'haze', 0, 2, 0.01).name('haze')
            .onChange((v: number) => { u.uHaze.value = v })
        atmo.add(this.params, 'vignette', 0, 2, 0.01).name('vignette')
            .onChange((v: number) => { u.uVignette.value = v })
        atmo.add(this.params, 'grain', 0, 0.3, 0.001).name('grain')
            .onChange((v: number) => { u.uGrain.value = v })
        atmo.add(this.params, 'exposure', 0, 3, 0.01).name('exposure')
            .onChange((v: number) => { u.uExposure.value = v })
        atmo.close()

        const audio = this.folder.addFolder('audio')
        audio.add(this.params, 'soundReactive').name('sound reactive')
        audio.add(this.params, 'baseLevel', 0, 1, 0.005).name('base level')
        audio.add(this.params, 'audioAmount', 0, 8, 0.01).name('spectrum amount')
        audio.add(this.params, 'volumeAmount', 0, 3, 0.01).name('volume amount')
        audio.add(this.params, 'kickPunch', 0, 3, 0.01).name('kick punch')
        audio.add(this.params, 'kickFlash', 0, 3, 0.01).name('kick flash')
        audio.add(this.params, 'attack', 0.01, 1, 0.01).name('attack')
        audio.add(this.params, 'release', 0.01, 1, 0.01).name('release')
        audio.add(this.params, 'bandStart', 0, 1, 0.005).name('band start')
        audio.add(this.params, 'bandEnd', 0, 1, 0.005).name('band end')
        audio.add(this.params, 'bandCurve', 0.2, 4, 0.01).name('band curve')
        audio.add(this.params, 'chaseSpeed', -4, 4, 0.01).name('spectrum band chase')

        this.folder.close()
    }

    showGUI(v: boolean) {
        v ? this.folder.show() : this.folder.hide()
    }

    setVisible(v: boolean, beatTravelMode: boolean = false) {
        this.visible = v
        this.guiState.visible = v
        this.mesh.visible = v

        this.clearIntraBeatTimeouts()
        this.beatTravelMode = v && beatTravelMode

        if (this.beatTravelMode) {
            this.travelIndex = Math.floor(Math.random() * this.travelShots.length)
            this.applyTravelShot()
        }
    }

    private clearIntraBeatTimeouts() {
        this.intraBeatTimeoutIds.forEach(id => clearTimeout(id))
        this.intraBeatTimeoutIds = []
    }

    private applyTravelShot() {
        const shot = this.travelShots[this.travelIndex]
        this.params.offsetX = shot.offsetX
        this.params.offsetY = shot.offsetY
        this.params.rotation = shot.rotation
        this.params.scale = shot.scale
        this.uniforms.uScale.value = shot.scale
        this.resize()
        this.folder.controllersRecursive().forEach(c => c.updateDisplay())
    }

    private stepCameraTravel() {
        this.travelIndex = (this.travelIndex + 1) % this.travelShots.length
        this.applyTravelShot()
    }

    // -----------------------------------------------------------------------
    // Audio
    // -----------------------------------------------------------------------

    private updateAudio(dt: number) {
        const an = this.exp.audioManager
        const p = this.params

        const volume = p.soundReactive ? (an?.volumeSmooth ?? 0) : 0
        const kick = p.soundReactive ? (this.exp.bpmManager?.pulse ?? 0) : 0
        const bins: Float32Array | undefined = p.soundReactive ? an?.spectrum : undefined

        this.smoothVolume += (volume - this.smoothVolume) * Math.min(1, dt * 8)

        // Chase: rotate which slot of the spectrum each edge is reading.
        const chase = p.chaseSpeed !== 0
            ? Math.floor(this.exp.time.elapsedTime * 0.001 * p.chaseSpeed * LOGO_EDGE_COUNT)
            : 0

        updateLogoEdgeAudio(this.edgeAudio, bins, this.smoothVolume, this.punch, p as LogoEdgeAudioParams, dt, chase)

        // Backlight punch chases the same beat trigger as everything else,
        // but through its own attack/release so its snap and fade can be
        // tuned independently of the edge LEDs and the pulse speed-burst.
        const backRate = this.punch > this.backPunch ? p.backAttack : p.backRelease
        this.backPunch += (this.punch - this.backPunch) * Math.min(1, backRate * dt * 60)

        this.punch += (0 - this.punch) * Math.min(1, dt * 6)
        this.flash += (kick * p.kickFlash - this.flash) * Math.min(1, dt * 10)

        this.uniforms.uVolume.value = this.smoothVolume
        this.uniforms.uFlash.value = this.flash
        this.uniforms.uPunch.value = this.backPunch
    }

    onBPMBeat() {
        if (!this.visible || !this.params.soundReactive) return
        console.log('beat')
        this.punch = 1
        this.flash = Math.max(this.flash, this.params.kickFlash)

        if (!this.beatTravelMode) return

        this.clearIntraBeatTimeouts()
        this.stepCameraTravel()

        const beatMs = this.exp.bpmManager?.getBPMDuration() ?? 500
        const stepMs = beatMs / this.stepsPerBeat
        for (let i = 1; i < this.stepsPerBeat; i++) {
            this.intraBeatTimeoutIds.push(setTimeout(() => this.stepCameraTravel(), stepMs * i))
        }
    }

    // -----------------------------------------------------------------------

    update() {
        if (!this.visible) return

        const dt = Math.min(this.exp.time.delta * 0.001, 0.1)
        const t = this.exp.time.elapsedTime * 0.001
        const p = this.params

        this.updateAudio(dt)

        this.uniforms.uTime.value = t

        if (this.beatTravelMode) {
            // Framing is hard-cut per beat step (see stepCameraTravel) — no
            // continuous drift on top, so cuts read as clean jumps.
            this.uniforms.uOffset.value.set(p.offsetX, p.offsetY)
            this.uniforms.uRot.value = p.rotation * Math.PI / 180
        } else {
            this.uniforms.uOffset.value.set(
                p.offsetX,
                p.offsetY + Math.sin(t * p.floatSpeed * Math.PI * 2) * p.floatAmount,
            )
            this.uniforms.uRot.value = (
                p.rotation + Math.sin(t * p.swaySpeed * Math.PI * 2) * p.swayAmount
            ) * Math.PI / 180
        }

        if (p.mouseFollow) {
            // Undo the shader's toLogo transform (offset/rotate/scale, using
            // this frame's just-updated values) to get the cursor's position
            // in logo space, then project it onto each polygon's outline.
            const off = this.uniforms.uOffset.value as THREE.Vector2
            const rot = this.uniforms.uRot.value as number
            const scale = Math.max(this.uniforms.uScale.value as number, 1e-4)
            const qx = this.mouseScreen.x - off.x
            const qy = this.mouseScreen.y - off.y
            const c = Math.cos(-rot), s = Math.sin(-rot)
            const lx = (c * qx - s * qy) / scale
            const ly = (s * qx + c * qy) / scale
            for (let pi = 0; pi < LOGO_POLYGONS.length; pi++) {
                this.mouseU[pi] = nearestArcU(pi, lx, ly)
            }
        } else {
            // Auto-chase: advance one shared arc-length position with time and
            // apply it to every polygon directly — always continuous (see the
            // note on `autoU` above for why a projected orbiting cursor isn't).
            const dir = Math.sign(p.pulseSpeed) || 1
            const speed = p.pulseSpeed + dir * (
                this.smoothVolume * p.pulseAudioSpeed + this.punch * p.pulseKick
            )
            this.autoU = (this.autoU + speed * dt) % 1
            if (this.autoU < 0) this.autoU += 1
            for (let pi = 0; pi < LOGO_POLYGONS.length; pi++) {
                this.mouseU[pi] = this.autoU
            }
        }
    }

    resize() {
        this.uniforms.uAspect.value = this.exp.sizes.width / this.exp.sizes.height
        // One screen pixel expressed in logo units, for edge antialiasing.
        this.uniforms.uAA.value = 1.0 / (this.exp.sizes.height * Math.max(this.params.scale, 1e-4))
    }

    clean() {
        this.clearIntraBeatTimeouts()
        window.removeEventListener('pointermove', this.onPointerMove)
        this.scene.remove(this.mesh)
        this.mesh.geometry.dispose()
        this.material.dispose()
        this.folder.destroy()
    }

    leave() {
        this.clearIntraBeatTimeouts()
    }
}
