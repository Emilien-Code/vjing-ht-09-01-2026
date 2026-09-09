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
            { sobel: true, ascii: true, asciiCellSize: 4, rgbShift: false, bloom: true },
        ],
    },
    sphereLevitating: {
        constant: NO_EFFECT,
        glitches: [
            { sobel: false, ascii: true, asciiCellSize: 4, rgbShift: false, bloom: false },
        ],
    },
    waterDancing: {
        constant: NO_EFFECT,
        glitches: [
            { sobel: true, ascii: true, asciiCellSize: 4, rgbShift: false, bloom: false },
            { sobel: false, ascii: true, asciiCellSize: 4, rgbShift: false, bloom: true, bloomValue: 0.7 },
            { sobel: false, ascii: true, asciiCellSize: 4, rgbShift: false, bloom: false }
        ],
    },
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

    private switchScene(index: number) {
        clearTimeout(this.timeoutDurationId)
        clearTimeout(this.timeoutDelayId)
        this.hideAll()
        this.currentSceneIndex = index
        const name = SCENE_NAMES[index]
        this.getScene(name).setVisible(true)
        this.visibility[name] = true

        const cloudParams = CLOUDS_PARAMS[name]
        if (cloudParams) {
            this.clouds.reconfigure(cloudParams)
            this.clouds.setVisible(true)
        }

        this.exp.renderer.applyPostProcessingPreset(SCENE_POST_PROCESSING[name].constant)
        this.gui.controllersRecursive().forEach(c => c.updateDisplay())
    }

    private triggerGlitch() {
        if (this.currentSceneIndex < 0) return
        const name = SCENE_NAMES[this.currentSceneIndex]
        const config = SCENE_POST_PROCESSING[name]
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
        const candidates = SCENE_NAMES
            .map((_, i) => i)
            .filter(i => i !== this.currentSceneIndex)
        const next = candidates[Math.floor(Math.random() * candidates.length)]
        this.switchScene(next)
    }

    onBPMBeat() {
        // if (!this.exp.audioManager || !this.exp.bpmManager) return
        SCENE_NAMES.forEach(name => {
            if (this.visibility[name]) this.getScene(name).onBPMBeat()
        })
        if (!this.musicReactive) return


        if (Math.random() < 0.5) this.triggerGlitch()

        if (Math.random() < 1 / 3) {
            const candidates = SCENE_NAMES
                .map((_, i) => i)
                .filter(i => i !== this.currentSceneIndex && SCENE_NAMES[i] !== 'waterDancing')
            const next = candidates[Math.floor(Math.random() * candidates.length)]
            this.switchScene(next)
        }
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
