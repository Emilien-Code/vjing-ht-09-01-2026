
import Experience from "../Experience"
import * as THREE from 'three/webgpu'
import GUI from "lil-gui";
import World from "../classes/World";
import {
    Fn, uniform, varying, positionLocal, normalLocal, modelWorldMatrix, cameraPosition,
    transformDirection, float, vec3, vec4, normalize, dot, abs, pow, clamp, mix, add,
} from 'three/tsl'
import { snoise3 } from "../tsl/noise"

export default class LightStorm extends World {

    private exp: Experience
    private scene: THREE.Scene
    private gui: GUI

    private gltf!: any
    private mat!: THREE.NodeMaterial
    private uniforms!: Record<string, any>

    private holder: THREE.Object3D
    private guiFolder!: GUI

    private params = {
        baseColor: 0x1d9315,
        energyColor: 0x54d96a,
        energyIntensity: 1.5,
        noiseScale: 0.1,
        upSpeed: -2,
    }

    private beatDownSpeed: number = 0
    private beatDecay: number = 0.92

    constructor(exp: Experience) {
        super()
        this.exp = exp
        this.scene = exp.scene
        this.gui = this.exp.helpers.GUI

        this.holder = new THREE.Object3D()

        this.gltf = this.exp.ressources.items.storm_light

        this.createMaterial()
        this.createScene()
        this.addScene()
        this.setupGUI()
    }

    createMaterial() {
        const u = this.uniforms = {
            time: uniform(0),
            baseColor: uniform(new THREE.Color(this.params.baseColor)),
            energyColor: uniform(new THREE.Color(this.params.energyColor)),
            energyIntensity: uniform(this.params.energyIntensity),
            noiseScale: uniform(this.params.noiseScale),
            upSpeed: uniform(this.params.upSpeed),
        }

        // ---- vertex ----
        const worldPos = modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz
        const vWorldPosition = varying(worldPos)
        const vWorldNormal = varying(transformDirection(normalLocal, modelWorldMatrix))
        const vViewDirection = varying(normalize(cameraPosition.sub(worldPos)))

        // ---- fragment ----
        const fragment = Fn(() => {
            const pos = vWorldPosition.mul(u.noiseScale)
            const t = u.time

            // Three noise layers at different scales/speeds for complex electricity
            const n1 = snoise3(pos.add(vec3(0.0, t.mul(u.upSpeed).negate(), 0.0)))
            const n2 = snoise3(pos.mul(2.1).add(vec3(t.mul(0.4), t.mul(u.upSpeed).mul(0.6).negate(), t.mul(0.3))))
            const n3 = snoise3(pos.mul(4.3).sub(vec3(0.0, t.mul(u.upSpeed).mul(1.4), 0.0)))

            // Sharp bolt (high exponent = narrow bright veins)
            const bolt = pow(clamp(n1.mul(0.5).add(0.5), 0.0, 1.0), 6.0)
            const fine = pow(clamp(n3.mul(0.5).add(0.5), 0.0, 1.0), 4.0)
            const ambient = clamp(n2.mul(0.5).add(0.5), 0.0, 1.0)

            // Fresnel edge glow
            const fresnel = pow(float(1.0).sub(abs(dot(vViewDirection, vWorldNormal))), 2.5)

            const energy = add(bolt.mul(1.5), fresnel.mul(0.6), fine.mul(0.4), ambient.mul(0.15))
                .mul(u.energyIntensity)

            const col = mix(u.baseColor, u.energyColor, clamp(energy, 0.0, 1.0)).toVar()
            // Overbright core on bolt areas for bloom pickup
            col.addAssign(u.energyColor.mul(bolt).mul(u.energyIntensity).mul(1.5))

            return vec4(col, 1.0)
        })

        this.mat = new THREE.NodeMaterial()
        this.mat.fragmentNode = fragment()
    }

    createScene() {
        const model = this.gltf.scene
        model.traverse((el: THREE.Object3D) => {
            if ((el as THREE.Mesh).isMesh) {
                (el as THREE.Mesh).material = this.mat
            }
            el.layers.enable(6)
        })
    }

    addScene() {
        this.holder.add(this.gltf.scene)
        this.scene.add(this.holder)
    }

    private setupGUI() {
        this.guiFolder = this.gui.addFolder('light_storm')
        const folder = this.guiFolder
        const u = this.uniforms

        folder.addColor(this.params, 'baseColor')
            .name('Base Color')
            .onChange((v: number) => { u.baseColor.value.set(v) })

        folder.addColor(this.params, 'energyColor')
            .name('Energy Color')
            .onChange((v: number) => { u.energyColor.value.set(v) })

        folder.add(this.params, 'energyIntensity', 0, 4, 0.01)
            .name('Intensity')
            .onChange((v: number) => { u.energyIntensity.value = v })

        folder.add(this.params, 'noiseScale', 0.1, 15, 0.1)
            .name('Noise Scale')
            .onChange((v: number) => { u.noiseScale.value = v })

        folder.add(this.params, 'upSpeed', -3, 3, 0.01)
            .name('Flow Speed')
            .onChange((v: number) => { u.upSpeed.value = v })

        this.guiFolder.hide()
    }

    showGUI(v: boolean) {
        v ? this.guiFolder.show() : this.guiFolder.hide()
    }

    setVisible(v: boolean) {
        this.showGUI(v)
        this.gltf.scene.visible = v
        this.holder.visible = v
    }

    onBPMBeat() {
        this.beatDownSpeed = Date.now()
    }

    update() {
        this.uniforms.time.value += this.exp.time.delta * 0.001

        if (Date.now() - this.beatDownSpeed < 300) {
            this.uniforms.energyIntensity.value = 4
        } else {
            this.uniforms.energyIntensity.value = 0
        }
    }

    leave() {
        this.scene.remove(this.holder)
    }

}