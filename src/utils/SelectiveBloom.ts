import * as THREE from "three"
import type Experience from "../Experience";
import { fogPalette, fogSettings } from "../common/colors"
import type GUI from "lil-gui"

import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export default class SelectiveBloom {

    private experience: Experience;
    private darkMaterial = new THREE.MeshBasicMaterial({ color: 'black' });
    private materials: THREE.Material[] = [];
    private bloomLayer: THREE.Layers;
    private bloom_scene = 1;
    private scene: THREE.Scene;
    private bloomPass: UnrealBloomPass;
    private mixPass: ShaderPass;
    private bloomComposer: EffectComposer;
    private renderer: THREE.WebGLRenderer;
    private camera: THREE.Camera;
    private renderScene: RenderPass;
    private outputPass: OutputPass;
    private rendererExposure: number
    public params = {
        threshold: 0,
        strength: 0.7,
        radius: 0.5,
        exposure: 1,
        bloom: false
    };


    constructor(experience: Experience, bloom_scene?: number, properties?: {
        radius?: number
        strength?: number
        threshold?: number
    }, parentFolder?: GUI) {
        this.experience = experience
        this.scene = this.experience.scene
        this.renderer = this.experience.renderer.instance
        this.camera = this.experience.camera.instance
        this.renderScene = this.experience.renderer.renderScene;
        this.rendererExposure = this.renderer.toneMappingExposure

        bloom_scene && (this.bloom_scene = bloom_scene)

        this.bloomLayer = new THREE.Layers();
        this.bloomLayer.set(this.bloom_scene);

        this.params = {
            ...this.params,
            ...properties
        }

        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        this.bloomPass.threshold = this.params.threshold;
        this.bloomPass.strength = this.params.strength;
        this.bloomPass.radius = this.params.radius;
        this.bloomPass.enabled = false;


        this.bloomComposer = new EffectComposer(this.renderer);
        this.bloomComposer.renderToScreen = false;


        this.bloomComposer.addPass(this.renderScene);
        this.bloomComposer.addPass(this.bloomPass);

        this.mixPass = new ShaderPass(
            new THREE.ShaderMaterial({
                uniforms: {
                    baseTexture: { value: null },
                    bloomTexture: { value: this.bloomComposer.renderTarget2.texture }
                },
                vertexShader: `
                varying vec2 vUv;

                void main() {

                    vUv = uv;

                    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

                }
            `,
                fragmentShader: `
                uniform sampler2D baseTexture;
                uniform sampler2D bloomTexture;

                varying vec2 vUv;

                void main() {

                    gl_FragColor = ( texture2D( baseTexture, vUv ) + vec4( 1.0 ) * texture2D( bloomTexture, vUv ) );

                }
            `,
                defines: {}
            }), 'baseTexture'
        );

        this.darkenNonBloomed = this.darkenNonBloomed.bind(this)
        this.restoreMaterial = this.restoreMaterial.bind(this)

        this.outputPass = new OutputPass();
        this.mixPass.needsSwap = true;
        this.createTweaks(parentFolder)
    }

    get getBloomPass() {
        return this.bloomPass
    }

    get getMixPass() {
        return this.mixPass
    }
    get getBloomComposer() {
        return this.bloomComposer
    }
    get getRenderScene() {
        return this.bloomComposer
    }
    get getOutputPass() {
        return this.outputPass
    }


    createTweaks(parentFolder?: GUI) {
        const root = parentFolder ?? this.experience.helpers.GUI;
        const folder = root.addFolder('bloom');

        folder.add(this.params, 'bloom').name('enabled')
            .onChange((value: boolean) => { this.bloomPass.enabled = value; });
        folder.add(this.params, 'threshold', 0.0, 10.0).name('threshold')
            .onChange((value: number) => { this.bloomPass.threshold = Number(value); });
        folder.add(this.params, 'strength', 0.0, 30.0).name('strength')
            .onChange((value: number) => { this.bloomPass.strength = Number(value); });
        folder.add(this.params, 'radius', 0.0, 10.0).step(0.01).name('radius')
            .onChange((value: number) => { this.bloomPass.radius = Number(value); });
    }

    darkenNonBloomed(obj: any) {
        this.scene.background = new THREE.Color(0x000000)
        // this.scene.fog = new THREE.FogExp2(0x000000, 0)
        this.scene.fog && (this.scene.fog.color = new THREE.Color(0x000000))
        // this.rendererExposure = this.renderer.toneMappingExposure // FONCTIONNE PAS
        // this.renderer.toneMappingExposure = this.params.exposure // FONCTIONNE PAS

        if (obj.isMesh && this.bloomLayer.test(obj.layers) === false) {

            this.materials[obj.uuid] = obj.material;
            //For the towers

            if (obj.material.transparent) {
                obj.visible = false;
            } else {
                obj.material = this.darkMaterial;
            }

            //For the opacities

        }

    }

    restoreMaterial(obj: any) {
        // this.scene.background = new THREE.Color(fogPalette[0])
        this.scene.background = new THREE.Color(0x000000)
        this.scene.fog && (this.scene.fog.color = new THREE.Color(fogPalette[0]))
        // this.renderer.toneMappingExposure = this.rendererExposure // FONCTIONNE PAS


        if (this.materials[obj.uuid]) {


            if (obj.material.transparent) {
                obj.visible = true;
            } else {
                obj.material = this.materials[obj.uuid];
            }


            delete this.materials[obj.uuid];

        }

    }

    onResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        this.bloomComposer && this.bloomComposer.setSize(width, height);
        // this.finalComposer.setSize(width, height);
    }

    update() {
        // if (this.bloomLayer) return
        this.scene.traverse(this.darkenNonBloomed);
        this.bloomComposer.render();
        this.scene.traverse(this.restoreMaterial);
    }
}