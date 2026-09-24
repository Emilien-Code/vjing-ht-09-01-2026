import Experience from "../Experience"
import World from "../classes/World"
import Water from "../components/Water"
import DancingBody from "../components/DancingBody"
import GUI from "lil-gui"
import * as THREE from 'three/webgpu'
import { uniform } from 'three/tsl'
import { createNoiseSurfaceMaterial } from "../tsl/noiseSurface"


export default class WaterDancingScene extends World {

    private exp: Experience
    private water: Water
    private dancingBody: DancingBody
    private guiFolder!: GUI
    private pathMesh!: THREE.Mesh
    private curve!: THREE.CatmullRomCurve3
    private visible = false
    private progressController!: any
    private params = {
        autoPlay: true,
        speed: 0.03, // loops per second
        progress: 0, // manual camera travel progress along the path (0-1)
    }

    private floorGeo!: THREE.PlaneGeometry
    private floorMesh!: THREE.Mesh
    private floorMat!: THREE.NodeMaterial
    private floorUniforms: Record<string, any>
    private floorGuiFolder!: GUI
    private floorParams = {
        noiseScale: 100,
        color1: '#5c5c5c',
        color2: '#000000',
        color3: '#dedede',
        elevation: 31,
        elevationIntensity: 1.48,
        grainAmount: 0.052,
        grainDensity: 5.0,
        beatBoostAmount: 59,
        beatDuration: 1.26,
        footBaseRadius: 0.06,
        footRippleSpeed: 0.5, // units/sec the ripple radius grows
        footRippleDuration: 0.9, // seconds for a ripple to fully fade out
        footBumpHeight: 0.06,
        footGroundProximity: 0.35, // how close a foot's lowest point must be to the floor to count as a step
        bodyCircleRadius: 0.8,
    }

    private floorBeatPhase: number = 0
    private floorBeatCounter: number = 0

    private leftFootPos: THREE.Vector3 = new THREE.Vector3()
    private rightFootPos: THREE.Vector3 = new THREE.Vector3()
    private hipsPos: THREE.Vector3 = new THREE.Vector3()

    private leftRippleAge: number | null = null
    private rightRippleAge: number | null = null
    private leftRippleOrigin: THREE.Vector3 = new THREE.Vector3()
    private rightRippleOrigin: THREE.Vector3 = new THREE.Vector3()

    // one-frame history of each foot's Y to detect the exact moment it hits the bottom of its arc
    private leftPrevY: number = Infinity
    private leftPrevPrevY: number = Infinity
    private leftPrevPos: THREE.Vector3 = new THREE.Vector3()
    private rightPrevY: number = Infinity
    private rightPrevPrevY: number = Infinity
    private rightPrevPos: THREE.Vector3 = new THREE.Vector3()

    constructor(exp: Experience, water: Water) {
        super()
        this.exp = exp
        this.water = water
        this.dancingBody = new DancingBody(exp)

        this.floorUniforms = {
            uTime: uniform(0),
            uNoiseScale: uniform(this.floorParams.noiseScale),
            uElevation: uniform(this.floorParams.elevation),
            uElevationIntensity: uniform(this.floorParams.elevationIntensity),
            uColor1: uniform(new THREE.Color(this.floorParams.color1)),
            uColor2: uniform(new THREE.Color(this.floorParams.color2)),
            uColor3: uniform(new THREE.Color(this.floorParams.color3)),
            uGrainAmount: uniform(this.floorParams.grainAmount),
            uGrainDensity: uniform(this.floorParams.grainDensity),
            uLeftFootPos: uniform(new THREE.Vector3()),
            uRightFootPos: uniform(new THREE.Vector3()),
            uFootTouchL: uniform(0),
            uFootTouchR: uniform(0),
            uLeftFootRadius: uniform(this.floorParams.footBaseRadius),
            uRightFootRadius: uniform(this.floorParams.footBaseRadius),
            uFootBumpHeight: uniform(this.floorParams.footBumpHeight),
            uBodyCirclePos: uniform(new THREE.Vector3()),
            uBodyCircleRadius: uniform(this.floorParams.bodyCircleRadius),
        }

        this.setupPath()
        this.createFloor()
        this.setupGUI()
        this.setVisible(false)
    }

    private createFloor() {
        this.floorGeo = new THREE.PlaneGeometry(40, 40, 256, 256)

        this.floorMat = createNoiseSurfaceMaterial(this.floorUniforms, { footsteps: true })

        this.floorMesh = new THREE.Mesh(this.floorGeo, this.floorMat)
        this.floorMesh.rotation.x = -Math.PI / 2
        this.floorMesh.position.y = this.dancingBody.feetY - 0.05
        this.exp.scene.add(this.floorMesh)
    }

    private setupPath() {
        this.curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(3.76, 2.85, -0.63),
            new THREE.Vector3(5.08, 1.15, 6.9),
            new THREE.Vector3(2.05, 1.68, 0.26),
            new THREE.Vector3(1.46, 1.45, -0.48),
        ], true)

        const geometry = new THREE.TubeGeometry(this.curve, 200, 0.02, 8, true)
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff })
        this.pathMesh = new THREE.Mesh(geometry, material)
        this.exp.scene.add(this.pathMesh)
    }

    private setupGUI() {
        this.guiFolder = this.exp.helpers.GUI.addFolder('WaterDancing')

        this.guiFolder.add(this.params, 'autoPlay').name('Auto Travel')
        this.guiFolder.add(this.params, 'speed', 0, 0.2, 0.001).name('Travel Speed')
        this.progressController = this.guiFolder.add(this.params, 'progress', 0, 1, 0.001).name('Travel Progress')

        this.floorGuiFolder = this.guiFolder.addFolder('Floor')

        const noiseFolder = this.floorGuiFolder.addFolder('Noise')
        noiseFolder.add(this.floorParams, 'noiseScale', 0.1, 100.0, 0.1).onChange((v: number) => {
            this.floorUniforms.uNoiseScale.value = v
        })
        noiseFolder.add(this.floorParams, 'elevation', 0.0, 100.0, 1).onChange((v: number) => {
            this.floorUniforms.uElevation.value = v
        })

        const gradientFolder = this.floorGuiFolder.addFolder('Gradient')
        gradientFolder.addColor(this.floorParams, 'color1').name('Color A').onChange((v: string) => {
            this.floorUniforms.uColor1.value.set(v)
        })
        gradientFolder.addColor(this.floorParams, 'color2').name('Color B').onChange((v: string) => {
            this.floorUniforms.uColor2.value.set(v)
        })
        gradientFolder.addColor(this.floorParams, 'color3').name('Color C').onChange((v: string) => {
            this.floorUniforms.uColor3.value.set(v)
        })
        gradientFolder.add(this.floorParams, 'elevationIntensity', 0.0, 2.0, 0.01).name('Elevation Intensity').onChange((v: number) => {
            this.floorUniforms.uElevationIntensity.value = v
        })

        const grainFolder = this.floorGuiFolder.addFolder('Grain')
        grainFolder.add(this.floorParams, 'grainAmount', 0.0, 0.5, 0.001).name('Amount').onChange((v: number) => {
            this.floorUniforms.uGrainAmount.value = v
        })
        grainFolder.add(this.floorParams, 'grainDensity', 0.1, 5.0, 0.1).name('Density').onChange((v: number) => {
            this.floorUniforms.uGrainDensity.value = v
        })

        const beatFolder = this.floorGuiFolder.addFolder('Beat')
        beatFolder.add(this.floorParams, 'beatBoostAmount', 0, 500, 1).name('Boost Amount')
        beatFolder.add(this.floorParams, 'beatDuration', 0.05, 2, 0.01).name('Duration')

        const footFolder = this.floorGuiFolder.addFolder('Footsteps')
        footFolder.add(this.floorParams, 'footBaseRadius', 0.01, 1, 0.01).name('Base Radius')
        footFolder.add(this.floorParams, 'footRippleSpeed', 0, 3, 0.01).name('Ripple Speed')
        footFolder.add(this.floorParams, 'footRippleDuration', 0.05, 3, 0.01).name('Ripple Duration')
        footFolder.add(this.floorParams, 'footBumpHeight', 0, 2, 0.01).name('Bump Height').onChange((v: number) => {
            this.floorUniforms.uFootBumpHeight.value = v
        })
        footFolder.add(this.floorParams, 'footGroundProximity', 0.05, 2, 0.01).name('Ground Proximity')

        this.floorGuiFolder.add(this.floorParams, 'bodyCircleRadius', 0.05, 5, 0.01).name('Body Circle Radius').onChange((v: number) => {
            this.floorUniforms.uBodyCircleRadius.value = v
        })

        this.guiFolder.hide()
    }

    setVisible(v: boolean) {
        this.visible = v
        this.water.water.visible = false
        this.dancingBody.setVisible(v)
        this.pathMesh.visible = false
        this.floorMesh.visible = v
        this.showGUI(v)
    }

    showGUI(v: boolean) {
        v ? this.guiFolder.show() : this.guiFolder.hide()
        this.dancingBody.showGUI(v)
    }

    onBPMBeat() {
        this.dancingBody.onBPMBeat()

        this.floorBeatCounter++
        if (this.floorBeatCounter % 2 === 0) this.floorBeatPhase = 1.0
    }

    update() {
        this.dancingBody.update()

        // this.floorUniforms.uTime.value = this.exp.time.elapsedTime / 1000

        const delta = this.exp.time.delta / 1000
        if (this.floorBeatPhase > 0) {
            this.floorBeatPhase = Math.max(0, this.floorBeatPhase - delta / this.floorParams.beatDuration)
        }
        // const easeOutCirc = (x: number) => Math.sqrt(1 - Math.pow(x - 1, 2))
        // const floorBoost = this.floorBeatPhase > 0
        //     ? this.floorParams.beatBoostAmount * (1 - easeOutCirc(1 - this.floorBeatPhase))
        //     : 0
        this.floorUniforms.uElevation.value = this.floorParams.elevation //+ floorBoost

        this.dancingBody.getLeftFootPosition(this.leftFootPos)
        this.dancingBody.getRightFootPosition(this.rightFootPos)
        this.dancingBody.getHipsPosition(this.hipsPos)
        this.floorUniforms.uBodyCirclePos.value.copy(this.hipsPos)

        const floorY = this.floorMesh.position.y

        // a foot "lands" the moment it hits the bottom of its arc (Y stops falling and starts rising),
        // not when it crosses some fixed height above the floor - that kept the ripple out of sync
        // with when the foot visually reaches the ground.
        const leftIsLocalMin = this.leftPrevY <= this.leftPrevPrevY && this.leftPrevY <= this.leftFootPos.y
        const leftNearFloor = (this.leftPrevY - floorY) < this.floorParams.footGroundProximity
        if (leftIsLocalMin && leftNearFloor && this.leftRippleAge === null) {
            this.leftRippleAge = 0
            this.leftRippleOrigin.copy(this.leftPrevPos)
        }
        this.leftPrevPrevY = this.leftPrevY
        this.leftPrevY = this.leftFootPos.y
        this.leftPrevPos.copy(this.leftFootPos)

        const rightIsLocalMin = this.rightPrevY <= this.rightPrevPrevY && this.rightPrevY <= this.rightFootPos.y
        const rightNearFloor = (this.rightPrevY - floorY) < this.floorParams.footGroundProximity
        if (rightIsLocalMin && rightNearFloor && this.rightRippleAge === null) {
            this.rightRippleAge = 0
            this.rightRippleOrigin.copy(this.rightPrevPos)
        }
        this.rightPrevPrevY = this.rightPrevY
        this.rightPrevY = this.rightFootPos.y
        this.rightPrevPos.copy(this.rightFootPos)

        if (this.leftRippleAge !== null) {
            this.leftRippleAge += delta
            if (this.leftRippleAge > this.floorParams.footRippleDuration) this.leftRippleAge = null
        }
        if (this.rightRippleAge !== null) {
            this.rightRippleAge += delta
            if (this.rightRippleAge > this.floorParams.footRippleDuration) this.rightRippleAge = null
        }

        if (this.leftRippleAge !== null) {
            const t = this.leftRippleAge / this.floorParams.footRippleDuration
            this.floorUniforms.uLeftFootPos.value.copy(this.leftRippleOrigin)
            this.floorUniforms.uLeftFootRadius.value = this.floorParams.footBaseRadius + t * this.floorParams.footRippleSpeed * this.floorParams.footRippleDuration
            this.floorUniforms.uFootTouchL.value = 1 - t
        } else {
            this.floorUniforms.uFootTouchL.value = 0
        }

        if (this.rightRippleAge !== null) {
            const t = this.rightRippleAge / this.floorParams.footRippleDuration
            this.floorUniforms.uRightFootPos.value.copy(this.rightRippleOrigin)
            this.floorUniforms.uRightFootRadius.value = this.floorParams.footBaseRadius + t * this.floorParams.footRippleSpeed * this.floorParams.footRippleDuration
            this.floorUniforms.uFootTouchR.value = 1 - t
        } else {
            this.floorUniforms.uFootTouchR.value = 0
        }

        if (!this.visible) return


        if (this.params.autoPlay) {
            // this.params.progress = ((this.exp.time.elapsedTime / 1000) * this.params.speed) % 1
            this.progressController.updateDisplay()
        }

        const camPos = this.curve.getPoint(this.params.progress)
        this.exp.camera.instance.position.copy(camPos)
        this.exp.camera.instance.lookAt(this.dancingBody.bodyCenter)
    }

    leave() {
        this.dancingBody.leave()
    }
}
