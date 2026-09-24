import Experience from "../Experience"

import * as THREE from 'three/webgpu'
import GUI from "lil-gui";
import {
    Fn, uniform, attribute, output, positionLocal, positionGeometry, cameraPosition,
    float, vec4, distance, select,
} from 'three/tsl'
import { SimplexNoise } from "../utils/noise"
import { grassPalette, rockPalette } from "../common/colors";
const getRandomBetween = (min: number, max: number) => Math.random() * (max - min) + min
const lerp = (t, i, e) => t * (1 - e) + i * e


export default class Tower {

    private experience: Experience;
    private gui: GUI;
    private x: number;
    private y: number;
    private z: number;
    private currentFloor = 0
    private blockCount = 0
    private noise: SimplexNoise;
    private bricksColors: Float32Array;
    private dummy = new THREE.Object3D();
    public mesh: THREE.InstancedMesh
    private geometry: THREE.BoxGeometry
    private material: THREE.MeshStandardNodeMaterial
    private scene: THREE.Scene
    private musicDurationInBlock = 400

    private repeatOffset = 0

    private towerParams = {
        base: 8,
        height: 56,
        noiseFactor: 0.5,
        amountOfCrumbles: 100,
        offset: 16,
        towerCount: 4,
        fogDistance: 1024,
        columns: 2,
        appearingProgress: 1,
    }

    private uniforms = {
        uCameraPosition: uniform(new THREE.Vector3()),
        uProgress: uniform(this.towerParams.appearingProgress),
        uRadius: uniform(0)
    }


    constructor(
        experience: Experience,
        towerParams: {
            base: number,
            height: number,
            //     noiseFactor?: number
            //     amountOfCrumbles?: number
        }
    ) {
        const {
            base,
            height,
            //     noiseFactor = 0.1,
            //     amountOfCrumbles = 5,
        } = towerParams

        // this.towerParams = {
        //     ...towerParams,
        //     noiseFactor,
        //     amountOfCrumbles,
        // }

        this.experience = experience
        this.gui = this.experience.helpers.GUI
        this.scene = this.experience.scene
        this.x = base
        this.y = height
        this.z = base

        const u = this.uniforms
        this.material = new THREE.MeshStandardNodeMaterial({ color: 0xffffff });

        // Bricks shrink to nothing beyond `uRadius` from the camera and grow
        // back over the outer quarter of it. The shrink has to happen about
        // each brick's own centre, but by the time positionNode runs the
        // instance matrix has already been applied to positionLocal — the
        // bricks are translation-only (scale 1, no rotation), so the centre is
        // simply `positionLocal - positionGeometry`.
        this.material.positionNode = Fn(() => {
            const dist = distance(positionLocal, cameraPosition)

            const radius = u.uRadius
            const areaFactor = 0.25
            const diff = radius.mul(1.0 - areaFactor)
            const inFalloff = float(1.0).sub(dist.sub(diff).div(radius.sub(diff)))
            const scale = select(
                dist.lessThan(radius),
                select(dist.greaterThan(diff), inFalloff, float(1.0)),
                float(0.0),
            )
            // (snap scales just under 1 up to 1)
            const snapped = select(scale.greaterThan(0.99).and(scale.lessThan(1.0)), float(1.0), scale)

            const center = positionLocal.sub(positionGeometry)
            return center.add(positionGeometry.mul(snapped))
        })()

        // Per-brick colour, multiplied in after lighting
        // (was `gl_FragColor.rgb *= vInstanceColor` after fog_fragment).
        const instanceTint = attribute('instanceColor', 'vec3')
        this.material.outputNode = vec4(output.rgb.mul(instanceTint), output.a)

        this.bricksColors = new Float32Array(this.x * this.y * this.z * 3 * this.towerParams.towerCount * this.towerParams.columns)
        this.geometry = new THREE.BoxGeometry(1, 1, 1);


        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.x * this.y * this.z * this.towerParams.towerCount * this.towerParams.columns);
        this.mesh.receiveShadow = true
        this.mesh.castShadow = true
        this.noise = new SimplexNoise()

        // this.buildFloor()
        // this.createTower()
        // this.geometry.setAttribute("instanceColor", new THREE.InstancedBufferAttribute(this.bricksColors, 3))

        this.createTweaks()
    }


    createTower(off: number) {

        this.blockCount = 0
        this.currentFloor = 0
        this.dummy = new THREE.Object3D();
        this.bricksColors = new Float32Array(this.x * this.y * this.z * 3 * this.towerParams.towerCount * this.towerParams.columns)
        this.geometry = new THREE.BoxGeometry(1, 1, 1);

        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.x * this.y * this.z * this.towerParams.towerCount * this.towerParams.columns);
        this.mesh.receiveShadow = true
        this.mesh.castShadow = true
        this.noise = new SimplexNoise()

        this.buildFloor(off)

        this.geometry.setAttribute("instanceColor", new THREE.InstancedBufferAttribute(this.bricksColors, 3))


    }

    buildFloor(translation: number) {
        const offset = this.towerParams.offset
        this.repeatOffset = translation * this.towerParams.towerCount * (this.towerParams.base + offset)
        for (let j = 0; j < this.towerParams.columns; j++) {
            for (let i = 0; i < this.towerParams.towerCount; i++) {
                this.noise = new SimplexNoise()
                this.createCrumbledFloor(
                    this.x,
                    j * (this.x + offset),
                    0,
                    i * (this.x + offset) + this.repeatOffset
                )
            }
        }
    }
    getTowerEndPosZ() {
        const offset = this.towerParams.offset
        return this.repeatOffset + this.towerParams.towerCount * (this.x + offset)
    }


    createCrumbledFloor(splits: number, posX: number, posY: number, posZ: number) {

        // console.log(posZ)
        const factor = posZ / this.musicDurationInBlock * 0.5;//((this.towerParams.offset + this.x) * this.towerParams.towerCount) * 0.5
        const aoc = posZ / this.musicDurationInBlock * 100;//((this.towerParams.offset + this.x) * this.towerParams.towerCount) * 100

        const colors = [
            new THREE.Color(0xAF8F5E),
            // new THREE.Color(0x98B38A),
        ]
        const crumbleCount = Math.floor(Math.random() * aoc) + Math.floor(aoc/100)


        const crumbles: { x: number, y: number, z: number, rx: number, ry: number, rz: number }[] = []


        const randomY = getRandomBetween(this.y - 10, this.y)
        for (let i = 0; i < crumbleCount; i++) {
            const isOnX = Math.random() < 0.5
            crumbles[i] = {
                x: isOnX
                    ? Math.random() < 0.5
                        ? 0
                        : this.x
                    : Math.floor(Math.random() * this.x),
                y: Math.floor(Math.random() * this.y),
                z:
                    !isOnX
                        ? Math.random() < 0.5
                            ? 0
                            : this.x
                        : Math.floor(Math.random() * this.x),

                ry: Math.floor(Math.random() * 4) + 2,
                rx: Math.floor(Math.random() * 4) + 1,
                rz: Math.floor(Math.random() * 4) + 1,
            }
        }


        const offset = getRandomBetween(-2, 2)
        for (let x = 0; x < this.x; x++) {

            for (let y = 0; y < randomY; y++) {

                for (let z = 0; z < this.z; z++) {


                    let brickColor = new THREE.Color().setHSL(
                        (22 + Math.random() * 5) / 360,
                        (48 + Math.random() * 5) / 100,
                        (27 + Math.random() * 5) / 100,
                    )
                    //new THREE.Color(rockPalette[Math.floor(Math.random() * rockPalette.length)])

                    // console.log(brickColor.r)

                    //Green color
                    if (
                        y >= randomY - 1
                        || ((x === 0 || x === this.x - 1) && (y > randomY - Math.cos(z - 0.5 * Math.PI / 2) * Math.random() * 20))
                        || ((z === 0 || z === this.z - 1) && (y > randomY - Math.cos(x - 0.5 * Math.PI / 2) * Math.random() * 20))


                    ) {
                        brickColor = new THREE.Color().setHSL(
                            (84 + Math.random() * 5) / 360,
                            (30 + Math.random() * 5) / 100,
                            (25 + Math.random() * 5) / 100,
                        )
                    }




                    //Brown color
                    this.bricksColors[this.blockCount * 3] = brickColor.r
                    this.bricksColors[this.blockCount * 3 + 1] = brickColor.g
                    this.bricksColors[this.blockCount * 3 + 2] = brickColor.b







                    const noise = this.noise.noise3D(x * factor, y * factor, z * factor);

                    let shouldBeRendered = true
                    for (const crumble of crumbles) {
                        const { rx, ry, rz } = crumble
                        const dx = x - crumble.x
                        const dy = y - crumble.y
                        const dz = z - crumble.z
                        if (
                            (
                                (dx * dx) / (rx * rx)
                                + (dy * dy) / (ry * ry)
                                + (dz * dz) / (rz * rz)
                            ) + noise * 0.2 < 1
                        ) {
                            shouldBeRendered = false
                        }
                    }



                    if (shouldBeRendered) {
                        this.dummy.position.set(x + posX + offset, y, z + posZ + offset);
                        this.dummy.scale.set(1, 1, 1)
                        this.dummy.updateMatrix();


                        this.mesh.setMatrixAt(this.blockCount, this.dummy.matrix);
                    }

                    this.blockCount++;


                }
            }
        }


    }


    createTweaks() {
        const towerFolder = this.gui.addFolder('towers');
        towerFolder.add(
            this.towerParams,
            'base',
            8, 128, 8
        ).onChange((e) => {
            this.x = e
            this.z = e

            this.dispose()
            this.createTower()
            this.addScene()
        })

        towerFolder.add(
            this.towerParams,
            'height',
            8, 128, 8
        ).onChange((e) => {
            this.y = e

            this.dispose()
            this.createTower()
            this.addScene()
        })


        towerFolder.add(
            this.towerParams,
            'noiseFactor',
            0, 0.5, 0.01
        ).onChange((e) => {

            this.dispose()
            this.createTower()
            this.addScene()
        })
        towerFolder.add(
            this.towerParams,
            'amountOfCrumbles',
            0, 100, 1
        ).onChange((e) => {

            this.dispose()
            this.createTower()
            this.addScene()
        })


        towerFolder.add(
            this.towerParams,
            'towerCount',
            0, 100, 1
        ).onChange((e) => {

            this.dispose()
            this.createTower()
            this.addScene()
        })
        towerFolder.add(
            this.towerParams,
            'offset',
            0, 100, 1
        ).onChange((e) => {

            this.dispose()
            this.createTower()
            this.addScene()
        })

        towerFolder.add(
            this.towerParams,
            'appearingProgress',
            0, 1, 0.01
        ).onChange((e) => {

            // this.uniforms.uCameraPosition.value.copy(this.experience.camera.instance.position);
            this.uniforms.uProgress.value = e

        })


        towerFolder.close()


    }

    update() {
        if (!this.experience.camera.instance) return
        // console.log(this.experience.camera.instance.position)
        this.uniforms.uRadius.value = lerp(
            this.uniforms.uRadius.value,
            100,
            0.051
        )
        this.uniforms.uCameraPosition.value.copy(this.experience.camera.instance.position);
    }
    addScene() {
        this.experience.scene.add(this.mesh)
    }

    dispose() {
        this.scene.remove(this.mesh);
        this.geometry.dispose()
    }

}
