import * as THREE from 'three/webgpu'
import Experience from "../Experience"
import GUI from "lil-gui";
import {
    Fn, positionLocal, cameraPosition, instancedBufferAttribute,
    float, distance, select,
} from 'three/tsl'

import { godRaysBloom } from "../common/colors";

const getRandomBetween = (min: number, max: number) => Math.random() * (max - min) + min

export default class GodRays {

    private experience: Experience;
    private gui: GUI;
    private scene: THREE.Scene
    private material: THREE.MeshBasicNodeMaterial | null = null
    private geometry: THREE.PlaneGeometry | null = null
    private mesh: THREE.InstancedMesh | null = null
    private dummy: THREE.Object3D | null = null

    private raysParams = {
        count: 1,
        faces: 100,
        opacity: 0.01,
        color: 0xffffff,
        x: 0,
        y: 25,
        z: 11
    }


    constructor(experience: Experience,
        params: {
            x: number
            y: number
            z: number
            count: number
        }
    ) {
        this.experience = experience
        this.gui = this.experience.helpers.GUI
        this.scene = this.experience.scene
        this.raysParams = {
            ...this.raysParams,
            ...params
        }
        this.createTweaks()
    }


    createRays() {

        this.material = new THREE.MeshBasicNodeMaterial({
            map: this.experience.ressources.items.noise,

            color: this.raysParams.color,       // teinte du rayon
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,     // important pour que les rayons se superposent bien
            opacity: this.raysParams.opacity,
            side: THREE.DoubleSide,


        });

        // Rays vanish beyond `radius` from the camera and grow back over the
        // outer quarter of it, scaling each quad about its own centre (the
        // instance matrix has already been applied to positionLocal by the
        // time positionNode runs, so the centre comes in as an attribute).
        const centers = new Float32Array(this.raysParams.count * this.raysParams.faces * 3)
        const centerAttr = new THREE.InstancedBufferAttribute(centers, 3)
        const center: any = instancedBufferAttribute(centerAttr)
        const radius = 100
        const areaFactor = 0.25
        const diff = radius * (1 - areaFactor)
        this.material.positionNode = Fn(() => {
            const dist = distance(positionLocal, cameraPosition)
            const inFalloff = float(1.0).sub(dist.sub(diff).div(radius - diff))
            const scale = select(
                dist.lessThan(radius),
                select(dist.greaterThan(diff), inFalloff, float(1.0)),
                float(0.0),
            )
            return center.add(positionLocal.sub(center).mul(scale))
        })()

        this.dummy = new THREE.Object3D();

        this.geometry = new THREE.PlaneGeometry(1, 1, 1);

        this.geometry.setAttribute('aCenter', centerAttr)
        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.raysParams.count * this.raysParams.faces);

        this.mesh.layers.enable(godRaysBloom.layer)
        let plane = 0

        for (let ray = 0; ray < this.raysParams.count; ray++) {
            for (let face = 0; face < this.raysParams.faces; face++) {

                this.dummy.position.set(
                    getRandomBetween(-5, 10 * ray * 0.005),
                    getRandomBetween(0, 10 * (this.raysParams.faces - ray) / this.raysParams.faces * 0.5) + this.raysParams.y,
                    ray * (getRandomBetween(0, 10) + getRandomBetween(8, 12)) + getRandomBetween(0, 10) + getRandomBetween(8, 12),
                );

                this.dummy.rotation.set(
                    Math.random(),
                    Math.random(),
                    Math.random()
                );

                const scale = getRandomBetween(2, 25);
                this.dummy.scale.set(scale, scale * 2, scale);

                this.dummy.updateMatrix();
                this.mesh.setMatrixAt(plane, this.dummy.matrix);
                centers[plane * 3] = this.dummy.position.x
                centers[plane * 3 + 1] = this.dummy.position.y
                centers[plane * 3 + 2] = this.dummy.position.z
                plane++

            }
            // console.log(this.dummy.position)
        }


        // console.log(plane, this.raysParams.count * this.raysParams.faces)
        this.addScene()
    }


    createTweaks() {

        const godRaysFolder = this.gui.addFolder("godrays")

        godRaysFolder.add(this.raysParams, "opacity", 0, 0.1, 0.001)
            .onChange((e: number) => this.material && (this.material.opacity = e))

        godRaysFolder.add(this.raysParams, "faces", 0, 1000, 1)
            .onChange((e: number) => {
                this.raysParams.faces = e
                this.dispose()
                this.createRays()
            })


        godRaysFolder.add(this.raysParams, "x", -100, 1000, 1)
            .onChange((e: number) => {
                this.mesh && (this.mesh.position.x = e)
            })

        godRaysFolder.add(this.raysParams, "y", 0, 1000, 1)
            .onChange((e: number) => {
                this.mesh && (this.mesh.position.y = e)
            })

        godRaysFolder.add(this.raysParams, "z", 0, 1000, 1)
            .onChange((e: number) => {
                this.mesh && (this.mesh.position.z = e)
            })


        godRaysFolder.add(this.raysParams, "count", 0, 1000, 1)
            .onChange((e: number) => {
                this.dispose()
                this.createRays()
            })

godRaysFolder.close()


    }

    addScene() {
        this.mesh && this.scene.add(this.mesh)
    }
    dispose() {
        if (!this.mesh || !this.geometry) return
        this.scene.remove(this.mesh);
        this.geometry.dispose()
    }
    update() {
        if (!this.experience.camera.instance) return
    }
}