
import Experience from "../Experience"
import * as THREE from 'three/webgpu'
import GUI from "lil-gui";
import World from "../classes/World";
import CustomToonMaterial from "./CustomToonMaterial";
import { createLogoGroup } from "../utils/logoGeometry";

export default class LevitatingBody extends World {

    private exp: Experience
    private scene: THREE.Scene
    private gui: GUI

    // Kept as `{ scene }` (rather than a plain THREE.Object3D) so the owning
    // scenes' existing `levitatingBody.gltf.scene.position/rotation` calls
    // keep working unchanged — this used to be the loaded GLTF, now it's the
    // static logo group.
    public gltf!: { scene: THREE.Object3D }
    private mat!: CustomToonMaterial

    private holder: THREE.Object3D
    private guiFolder!: GUI

    private params = {
        color: 0xffffff,
        baseColor: 0x000000,
        noiseColor: 0x0aff27,
        threshold: 0.7,
        noiseDensity: 1.0,
        lightX: 2,
        lightY: 4,
        lightZ: 3,
        speed: 0.01
    }

    constructor(exp: Experience) {
        super()
        this.exp = exp
        this.scene = exp.scene
        this.gui = this.exp.helpers.GUI

        this.holder = new THREE.Object3D()

        this.createMaterial()
        this.createScene()
        this.addScene()
        this.setupGUI()
    }

    createMaterial() {
        this.mat = new CustomToonMaterial({
            baseColor: this.params.baseColor,
            noiseColor: this.params.noiseColor,
            color: this.params.color
        }, this.params.threshold)
        this.mat.side = THREE.DoubleSide
    }

    createScene() {
        const logo = createLogoGroup({ material: this.mat })

        logo.traverse((el: THREE.Object3D) => el.layers.enable(6))
        logo.position.y += 0.4
        logo.position.z += 3

        this.gltf = { scene: logo }

        this.mat.uniforms.uLightDir.value.set(this.params.lightX, this.params.lightY, this.params.lightZ).normalize()
    }

    addScene() {
        this.holder.add(this.gltf.scene)
        this.scene.add(this.holder)
    }

    private setupGUI() {
        this.guiFolder = this.gui.addFolder('levitating_body')
        const folder = this.guiFolder

        const transform = folder.addFolder('transform')
        transform.add(this.gltf.scene.position, 'x', -20, 20, 0.01).name('Position X').listen()
        transform.add(this.gltf.scene.position, 'y', -20, 20, 0.01).name('Position Y').listen()
        transform.add(this.gltf.scene.position, 'z', -50, 20, 0.01).name('Position Z').listen()
        transform.add(this.gltf.scene.rotation, 'x', -Math.PI, Math.PI, 0.01).name('Rotation X').listen()
        transform.add(this.gltf.scene.rotation, 'y', -Math.PI, Math.PI, 0.01).name('Rotation Y').listen()
        transform.add(this.gltf.scene.rotation, 'z', -Math.PI, Math.PI, 0.01).name('Rotation Z').listen()
        transform.add(this.gltf.scene.scale, 'x', 0.1, 3, 0.01).name('Scale').listen()
            .onChange((v: number) => { this.gltf.scene.scale.setScalar(v) })

        folder.addColor(this.params, 'baseColor')
            .name('Base Color')
            .onChange((v: number) => { this.mat.uniforms.baseColor.value = new THREE.Color(v) })
        folder.addColor(this.params, 'noiseColor')
            .name('Noise Color')
            .onChange((v: number) => { this.mat.uniforms.noiseColor.value = new THREE.Color(v) })

        folder.add(this.params, 'threshold', 0, 1, 0.01)
            .name('Threshold')
            .onChange((v: number) => { this.mat.uniforms.threshold.value = v })

        folder.add(this.params, 'noiseDensity', 0.0001, 1, 0.001)
            .name('Noise Density')
            .onChange((v: number) => { this.mat.uniforms.noiseDensity.value = v })

        const updateLightDir = () => {
            this.mat.uniforms.uLightDir.value.set(this.params.lightX, this.params.lightY, this.params.lightZ).normalize()
        }
        folder.add(this.params, 'lightX', -10, 10, 0.1).name('X').onChange(updateLightDir)
        folder.add(this.params, 'lightY', -10, 10, 0.1).name('Y').onChange(updateLightDir)
        folder.add(this.params, 'lightZ', -10, 10, 0.1).name('Z').onChange(updateLightDir)

        this.guiFolder.hide()
    }

    showGUI(v: boolean) {
        v ? this.guiFolder.show() : this.guiFolder.hide()
    }

    setVisible(v: boolean) {
        this.holder.visible = v
    }

    onBPMBeat() {
        if (!this.exp.audioManager || !this.exp.bpmManager) return
    }

    update() {
        this.mat.uniforms.time.value += this.exp.time.delta * this.params.speed
    }

    leave() { }

}
