import Experience from "../Experience"
import * as THREE from "three"
import GUI from "lil-gui"
import World from "../classes/World"
import simplex3D from "../shaders/simplex3D"

// Black hole scene: a full-screen Schwarzschild black hole rendered by
// integrating each pixel's light path through curved spacetime (Binet
// equation for equatorial null geodesics), with an accretion disk shaded
// for Doppler beaming and gravitational redshift. Shader ported from a
// TSL/WebGPU raymarcher to plain GLSL since this project's renderer is a
// classic WebGLRenderer.
export default class BlackholeScene extends World {

    private exp: Experience
    private scene: THREE.Scene
    private gui: GUI

    private material!: THREE.ShaderMaterial
    private mesh!: THREE.Mesh
    private uniforms: { [key: string]: THREE.IUniform }
    private visible = false

    private blackHoleParams = {
        rs: 0.5,
        diskInner: 1,
        diskOuter: 9,
        centerX: 0,
        centerY: -0.1,
        centerZ: -37.6,
        timeScale: 1.0,
        bgColor: '#25e960',
        diskColor: '#11b706',
    }

    private cameraParams = {
        distance: 46.1,
        height: 0.1,
        orbitYawSpeed: 0.025,
        orbitPitchSpeed: 0.035,
        pitchAmplitude: 35,
        wiggleSpeed: 0.35,
        wiggleAmount: 0.015,
        rollAmount: 1.5,
        audioWiggle: 0.01,
        kickPunch: 0.02,
        soundReactive: true,
        wiggleX: 0,
        wiggleY: 0,
        wiggleZ: 0,
    }
    private cameraOffset = new THREE.Vector3()

    constructor(exp: Experience) {
        super()
        this.exp = exp
        this.scene = exp.scene
        this.gui = this.exp.helpers.GUI

        this.uniforms = {
            uCamPos: { value: new THREE.Vector3() },
            uCamRight: { value: new THREE.Vector3(1, 0, 0) },
            uCamUp: { value: new THREE.Vector3(0, 1, 0) },
            uCamForward: { value: new THREE.Vector3(0, 0, -1) },
            uTanFov: { value: 0.4 },
            uAspect: { value: this.exp.sizes.width / this.exp.sizes.height },
            uTime: { value: 0 },
            uAudioVolume: { value: 0 },
            uKick: { value: 0 },
            uRs: { value: this.blackHoleParams.rs },
            uDiskInner: { value: this.blackHoleParams.diskInner },
            uDiskOuter: { value: this.blackHoleParams.diskOuter },
            uCenter: { value: new THREE.Vector3(this.blackHoleParams.centerX, this.blackHoleParams.centerY, this.blackHoleParams.centerZ) },
            uBgColor: { value: new THREE.Color(this.blackHoleParams.bgColor) },
            uDiskColor: { value: new THREE.Color(this.blackHoleParams.diskColor) },
        }

        this.createBlackHoleMaterial()
        this.createBlackHoleMesh()
        this.setupGUI()
    }

    private createBlackHoleMaterial() {
        this.material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            depthTest: false,
            depthWrite: false,
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.9999, 1.0);
                }
            `,
            fragmentShader: `
                varying vec2 vUv;

                uniform vec3 uCamPos;
                uniform vec3 uCamRight;
                uniform vec3 uCamUp;
                uniform vec3 uCamForward;
                uniform float uTanFov;
                uniform float uAspect;
                uniform float uTime;
                uniform float uAudioVolume;
                uniform float uKick;
                uniform float uRs;
                uniform float uDiskInner;
                uniform float uDiskOuter;
                uniform vec3 uCenter;
                uniform vec3 uBgColor;
                uniform vec3 uDiskColor;

                ${simplex3D}

                float fbm(vec3 p) {
                    float amp = 0.5;
                    float freq = 1.0;
                    float sum = 0.0;
                    for (int i = 0; i < 5; i++) {
                        sum += amp * snoise(p * freq);
                        freq *= 2.05;
                        amp *= 0.55;
                    }
                    return sum;
                }

                float hash1(float n) {
                    return fract(sin(n) * 43758.5453123);
                }

                vec3 hash3(vec3 p) {
                    float s = dot(p, vec3(127.1, 311.7, 74.7));
                    return vec3(hash1(s), hash1(s + 19.19), hash1(s + 71.71));
                }

                vec3 blackbody(float t01) {
                    vec3 c0 = vec3(0.35, 0.05, 0.02);
                    vec3 c1 = vec3(1.0, 0.35, 0.08);
                    vec3 c2 = vec3(1.0, 0.82, 0.5);
                    vec3 c3 = vec3(0.82, 0.9, 1.0);

                    float t = clamp(t01, 0.0, 1.0);
                    vec3 col = mix(c0, c1, smoothstep(0.0, 0.35, t));
                    col = mix(col, c2, smoothstep(0.35, 0.72, t));
                    col = mix(col, c3, smoothstep(0.72, 1.0, t));
                    return col;
                }

                vec3 starfield(vec3 dir) {
                    vec3 d = dir * 420.0;
                    vec3 cell = floor(d);
                    vec3 h = hash3(cell);

                    float isStar = step(0.9965, h.x);
                    float brightness = pow(h.y, 24.0) * isStar * 3.0;
                    vec3 starColor = mix(vec3(0.65, 0.75, 1.0), vec3(1.0, 0.86, 0.65), h.z);

                    float neb = fbm(dir * 2.2);
                    vec3 nebColor = mix(vec3(0.015, 0.015, 0.03), vec3(0.09, 0.05, 0.16), clamp(neb * 0.5 + 0.5, 0.0, 1.0));

                    return starColor * brightness + nebColor;
                }

                void main() {
                    vec2 ndc = vUv * 2.0 - 1.0;

                    vec3 rayDir = normalize(
                        uCamForward
                        + uCamRight * (ndc.x * uTanFov * uAspect)
                        + uCamUp * (ndc.y * uTanFov)
                    );

                    vec3 pos = uCamPos - uCenter;
                    vec3 dir = rayDir;

                    vec3 hVec = cross(pos, dir);
                    float h2 = dot(hVec, hVec);

                    vec3 outColor = vec3(0.0);
                    float accAlpha = 0.0;
                    float captured = 0.0;

                    for (int i = 0; i < 220; i++) {

                        float r = length(pos);
                        float dt = clamp(r * 0.035, 0.006, 0.35);

                        vec3 prevPos = pos;

                        vec3 acc = pos * (h2 * -1.5 * uRs / pow(max(r, 0.05), 5.0));
                        dir += acc * dt;
                        pos += dir * dt;

                        float py0 = prevPos.y;
                        float py1 = pos.y;

                        if (py0 * py1 < 0.0 && accAlpha < 0.98) {

                            float tHit = py0 / (py0 - py1);
                            vec3 hitPos = mix(prevPos, pos, tHit);
                            float rHit = length(hitPos.xz);

                            if (rHit > uDiskInner && rHit < uDiskOuter) {

                                float norm = clamp((rHit - uDiskInner) / (uDiskOuter - uDiskInner), 0.0, 1.0);
                                float temp = pow(1.0 - norm, 0.65);

                                float phi = atan(hitPos.z, hitPos.x);
                                float omega = pow(max(rHit, 0.3), -1.5) * 2.2 * (1.0 + uAudioVolume * 0.8);
                                float angle = phi - omega * uTime;

                                vec3 turbP = vec3(cos(angle) * rHit, sin(angle) * rHit, uTime * 0.06);
                                float turb = fbm(turbP * 0.9);

                                float density = smoothstep(0.0, 0.12, norm)
                                    * smoothstep(1.0, 0.8, norm)
                                    * clamp(turb * 0.5 + 0.55, 0.0, 1.0);

                                vec3 tangent = normalize(vec3(-hitPos.z, 0.0, hitPos.x));
                                float beta = clamp(sqrt(uRs * 0.5 / max(rHit, 0.35)), 0.0, 0.94);
                                vec3 viewDir = normalize(-dir);
                                float cosA = dot(tangent, viewDir);
                                float gamma = 1.0 / sqrt(max(1.0 - beta * beta, 0.001));
                                float dopp = 1.0 / max(gamma * (1.0 - beta * cosA), 0.05);
                                float beaming = clamp(pow(dopp, 3.0), 0.0, 6.0);

                                float redshift = sqrt(clamp(1.0 - uRs / max(rHit, 0.35), 0.05, 1.0));

                                float audioBoost = 1.0 + uAudioVolume * 1.6 + uKick * 1.4;
                                vec3 diskCol = blackbody(temp) * uDiskColor * beaming * redshift * density * 1.5 * audioBoost;

                                outColor += diskCol * (1.0 - accAlpha);
                                accAlpha = clamp(accAlpha + density * 0.85, 0.0, 1.0);

                            }

                        }

                        if (r < uRs * 1.02) {
                            captured = 1.0;
                            break;
                        }

                        if (r > 80.0) {
                            break;
                        }

                    }

                    vec3 bg = starfield(dir) * uBgColor * (1.0 - captured) * (1.0 + uKick * 0.5);
                    vec3 finalColor = outColor + bg * (1.0 - accAlpha);

                    gl_FragColor = vec4(finalColor, 1.0);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }
            `
        })
    }

    private createBlackHoleMesh() {
        this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
        this.mesh.frustumCulled = false
        this.mesh.renderOrder = -1000
        this.scene.add(this.mesh)
    }

    private setupGUI() {
        const blackHoleFolder = this.gui.addFolder('Black Hole')
        blackHoleFolder.add(this.blackHoleParams, 'rs', 0.1, 5, 0.05).name('Rs').onChange((v: number) => {
            this.uniforms.uRs.value = v
        })
        blackHoleFolder.add(this.blackHoleParams, 'diskInner', 1, 10, 0.1).name('disk inner').onChange((v: number) => {
            this.uniforms.uDiskInner.value = v
        })
        blackHoleFolder.add(this.blackHoleParams, 'diskOuter', 2, 30, 0.1).name('disk outer').onChange((v: number) => {
            this.uniforms.uDiskOuter.value = v
        })
        blackHoleFolder.add(this.blackHoleParams, 'centerX', -20, 20, 0.1).name('center x').onChange((v: number) => {
            this.uniforms.uCenter.value.x = v
        })
        blackHoleFolder.add(this.blackHoleParams, 'centerY', -20, 20, 0.1).name('center y').onChange((v: number) => {
            this.uniforms.uCenter.value.y = v
        })
        blackHoleFolder.add(this.blackHoleParams, 'centerZ', -100, 10, 0.1).name('center z').onChange((v: number) => {
            this.uniforms.uCenter.value.z = v
        })
        blackHoleFolder.add(this.blackHoleParams, 'timeScale', 0, 3, 0.01).name('time scale')
        blackHoleFolder.addColor(this.blackHoleParams, 'bgColor').name('background color').onChange((v: string) => {
            this.uniforms.uBgColor.value.set(v)
        })
        blackHoleFolder.addColor(this.blackHoleParams, 'diskColor').name('disk color').onChange((v: string) => {
            this.uniforms.uDiskColor.value.set(v)
        })
        blackHoleFolder.close()

        const cameraFolder = this.gui.addFolder('blackhole_camera')
        cameraFolder.add(this.cameraParams, 'distance', 1, 100, 0.1).name('distance')
        cameraFolder.add(this.cameraParams, 'height', -20, 20, 0.1).name('height')
        cameraFolder.add(this.cameraParams, 'orbitYawSpeed', -0.5, 0.5, 0.001).name('orbit yaw speed')
        cameraFolder.add(this.cameraParams, 'orbitPitchSpeed', 0, 0.5, 0.001).name('orbit pitch speed')
        cameraFolder.add(this.cameraParams, 'pitchAmplitude', 0, 60, 1).name('pitch amplitude (deg)')
        cameraFolder.add(this.cameraParams, 'wiggleSpeed', 0, 3, 0.01).name('wiggle speed')
        cameraFolder.add(this.cameraParams, 'wiggleAmount', 0, 0.3, 0.005).name('wiggle amount')
        cameraFolder.add(this.cameraParams, 'rollAmount', 0, 20, 0.5).name('roll amount (deg)')
        cameraFolder.add(this.cameraParams, 'soundReactive').name('sound reactive')
        cameraFolder.add(this.cameraParams, 'audioWiggle', 0, 0.3, 0.005).name('audio wiggle')
        cameraFolder.add(this.cameraParams, 'kickPunch', 0, 0.5, 0.005).name('kick punch')
        cameraFolder.add(this.cameraParams, 'wiggleX', 0, 5, 0.01).name('wiggle X')
        cameraFolder.add(this.cameraParams, 'wiggleY', 0, 5, 0.01).name('wiggle Y')
        cameraFolder.add(this.cameraParams, 'wiggleZ', 0, 5, 0.01).name('wiggle Z')
        cameraFolder.close()
    }

    showGUI(_v: boolean) { }

    setVisible(v: boolean) {
        this.visible = v
        this.mesh.visible = v
    }

    onBPMBeat() { }

    update() {
        // Owns the real camera while active (orbits it for the raymarch), so
        // it must not fight other scenes for it while hidden.
        if (!this.visible) return

        const cam = this.exp.camera.instance
        const center = this.uniforms.uCenter.value
        const t = this.exp.time.elapsedTime / 1000
        const volume = this.exp.audioManager?.volumeSmooth ?? 0
        const kick = this.exp.bpmManager?.pulse ?? 0
        const cp = this.cameraParams

        const audioMul = cp.soundReactive ? 1 : 0
        const pitchAmp = THREE.MathUtils.degToRad(cp.pitchAmplitude)

        // Full spherical orbit: yaw spins freely around the disk, pitch swings
        // between near-overhead and near-underneath so the light bending and
        // disk can be enjoyed from any angle, not just an equatorial wobble.
        const yaw = t * cp.orbitYawSpeed
        const pitch = Math.sin(t * cp.orbitPitchSpeed) * pitchAmp

        const wiggleYaw = Math.sin(t * cp.wiggleSpeed) * cp.wiggleAmount
            + Math.sin(t * 8.3) * volume * cp.audioWiggle * audioMul
            + Math.sin(t * 21.0) * kick * cp.kickPunch * audioMul
        const wigglePitch = Math.cos(t * cp.wiggleSpeed * 0.8) * cp.wiggleAmount
            + Math.cos(t * 9.7) * volume * cp.audioWiggle * audioMul
            + Math.cos(t * 17.0) * kick * cp.kickPunch * audioMul
        const wiggleRoll = Math.sin(t * cp.wiggleSpeed * 0.5) * THREE.MathUtils.degToRad(cp.rollAmount)

        const finalYaw = yaw + wiggleYaw
        // stay just short of the poles to avoid the lookAt() gimbal singularity
        const finalPitch = THREE.MathUtils.clamp(pitch + wigglePitch, -Math.PI / 2 + 0.03, Math.PI / 2 - 0.03)

        const cosPitch = Math.cos(finalPitch)
        this.cameraOffset.set(
            cp.distance * cosPitch * Math.sin(finalYaw),
            cp.distance * Math.sin(finalPitch) + cp.height,
            cp.distance * cosPitch * Math.cos(finalYaw)
        )

        const posWiggleX = Math.sin(t * cp.wiggleSpeed * 1.3) * cp.wiggleX
        const posWiggleY = Math.sin(t * cp.wiggleSpeed * 0.9 + 1.5) * cp.wiggleY
        const posWiggleZ = Math.sin(t * cp.wiggleSpeed * 0.7 + 3.0) * cp.wiggleZ

        cam.position.copy(center).add(this.cameraOffset)
        cam.position.x += posWiggleX
        cam.position.y += posWiggleY
        cam.position.z += posWiggleZ
        cam.lookAt(center)
        cam.rotateZ(wiggleRoll)
        cam.updateMatrixWorld(true)

        const m = cam.matrixWorld

        this.uniforms.uCamPos.value.copy(cam.position)
        this.uniforms.uCamRight.value.setFromMatrixColumn(m, 0).normalize()
        this.uniforms.uCamUp.value.setFromMatrixColumn(m, 1).normalize()
        this.uniforms.uCamForward.value.set(-m.elements[8], -m.elements[9], -m.elements[10]).normalize()
        this.uniforms.uTanFov.value = Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5)
        this.uniforms.uAspect.value = cam.aspect
        this.uniforms.uTime.value = (this.exp.time.elapsedTime / 1000) * this.blackHoleParams.timeScale

        this.uniforms.uAudioVolume.value = this.exp.audioManager?.volumeSmooth ?? 0
        this.uniforms.uKick.value = this.exp.bpmManager?.pulse ?? 0
    }

    leave() { }
}
