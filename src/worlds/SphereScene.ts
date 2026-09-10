import Experience from "../Experience"
import * as THREE from "three"
import GUI from "lil-gui"
import World from "../classes/World"
import Water from "../components/Water"
import Clouds from "../components/Clouds"
import type { cloudParamsType } from "../components/Clouds"
import SquaresFallingScene from "../scenes/SquaresFallingScene"
import SphereLevitatingScene from "../scenes/SphereLevitatingScene"
import WaterDancingScene from "../scenes/WaterDancingScene"
import LightStormLevitatingScene from "../scenes/LightStormLevitatingScene"
import LogoLedScene from "../scenes/LogoLedScene"
import type { PostProcessingPreset } from "../utils/Renderer"

type SceneName = 'squaresFalling' | 'sphereLevitating' | 'waterDancing' | 'lightStormLevitating' | 'logoLed'

const SCENE_NAMES: SceneName[] = [
    'squaresFalling',
    'sphereLevitating',
    'waterDancing',
    'lightStormLevitating',
    'logoLed',
]

const NO_EFFECT: PostProcessingPreset = { sobel: false, ascii: false, asciiCellSize: 4, rgbShift: false, bloom: false }

const CLOUDS_PARAMS: Partial<Record<SceneName, Omit<cloudParamsType, 'scaleFactor'>>> = {
    squaresFalling: {
        x: 0, y: 0, z: -100,
        clouds: 800,
        yAmplitude: 8,
        cloudOpacity: 0.025,
        color: '#0f755c',
        blending: THREE.AdditiveBlending,
        scaleAspect: 5,
        spreadX: 6,
        spreadZ: 220,
        textureKey: 'noise',
    },
    lightStormLevitating: {
        x: -10, y: 0, z: -10,
        clouds: 800,
        yAmplitude: 8,
        cloudOpacity: 0.01,
        color: '#0f755c',
        blending: THREE.AdditiveBlending,
        scaleAspect: 5,
        spreadX: 20,
        spreadZ: 20,
        textureKey: 'noise',
    },
}

type ScenePostProcessingConfig = {
    constant: PostProcessingPreset
    glitches: PostProcessingPreset[]
}

const SCENE_POST_PROCESSING: Record<SceneName, ScenePostProcessingConfig> = {
    squaresFalling: {
        constant: NO_EFFECT,
        glitches: [
            NO_EFFECT,
            NO_EFFECT,
            NO_EFFECT,
            { sobel: true, ascii: true, asciiCellSize: 4, rgbShift: false, bloom: true },
        ],
    },
    sphereLevitating: {
        // Sphere is always NO_EFFECT, no glitches.
        constant: NO_EFFECT,
        glitches: [],
    },
    waterDancing: {
        constant: NO_EFFECT,
        glitches: [
            { sobel: true, ascii: true, asciiCellSize: 4, rgbShift: false, bloom: false },
            { sobel: false, ascii: true, asciiCellSize: 4, rgbShift: false, bloom: true, bloomValue: 0.7 },
            { sobel: false, ascii: true, asciiCellSize: 4, rgbShift: false, bloom: false }
        ],
    },
    // Used for the beat-travel camera-stepping variant (now the only
    // automatic LightStorm transition), which keeps the original
    // ascii-glitch postprocessing. LIGHTSTORM_NORMAL_POST (always NO_EFFECT)
    // still applies when lightStormLevitating is picked manually.
    lightStormLevitating: {
        constant: { sobel: false, ascii: true, asciiCellSize: 4, rgbShift: false, bloom: false },
        glitches: [
            { sobel: true, ascii: true, asciiCellSize: 4, rgbShift: false, bloom: false },
            { sobel: false, ascii: true, asciiCellSize: 4, rgbShift: false, bloom: false },
        ],
    },
    logoLed: {
        constant: NO_EFFECT,
        glitches: [
            { sobel: false, ascii: true, asciiCellSize: 4, rgbShift: false, bloom: false },
            { sobel: false, ascii: true, asciiCellSize: 4, rgbShift: true, bloom: false },
        ],
    },
}

// Sphere/LightStorm's "always NO_EFFECT" rule, applied when
// lightStormLevitating is picked manually (via Space or the Visibility
// panel) rather than through the automatic beat-travel transition.
const LIGHTSTORM_NORMAL_POST: ScenePostProcessingConfig = { constant: NO_EFFECT, glitches: [] }

// --- Scene classification / selection rules ---
// Long: 12-36 beats (logoLed: 24-36 beats). Intermediate: 6-18 beats.
// Transition (beat-travel LightStorm, now the only automatic transition
// variant): 6-12 beats.
const LONG_DURATION_RANGE: [number, number] = [12, 36]
const LOGO_LED_DURATION_RANGE: [number, number] = [24, 36]
const INTERMEDIATE_DURATION_RANGE: [number, number] = [6, 8]
const TRANSITION_BEAT_TRAVEL_RANGE: [number, number] = [6, 12]

type LongEntry = { name: 'squaresFalling' | 'logoLed', direction?: boolean, weight: number, durationRange: [number, number] }
// logoLed vs squaresFalling: 3/4 vs 1/4 chance (weight 6 vs 1+1).
const LONG_ENTRIES: LongEntry[] = [
    { name: 'squaresFalling', direction: true, weight: 1, durationRange: LONG_DURATION_RANGE },
    { name: 'squaresFalling', direction: false, weight: 1, durationRange: LONG_DURATION_RANGE },
    { name: 'logoLed', weight: 6, durationRange: LOGO_LED_DURATION_RANGE },
]

type IntermediateEntry = { name: 'sphereLevitating', weight: number }
const INTERMEDIATE_ENTRIES: IntermediateEntry[] = [
    { name: 'sphereLevitating', weight: 1 },
]

type MainPick = { name: 'squaresFalling' | 'logoLed' | 'sphereLevitating', direction?: boolean, durationRange: [number, number] }

function randomIntInRange([min, max]: [number, number]): number {
    return Math.floor(min + Math.random() * (max - min + 1))
}

function weightedPick<T extends { weight: number }>(entries: T[]): T {
    const total = entries.reduce((sum, e) => sum + e.weight, 0)
    let r = Math.random() * total
    for (const entry of entries) {
        if (r < entry.weight) return entry
        r -= entry.weight
    }
    return entries[entries.length - 1]
}

function pickMainScene(): MainPick {
    if (Math.random() < 2 / 3) {
        const entry = weightedPick(LONG_ENTRIES)
        return { name: entry.name, direction: entry.direction, durationRange: entry.durationRange }
    }
    const entry = weightedPick(INTERMEDIATE_ENTRIES)
    return { name: entry.name, durationRange: INTERMEDIATE_DURATION_RANGE }
}

export default class GlassScene extends World {

    private exp: Experience
    private scene: THREE.Scene
    private gui: GUI

    private water: Water
    private clouds!: Clouds

    private squaresFalling!: SquaresFallingScene
    private sphereLevitating!: SphereLevitatingScene
    private waterDancing!: WaterDancingScene
    private lightStormLevitating!: LightStormLevitatingScene
    private logoLed!: LogoLedScene

    private timeoutDurationId: number = -1
    private timeoutDelayId: number = -1

    private currentSceneIndex: number = -1
    private musicReactive: boolean = true
    private sceneBeatCount: number = 0
    private sceneBeatDuration: number = 0
    private currentPostProcessing: ScenePostProcessingConfig | null = null

    // Drives the long/intermediate/transition scene rotation: 'transition'
    // starting with 0 remaining beats means the very first beat immediately
    // picks a main scene, matching the old startup behavior.
    private director: { phase: 'main' | 'transition', remainingBeats: number, lastMainKey: string } = {
        phase: 'transition',
        remainingBeats: 0,
        lastMainKey: '',
    }

    private visibility: Record<SceneName, boolean> = {
        squaresFalling: false,
        sphereLevitating: false,
        waterDancing: false,
        lightStormLevitating: false,
        logoLed: false,
    }

    constructor(exp: Experience) {
        super()
        this.exp = exp
            ; (window as any).exp = exp
        this.scene = exp.scene
        this.gui = this.exp.helpers.GUI

        this.water = new Water(exp, {
            color: 0xffffff,
            speed: 0.0021,
            width: 1000,
            height: 1000,
        })
        this.water.water.rotation.x = -1.34159265358979
        this.water.water.position.y = 0
        this.scene.add(this.water.water)

        this.squaresFalling = new SquaresFallingScene(exp)
        this.sphereLevitating = new SphereLevitatingScene(exp)
        this.waterDancing = new WaterDancingScene(exp, this.water)
        this.lightStormLevitating = new LightStormLevitatingScene(exp, this.water)
        this.logoLed = new LogoLedScene(exp)
        this.logoLed.onToggle = (v: boolean) => {
            if (v) {
                this.switchScene(SCENE_NAMES.indexOf('logoLed'))
            } else {
                this.hideAll()
                this.currentSceneIndex = -1
            }
        }

        this.clouds = new Clouds(exp, CLOUDS_PARAMS.squaresFalling!)
        this.clouds.createClouds()
        this.clouds.setVisible(false)

        this.setupGUI()
    }

    private getScene(name: SceneName) {
        return {
            squaresFalling: this.squaresFalling,
            sphereLevitating: this.sphereLevitating,
            waterDancing: this.waterDancing,
            lightStormLevitating: this.lightStormLevitating,
            logoLed: this.logoLed,
        }[name]
    }

    private hideAll() {
        SCENE_NAMES.forEach(name => {
            this.getScene(name).setVisible(false)
            this.visibility[name] = false
        })
        this.clouds.setVisible(false)
    }

    private switchScene(index: number, options: { direction?: boolean, lightStormBeatTravel?: boolean } = {}) {
        clearTimeout(this.timeoutDurationId)
        clearTimeout(this.timeoutDelayId)
        this.hideAll()
        this.currentSceneIndex = index
        const name = SCENE_NAMES[index]

        this.sceneBeatCount = 0
        this.sceneBeatDuration = this.director.remainingBeats

        if (name === 'squaresFalling') {
            this.squaresFalling.setVisible(true, options.direction ?? true)
        } else if (name === 'lightStormLevitating') {
            this.lightStormLevitating.setVisible(true, options.lightStormBeatTravel ?? false)
        } else {
            this.getScene(name).setVisible(true)
        }
        this.visibility[name] = true

        const cloudParams = CLOUDS_PARAMS[name]
        if (cloudParams) {
            this.clouds.reconfigure(cloudParams)
            this.clouds.setVisible(true)
        }

        this.currentPostProcessing = name === 'lightStormLevitating'
            ? (options.lightStormBeatTravel ? SCENE_POST_PROCESSING.lightStormLevitating : LIGHTSTORM_NORMAL_POST)
            : SCENE_POST_PROCESSING[name]

        this.exp.renderer.applyPostProcessingPreset(this.currentPostProcessing.constant)
        this.gui.controllersRecursive().forEach(c => c.updateDisplay())
    }

    private triggerGlitch() {
        if (this.currentSceneIndex < 0 || !this.currentPostProcessing) return
        const config = this.currentPostProcessing
        if (config.glitches.length === 0) return

        clearTimeout(this.timeoutDurationId)
        clearTimeout(this.timeoutDelayId)

        const glitch = config.glitches[Math.floor(Math.random() * config.glitches.length)]
        const delay = Math.random() * 200
        const duration = Math.max(100, Math.random() * 1000)

        this.timeoutDelayId = setTimeout(() => {
            this.exp.renderer.applyPostProcessingPreset(glitch)
        }, delay)

        this.timeoutDurationId = setTimeout(() => {
            this.exp.renderer.applyPostProcessingPreset(config.constant)
        }, delay + duration)
    }

    private setupGUI() {
        this.gui.add(this, 'musicReactive').name('Music Reactive')

        const folder = this.gui.addFolder('Visibility')
        SCENE_NAMES.forEach(name => {
            folder.add(this.visibility, name).name(name).onChange((v: boolean) => {
                this.switchScene(SCENE_NAMES.findIndex(n => n == name))
            })
        })
    }

    onReady() {
        this.squaresFalling.onReady()
    }

    randomizeScene() {
        const pick = pickMainScene()
        this.director.phase = 'main'
        this.director.remainingBeats = randomIntInRange(pick.durationRange)
        this.director.lastMainKey = `${pick.name}:${pick.direction ?? ''}`
        this.switchScene(SCENE_NAMES.indexOf(pick.name), { direction: pick.direction })
    }

    onBPMBeat() {
        this.sceneBeatCount++
        const currentName = this.currentSceneIndex >= 0 ? SCENE_NAMES[this.currentSceneIndex] : 'none'
        console.log(`beat ${this.sceneBeatCount}/${this.sceneBeatDuration} (${currentName})`)

        SCENE_NAMES.forEach(name => {
            if (this.visibility[name]) this.getScene(name).onBPMBeat()
        })
        if (!this.musicReactive) return

        if (Math.random() < 0.5) this.triggerGlitch()

        this.director.remainingBeats--
        if (this.director.remainingBeats <= 0) this.advanceDirector()
    }

    private advanceDirector() {
        if (this.director.phase === 'main') {
            this.director.phase = 'transition'
            this.director.remainingBeats = randomIntInRange(TRANSITION_BEAT_TRAVEL_RANGE)
            this.switchScene(SCENE_NAMES.indexOf('lightStormLevitating'), { lightStormBeatTravel: true })
            return
        }

        // Avoid immediately repeating the same main scene/variant back to back.
        let pick = pickMainScene()
        let key = `${pick.name}:${pick.direction ?? ''}`
        let attempts = 0
        while (key === this.director.lastMainKey && attempts < 5) {
            pick = pickMainScene()
            key = `${pick.name}:${pick.direction ?? ''}`
            attempts++
        }

        this.director.phase = 'main'
        this.director.lastMainKey = key
        this.director.remainingBeats = randomIntInRange(pick.durationRange)
        this.switchScene(SCENE_NAMES.indexOf(pick.name), { direction: pick.direction })
    }

    update() {
        this.water.update()
        this.squaresFalling.update()
        this.sphereLevitating.update()
        this.waterDancing.update()
        this.lightStormLevitating.update()
        this.logoLed.update()
        this.clouds.update()
    }

    resize() {
        this.logoLed.resize()
    }

    leave() { }
}
