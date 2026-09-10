
import Experience from "../Experience"
import * as THREE from "three"
import GUI from "lil-gui";
import World from "../classes/World";
import simplex3D from "../shaders/simplex3D";

const vertexShader = `
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vViewDirection;

void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDirection = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = `
${simplex3D}

uniform float time;
uniform vec3 baseColor;
uniform vec3 energyColor;
uniform float energyIntensity;
uniform float noiseScale;
uniform float upSpeed;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vViewDirection;

void main() {
    vec3 pos = vWorldPosition * noiseScale;

    // Three noise layers at different scales/speeds for complex electricity
    float n1 = snoise(pos + vec3(0.0, -time * upSpeed, 0.0));
    float n2 = snoise(pos * 2.1 + vec3(time * 0.4, -time * upSpeed * 0.6, time * 0.3));
    float n3 = snoise(pos * 4.3 - vec3(0.0, time * upSpeed * 1.4, 0.0));

    // Sharp bolt (high exponent = narrow bright veins)
    float bolt = pow(clamp(n1 * 0.5 + 0.5, 0.0, 1.0), 6.0);
    float fine = pow(clamp(n3 * 0.5 + 0.5, 0.0, 1.0), 4.0);
    float ambient = clamp(n2 * 0.5 + 0.5, 0.0, 1.0);

    // Fresnel edge glow
    float fresnel = pow(1.0 - abs(dot(vViewDirection, vWorldNormal)), 2.5);

    float energy = bolt * 1.5 + fresnel * 0.6 + fine * 0.4 + ambient * 0.15;
    energy *= energyIntensity;

    vec3 col = mix(baseColor, energyColor, clamp(energy, 0.0, 1.0));
    // Overbright core on bolt areas for bloom pickup
    col += energyColor * bolt * energyIntensity * 1.5;

    gl_FragColor = vec4(col, 1.0);
}
`

export default class LightStorm extends World {

    private exp: Experience
    private scene: THREE.Scene
    private gui: GUI

    private gltf!: any
    private mat!: THREE.ShaderMaterial

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
        this.mat = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                time: { value: 0 },
                baseColor: { value: new THREE.Color(this.params.baseColor) },
                energyColor: { value: new THREE.Color(this.params.energyColor) },
                energyIntensity: { value: this.params.energyIntensity },
                noiseScale: { value: this.params.noiseScale },
                upSpeed: { value: this.params.upSpeed },
            }
        })
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
        const u = this.mat.uniforms

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
        this.mat.uniforms.time.value += this.exp.time.delta * 0.001

        if (Date.now() - this.beatDownSpeed < 300) {
            this.mat.uniforms.energyIntensity.value = 4
        } else {
            this.mat.uniforms.energyIntensity.value = 0
        }
    }

    leave() {
        this.scene.remove(this.holder)
    }

}