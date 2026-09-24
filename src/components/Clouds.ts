import Experience from "../Experience"

import * as THREE from 'three/webgpu'
import GUI from "lil-gui";
import {
    Fn, uniform, uv, texture, positionLocal, cameraPosition, instancedBufferAttribute,
    float, vec4, distance, select,
} from 'three/tsl'

const getRandomBetween = (min: number, max: number) => Math.random() * (max - min) + min
export type cloudParamsType = {
    x: number, y: number, z: number,
    clouds: number,
    yAmplitude: number,
    cloudOpacity: number,
    scaleFactor: number,
    color?: THREE.ColorRepresentation,
    blending?: THREE.Blending,
    scaleAspect?: number,
    spreadX?: number,
    spreadZ?: number,
    textureKey?: string,
}


export default class Clouds {

    private experience: Experience;
    private gui: GUI;
    private scene: THREE.Scene
    private material: THREE.NodeMaterial | null = null
    private uniforms: Record<string, any> | null = null
    private geometry: THREE.PlaneGeometry | null = null
    private mesh: THREE.InstancedMesh | null = null
    private dummy: THREE.Object3D | null = null
    private visible: boolean = true

    private guiFolder!: GUI

    private cloudParams: cloudParamsType = {
        scaleFactor: 10,
        clouds: 5000,
        yAmplitude: 20,
        cloudOpacity: 0.025,
        color: '#ffffff',
        x: 0,
        y: 0,
        z: -100,
    }

    constructor(
        experience: Experience,
        cloudParams: Omit<cloudParamsType, scaleFactor>
    ) {
        this.cloudParams = {
            ...cloudParams,
            ...this.cloudParams,
        }



        this.experience = experience
        this.gui = this.experience.helpers.GUI
        this.scene = this.experience.scene


        this.createTweaks()
    }

    createClouds() {

        console.log("create clouds")
        const {
            blending = THREE.NormalBlending,
            scaleAspect = 1,
            spreadX,
            spreadZ = 1000,
            textureKey = 'cloud',
        } = this.cloudParams

        const texture_ = this.experience.ressources.items[textureKey]

        const u = this.uniforms = {
            uColor: uniform(new THREE.Color(this.cloudParams.color ?? '#ffffff')),
            uOpacity: uniform(this.cloudParams.cloudOpacity),
            uFalloff: uniform(blending === THREE.AdditiveBlending ? 1 : 0),
            uRadius: uniform(120),
            uAreaFactor: uniform(0.25),
        }

        // Each instance's translation, so the distance falloff can shrink a
        // quad about its own centre (the instance matrix has already been
        // applied to positionLocal by the time positionNode runs).
        const centers = new Float32Array(this.cloudParams.clouds * 3)
        const centerAttr = new THREE.InstancedBufferAttribute(centers, 3)

        const mat = new THREE.NodeMaterial()
        const center: any = instancedBufferAttribute(centerAttr)
        mat.positionNode = Fn(() => {
            const dist = distance(positionLocal, cameraPosition)
            const diff = u.uRadius.mul(float(1.0).sub(u.uAreaFactor))
            const falloff = select(
                dist.lessThan(u.uRadius),
                select(dist.greaterThan(diff), float(1.0).sub(dist.sub(diff).div(u.uRadius.sub(diff))), float(1.0)),
                float(0.0),
            )
            const scale = select(u.uFalloff.greaterThan(0.5), falloff, float(1.0))
            return center.add(positionLocal.sub(center).mul(scale))
        })()
        mat.fragmentNode = Fn(() => {
            const texColor = texture(texture_).sample(uv())
            return vec4(texColor.rgb.mul(u.uColor), texColor.a.mul(u.uOpacity))
        })()
        mat.transparent = true
        mat.side = THREE.DoubleSide
        mat.depthWrite = false
        mat.blending = blending
        this.material = mat

        this.dummy = new THREE.Object3D()
        this.geometry = new THREE.PlaneGeometry(1, 1, 1)
        this.geometry.setAttribute('aCenter', centerAttr)
        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.cloudParams.clouds)
        this.mesh.position.set(this.cloudParams.x, this.cloudParams.y, this.cloudParams.z)

        for (let i = 0; i < this.cloudParams.clouds; i++) {
            const xRange = spreadX ?? 32
            const px = spreadX !== undefined
                ? getRandomBetween(-xRange, xRange)
                : getRandomBetween(0, xRange)

            this.dummy.position.set(
                px,
                getRandomBetween(-this.cloudParams.yAmplitude, this.cloudParams.yAmplitude),
                getRandomBetween(0, spreadZ)
            )

            this.dummy.rotation.set(
                Math.random() * Math.PI * 2,
                Math.random() * Math.PI * 2,
                Math.random() * Math.PI * 2
            )

            const scale = getRandomBetween(2, this.cloudParams.scaleFactor)
            this.dummy.scale.set(scale, scale * scaleAspect, scale)
            this.dummy.updateMatrix()
            this.mesh.setMatrixAt(i, this.dummy.matrix)
            centers[i * 3] = this.dummy.position.x
            centers[i * 3 + 1] = this.dummy.position.y
            centers[i * 3 + 2] = this.dummy.position.z
        }

        this.addScene()
    }

    createTweaks() {

        const towerFolder = this.guiFolder = this.gui.addFolder('clouds');
        towerFolder.add(
            this.cloudParams,
            'clouds',
            0, 100000, 1
        ).onChange((e: number) => {
            this.dispose()
            this.createClouds()
            this.addScene()
        })

        towerFolder.add(
            this.cloudParams,
            'scaleFactor',
            1, 10, 1
        ).onChange((e: number) => {

            this.dispose()
            this.createClouds()
            this.addScene()
        })

        towerFolder.add(
            this.cloudParams,
            'yAmplitude',
            1, 100, 1
        ).onChange((e: number) => {

            this.dispose()
            this.createClouds()
            this.addScene()
        })
        towerFolder.add(
            this.cloudParams,
            'cloudOpacity',
            0, 1, 0.01
        ).onChange((e: number) => {
            this.uniforms && (this.uniforms.uOpacity.value = e)
        })

        towerFolder.addColor(
            this.cloudParams,
            'color'
        ).onChange((e: THREE.ColorRepresentation) => {
            this.uniforms && this.uniforms.uColor.value.set(e)
        })


        towerFolder.add(
            this.cloudParams,
            'x',
            -100, 100, 1
        ).onChange((e: number) => {
            this.mesh && (this.mesh.position.x = e)
        })
        towerFolder.add(
            this.cloudParams,
            'y',
            -100, 100, 1
        ).onChange((e: number) => {
            this.mesh && (this.mesh.position.y = e)
        })
        towerFolder.add(
            this.cloudParams,
            'z',
            -300, 100, 1
        ).onChange((e: number) => {
            this.mesh && (this.mesh.position.z = e)
        })
        towerFolder.close()
    }
    setVisible(v: boolean) {
        this.visible = v
        this.mesh && (this.mesh.visible = v)
        this.uniforms && (this.uniforms.uOpacity.value = v ? this.cloudParams.cloudOpacity : 0)
    }

    showGUI(v: boolean) {
        v ? this.guiFolder.show() : this.guiFolder.hide()
    }

    update() {
        if (!this.experience.camera.instance) return
        if (!this.mesh) return

        this.mesh.position.x += Math.sin(this.experience.time.elapsedTime * 0.00005) * 0.001
        this.mesh.position.y += Math.cos(this.experience.time.elapsedTime * 0.00005) * 0.01
        // this.mesh.position.z += Math.cos(this.experience.time.elapsedTime * 0.00005) * 0.01
    }
    addScene() {
        if (!this.mesh) return
        this.mesh.visible = this.visible
        this.experience.scene.add(this.mesh)
        this.mesh.position.z = this.cloudParams.z
    }
    setPosition(x: number, y: number, z: number) {
        if (!this.mesh) return

        this.cloudParams.x = x
        this.cloudParams.y = y
        this.cloudParams.z = z
        this.mesh.position.x = x
        this.mesh.position.y = y
        this.mesh.position.z = z
    }

    dispose() {
        this.mesh && this.scene.remove(this.mesh)
        this.geometry && this.geometry.dispose()
        this.material && this.material.dispose()
        this.mesh = null
        this.geometry = null
        this.material = null
        this.uniforms = null
    }

    reconfigure(params: Omit<cloudParamsType, 'scaleFactor'>) {
        this.dispose()
        this.cloudParams = {
            scaleFactor: this.cloudParams.scaleFactor,
            ...params,
        }
        this.createClouds()
    }

}
