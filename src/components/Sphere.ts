import Experience from "../Experience"
import * as THREE from 'three/webgpu'
import GUI from "lil-gui";
import World from "../classes/World";
import { uniform } from 'three/tsl'
import { createNoiseSurfaceMaterial } from "../tsl/noiseSurface"


export default class Sphere extends World {

    private exp: Experience
    private scene: THREE.Scene
    private gui: GUI

    private boxes: THREE.Mesh[] = []
    private geo!: THREE.SphereGeometry
    private mesh!: THREE.Mesh
    private mat!: THREE.NodeMaterial
    private uniforms: Record<string, any>

    private holder: THREE.Object3D
    private guiFolder!: GUI
    private params = {
        noiseScale: 100,
        color1: '#43ae0a',
        color2: '#000000',
        color3: '#dedede',
        elevation: 31,
        elevationIntensity: 1.48,
        grainAmount: 0.052,
        grainDensity: 5.0,
        beatBoostAmount: 59,
        beatDuration: 1.26,
    }

    private beatPhase: number = 0
    private beatCounter: number = 0

    constructor(exp: Experience) {
        super()
        this.exp = exp
        this.scene = exp.scene
        this.gui = this.exp.helpers.GUI

        this.uniforms = {
            uTime: uniform(0),
            uNoiseScale: uniform(this.params.noiseScale),
            uElevation: uniform(this.params.elevation),
            uElevationIntensity: uniform(this.params.elevationIntensity),
            uColor1: uniform(new THREE.Color(this.params.color1)),
            uColor2: uniform(new THREE.Color(this.params.color2)),
            uColor3: uniform(new THREE.Color(this.params.color3)),
            uGrainAmount: uniform(this.params.grainAmount),
            uGrainDensity: uniform(this.params.grainDensity),
        }

        this.holder = new THREE.Object3D()

        this.createSphere()
        this.createMaterial()
        this.createMesh()
        this.addScene()

        this.setupGUI()
    }
    createSphere() {
        this.geo = new THREE.SphereGeometry(1.5, 128, 128);
    }
    createMaterial() {
        this.mat = createNoiseSurfaceMaterial(this.uniforms, { footsteps: false })
    }

    createMesh() {
        this.mesh = new THREE.Mesh(this.geo, this.mat);
        // this.mesh.layers.enable(6)
    }
    addScene() {
        this.holder.add(this.mesh)
        this.scene.add(this.holder)
    }
    private setupGUI() {
        this.guiFolder = this.gui.addFolder('Sphere')

        const noiseFolder = this.guiFolder.addFolder('Noise')
        noiseFolder.add(this.params, 'noiseScale', 0.1, 100.0, 0.1).onChange((v: number) => {
            this.uniforms.uNoiseScale.value = v
        })
        noiseFolder.add(this.params, 'elevation', 0.0, 100.0, 1).onChange((v: number) => {
            this.uniforms.uElevation.value = v
            console.log(this.uniforms)
        })

        const gradientFolder = this.guiFolder.addFolder('Gradient')
        gradientFolder.addColor(this.params, 'color1').name('Color A').onChange((v: string) => {
            this.uniforms.uColor1.value.set(v)
        })
        gradientFolder.addColor(this.params, 'color2').name('Color B').onChange((v: string) => {
            this.uniforms.uColor2.value.set(v)
        })
        gradientFolder.addColor(this.params, 'color3').name('Color C').onChange((v: string) => {
            this.uniforms.uColor3.value.set(v)
        })
        gradientFolder.add(this.params, 'elevationIntensity', 0.0, 2.0, 0.01).name('Elevation Intensity').onChange((v: number) => {
            this.uniforms.uElevationIntensity.value = v
        })

        const grainFolder = this.guiFolder.addFolder('Grain')
        grainFolder.add(this.params, 'grainAmount', 0.0, 0.5, 0.001).name('Amount').onChange((v: number) => {
            this.uniforms.uGrainAmount.value = v
        })
        grainFolder.add(this.params, 'grainDensity', 0.1, 5.0, 0.1).name('Density').onChange((v: number) => {
            this.uniforms.uGrainDensity.value = v
        })

        const beatFolder = this.guiFolder.addFolder('Beat')
        beatFolder.add(this.params, 'beatBoostAmount', 0, 500, 1).name('Boost Amount')
        beatFolder.add(this.params, 'beatDuration', 0.05, 2, 0.01).name('Duration')

        this.guiFolder.hide()
    }

    showGUI(v: boolean) {
        v ? this.guiFolder.show() : this.guiFolder.hide()
    }

    onBPMBeat() {
        this.beatCounter++
        if (this.beatCounter % 2 === 0) this.beatPhase = 1.0
    }

    setVisible(v: boolean) {
        this.holder.visible = v
    }

    update() {
        this.uniforms.uTime.value = this.exp.time.elapsedTime / 1000

        const delta = this.exp.time.delta / 1000
        if (this.beatPhase > 0) {
            this.beatPhase = Math.max(0, this.beatPhase - delta / this.params.beatDuration)
        }
        const easeOutCirc = (x: number) => Math.sqrt(1 - Math.pow(x - 1, 2))
        const boost = this.beatPhase > 0
            ? this.params.beatBoostAmount * (1 - easeOutCirc(1 - this.beatPhase))
            : 0
        this.uniforms.uElevation.value = this.params.elevation + boost
    }

    leave() {
        this.boxes.forEach(m => this.dispose(m, this.scene))
        this.boxes = []
    }

}