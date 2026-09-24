import * as THREE from 'three/webgpu';
import {
    pass, uniform, uv, renderOutput,
    Fn, If, float, vec2, vec3, vec4, length, sqrt,
} from 'three/tsl';
import Experience from "../Experience"
import { ThreePerf } from "three-perf"

import SelectiveBloom from "./SelectiveBloom";
import { AsciiPass } from "./AsciiPass";
import { smoothstepAny } from "../tsl/noise";


import GUI from "lil-gui"
export interface PostProcessingPreset {
    sobel: boolean
    ascii: boolean
    rgbShift: boolean
    bloom: boolean
    asciiCellSize?: number
    rgbShiftAmount?: number
    rgbShiftAngle?: number
    bloomValue?: number
}

const lerp = (t, i, e) => t * (1 - e) + i * e

import type TwoerScene from "../worlds/TowerScene";

export default class Renderer {
    public experience: Experience;
    public sizes: { width: number; height: number };
    public scene: THREE.Scene;
    public camera: { instance: THREE.Camera };
    public instance!: THREE.WebGPURenderer;
    // WebGPURenderer needs an async init() before the first render; the
    // Experience loop waits for this.
    public initialized = false
    public ready!: Promise<void>
    private pipeline!: THREE.RenderPipeline
    private selectiveBloom!: SelectiveBloom

    private asciiPass!: AsciiPass
    private perf: ThreePerf | null = null
    private guiFolder!: GUI

    // Per-effect switches and settings. Every stage of the post chain lives in
    // one shader and is gated by these uniforms, so toggling a glitch preset
    // never rebuilds a graph or recompiles anything.
    private uSobel = uniform(0)
    private uSobelTexel = uniform(new THREE.Vector2(1, 1))
    private uRgbShift = uniform(0)
    private uRgbShiftAmount = uniform(0.001)
    private uRgbShiftAngle = uniform(0)
    private uVignette = {
        gain: uniform(1.27),
        radius: uniform(1.29),
        softness: uniform(0.39),
    }

    private params = {
        threshold: 0.07,
        strength: 2,
        radius: 0.0,
        exposure: 1.52,
        bloom: false,
        sobel: false,
        // tDiffuse: 0,
        // satGreen: 1.5,
        // satOrange: 1.4,

        gain: 2.0,
        vRadius: .5,
        softness: .3,

        ascii: false,
        asciiCellSize: 4,

        rgbShift: false,
        rgbShiftAmount: 0.001,
        rgbShiftAngle: 0.0,
    }

    constructor(experience: Experience) {
        this.experience = experience;

        this.sizes = experience.sizes;
        this.scene = experience.scene;
        this.camera = experience.camera;


        this.setInstance();
        this.createTweaks()
    }

    public setInstance(): void {
        this.guiFolder = this.experience.helpers.GUI.addFolder('renderer');

        this.instance = new THREE.WebGPURenderer({
            canvas: this.experience.canvas,
            antialias: true,
        });

        this.instance.toneMapping = THREE.ACESFilmicToneMapping;
        this.instance.toneMappingExposure = this.params.exposure;
        this.instance.shadowMap.enabled = true;
        this.instance.shadowMap.type = THREE.PCFShadowMap;
        this.instance.setClearColor(0x000000, 1);
        this.instance.setSize(this.sizes.width, this.sizes.height);
        this.instance.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        this.experience.renderer = this

        this.selectiveBloom = new SelectiveBloom(this.experience, 3, undefined, this.guiFolder)
        this.asciiPass = new AsciiPass(window.innerWidth, window.innerHeight);
        this.updateSobelTexel()

        this.pipeline = new THREE.RenderPipeline(this.instance);
        this.buildPipeline()

        this.ready = this.instance.init().then(() => {
            this.initialized = true
            this.selectiveBloom.onResize()

            if (window.location.hash.includes('dev')) {
                try {
                    this.perf = new ThreePerf({
                        anchorX: 'left',
                        anchorY: 'top',
                        domElement: document.body,
                        renderer: this.instance as any,
                    })
                } catch (e) {
                    // three-perf only knows how to read WebGL timer queries.
                    console.warn('three-perf is unavailable with WebGPURenderer', e)
                }
            }
        })
    }

    // The whole post chain as one node graph. Each stage is a function of
    // `uv` (instead of a pass with its own render target) so neighbours /
    // cell centres can be sampled straight from the scene textures:
    //
    //   scene + dark/bloom render -> ACES + sRGB (was OutputPass)
    //     -> sobel -> colour correction -> ascii -> rgb shift -> vignette
    //
    // All stage maths below is written in "uv-up" space (v = 0 at the bottom,
    // like the old WebGL pipeline), so shift directions, the ascii grid origin
    // and glyph orientation are unchanged. The pipeline's own uv() is v-down
    // (top-left origin) on both backends, so it is flipped once, in `base`,
    // right where the textures are sampled.
    //
    // Every stage that branches on its enable-uniform first pins its `uv` into
    // a variable (`.toVar()`). TSL emits a shared expression at its first use;
    // if that use is inside one branch of an If, the other branch would read a
    // variable that was never assigned (samples at uv 0,0 -> black).
    private buildPipeline() {
        // The old EffectComposer rendered into non-MSAA targets, keep that look.
        const scenePass = pass(this.experience.scene, this.experience.camera.instance, { samples: 0 })
        const sceneTexture = scenePass.getTextureNode()
        const bloom = this.selectiveBloom

        // Scene + (dark render, plus its glow when the bloom is on), tone
        // mapped and encoded for the screen.
        const base = Fn(([uvUp]: any[]) => {
            const uvN = vec2(uvUp.x, float(1.0).sub(uvUp.y))
            const sum = sceneTexture.sample(uvN).rgb
                .add(bloom.darkTexture.sample(uvN).rgb)
            const withGlow = sum.add(bloom.glowTexture.sample(uvN).rgb.mul(bloom.glowAmount))
            return renderOutput(vec4(withGlow, 1.0), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace)
        })

        // Sobel edge detection on the red channel.
        const sobelEdges = Fn(([uvN]: any[]) => {
            const t = this.uSobelTexel
            const s = (dx: number, dy: number) => base(uvN.add(t.mul(vec2(dx, dy)))).r

            const tx0y0 = s(-1, -1), tx0y1 = s(-1, 0), tx0y2 = s(-1, 1)
            const tx1y0 = s(0, -1), tx1y2 = s(0, 1)
            const tx2y0 = s(1, -1), tx2y1 = s(1, 0), tx2y2 = s(1, 1)

            const gx = tx2y0.sub(tx0y0).add(tx2y1.sub(tx0y1).mul(2.0)).add(tx2y2.sub(tx0y2))
            const gy = tx0y2.sub(tx0y0).add(tx1y2.sub(tx1y0).mul(2.0)).add(tx2y2.sub(tx2y0))
            const g = sqrt(gx.mul(gx).add(gy.mul(gy)))
            return vec4(vec3(g), 1.0)
        })

        const stageSobel = Fn(([uvIn]: any[]) => {
            const uvN = uvIn.toVar()
            const result = vec4(0.0).toVar()
            If(this.uSobel.greaterThan(0.5), () => {
                result.assign(sobelEdges(uvN))
            }).Else(() => {
                result.assign(base(uvN))
            })
            return result
        })

        // ColorCorrectionShader at its defaults (powRGB = 2, mulRGB = 1,
        // addRGB = 0), always on: squares every channel.
        const stageColor = Fn(([uvN]: any[]) => {
            const c = stageSobel(uvN)
            return vec4(c.rgb.mul(c.rgb), c.a)
        })

        const stageAscii = this.asciiPass.apply((uvN: any) => stageColor(uvN))

        const stageRgbShift = Fn(([uvIn]: any[]) => {
            const uvN = uvIn.toVar()
            const result = vec4(0.0).toVar()
            If(this.uRgbShift.greaterThan(0.5), () => {
                const offset = vec2(this.uRgbShiftAngle.cos(), this.uRgbShiftAngle.sin()).mul(this.uRgbShiftAmount)
                const cr = stageAscii(uvN.add(offset))
                const cga = stageAscii(uvN)
                const cb = stageAscii(uvN.sub(offset))
                result.assign(vec4(cr.r, cga.g, cb.b, cga.a))
            }).Else(() => {
                result.assign(stageAscii(uvN))
            })
            return result
        })

        const vignette = Fn(() => {
            const vUv = uv()
            const c = stageRgbShift(vec2(vUv.x, float(1.0).sub(vUv.y))).rgb
            const len = length(vUv.sub(0.5)).mul(this.uVignette.gain)
            return vec4(
                c.mul(smoothstepAny(this.uVignette.radius, this.uVignette.radius.sub(this.uVignette.softness), len)),
                1.0,
            )
        })

        // Tone mapping and the sRGB encode already happen inside `base`, so
        // the pipeline must not add its own on top.
        this.pipeline.outputColorTransform = false
        this.pipeline.outputNode = vignette()
    }

    private updateSobelTexel() {
        const pr = Math.min(window.devicePixelRatio, 2)
        this.uSobelTexel.value.set(
            1 / (this.sizes.width * pr),
            1 / (this.sizes.height * pr),
        )
    }

    private setSobel(v: boolean) {
        this.uSobel.value = v ? 1 : 0
    }

    private setRgbShift(v: boolean) {
        this.uRgbShift.value = v ? 1 : 0
    }

    createTweaks() {
        const folder = this.guiFolder;

        // — Tone mapping
        folder.add(this.params, 'exposure', 0.0, 10.0).step(0.01)
            .name('exposure')
            .onChange((value: number) => { this.instance.toneMappingExposure = value; });

        // — Sobel
        const sobelFolder = folder.addFolder('sobel');
        sobelFolder.add(this.params, 'sobel').name('enabled')
            .onChange((value: boolean) => { this.setSobel(value); });

        // — Vignette
        const vignetteFolder = folder.addFolder('vignette');
        vignetteFolder.add(this.params, 'gain', 0, 2).step(0.01).name('gain')
            .onChange((value: number) => { this.uVignette.gain.value = value; });
        vignetteFolder.add(this.params, 'vRadius', 0, 2).step(0.01).name('radius')
            .onChange((value: number) => { this.uVignette.radius.value = value; });
        vignetteFolder.add(this.params, 'softness', 0, 2).step(0.01).name('softness')
            .onChange((value: number) => { this.uVignette.softness.value = value; });

        // — ASCII
        const asciiFolder = folder.addFolder('ascii');
        asciiFolder.add(this.params, 'ascii').name('enabled')
            .onChange((value: boolean) => { this.asciiPass.enabled = value; });
        asciiFolder.add(this.params, 'asciiCellSize', 4, 32).step(1).name('cell size')
            .onChange((value: number) => { this.asciiPass.cellSize = value; });

        // — RGB shift
        const rgbFolder = folder.addFolder('rgb shift');
        rgbFolder.add(this.params, 'rgbShift').name('enabled')
            .onChange((value: boolean) => { this.setRgbShift(value); });
        rgbFolder.add(this.params, 'rgbShiftAmount', 0.0, 0.05).step(0.001).name('amount')
            .onChange((value: number) => { this.uRgbShiftAmount.value = value; });
        rgbFolder.add(this.params, 'rgbShiftAngle', 0.0, Math.PI * 2).step(0.01).name('angle')
            .onChange((value: number) => { this.uRgbShiftAngle.value = value; });
    }


    public update(): void {
        if (!this.initialized) return

        if (
            this.experience.world
            && (this.experience.world as TwoerScene).isPlaying
            && this.experience.time.elapsedTime > 78300
        ) {
            this.params.exposure = 20
        }
        this.instance.toneMappingExposure = lerp(this.instance.toneMappingExposure, this.params.exposure, 0.01);
        this.perf?.begin()
        this.selectiveBloom.update()
        this.pipeline.render();
        this.perf?.end()
    }

    public applyPostProcessingPreset(preset: PostProcessingPreset): void {
        this.params.sobel = preset.sobel
        this.setSobel(preset.sobel)

        this.params.ascii = preset.ascii
        this.asciiPass.enabled = preset.ascii
        if (preset.asciiCellSize !== undefined) {
            this.params.asciiCellSize = preset.asciiCellSize
            this.asciiPass.cellSize = preset.asciiCellSize
        }

        this.params.rgbShift = preset.rgbShift
        this.setRgbShift(preset.rgbShift)
        if (preset.rgbShiftAmount !== undefined) {
            this.params.rgbShiftAmount = preset.rgbShiftAmount
            this.uRgbShiftAmount.value = preset.rgbShiftAmount
        }
        if (preset.rgbShiftAngle !== undefined) {
            this.params.rgbShiftAngle = preset.rgbShiftAngle
            this.uRgbShiftAngle.value = preset.rgbShiftAngle
        }


        this.params.bloom = preset.bloom
        if (preset.bloom && preset.bloomValue) {
            this.selectiveBloom.params.strength = preset.bloomValue
        }
        this.guiFolder.controllersRecursive().forEach(c => c.updateDisplay())
    }

    public resize(): void {
        this.instance.setSize(this.experience.sizes.width, this.experience.sizes.height);
        this.instance.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.asciiPass && this.asciiPass.setSize(this.experience.sizes.width, this.experience.sizes.height);
        this.updateSobelTexel()
        this.initialized && this.selectiveBloom.onResize()
    }
}
