import type GUI from 'lil-gui';
import * as THREE from 'three';

import { godRaysBloom as jellyFishBloom, jellyFishPalette } from '../common/colors';
import Experience from "../Experience";
import { SimplexNoise } from "../utils/noise";
import type Time from '../utils/Time';
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
    private material: THREE.MeshBasicMaterial
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
            material: THREE.ShaderMaterial
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

        this.material = new THREE.ShaderMaterial({
            wireframe: false,
            uniforms: {
                uColor: { value: new THREE.Color(jellyFishPalette[0]) }
            },
            vertexShader: `


                            void main() {

                                vec4 modelPosition = modelMatrix * vec4(position, 1.0);
                                vec4 viewPosition = viewMatrix * modelPosition;
                                vec4 projectedPosition = projectionMatrix * viewPosition;

                                gl_Position = projectedPosition;

                            }
                        
                        `,
            fragmentShader: `

                            uniform vec3 uColor;
                            void main() {
                                gl_FragColor = vec4(uColor,1.0);
                            }
                        `
        })
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
                this.medusas[i].tentacules[j] = {
                    material: new THREE.ShaderMaterial({
                        wireframe: false,
                        side: THREE.DoubleSide,
                        uniforms: {
                            uTime: { value: 0 },
                            uAmplitudes: { value: new THREE.Vector2((Math.random() - 0.5), (Math.random() - 0.5)) },
                            uOffset: { value: Math.random() },
                            uColor: { value: new THREE.Color(jellyFishPalette[0]) }
                        },
                        vertexShader: `

                            uniform float uTime;
                            uniform float uOffset;
                            uniform vec2 uAmplitudes;
                            

                            void main() {
                                vec3 newPos = position;


                                float radiusY = 1.0;
                                float radiusZ = 0.5;
                                
                                float y = newPos.y * radiusY;
                                float z = newPos.z * radiusZ;
                    
                                newPos.y = y * cos(position.x) - z * sin(position.x);
                                newPos.z = y * sin(position.x) + z * cos(position.x);
                                
                                //Animation
                                newPos.y += sin(uv.x * 5.+ uTime * 0.001 + uOffset) * uAmplitudes.x * (5.-uv.x * 5.) ;
                                newPos.z += sin(uv.x * 5.+ uTime * 0.001 + uOffset) * uAmplitudes.y * (5.-uv.x * 5.) ;

                                
                                vec4 modelPosition = modelMatrix * vec4(newPos, 1.0);
                                vec4 viewPosition = viewMatrix * modelPosition;
                                vec4 projectedPosition = projectionMatrix * viewPosition;

                                gl_Position = projectedPosition;

                            }
                        
                        `,
                        fragmentShader: `
                            uniform vec3 uColor;
                            void main() {
                                gl_FragColor = vec4(uColor,1.0);
                            }
                        `
                    })
                }
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
                    tentac.material.uniforms.uTime.value = this.experience.time.elapsedTime
                }

                if(Math.abs(cameraPos - medusa.group.position.z) < 100){

                    medusa.group.position.addScaledVector(new THREE.Vector3(medusa.direction.x, medusa.direction.y, medusa.direction.z), medusa.velocity * 10)
                }
                medusa.group.rotation.x += this.time.elapsedTime * 0.00000001

            }
        }
    }
}