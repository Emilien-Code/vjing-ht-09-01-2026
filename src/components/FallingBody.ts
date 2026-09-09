
import Experience from "../Experience"
import * as THREE from "three"
import GUI from "lil-gui";
import World from "../classes/World";
import { LOGO_POLYGONS, LOGO_DEFAULT_HEIGHT, type Pt } from "../utils/logoGeometry";
import {
    LOGO_EDGE_COUNT,
    LOGO_LED_GLSL,
    LOGO_LED_DEFAULTS,
    updateLogoEdgeAudio,
    type LogoEdgeAudioParams,
} from "../shaders/logoLedGlsl";

// Builds a flat plane, sized to the logo polygons' bounding box (plus
// padding for the halo to bleed into), sitting directly in "logo space" —
// the same coordinate system LOGO_LED_GLSL's edge literals are baked in.
// Vertex positions are left unscaled here; the mesh's own `.scale` (set to
// LOGO_DEFAULT_HEIGHT below) handles sizing it into world units, so
// `position.xy` in the vertex shader stays in logo space and can be fed
// straight into logoEval() — exactly the same per-edge distance-field LED
// shader LogoLedScene runs full-screen, just applied to a plane parented to
// the falling body instead of a full-screen quad.
function buildLogoLedPlaneGeometry(polygons: Pt[][], padding: number): THREE.BufferGeometry {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    polygons.forEach(poly => poly.forEach(p => {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    }))

    const x0 = minX - padding, x1 = maxX + padding
    const y0 = minY - padding, y1 = maxY + padding

    const geo = new THREE.PlaneGeometry(x1 - x0, y1 - y0)
    geo.translate((x0 + x1) * 0.5, (y0 + y1) * 0.5, 0)
    return geo
}

export default class FallingBody extends World {

    private exp: Experience
    private scene: THREE.Scene
    private gui: GUI

    // Kept as `{ scene }` (rather than a plain THREE.Object3D) so the owning
    // scenes' existing `fallingBody.gltf.scene.position/rotation` calls keep
    // working unchanged — this now holds a single flat LED-shader plane
    // instead of a loaded GLTF or an extruded 3D mesh.
    public gltf!: { scene: THREE.Object3D }
    private planeMat!: THREE.ShaderMaterial
    private planeGeo!: THREE.BufferGeometry
    private mesh!: THREE.Mesh

    private holder: THREE.Object3D
    private guiFolder!: GUI
    // Drives the LED chase comet's position around the outline — no longer
    // a light direction (there's no toon shading left to aim it at), just an
    // angle that advances every frame and gets turned into a 0..1 arc-length
    // fraction below.
    private chaseAngle = 0
    private smoothVolume = 0
    private punch = 0

    // Per-edge audio-reactive glow level — same array shape and meaning as
    // LogoLedScene's uEdgeAudio (indexed via LOGO_EDGE_BAND_SLOT internally),
    // driven by the same updateLogoEdgeAudio() helper.
    private edgeAudio = new Float32Array(LOGO_EDGE_COUNT)
    // Per-polygon chase-light position (0..1 arc-length fraction). FallingBody
    // has no cursor to project like LogoLedScene's mouse-follow mode, so every
    // entry just gets the same time-based auto-chase value each frame.
    private mouseU = new Float32Array(LOGO_POLYGONS.length)

    private params = {
        // transform / animation
        locked: false, // freezes rotation + falling drift so position can be tweaked by hand
        opacity: 1,
        scale: 0.6,

        // chase orbit
        lightOrbitSpeed: 0.03,
        soundReactive: true,
        lightAudioSpeed: 0.04,
        lightKick: 0.08,
        beatEnabled: false,

        // colour — same LogoLedScene concept: an opaque slab hiding a light,
        // with LED strips along its edges.
        color: '#3dff7a',
        bodyColor: '#2c3f34',

        // led
        ledWidth: LOGO_LED_DEFAULTS.ledWidth,
        ledCore: LOGO_LED_DEFAULTS.ledCore,
        ledHalo: LOGO_LED_DEFAULTS.ledHalo,
        ledIntensity: 1.0,
        rimRadius: 0.012,
        rimIntensity: 0,
        interior: 0.22,
        ambient: 0.35,

        // hidden light behind the slab
        backRadius: 0.22,
        backIntensity: 0.25,
        backBase: 0,
        backAudio: 0.9,

        // chase comet
        pulseOn: true,
        pulseWidth: LOGO_LED_DEFAULTS.pulseWidth,
        pulseCount: LOGO_LED_DEFAULTS.pulseCount,
        pulseIntensity: LOGO_LED_DEFAULTS.pulseIntensity,

        // per-edge audio reactivity — field names match LogoEdgeAudioParams
        // exactly so `this.params` can be passed straight into
        // updateLogoEdgeAudio() without remapping.
        baseLevel: 0.05,
        audioAmount: 1.4,
        volumeAmount: 0.5,
        kickPunch: 0.6,
        attack: 0.35,
        release: 0.12,
        bandStart: 0.0,
        bandEnd: 0.35,
        bandCurve: 0.5,
    }

    constructor(exp: Experience) {
        super()
        this.exp = exp
        this.scene = exp.scene
        this.gui = this.exp.helpers.GUI

        this.holder = new THREE.Object3D()

        this.createPlaneMaterial()
        this.createScene()
        this.addScene()
        this.setupGUI()
    }

    // The same slab + LED-edge + hidden-backlight look LogoLedScene draws
    // full-screen, minus the parts that only make sense for a full-screen
    // effect (floor reflection, background, vignette/grain) — this is a
    // flat plane living inside the 3D scene instead.
    private createPlaneMaterial() {
        this.planeMat = new THREE.ShaderMaterial({
            uniforms: {
                uAA: { value: 0.01 },

                uColor: { value: new THREE.Color(this.params.color) },
                uBodyColor: { value: new THREE.Color(this.params.bodyColor) },

                uLedIntensity: { value: this.params.ledIntensity },
                uLedWidth: { value: this.params.ledWidth },
                uLedCore: { value: this.params.ledCore },
                uLedHalo: { value: this.params.ledHalo },
                uRimRadius: { value: this.params.rimRadius },
                uRimIntensity: { value: this.params.rimIntensity },
                uInterior: { value: this.params.interior },
                uAmbient: { value: this.params.ambient },

                uBackRadius: { value: this.params.backRadius },
                uBackIntensity: { value: this.params.backIntensity },
                uBackBase: { value: this.params.backBase },
                uBackAudio: { value: this.params.backAudio },

                uPulseOn: { value: this.params.pulseOn ? 1 : 0 },
                uPulseWidth: { value: this.params.pulseWidth },
                uPulseCount: { value: this.params.pulseCount },
                uPulseIntensity: { value: this.params.pulseIntensity },

                uMouseU: { value: this.mouseU },
                uEdgeAudio: { value: this.edgeAudio },

                uVolume: { value: 0 },
                uOpacity: { value: this.params.opacity },
            },
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            vertexShader: /* glsl */`
                varying vec2 vLogoP;
                void main() {
                    vLogoP = position.xy;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                uniform float uAA;

                uniform vec3 uColor;
                uniform vec3 uBodyColor;

                uniform float uLedIntensity;
                uniform float uRimRadius;
                uniform float uRimIntensity;
                uniform float uInterior;
                uniform float uAmbient;

                uniform float uBackRadius;
                uniform float uBackIntensity;
                uniform float uBackBase;
                uniform float uBackAudio;

                uniform float uVolume;
                uniform float uOpacity;

                varying vec2 vLogoP;

                ${LOGO_LED_GLSL}

                void main() {
                    vec2 p = vLogoP;
                    vec2 r = logoEval(p, 1.0);
                    float sd = r.x;
                    float glow = r.y;

                    float outside = smoothstep(-uAA, uAA, sd);
                    float inside = 1.0 - outside;

                    // Light escaping from behind the slab, same as LogoLedScene.
                    float back = exp(-max(sd, 0.0) / max(uBackRadius, 1e-3))
                        * uBackIntensity * (uBackBase + uVolume * uBackAudio);
                    vec3 light = uColor * (glow * uLedIntensity + back);

                    // The slab itself, with a thin rim glow and the buried
                    // seams bleeding faintly through, same as LogoLedScene.
                    float rim = exp(-max(-sd, 0.0) / max(uRimRadius, 1e-4));
                    vec3 body = uBodyColor + uColor * rim * uRimIntensity * 0.12;
                    body += uColor * glow * uLedIntensity * uInterior;
                    // Flat baseline lift, independent of edge proximity, so the
                    // slab still reads as a visibly lit opaque surface far from
                    // any edge/LED glow instead of fading into a dark background.
                    body += uColor * uAmbient;

                    vec3 col = mix(light, body, inside);

                    // Opaque over the slab; outside it, alpha follows how
                    // bright the escaping/edge light is so the halo bleeds
                    // out onto whatever sits behind this plane instead of
                    // being a hard-edged quad.
                    float haloAlpha = clamp(max(max(light.r, light.g), light.b), 0.0, 1.0);
                    float alpha = clamp(inside + (1.0 - inside) * haloAlpha, 0.0, 1.0) * uOpacity;

                    gl_FragColor = vec4(max(col, 0.0), alpha);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }
            `,
        })
    }

    createScene() {
        this.planeGeo = buildLogoLedPlaneGeometry(LOGO_POLYGONS, 0.4)
        this.mesh = new THREE.Mesh(this.planeGeo, this.planeMat)
        this.mesh.scale.setScalar(LOGO_DEFAULT_HEIGHT * this.params.scale)
        this.mesh.layers.enable(6)

        const group = new THREE.Object3D()
        group.add(this.mesh)
        
        group.position.z += 3

        this.gltf = { scene: group }
    }

    addScene() {
        this.holder.add(this.gltf.scene)
        this.scene.add(this.holder)
    }

    private setupGUI() {
        this.guiFolder = this.gui.addFolder('falling_body')
        const folder = this.guiFolder

        const transform = folder.addFolder('transform')
        transform.add(this.params, 'locked').name('Lock Animation (edit position)')
        transform.add(this.params, 'opacity', 0, 1, 0.01).name('Opacity').onChange((v: number) => {
            this.planeMat.uniforms.uOpacity.value = v
        })
        transform.add(this.params, 'scale', 0.1, 3, 0.01).name('Scale').onChange((v: number) => {
            this.mesh.scale.setScalar(LOGO_DEFAULT_HEIGHT * v)
        })
        transform.add(this.gltf.scene.position, 'x', -10, 10, 0.01).name('Position X').listen()
        transform.add(this.gltf.scene.position, 'y', -10, 10, 0.01).name('Position Y').listen()
        transform.add(this.gltf.scene.position, 'z', -50, 10, 0.01).name('Position Z').listen()
        transform.add(this.gltf.scene.rotation, 'x', -Math.PI, Math.PI, 0.01).name('Rotation X').listen()
        transform.add(this.gltf.scene.rotation, 'y', -Math.PI, Math.PI, 0.01).name('Rotation Y').listen()
        transform.add(this.gltf.scene.rotation, 'z', -Math.PI, Math.PI, 0.01).name('Rotation Z').listen()

        const chase = folder.addFolder('chase orbit')
        chase.add(this.params, 'lightOrbitSpeed', 0, 0.1, 0.001).name('Orbit Speed')
        chase.add(this.params, 'soundReactive').name('Sound Reactive')
        chase.add(this.params, 'lightAudioSpeed', 0, 0.2, 0.001).name('Volume -> Orbit Speed')
        chase.add(this.params, 'lightKick', 0, 0.5, 0.005).name('Kick -> Orbit Burst')

        const led = folder.addFolder('led')
        led.addColor(this.params, 'color').name('Light Color').onChange((v: string) => {
            this.planeMat.uniforms.uColor.value.set(v)
        })
        led.addColor(this.params, 'bodyColor').name('Body Color').onChange((v: string) => {
            this.planeMat.uniforms.uBodyColor.value.set(v)
        })
        led.add(this.params, 'ledIntensity', 0, 6, 0.01).name('Intensity').onChange((v: number) => {
            this.planeMat.uniforms.uLedIntensity.value = v
        })
        led.add(this.params, 'ledWidth', 0.005, 0.4, 0.001).name('Width').onChange((v: number) => {
            this.planeMat.uniforms.uLedWidth.value = v
        })
        led.add(this.params, 'ledCore', 0, 4, 0.01).name('Core').onChange((v: number) => {
            this.planeMat.uniforms.uLedCore.value = v
        })
        led.add(this.params, 'ledHalo', 0, 4, 0.01).name('Halo').onChange((v: number) => {
            this.planeMat.uniforms.uLedHalo.value = v
        })
        led.add(this.params, 'rimRadius', 0.001, 0.1, 0.001).name('Front Rim Size').onChange((v: number) => {
            this.planeMat.uniforms.uRimRadius.value = v
        })
        led.add(this.params, 'rimIntensity', 0, 6, 0.01).name('Front Rim').onChange((v: number) => {
            this.planeMat.uniforms.uRimIntensity.value = v
        })
        led.add(this.params, 'interior', 0, 2, 0.01).name('Inner Seams').onChange((v: number) => {
            this.planeMat.uniforms.uInterior.value = v
        })
        led.add(this.params, 'ambient', 0, 2, 0.01).name('Ambient (Base Lift)').onChange((v: number) => {
            this.planeMat.uniforms.uAmbient.value = v
        })

        const hidden = folder.addFolder('hidden light')
        hidden.add(this.params, 'backIntensity', 0, 5, 0.01).name('Intensity').onChange((v: number) => {
            this.planeMat.uniforms.uBackIntensity.value = v
        })
        hidden.add(this.params, 'backRadius', 0.02, 2, 0.005).name('Radius').onChange((v: number) => {
            this.planeMat.uniforms.uBackRadius.value = v
        })
        hidden.add(this.params, 'backBase', 0, 2, 0.01).name('Base Level').onChange((v: number) => {
            this.planeMat.uniforms.uBackBase.value = v
        })
        hidden.add(this.params, 'backAudio', 0, 5, 0.01).name('Audio Amount').onChange((v: number) => {
            this.planeMat.uniforms.uBackAudio.value = v
        })

        const pulse = folder.addFolder('pulse (edge chase)')
        pulse.add(this.params, 'pulseOn').name('Comet Enabled').onChange((v: boolean) => {
            this.planeMat.uniforms.uPulseOn.value = v ? 1 : 0
        })
        pulse.add(this.params, 'pulseWidth', 0.01, 0.5, 0.005).name('Comet Width').onChange((v: number) => {
            this.planeMat.uniforms.uPulseWidth.value = v
        })
        pulse.add(this.params, 'pulseCount', 1, 8, 1).name('Comet Count').onChange((v: number) => {
            this.planeMat.uniforms.uPulseCount.value = v
        })
        pulse.add(this.params, 'pulseIntensity', 0, 10, 0.05).name('Comet Intensity').onChange((v: number) => {
            this.planeMat.uniforms.uPulseIntensity.value = v
        })

        const audioFolder = folder.addFolder('audio reactive')
        audioFolder.add(this.params, 'baseLevel', 0, 1, 0.005).name('Base Level')
        audioFolder.add(this.params, 'audioAmount', 0, 4, 0.01).name('Spectrum Amount')
        audioFolder.add(this.params, 'volumeAmount', 0, 3, 0.01).name('Volume Amount')
        audioFolder.add(this.params, 'kickPunch', 0, 3, 0.01).name('Kick Punch')
        audioFolder.add(this.params, 'attack', 0.01, 1, 0.01).name('Attack')
        audioFolder.add(this.params, 'release', 0.01, 1, 0.01).name('Release')
        audioFolder.add(this.params, 'bandStart', 0, 1, 0.005).name('Band Start')
        audioFolder.add(this.params, 'bandEnd', 0, 1, 0.005).name('Band End')
        audioFolder.add(this.params, 'bandCurve', 0.2, 4, 0.01).name('Band Curve')

        this.guiFolder.hide()
    }

    showGUI(v: boolean) {
        v ? this.guiFolder.show() : this.guiFolder.hide()
    }
    private applyEffect(effect: string) {
        this.params.beatEnabled = effect === 'kick'
        // this.gltf.scene.position.y = 0.22

        if (effect === 'aside') {
            this.gltf.scene.position.z = -32.24
            this.gltf.scene.position.y = 0.15
        } else {
            this.gltf.scene.position.z = -33
            this.gltf.scene.position.y = 0.05

        }
    }
    setVisible(v: boolean, effect: string) {
        this.showGUI(v)
        if (v) {
            this.applyEffect(effect)
        }
        this.gltf.scene.visible = v
        this.holder.visible = v
    }

    onBPMBeat() {
        if (!this.exp.audioManager || !this.exp.bpmManager) return
        if (!this.params.soundReactive) return
        this.punch = 1
    }

    update() {

        if (!this.params.locked) {
            // this.gltf.scene.rotation.y += 0.0051
            if (!this.params.beatEnabled) this.gltf.scene.position.z -= 0.0051
        }

        // Chase-light orbit speed reacts to volume/kick the same way
        // LogoLedScene's edge-chase pulse does.
        const dt = Math.min(this.exp.time.delta * 0.001, 0.1)
        const volume = this.params.soundReactive ? (this.exp.audioManager?.volumeSmooth ?? 0) : 0
        this.smoothVolume += (volume - this.smoothVolume) * Math.min(1, dt * 8)
        this.punch += (0 - this.punch) * Math.min(1, dt * 6)

        const bins: Float32Array | undefined = this.params.soundReactive ? this.exp.audioManager?.spectrum : undefined
        updateLogoEdgeAudio(this.edgeAudio, bins, this.smoothVolume, this.punch, this.params as LogoEdgeAudioParams, dt)

        const dir = Math.sign(this.params.lightOrbitSpeed) || 1
        const orbitSpeed = this.params.lightOrbitSpeed + dir * (
            this.smoothVolume * this.params.lightAudioSpeed + this.punch * this.params.lightKick
        )
        this.chaseAngle += orbitSpeed

        // Chase position, shared by every polygon (see the `mouseU` comment
        // above) — mutating the array in place is enough, it's the same
        // object bound to the uMouseU uniform.
        const loop = Math.PI * 2
        const pulseU = ((this.chaseAngle / loop) % 1 + 1) % 1
        this.mouseU.fill(pulseU)

        this.planeMat.uniforms.uVolume.value = this.smoothVolume
    }

    leave() {
        this.planeGeo.dispose()
        this.planeMat.dispose()
    }

}
