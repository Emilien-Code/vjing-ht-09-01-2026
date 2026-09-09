import Experience from "../Experience"

import * as THREE from "three"
import GUI from "lil-gui";

const getRandomBetween = (min: number, max: number) => Math.random() * (max - min) + min
const cloudShader = {
    vertexShader:
        `
        uniform float uFalloff;
        uniform float uRadius;
        uniform float uAreaFactor;

        varying vec2 vUv;

        void main() {
          vUv = uv;
          vec3 transformed = position;

          #ifdef USE_INSTANCING
            vec4 worldPosition = instanceMatrix * vec4( transformed, 1.0 );
          #else
            vec4 worldPosition = vec4( transformed, 1.0 );
          #endif

          if ( uFalloff > 0.5 ) {
            float dist = distance( worldPosition.xyz, cameraPosition.xyz );
            float diff = uRadius * ( 1.0 - uAreaFactor );
            float scale = dist < uRadius
                ? ( dist > diff ? 1.0 - ( dist - diff ) / ( uRadius - diff ) : 1.0 )
                : 0.0;
            transformed *= scale;
          }

          #ifdef USE_INSTANCING
            vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4( transformed, 1.0 );
          #else
            vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
          #endif

          gl_Position = projectionMatrix * mvPosition;
        }
      `,
    fragmentShader:
        `
        uniform sampler2D map;
        uniform vec3 uColor;
        uniform float uOpacity;

        varying vec2 vUv;

        void main() {
          vec4 texColor = texture2D( map, vUv );
          gl_FragColor = vec4( texColor.rgb * uColor, texColor.a * uOpacity );
        }
      `
}
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
    private material: THREE.ShaderMaterial | null = null
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

        const texture = this.experience.ressources.items[textureKey]

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                map: { value: texture },
                uColor: { value: new THREE.Color(this.cloudParams.color ?? '#ffffff') },
                uOpacity: { value: this.cloudParams.cloudOpacity },
                uFalloff: { value: blending === THREE.AdditiveBlending ? 1 : 0 },
                uRadius: { value: 120 },
                uAreaFactor: { value: 0.25 },
            },
            vertexShader: cloudShader.vertexShader,
            fragmentShader: cloudShader.fragmentShader,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending,
        })

        this.dummy = new THREE.Object3D()
        this.geometry = new THREE.PlaneGeometry(1, 1, 1)
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
            this.material && (this.material.uniforms.uOpacity.value = e)
        })

        towerFolder.addColor(
            this.cloudParams,
            'color'
        ).onChange((e: THREE.ColorRepresentation) => {
            this.material && this.material.uniforms.uColor.value.set(e)
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
        this.material && (this.material.uniforms.uOpacity.value = v ? this.cloudParams.cloudOpacity : 0)
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
