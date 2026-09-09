import * as THREE from "three"
import Experience from "../Experience"
// import Time from "../utils/Time"
// import starFragmentShader from "../shaders/star/fragment.glsl"
// import starVertexShader from "../shaders/star/vertex.glsl"
export default class LightSpeed {
    private experience : Experience
    
    private velocities : THREE.BufferAttribute | THREE.InterleavedBufferAttribute
    private positions : THREE.BufferAttribute | THREE.InterleavedBufferAttribute
    private hues : THREE.BufferAttribute | THREE.InterleavedBufferAttribute

    private positionArray : THREE.TypedArray
    private velocitiesArray : THREE.TypedArray
    private hueArray : THREE.TypedArray

    private lineMaterial : THREE.ShaderMaterial
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
        
        
        this.lineMaterial = new THREE.ShaderMaterial({
            vertexShader : `
            varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;
varying float vHue;

uniform float uTime;
uniform float uVelocity;
uniform float uOffset;

attribute float aHue;

// attribute float initialZ;
void main()
{
    // Position
    vec4 modelPosition = modelMatrix * vec4(position, 1.0);
    float initialZ = position.z;
    // modelPosition.z += mod(uTime*uVelocity, 15.0) ;
    // modelPosition.x = 1.0;
    gl_Position = projectionMatrix * viewMatrix * modelPosition;

    // Model normal
    vec3 modelNormal = (modelMatrix * vec4(normal, 0.0)).xyz;





    // Varyings
    vUv = uv;
    vNormal = modelNormal;
    vPosition = modelPosition.xyz;
    vHue = aHue;
}
    `,
            fragmentShader : `
            varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;
varying float vHue;

//Uniforms
uniform float uTime;
uniform float uAudioVolume;
uniform float uRainbow;


vec3 hsv2rgb(vec3 c)
{
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main()
{
    // Multicolor: each star gets its hue once, at spawn (vHue) - fixed for its lifetime.
    float hue = vHue;

    // Sound reactive: louder passages saturate and brighten the colors.
    float saturation = 0.65 + uAudioVolume * 0.35;
    float brightness = 1.0 + uAudioVolume * 1.5;

    // GUI toggle: plain light color, or the full rainbow palette.
    vec3 color = uRainbow > 0.5
        ? hsv2rgb(vec3(hue, saturation, brightness))
        : vec3(brightness);

    // Final color
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
    `,
            uniforms : {
                uTime : new THREE.Uniform(0),
                uVelocity : new THREE.Uniform(10),
                uOffset : new THREE.Uniform(-5),
                uAudioVolume : new THREE.Uniform(0),
                uRainbow : new THREE.Uniform(this.params.colorMode === 'rainbow' ? 1 : 0)
            }
        })

        this.lines = new THREE.LineSegments(geom, this.lineMaterial)
        this.lines.position.z = 0
        this.lines.visible = this.params.visible
        this.experience.scene.add(this.lines)

        const gui = this.experience.helpers.GUI
        const folder = gui.addFolder('Light Speed')
        folder.add(this.params, 'colorMode', ['light', 'rainbow']).name('Color').onChange((v: 'light' | 'rainbow') => {
            this.lineMaterial.uniforms.uRainbow.value = v === 'rainbow' ? 1 : 0
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

        this.lineMaterial.uniforms.uTime.value = this.experience.time.elapsedTime

        const volumeSmooth = this.experience.audioManager?.volumeSmooth ?? 0
        this.lineMaterial.uniforms.uAudioVolume.value = volumeSmooth

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