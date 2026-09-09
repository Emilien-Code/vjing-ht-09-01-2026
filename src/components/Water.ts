import * as THREE from "three"
import { Reflector } from "three/examples/jsm/objects/Reflector.js"
import Experience from "../Experience"

interface BodyParams {
    geometry?: "circle" | "plane"
    color: THREE.ColorRepresentation
    speed: number
    width?: number
    height?: number
    radius?: number
    waveStrength?: number
}

export default class Body {
    experience: Experience

    speed: number

    vertex: string
    fragment: string

    customShader: any

    dudvMap: THREE.Texture

    geometry: THREE.CircleGeometry | THREE.PlaneGeometry

    water: Reflector

    constructor(experience: Experience, params: BodyParams) {
        this.experience = experience

        const {
            geometry,
            color,
            speed,
            width,
            height,
            radius,
            waveStrength = 0.5
        } = params

        this.speed = speed

        this.vertex = `
        uniform mat4 textureMatrix;
        varying vec2 vUv;
        varying vec4 vUvRefraction;
        
        void main(){
            
            vUvRefraction = textureMatrix * vec4( position, 1.0 );
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        
        }`

        this.fragment = `
        uniform vec3 color;
        uniform float time;
        uniform float waveStrength;
        uniform sampler2D tDiffuse;
        uniform sampler2D tDudv;

        varying vec2 vUv;
        varying vec4 vUvRefraction;

        float blendOverlay( float base, float blend ) {

            return( base < 0.5 
                ? ( 2.0 * base * blend ) 
                : ( 1.0 - 2.0 * ( 1.0 - base ) * ( 1.0 - blend ) ) );

        }

        vec3 blendOverlay( vec3 base, vec3 blend ) {

            return vec3(
                blendOverlay( base.r, blend.r ),
                blendOverlay( base.g, blend.g ),
                blendOverlay( base.b, blend.b )
            );

        }

        void main() {

            float waveSpeed = 0.03;

            vec2 distortedUv = texture2D(
                tDudv,
                vec2( vUv.x + time * waveSpeed, vUv.y )
            ).rg * waveStrength;

            distortedUv = vUv.xy + vec2(
                distortedUv.x,
                distortedUv.y + time * waveSpeed
            );

            vec2 distortion = (
                texture2D( tDudv, distortedUv ).rg * 1.0 - 1.0
            ) * waveStrength;

            vec4 uv = vec4( vUvRefraction );
            uv.xy += distortion;

            vec4 base = texture2DProj( tDiffuse, uv );

            gl_FragColor = vec4(
                blendOverlay( base.rgb, color ),
                1.0
            );

            #include <tonemapping_fragment>
            #include <colorspace_fragment>

        }`

        this.customShader = Reflector.ReflectorShader

        // Create displacement texture
        this.dudvMap =
            this.experience.ressources.items.water_displacement

        this.dudvMap.wrapS = THREE.RepeatWrapping
        this.dudvMap.wrapT = THREE.RepeatWrapping

        this.customShader.uniforms.tDudv = {
            value: this.dudvMap
        }

        this.customShader.uniforms.time = {
            value: 0
        }

        this.customShader.uniforms.waveStrength = {
            value: waveStrength
        }

        this.customShader.vertexShader = this.vertex
        this.customShader.fragmentShader = this.fragment

        if (geometry === "circle" || radius) {
            this.geometry = new THREE.CircleGeometry(radius ?? 1)
        } else {
            this.geometry = new THREE.PlaneGeometry(
                width ?? 1,
                height ?? 1
            )
        }

        this.water = new Reflector(this.geometry, {
            color,
            textureWidth: this.experience.sizes.width,
            textureHeight: this.experience.sizes.height
        })
    }

    update(): void {
        const uniforms = this.water.material.uniforms as {
            time: { value: number }
        }

        uniforms.time.value += this.speed
    }
}