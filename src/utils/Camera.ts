import * as THREE from "three"
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import Experience from "../Experience"
import Sizes from "../utils/Sizes"
import preferences from "../common/preferences"
// const lerp=(t,i,e)=>t*(1-e)+i*e
// const linear = (a, b, t) => (1 - t) * a + t * b;
import GUI from "lil-gui";

export default class Camera {
    public experience: Experience;
    public scene: THREE.Scene;
    public sizes: Sizes;
    public canvas: HTMLElement;
    public controls: OrbitControls;
    public instance: THREE.PerspectiveCamera;
    public enableControls = false;
    private gui: GUI


    constructor(experience: Experience) {
        this.experience = experience

        this.sizes = experience.sizes
        this.scene = experience.scene
        this.canvas = experience.canvas


        this.instance = new THREE.PerspectiveCamera(35, this.sizes.width / this.sizes.height, 0.1, preferences.cameraSettings.far)
        this.setInstance()


        // this.controls = new OrbitControls(this.instance, this.canvas)
        // this.setControls()

        this.gui = this.experience.helpers.GUI

        const folder = this.gui.addFolder('controls')

        // folder.add(this, 'enableControls',)
        //     .name('enable camera controls')
        //     .onFinishChange(() => {
        //         this.setControls()
        //     })

    }



    public setInstance() {
        this.instance = new THREE.PerspectiveCamera(35, this.sizes.width / this.sizes.height, 0.1, preferences.cameraSettings.far)
        this.instance.position.set(0, 0, 8.5)
        this.scene.add(this.instance)
    }

    public setControls() {
        if (!this.enableControls) return

        this.controls = new OrbitControls(this.instance, this.canvas)
        this.controls.enableDamping = true
    }

    public update() {
        if (!this.enableControls) return

        // this.controls.update()
    }
    // setTargetPosition(p){
    //     this.targetPosition = p  
    // }
    public resize() {
        this.instance.aspect = this.sizes.width / this.sizes.height
        this.instance.updateProjectionMatrix()
    }
}