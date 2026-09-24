import Experience from "../Experience"
import World from "../classes/World"
import Sphere from "../components/Sphere"
import GUI from "lil-gui"
import * as THREE from 'three/webgpu'

export default class SphereLevitatingScene extends World {

    private exp: Experience
    private sphere: Sphere
    private guiFolder!: GUI
    private pathMesh!: THREE.Mesh
    private curve!: THREE.CatmullRomCurve3
    private pathSpeed = 0.15
    private visible = false
    private lookTarget = new THREE.Vector3(0.1, 7.1, 6.5)

    constructor(exp: Experience) {
        super()
        this.exp = exp
        this.sphere = new Sphere(exp)

        this.setupPath()
        this.setupGUI()
        this.setVisible(false)
    }

    private setupPath() {
        // Orbit around body at (0.1, 6.3, 6.5) with varying height and distance
        this.curve = new THREE.CatmullRomCurve3([

            new THREE.Vector3(-0.07154439545623454, 10.159190393236447, 9.777464055486467),
            new THREE.Vector3(0.20957989252555904, 10.565661311257323, 9.254784230549046),
            new THREE.Vector3(0.006014049667200538, 10.241878039210015, 9.611794794420966),
        ], true)

        const geometry = new THREE.TubeGeometry(this.curve, 200, 0.02, 8, true)
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff })
        this.pathMesh = new THREE.Mesh(geometry, material)
        this.exp.scene.add(this.pathMesh)
    }

    private setupGUI() {
        this.guiFolder = this.exp.helpers.GUI.addFolder('SphereLevitating')
        this.guiFolder.add(this, 'pathSpeed', 0.001, 0.1, 0.001).name('Path Speed')
        this.guiFolder.hide()
    }

    setVisible(v: boolean) {
        this.visible = v
        this.sphere.setVisible(v)
        this.showGUI(v)
        this.pathMesh.visible = false
    }

    showGUI(v: boolean) {
        v ? this.guiFolder.show() : this.guiFolder.hide()
        this.sphere.showGUI(v)
    }

    onBPMBeat() {
        this.sphere.onBPMBeat()
    }

    update() {
        this.sphere.update()
        if (!this.visible) return

        const t = ((this.exp.time.elapsedTime / 1000) * this.pathSpeed) % 1
        const camPos = this.curve.getPoint(t)
        this.exp.camera.instance.position.copy(camPos)
        this.exp.camera.instance.lookAt(this.lookTarget)
    }

    leave() {
        this.sphere.leave()
    }
}
