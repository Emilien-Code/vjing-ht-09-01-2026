import * as THREE from "three";
import Experience from "../Experience"
import { ThreePerf } from "three-perf"

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SobelOperatorShader } from 'three/addons/shaders/SobelOperatorShader.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import SelectiveBloom from "./SelectiveBloom";
import { ColorCorrectionShader } from 'three/examples/jsm/shaders/ColorCorrectionShader.js';
import { RGBShiftShader } from 'three/examples/jsm/shaders/RGBShiftShader.js';


import GUI from "lil-gui"
import {
    godRaysBloom,
    jellyFishBloom,
    rendererPalette
} from "../common/colors"

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



const vignettShaderProperties = {

    uniforms: {

        "tDiffuse": { type: "t", value: null },

        "resolution": { type: "v2", value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        "gain": { type: "f", value: 0.9 },

        "horizontal": { type: "bool", value: false },
        "radius": { type: "f", value: 0.75 },
        "softness": { type: "f", value: 0.3 },


    },

    vertexShader: /*glsl*/`

        varying vec2 vUv;

        void main() {

            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

        }

    `,

    fragmentShader: [
        "uniform sampler2D tDiffuse;",
        "uniform vec2 resolution;",
        "uniform float gain;",
        "uniform float radius;",
        "uniform float softness;",
        "uniform bool horizontal;",

        "varying vec2 vUv;",

        "float rand(vec2 co){",
        "return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);",
        "}",

        "void main() {",
        "vec4 color = texture2D( tDiffuse, vUv );",
        "vec3 c = color.rgb;",
        "float noise = rand(gl_FragCoord.xy) * .05;",

        // determine center
        "vec2 position;",
        "position = (vUv.xy) - vec2(0.5);",
        "float len = length(position) * gain;",
        "gl_FragColor = vec4 ( c * vec3 (smoothstep(radius, radius - softness, len)), 1.0);",
        "}"
    ].join("\n")

};

import { ClearPass } from "three/examples/jsm/Addons.js";
import { AsciiPass } from "./AsciiPass";
import type TwoerScene from "../worlds/TowerScene";

export default class Renderer {
    public experience: Experience;
    public sizes: { width: number; height: number };
    public scene: THREE.Scene;
    public camera: { instance: THREE.Camera };
    public instance!: THREE.WebGLRenderer;
    private cursorTexture: THREE.WebGLRenderTarget
    private sceneTexture: THREE.WebGLRenderTarget
    private orthographicCamera: THREE.OrthographicCamera;
    private composer: EffectComposer | null = null;
    public strength = 0
    public renderScene: RenderPass
    public renderScene2: RenderPass
    private bloomPass: UnrealBloomPass
    private effectSobel: ShaderPass
    private selectiveBloom: SelectiveBloom
    private godRaysBloom: SelectiveBloom

    private vignetteShader: THREE.ShaderMaterial
    private asciiPass: AsciiPass
    private rgbShiftPass: ShaderPass
    private perf: ThreePerf | null = null
    private guiFolder!: GUI

    private colorCorrectionpowRGB_x = 2.2
    private colorCorrectionpowRGB_y = 1.51
    private colorCorrectionpowRGB_z = 1.0

    private colorCorrectionmulRGB_x = 2.1
    private colorCorrectionmulRGB_y = 1.505
    private colorCorrectionmulRGB_z = 0.95
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

        if (window.location.hash.includes('dev')) {
            this.perf = new ThreePerf({
                anchorX: 'left',
                anchorY: 'top',
                domElement: document.body,
                renderer: this.instance,
            })
        }
    }

    public setInstance(strength = 0, r = 0, t = 0): void {
        this.guiFolder = this.experience.helpers.GUI.addFolder('renderer');

        this.instance = new THREE.WebGLRenderer({
            canvas: this.experience.canvas,
            antialias: true,
        });

        this.instance.toneMapping = THREE.ACESFilmicToneMapping;
        this.instance.toneMappingExposure = this.params.exposure;
        this.instance.shadowMap.enabled = true;
        this.instance.shadowMap.type = THREE.PCFSoftShadowMap;
        // this.instance.setClearColor(rendererPalette[0], 1);
        this.instance.setClearColor(0x000000, 1);
        this.instance.setSize(this.sizes.width, this.sizes.height);
        this.instance.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.instance.physicallyCorrectLights = true

        this.experience.renderer = this


        this.renderScene = new RenderPass(this.experience.scene, this.experience.camera.instance/* null, new THREE.Color( 0xff00ff ), 1**/)
        this.renderScene2 = new RenderPass(this.experience.scene, this.experience.camera.instance/* null, new THREE.Color( 0xff00ff ), 1**/)

        this.selectiveBloom = new SelectiveBloom(this.experience, 3, undefined, this.guiFolder)
        // this.godRaysBloom = new SelectiveBloom(this.experience, godRaysBloom.layer, {
        //     strength: 0.3,
        //     radius: 1.48
        // })

        // this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        // this.bloomPass.enabled = this.params.bloom
        // this.bloomPass.threshold = this.params.threshold;
        // this.bloomPass.strength = this.params.strength;
        // this.bloomPass.radius = this.params.radius;


        this.composer = new EffectComposer(this.instance);

        // this.composer.addPass(new ClearPass( new THREE.Color( 0xff00ff)))
        this.composer.addPass(this.renderScene)
        this.composer.addPass(this.selectiveBloom.getMixPass);
        this.composer.addPass(this.selectiveBloom.getOutputPass);

        // this.composer.addPass(this.renderScene2)
        // this.composer.addPass(this.godRaysBloom.getMixPass);
        // this.composer.addPass(this.godRaysBloom.getOutputPass);
        // this.composer.addPass(outputPass);
        console.log('yoyoyo')


        //Rendre dans une texture puis retirer les px noirs
        this.effectSobel = new ShaderPass(SobelOperatorShader);
        this.effectSobel.enabled = this.params.sobel
        this.effectSobel.uniforms['resolution'].value.x = window.innerWidth * window.devicePixelRatio;
        this.effectSobel.uniforms['resolution'].value.y = window.innerHeight * window.devicePixelRatio;
        this.composer.addPass(this.effectSobel);

        const colorCorrection = new ShaderPass(ColorCorrectionShader);
        // colorCorrection.uniforms['powRGB'].value = new THREE.Vector3(2.2, 1.51, 1.0);
        // colorCorrection.uniforms['mulRGB'].value = new THREE.Vector3(2.1, 1.505, 0.95);
        this.composer.addPass(colorCorrection);

        this.asciiPass = new AsciiPass(window.innerWidth, window.innerHeight);
        this.composer.addPass(this.asciiPass);

        this.rgbShiftPass = new ShaderPass(RGBShiftShader);
        this.rgbShiftPass.uniforms['amount'].value = this.params.rgbShiftAmount;
        this.rgbShiftPass.uniforms['angle'].value = this.params.rgbShiftAngle;
        this.rgbShiftPass.enabled = this.params.rgbShift;
        this.composer.addPass(this.rgbShiftPass);

        this.vignetteShader = new THREE.ShaderMaterial(vignettShaderProperties)

        this.vignetteShader.uniforms["resolution"].value = new THREE.Vector2(window.innerWidth, window.innerHeight);
        this.vignetteShader.uniforms["horizontal"].value = false; // default is false
        this.vignetteShader.uniforms["radius"].value = 1.29; // default is 0.75
        this.vignetteShader.uniforms["softness"].value = 0.39; // default is 0.3
        this.vignetteShader.uniforms["gain"].value = 1.27; // default is 0.9

        this.composer.addPass(new ShaderPass(this.vignetteShader));

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
            .onChange((value: boolean) => { this.effectSobel.enabled = value; });

        // — Vignette
        const vignetteFolder = folder.addFolder('vignette');
        vignetteFolder.add(this.params, 'gain', 0, 2).step(0.01).name('gain')
            .onChange((value: number) => { this.vignetteShader.uniforms.gain.value = value; });
        vignetteFolder.add(this.params, 'vRadius', 0, 2).step(0.01).name('radius')
            .onChange((value: number) => { this.vignetteShader.uniforms.radius.value = value; });
        vignetteFolder.add(this.params, 'softness', 0, 2).step(0.01).name('softness')
            .onChange((value: number) => { this.vignetteShader.uniforms.softness.value = value; });

        // — ASCII
        const asciiFolder = folder.addFolder('ascii');
        asciiFolder.add(this.params, 'ascii').name('enabled')
            .onChange((value: boolean) => { this.asciiPass.enabled = value; });
        asciiFolder.add(this.params, 'asciiCellSize', 4, 32).step(1).name('cell size')
            .onChange((value: number) => { this.asciiPass.cellSize = value; });

        // — RGB shift
        const rgbFolder = folder.addFolder('rgb shift');
        rgbFolder.add(this.params, 'rgbShift').name('enabled')
            .onChange((value: boolean) => { this.rgbShiftPass.enabled = value; });
        rgbFolder.add(this.params, 'rgbShiftAmount', 0.0, 0.05).step(0.001).name('amount')
            .onChange((value: number) => { this.rgbShiftPass.uniforms['amount'].value = value; });
        rgbFolder.add(this.params, 'rgbShiftAngle', 0.0, Math.PI * 2).step(0.01).name('angle')
            .onChange((value: number) => { this.rgbShiftPass.uniforms['angle'].value = value; });
    }


    public update(): void {
        // console.log(this.instance.toneMappingExposure)
        //  console.log(this.experience.time.elapsedTime)
        if (
            this.experience.world
            && (this.experience.world as TwoerScene).isPlaying
            && this.experience.time.elapsedTime > 78300
        ) {
            this.params.exposure = 20
        }
        this.instance.toneMappingExposure = lerp(this.instance.toneMappingExposure, this.params.exposure, 0.01);
        this.perf?.begin()
        if (this.composer) {
            this.composer.render();
            this.selectiveBloom.update()
            // this.godRaysBloom.update()
            this.perf?.end()
            return
        }

        this.instance.clear()
        this.instance.render(this.experience.scene, this.camera.instance);
        this.perf?.end()



        // this.instance.setRenderTarget(this.cursorTexture)
        // this.instance.render(this.experience.cursorScene, this.orthographicCamera);
        // (this.experience.renderMesh.material as THREE.ShaderMaterial).uniforms.uDisplacement.value = this.cursorTexture.texture

        // this.instance.setRenderTarget(this.sceneTexture)


        // (this.experience.renderMesh.material as THREE.ShaderMaterial).uniforms.uScene.value = this.sceneTexture.texture

        // this.instance.setRenderTarget(null)
        // this.instance.clear()
        // this.instance.render(this.experience.renderScene,  this.orthographicCamera);
        // this.bloomComposer.render()

        // this.composer.render(this.scene, this.camera.instance)
        // this.instance.render()


    }

    public applyPostProcessingPreset(preset: PostProcessingPreset): void {
        this.params.sobel = preset.sobel
        this.effectSobel.enabled = preset.sobel

        this.params.ascii = preset.ascii
        this.asciiPass.enabled = preset.ascii
        if (preset.asciiCellSize !== undefined) {
            this.params.asciiCellSize = preset.asciiCellSize
            this.asciiPass.cellSize = preset.asciiCellSize
        }

        this.params.rgbShift = preset.rgbShift
        this.rgbShiftPass.enabled = preset.rgbShift
        if (preset.rgbShiftAmount !== undefined) {
            this.params.rgbShiftAmount = preset.rgbShiftAmount
            this.rgbShiftPass.uniforms['amount'].value = preset.rgbShiftAmount
        }
        if (preset.rgbShiftAngle !== undefined) {
            this.params.rgbShiftAngle = preset.rgbShiftAngle
            this.rgbShiftPass.uniforms['angle'].value = preset.rgbShiftAngle
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
        this.composer && this.composer.setSize(this.experience.sizes.width, this.experience.sizes.height);
        this.asciiPass && this.asciiPass.setSize(this.experience.sizes.width, this.experience.sizes.height);
    }
}
