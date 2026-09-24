import type GUI from 'lil-gui';
import * as THREE from 'three/webgpu';

import { godRaysBloom as jellyFishBloom, jellyFishPalette } from '../common/colors';
import Experience from "../Experience";
import { SimplexNoise } from "../utils/noise";
import type Time from '../utils/Time';
import {
    uniform, uv, positionGeometry, float, vec3, sin, cos,
} from 'three/tsl';
const getRandomBetween = (min: number, max: number) => Math.random() * (max - min) + min


export type MedusaParamsType = {
    noiseFactor: number;
    amountOfMedusa: number;

}
export default class Medusa {

    private experience: Experience
    private scene: THREE.Scene
    private time: Time


    private geometry: THREE.SphereGeometry
    private material: THREE.MeshBasicNodeMaterial
    private mesh: THREE.Mesh
    private gui: GUI

    private noise: SimplexNoise
    private medusas: {
        velocity: number
        amplitudes: {
            x: number
            y: number
            z: number
        }
        direction: {
            x: number, y: number, z: number
        }
        group: THREE.Group
        tentacules: {
            material: THREE.NodeMaterial
            uniforms: { uTime: any, uAmplitudes: any, uOffset: any, uColor: any }
        }[]
    }[] = []
    private medusaGroup: THREE.Group
    private medusaParams: MedusaParamsType
    private tentaculeDefaultLength = 5
    private tentaculePlane = new THREE.PlaneGeometry(this.tentaculeDefaultLength, 0.2, 20, 2)


    constructor(experience: Experience, medusaParams: MedusaParamsType) {

        this.experience = experience
        this.medusaParams = medusaParams

        this.scene = this.experience.scene
        this.time = this.experience.time


        this.gui = this.experience.helpers.GUI

        // Flat jellyfish-coloured bulb.
        this.material = new THREE.MeshBasicNodeMaterial()
        this.material.colorNode = uniform(new THREE.Color(jellyFishPalette[0]))
        this.geometry = new THREE.SphereGeometry(1, 32, 16)
        this.mesh = new THREE.Mesh(this.geometry, this.material)
        this.medusaGroup = new THREE.Group()
        this.mesh.layers.enable(jellyFishBloom.layer)

        this.createTweaks()
        this.addScene()
    }

    createMedusas() {
        this.medusaGroup = new THREE.Group()

        this.noise = new SimplexNoise()



        for (let i = 0; i < this.medusaParams.amountOfMedusa; i++) {

            this.medusas[i] = {
                velocity: Math.random() * 0.01,
                amplitudes: {
                    x: Math.random() * 0.5,
                    y: Math.random() * 0.5,
                    z: Math.random() * 0.5,
                },
                direction: {
                    x: 0, y: 0, z: 0
                },
                group: new THREE.Group(),
                tentacules: []
            }
            const noise = this.noise.noise3D(
                Math.random() * 128 * this.medusaParams.noiseFactor,
                Math.random() * 128 * this.medusaParams.noiseFactor,
                Math.random() * 128 * this.medusaParams.noiseFactor
            );

            this.medusas[i].group.add(this.mesh.clone())
            this.medusas[i].group.position.x = getRandomBetween(8, 24);
            this.medusas[i].group.position.y = getRandomBetween(30, 60);
            this.medusas[i].group.position.z = getRandomBetween(0, 500);


            /**
             * Create tentacules
             */
            for (let j = 0; j < Math.floor(Math.random() * 200) + 30; j++) {
                const uniforms = {
                    uTime: uniform(0),
                    uAmplitudes: uniform(new THREE.Vector2((Math.random() - 0.5), (Math.random() - 0.5))),
                    uOffset: uniform(Math.random()),
                    uColor: uniform(new THREE.Color(jellyFishPalette[0])),
                }

                // Each tentacle is a plane that gets bent about the X axis and
                // then waves along its length.
                const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide })
                material.colorNode = uniforms.uColor
                material.positionNode = (() => {
                    const p = positionGeometry
                    const radiusY = 1.0
                    const radiusZ = 0.5

                    const y = p.y.mul(radiusY)
                    const z = p.z.mul(radiusZ)

                    const bentY = y.mul(cos(p.x)).sub(z.mul(sin(p.x)))
                    const bentZ = y.mul(sin(p.x)).add(z.mul(cos(p.x)))

                    // Animation
                    const wave = sin(uv().x.mul(5.0).add(uniforms.uTime.mul(0.001)).add(uniforms.uOffset))
                    const falloff = float(5.0).sub(uv().x.mul(5.0))

                    return vec3(
                        p.x,
                        bentY.add(wave.mul(uniforms.uAmplitudes.x).mul(falloff)),
                        bentZ.add(wave.mul(uniforms.uAmplitudes.y).mul(falloff)),
                    )
                })()

                this.medusas[i].tentacules[j] = { material, uniforms }
                let tentacule = new THREE.Mesh(this.tentaculePlane, this.medusas[i].tentacules[j].material)
                const tentaScale = getRandomBetween(0.3, 1.2)
                tentacule.position.x -= tentaScale * this.tentaculeDefaultLength / 2
                tentacule.position.y = (Math.random() - 0.5)
                tentacule.position.z = (Math.random() - 0.5)
                tentacule.scale.set(
                    tentaScale,
                    tentaScale,
                    tentaScale,
                )
                tentacule.layers.enable(jellyFishBloom.layer)
                this.medusas[i].group.add(tentacule)
                // this.medusas[i].group.scale.set(

                //     Math.random(),
                //     Math.random(),
                //     Math.random(),
                // )
            }

            const rotationX = getRandomBetween(0, Math.PI * 2)
            const rotationy = getRandomBetween(0, Math.PI * 2)
            const rotationz = getRandomBetween(0, Math.PI * 2)

            this.medusas[i].group.rotation.x = rotationX;
            this.medusas[i].group.rotation.y = rotationy;
            this.medusas[i].group.rotation.z = rotationz;

            const scale = getRandomBetween(0.1, 0.3)

            const dir = new THREE.Vector3(1, 0, 0); // direction de base (l’objet regarde vers l’avant, axe Z)
            dir.applyEuler(this.medusas[i].group.rotation); // applique la rotation
            dir.normalize();

            this.medusas[i].direction.x = dir.x
            this.medusas[i].direction.y = dir.y
            this.medusas[i].direction.z = dir.z

            this.medusas[i].group.scale.x = scale;
            this.medusas[i].group.scale.y = scale;
            this.medusas[i].group.scale.z = scale;

            this.medusaGroup.add(this.medusas[i].group)
            // this.medusaGroup.layers.enable(jellyFishBloom.layer)
            this.addScene()
        }
    }

    createTweaks() {
        const medusaFolder = this.gui.addFolder('medusa');
        medusaFolder.add(
            this.medusaParams,
            'noiseFactor',
            0, 0.5, 0.01
        ).onChange((e) => {

            this.dispose()
            this.createMedusas()

        })
        medusaFolder.add(
            this.medusaParams,
            "amountOfMedusa",
            0, 100, 1
        ).onChange((e) => {
            this.dispose()
            this.createMedusas()
        })
        medusaFolder.close()
    }

    addScene() {
        this.scene.add(this.medusaGroup)
    }

    dispose() {
        this.scene.remove(this.medusaGroup);
        // this.geometry.dispose()
    }

    update() {
        const cameraPos = this.experience.time.elapsedTime * 0.0051
        for (const medusa of this.medusas) {
            if (medusa) {

                for (const tentac of medusa.tentacules) {
                    tentac.uniforms.uTime.value = this.experience.time.elapsedTime
                }

                if(Math.abs(cameraPos - medusa.group.position.z) < 100){

                    medusa.group.position.addScaledVector(new THREE.Vector3(medusa.direction.x, medusa.direction.y, medusa.direction.z), medusa.velocity * 10)
                }
                medusa.group.rotation.x += this.time.elapsedTime * 0.00000001

            }
        }
    }
}