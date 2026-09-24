import * as THREE from 'three/webgpu'
import Experience from "../Experience"
import {
    Fn, uniform, attribute, float, vec3, vec4, fract, abs, clamp, mix, select,
} from 'three/tsl'
// import Time from "../utils/Time"
export default class LightSpeed {
    private experience : Experience
    
    private velocities : THREE.BufferAttribute | THREE.InterleavedBufferAttribute
    private positions : THREE.BufferAttribute | THREE.InterleavedBufferAttribute
    private hues : THREE.BufferAttribute | THREE.InterleavedBufferAttribute

    private positionArray : THREE.TypedArray
    private velocitiesArray : THREE.TypedArray
    private hueArray : THREE.TypedArray

    private lineMaterial : THREE.LineBasicNodeMaterial
    private uniforms : Record<string, any>
    private lines! : THREE.LineSegments
    private starsCount : number = 1000

    private vStart = 0
    private vEnd = 0
    private isPlaying : boolean;

    private params = {
        colorMode : 'rainbow' as 'light' | 'rainbow',
        speed : 1,
        visible : false
    }

    constructor(experience : Experience){
        this.experience = experience
    
        const geom = new THREE.BufferGeometry()
        
        geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * this.starsCount), 3))
        geom.setAttribute('velocity', new THREE.BufferAttribute(new Float32Array(6 * this.starsCount), 1))
        geom.setAttribute('aHue', new THREE.BufferAttribute(new Float32Array(2 * this.starsCount), 1))

        this.positions = geom.getAttribute('position')
        this.positionArray = this.positions.array
        this.velocities = geom.getAttribute("velocity")
        this.velocitiesArray = this.velocities.array
        this.hues = geom.getAttribute('aHue')
        this.hueArray = this.hues.array
        this.isPlaying = false


        for(let i = 0; i<this.starsCount; i++){
            const start_x = (Math.random()-0.5) * 20
            const start_y = (Math.random()-0.5) * 20
            const start_z = - Math.random() * 100

            const end_x = start_x
            const end_y = start_y
            const end_z = start_z

            //Start
            this.positionArray[6 * i] = start_x
            this.positionArray[6 * i + 1] = start_y
            this.positionArray[6 * i + 2] = start_z
            //End
            this.positionArray[6 * i + 3] = end_x
            this.positionArray[6 * i + 4] = end_y
            this.positionArray[6 * i + 5] = end_z

            this.velocitiesArray[2 * this.starsCount] = this.velocitiesArray[2 * this.starsCount + 1] = 0

            // Color assigned once at spawn, not derived from position
            const hue = Math.random()
            this.hueArray[2 * i] = hue
            this.hueArray[2 * i + 1] = hue

        }
        
        
        const u = this.uniforms = {
            uTime : uniform(0),
            uVelocity : uniform(10),
            uOffset : uniform(-5),
            uAudioVolume : uniform(0),
            uRainbow : uniform(this.params.colorMode === 'rainbow' ? 1 : 0)
        }

        // hsv (0..1) -> rgb
        const hsv2rgb = (c: any) => {
            const K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0)
            const p = abs(fract(vec3(c.x).add(K.xyz)).mul(6.0).sub(K.www))
            return c.z.mul(mix(K.xxx, clamp(p.sub(K.xxx), 0.0, 1.0), c.y))
        }

        // Multicolor: each star gets its hue once, at spawn (aHue) - fixed for its lifetime.
        const hue = attribute('aHue', 'float')
        const lineColor = Fn(() => {
            // Sound reactive: louder passages saturate and brighten the colors.
            const saturation = float(0.65).add(u.uAudioVolume.mul(0.35))
            const brightness = float(1.0).add(u.uAudioVolume.mul(1.5))

            // GUI toggle: plain light color, or the full rainbow palette.
            return select(
                u.uRainbow.greaterThan(0.5),
                hsv2rgb(vec3(hue, saturation, brightness)),
                vec3(brightness),
            )
        })()

        this.lineMaterial = new THREE.LineBasicNodeMaterial()
        this.lineMaterial.colorNode = lineColor

        this.lines = new THREE.LineSegments(geom, this.lineMaterial)
        this.lines.position.z = 0
        this.lines.visible = this.params.visible
        this.experience.scene.add(this.lines)

        const gui = this.experience.helpers.GUI
        const folder = gui.addFolder('Light Speed')
        folder.add(this.params, 'colorMode', ['light', 'rainbow']).name('Color').onChange((v: 'light' | 'rainbow') => {
            this.uniforms.uRainbow.value = v === 'rainbow' ? 1 : 0
        })
        folder.add(this.params, 'speed', 0.1, 5, 0.05).name('Speed')
        folder.add(this.params, 'visible').name('Show').listen().onChange((v: boolean) => {
            this.setVisible(v)
        })
    }

    setVisible(v: boolean) {
        this.params.visible = v
        this.lines.visible = v
        v ? this.enter() : this.leave()
    }

    onBPMBeat() { }

    enter(){
        this.isPlaying = true
        this.vStart = 0.0008
        this.vEnd = 0.001
    }
    leave(){
        this.isPlaying = false
        // this.vStart = 0.03
        // this.vEnd = 0.025

    }
    update(){

        this.uniforms.uTime.value = this.experience.time.elapsedTime

        const volumeSmooth = this.experience.audioManager?.volumeSmooth ?? 0
        this.uniforms.uAudioVolume.value = volumeSmooth

        for(let i = 0; i<this.starsCount; i++){

            // this.velocitiesArray[2 * i] = this.velocitiesArray[2 * i] + this.vStart > 0 ? this.velocitiesArray[2 * i] + this.vStart : 0
            // if(this.vStart > 0){

                this.velocitiesArray[2 * i] += this.vStart * this.params.speed
                this.velocitiesArray[2 * i + 1] +=  this.vEnd * this.params.speed
            // }

            // if(this.vStart < 0){
            //     if(this.velocitiesArray[2 * i] - this.velocitiesArray[2 * i + 1] > 0 ){
            //         this.velocitiesArray[2 * i] += this.vStart
            //         this.velocitiesArray[2 * i + 1] +=  this.vEnd
            //     }
            // }

            this.positionArray[6 * i + 2] += this.velocitiesArray[2 * i]
            this.positionArray[6 * i + 5] += this.velocitiesArray[2 * i + 1]
    
    
    
            if(
                this.positionArray[6 * i + 2] > this.experience.camera.instance.position.z + 2 
                && this.positionArray[6 * i + 5] > this.experience.camera.instance.position.z + 2 
                && this.isPlaying
            ){
                const start = - Math.random() * 100 - 1
                this.positionArray[6 * i + 2] = start
                this.positionArray[6 * i + 5] = start
                this.velocitiesArray[2 * i] = 0
                this.velocitiesArray[2 * i + 1] = 0

                // New color assigned at spawn
                const hue = Math.random()
                this.hueArray[2 * i] = hue
                this.hueArray[2 * i + 1] = hue
                this.hues.needsUpdate = true

            }

        }

        this.positions.needsUpdate = true
    
    



        
    }

}