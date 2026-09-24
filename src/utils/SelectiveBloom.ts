import * as THREE from "three/webgpu"
import { texture, uniform } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import type Experience from "../Experience";
import { fogPalette } from "../common/colors"
import type GUI from "lil-gui"

// Selective bloom, the "darken everything that isn't on the bloom layer, render,
// restore" way: every mesh outside `bloom_scene` is swapped for a black
// material (or hidden, when transparent), the scene is rendered into
// `bloomTarget`, then everything is put back.
//
// That render is what Renderer's post pipeline adds on top of the normal
// image (`bloomTexture`), and — when the bloom is enabled — also feeds a
// BloomNode whose glow is added as well. Same behaviour as the old
// EffectComposer setup, including that with the bloom disabled the plain dark
// render is still added (so Points/Lines, which are never darkened, get
// doubled up).
export default class SelectiveBloom {

    private experience: Experience;
    private darkMaterial = new THREE.MeshBasicNodeMaterial({ color: 'black' });
    private materials: THREE.Material[] = [];
    private bloomLayer: THREE.Layers;
    private bloom_scene = 1;
    private scene: THREE.Scene;
    private renderer: THREE.WebGPURenderer;
    private camera: THREE.Camera;

    private bloomTarget: THREE.RenderTarget;
    private bloomNode: any;
    private size = new THREE.Vector2();

    public params = {
        threshold: 0,
        strength: 0.7,
        radius: 0.5,
        exposure: 1,
        bloom: false
    };

    // Node that reads the dark render (input of the bloom, and added as-is).
    public readonly darkTexture: any;
    // Node with the blurred glow of `darkTexture` (already scaled by strength).
    public readonly glowTexture: any;
    // Multiplier applied to the glow: 0 while the bloom is off, otherwise 3.
    // UnrealBloomPass composited `3.0 * strength * (blurred mips)`, whereas
    // BloomNode only scales by `strength`, so the 3 keeps the same look and the
    // same 'strength' scale in the GUI.
    public readonly glowAmount = uniform(0);

    constructor(experience: Experience, bloom_scene?: number, properties?: {
        radius?: number
        strength?: number
        threshold?: number
    }, parentFolder?: GUI) {
        this.experience = experience
        this.scene = this.experience.scene
        this.renderer = this.experience.renderer.instance
        this.camera = this.experience.camera.instance

        bloom_scene && (this.bloom_scene = bloom_scene)

        this.bloomLayer = new THREE.Layers();
        this.bloomLayer.set(this.bloom_scene);

        this.params = {
            ...this.params,
            ...properties
        }

        this.bloomTarget = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType });
        this.darkTexture = texture(this.bloomTarget.texture);

        this.bloomNode = bloom(this.darkTexture, this.params.strength, this.params.radius, this.params.threshold);
        this.glowTexture = this.bloomNode.getTextureNode();

        // Off by default: skip the blur chain until it's switched on. The node
        // has to stay registered for per-frame updates (a node's update type is
        // read once, when the graph is first built), so gate its work instead.
        const runBloom = this.bloomNode.updateBefore.bind(this.bloomNode);
        this.bloomNode.updateBefore = (frame: any) => { if (this.params.bloom) runBloom(frame) };
        this.setBloomEnabled(false);

        this.darkenNonBloomed = this.darkenNonBloomed.bind(this)
        this.restoreMaterial = this.restoreMaterial.bind(this)

        this.createTweaks(parentFolder)
    }

    private setBloomEnabled(v: boolean) {
        this.params.bloom = v
        this.glowAmount.value = v ? 3 : 0
    }

    createTweaks(parentFolder?: GUI) {
        const root = parentFolder ?? this.experience.helpers.GUI;
        const folder = root.addFolder('bloom');

        folder.add(this.params, 'bloom').name('enabled')
            .onChange((value: boolean) => { this.setBloomEnabled(value); });
        folder.add(this.params, 'threshold', 0.0, 10.0).name('threshold')
            .onChange((value: number) => { this.bloomNode.threshold.value = Number(value); });
        folder.add(this.params, 'strength', 0.0, 30.0).name('strength')
            .onChange((value: number) => { this.bloomNode.strength.value = Number(value); });
        folder.add(this.params, 'radius', 0.0, 10.0).step(0.01).name('radius')
            .onChange((value: number) => { this.bloomNode.radius.value = Number(value); });
    }

    darkenNonBloomed(obj: any) {
        this.scene.background = new THREE.Color(0x000000)
        this.scene.fog && (this.scene.fog.color = new THREE.Color(0x000000))

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
        this.scene.background = new THREE.Color(0x000000)
        this.scene.fog && (this.scene.fog.color = new THREE.Color(fogPalette[0]))

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
        this.renderer.getDrawingBufferSize(this.size)
        this.bloomTarget.setSize(this.size.x, this.size.y)
    }

    // Renders the darkened scene into the bloom target. Called once per frame,
    // before the post pipeline that consumes it.
    update() {
        this.renderer.getDrawingBufferSize(this.size)
        if (this.bloomTarget.width !== this.size.x || this.bloomTarget.height !== this.size.y) {
            this.bloomTarget.setSize(this.size.x, this.size.y)
        }

        this.scene.traverse(this.darkenNonBloomed);

        const previousTarget = this.renderer.getRenderTarget()
        this.renderer.setRenderTarget(this.bloomTarget)
        this.renderer.clear()
        this.renderer.render(this.scene, this.camera)
        this.renderer.setRenderTarget(previousTarget)

        this.scene.traverse(this.restoreMaterial);
    }
}
