import Experience from "../Experience"
import World from "../classes/World"
import LightStorm from "../components/LightStorm"
import LevitatingBody from "../components/LevitatingBody"
import Water from "../components/Water"
import GUI from "lil-gui"
import * as THREE from "three"

export default class LightStormLevitatingScene extends World {

    private exp: Experience
    private lightStorm: LightStorm
    private levitatingBody: LevitatingBody
    private water: Water
    private guiFolder!: GUI
    private pathMesh!: THREE.Mesh
    private curve!: THREE.CatmullRomCurve3
    private pathSpeed = 0.02
    private visible = false

    private pathSequences: [number, number][] = [
        [0.885, 1],
        [0, 0.32],
        [0.3, 0.47],
    ]
    private currentSequence: [number, number] = this.pathSequences[0]
    private sequenceStartTime = 0

    // Rare alternate behavior: instead of continuously interpolating along
    // the current pathSequence, step the camera to a new fixed point on the
    // curve once per beat. 4 points sampled within each pathSequence range
    // (3 ranges x 4 = 12) keeps it dynamic while staying on the curated
    // "good" portions of the curve.
    private beatTravelMode = false
    private travelPositions: number[] = this.pathSequences.flatMap(([start, end]) => {
        const steps = 4
        return Array.from({ length: steps }, (_, i) => start + (end - start) * (i / steps))
    })
    private travelIndex = 0
    // How many camera steps happen within a single beat.
    private stepsPerBeat = 4
    private intraBeatTimeoutIds: number[] = []

    constructor(exp: Experience, water: Water) {
        super()
        this.exp = exp
        this.water = water
        this.lightStorm = new LightStorm(exp)
        this.levitatingBody = new LevitatingBody(exp)
        this.levitatingBody.gltf.scene.visible = false

        this.setupPath()




        this.setupGUI()
        this.setVisible(false)
    }

    private setupPath() {
        this.curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(-3.5, 2.5, 2.1),
            new THREE.Vector3(-0.7, 3.1, 4.2),
            new THREE.Vector3(3.5, 2.8, 1.4),
            new THREE.Vector3(2.1, 3.1, -2.8),
            // new THREE.Vector3(1.4, 2.3, -3.5),
            // new THREE.Vector3(1.0, 2.3, -3.8),
            new THREE.Vector3(0.7, 2.4, -3.5),
        ], true)

        const geometry = new THREE.TubeGeometry(this.curve, 200, 0.02, 8, true)
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff })
        this.pathMesh = new THREE.Mesh(geometry, material)
        this.exp.scene.add(this.pathMesh)
    }

    private setupGUI() {
        this.guiFolder = this.exp.helpers.GUI.addFolder('LightStormLevitating')
        // this.guiFolder.hide()

        const logo = this.levitatingBody.gltf.scene
        const logoFolder = this.guiFolder.addFolder('Logo')

        logoFolder.add(logo, 'visible').name('show logo')

        const positionFolder = logoFolder.addFolder('Position')
        positionFolder.add(logo.position, 'x', -5, 5, 0.01)
        positionFolder.add(logo.position, 'y', -5, 5, 0.01)
        positionFolder.add(logo.position, 'z', -5, 5, 0.01)

        const rotationFolder = logoFolder.addFolder('Rotation')
        rotationFolder.add(logo.rotation, 'x', -Math.PI, Math.PI, 0.01)
        rotationFolder.add(logo.rotation, 'y', -Math.PI, Math.PI, 0.01)
        rotationFolder.add(logo.rotation, 'z', -Math.PI, Math.PI, 0.01)

        const scaleFolder = logoFolder.addFolder('Scale')
        const uniformScale = { value: logo.scale.x }
        scaleFolder.add(uniformScale, 'value', 0.01, 5, 0.01).name('uniform').onChange((v: number) => {
            logo.scale.set(v, v, v)
        })
        scaleFolder.add(logo.scale, 'x', 0.01, 5, 0.01)
        scaleFolder.add(logo.scale, 'y', 0.01, 5, 0.01)
        scaleFolder.add(logo.scale, 'z', 0.01, 5, 0.01)
    }

    setVisible(v: boolean, beatTravelMode: boolean = false) {
        this.visible = v
        this.water.water.visible = v
        this.lightStorm.setVisible(v)
        this.levitatingBody.setVisible(v)
        this.pathMesh.visible = false

        this.clearIntraBeatTimeouts()

        if (v) {
            this.beatTravelMode = beatTravelMode
            if (beatTravelMode) {
                this.travelIndex = 0
                this.updateCameraTravelStep()
            } else {
                this.currentSequence = this.pathSequences[Math.floor(Math.random() * this.pathSequences.length)]
                this.sequenceStartTime = this.exp.time.elapsedTime
            }
        }


        if (Math.random() > 0.5) {
            this.levitatingBody.gltf.scene.position.x = 0
            this.levitatingBody.gltf.scene.position.y = 0
            this.levitatingBody.gltf.scene.position.z = 0

            this.levitatingBody.gltf.scene.rotation.y = Math.PI / 4
            this.levitatingBody.gltf.scene.rotation.x = Math.PI / 4
        } else {
            this.levitatingBody.gltf.scene.position.x = -0.6
            this.levitatingBody.gltf.scene.position.y = 0.4
            this.levitatingBody.gltf.scene.position.z = 0

            this.levitatingBody.gltf.scene.rotation.y = 0
            this.levitatingBody.gltf.scene.rotation.x = 0
        }

    }

    showGUI(v: boolean) {
        v ? this.guiFolder.show() : this.guiFolder.hide()
        this.lightStorm.showGUI(v)
        this.levitatingBody.showGUI(v)
    }

    onBPMBeat() {
        this.lightStorm.onBPMBeat()
        this.levitatingBody.onBPMBeat()
        if (!this.visible || !this.beatTravelMode) return

        this.clearIntraBeatTimeouts()

        this.stepCameraTravel()

        const beatMs = this.exp.bpmManager?.getBPMDuration() ?? 500
        const stepMs = beatMs / this.stepsPerBeat
        for (let i = 1; i < this.stepsPerBeat; i++) {
            this.intraBeatTimeoutIds.push(setTimeout(() => this.stepCameraTravel(), stepMs * i))
        }
    }

    private clearIntraBeatTimeouts() {
        this.intraBeatTimeoutIds.forEach(id => clearTimeout(id))
        this.intraBeatTimeoutIds = []
    }

    private stepCameraTravel() {
        this.travelIndex = (this.travelIndex + 1) % this.travelPositions.length
        this.updateCameraTravelStep()
    }

    private updateCameraTravelStep() {
        const t = this.travelPositions[this.travelIndex]
        const camPos = this.curve.getPoint(t)
        this.exp.camera.instance.position.copy(camPos)
        const lookTarget = this.levitatingBody.gltf.scene.position.clone()
        lookTarget.y += 0.6
        this.exp.camera.instance.lookAt(lookTarget)
    }

    update() {
        this.lightStorm.update()
        this.levitatingBody.update()
        if (!this.visible || this.beatTravelMode) return

        const [start, end] = this.currentSequence
        const elapsed = (this.exp.time.elapsedTime - this.sequenceStartTime) / 1000
        const t = start + ((elapsed * this.pathSpeed) % (end - start))
        const camPos = this.curve.getPoint(t)
        this.exp.camera.instance.position.copy(camPos)
        const lookTarget = this.levitatingBody.gltf.scene.position.clone()
        lookTarget.y += 0.6
        this.exp.camera.instance.lookAt(lookTarget)
    }

    leave() {
        this.clearIntraBeatTimeouts()
        this.lightStorm.leave()
        this.levitatingBody.leave()
    }
}
