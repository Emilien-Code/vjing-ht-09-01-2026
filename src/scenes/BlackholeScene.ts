import Experience from "../Experience"
import * as THREE from 'three/webgpu'
import GUI from "lil-gui"
import World from "../classes/World"
import { NodeMaterial } from 'three/webgpu'
import * as TSL from 'three/tsl'
import { snoise3 } from "../tsl/noise"

// Untyped: @types/three's TSL typings can't follow this kind of graph building.
const {
    Fn, If, Loop, Break, uniform, uv, positionGeometry, float, vec3, vec4,
    length, normalize, cross, dot, clamp, mix, pow, max, sqrt, step, floor, fract,
    smoothstep, sin, cos, atan,
} = TSL as any

// Black hole scene: a full-screen Schwarzschild black hole rendered by
// integrating each pixel's light path through curved spacetime (Binet
// equation for equatorial null geodesics), with an accretion disk shaded
// for Doppler beaming and gravitational redshift. Written in TSL.
export default class BlackholeScene extends World {

    private exp: Experience
    private scene: THREE.Scene
    private gui: GUI

    private material!: NodeMaterial
    private mesh!: THREE.Mesh
    private uniforms: Record<string, any>
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
            uCamPos: uniform(new THREE.Vector3()),
            uCamRight: uniform(new THREE.Vector3(1, 0, 0)),
            uCamUp: uniform(new THREE.Vector3(0, 1, 0)),
            uCamForward: uniform(new THREE.Vector3(0, 0, -1)),
            uTanFov: uniform(0.4),
            uAspect: uniform(this.exp.sizes.width / this.exp.sizes.height),
            uTime: uniform(0),
            uAudioVolume: uniform(0),
            uKick: uniform(0),
            uRs: uniform(this.blackHoleParams.rs),
            uDiskInner: uniform(this.blackHoleParams.diskInner),
            uDiskOuter: uniform(this.blackHoleParams.diskOuter),
            uCenter: uniform(new THREE.Vector3(this.blackHoleParams.centerX, this.blackHoleParams.centerY, this.blackHoleParams.centerZ)),
            uBgColor: uniform(new THREE.Color(this.blackHoleParams.bgColor)),
            uDiskColor: uniform(new THREE.Color(this.blackHoleParams.diskColor)),
        }

        this.createBlackHoleMaterial()
        this.createBlackHoleMesh()
        this.setupGUI()
    }

    private createBlackHoleMaterial() {
        const u = this.uniforms

        const fbm = (p: any) => {
            // 5 octaves, freq *= 2.05, amp *= 0.55 (unrolled)
            let sum: any = float(0.0)
            let amp = 0.5
            let freq = 1.0
            for (let i = 0; i < 5; i++) {
                sum = sum.add(snoise3(p.mul(freq)).mul(amp))
                freq *= 2.05
                amp *= 0.55
            }
            return sum
        }

        const hash1 = (n: any) => fract(sin(n).mul(43758.5453123))

        const hash3 = (p: any) => {
            const s = dot(p, vec3(127.1, 311.7, 74.7))
            return vec3(hash1(s), hash1(s.add(19.19)), hash1(s.add(71.71)))
        }

        const blackbody = (t01: any) => {
            const c0 = vec3(0.35, 0.05, 0.02)
            const c1 = vec3(1.0, 0.35, 0.08)
            const c2 = vec3(1.0, 0.82, 0.5)
            const c3 = vec3(0.82, 0.9, 1.0)

            const t = clamp(t01, 0.0, 1.0)
            const col1 = mix(c0, c1, smoothstep(0.0, 0.35, t))
            const col2 = mix(col1, c2, smoothstep(0.35, 0.72, t))
            return mix(col2, c3, smoothstep(0.72, 1.0, t))
        }

        const starfield = (dir: any) => {
            const d = dir.mul(420.0)
            const cell = floor(d)
            const h = hash3(cell)

            const isStar = step(0.9965, h.x)
            const brightness = pow(h.y, 24.0).mul(isStar).mul(3.0)
            const starColor = mix(vec3(0.65, 0.75, 1.0), vec3(1.0, 0.86, 0.65), h.z)

            const neb = fbm(dir.mul(2.2))
            const nebColor = mix(vec3(0.015, 0.015, 0.03), vec3(0.09, 0.05, 0.16), clamp(neb.mul(0.5).add(0.5), 0.0, 1.0))

            return starColor.mul(brightness).add(nebColor)
        }

        const fragment = Fn(() => {
            const vUv = uv()
            const ndc = vUv.mul(2.0).sub(1.0)

            const rayDir = normalize(
                u.uCamForward
                    .add(u.uCamRight.mul(ndc.x.mul(u.uTanFov).mul(u.uAspect)))
                    .add(u.uCamUp.mul(ndc.y.mul(u.uTanFov)))
            )

            // Mutable ray state. Everything that is derived from `pos` / `dir`
            // and must keep its value while they change is pinned with
            // .toVar() (see the note in Renderer.buildPipeline).
            const pos = u.uCamPos.sub(u.uCenter).toVar()
            const dir = rayDir.toVar()

            const hVec = cross(pos, dir)
            const h2 = dot(hVec, hVec).toVar()

            const outColor = vec3(0.0).toVar()
            const accAlpha = float(0.0).toVar()
            const captured = float(0.0).toVar()

            Loop(220, () => {
                const r = length(pos).toVar()
                const dt = clamp(r.mul(0.035), 0.006, 0.35).toVar()

                const prevPos = pos.toVar()

                const acc = pos.mul(h2.mul(-1.5).mul(u.uRs).div(pow(max(r, 0.05), 5.0)))
                dir.addAssign(acc.mul(dt))
                pos.addAssign(dir.mul(dt))

                const py0 = prevPos.y
                const py1 = pos.y

                If(py0.mul(py1).lessThan(0.0).and(accAlpha.lessThan(0.98)), () => {
                    const tHit = py0.div(py0.sub(py1))
                    const hitPos = mix(prevPos, pos, tHit)
                    const rHit = length(hitPos.xz)

                    If(rHit.greaterThan(u.uDiskInner).and(rHit.lessThan(u.uDiskOuter)), () => {
                        const norm = clamp(rHit.sub(u.uDiskInner).div(u.uDiskOuter.sub(u.uDiskInner)), 0.0, 1.0)
                        const temp = pow(float(1.0).sub(norm), 0.65)

                        const phi = atan(hitPos.z, hitPos.x)
                        const omega = pow(max(rHit, 0.3), -1.5).mul(2.2).mul(u.uAudioVolume.mul(0.8).add(1.0))
                        const angle = phi.sub(omega.mul(u.uTime))

                        const turbP = vec3(cos(angle).mul(rHit), sin(angle).mul(rHit), u.uTime.mul(0.06))
                        const turb = fbm(turbP.mul(0.9))

                        const density = smoothstep(0.0, 0.12, norm)
                            .mul(smoothstep(1.0, 0.8, norm))
                            .mul(clamp(turb.mul(0.5).add(0.55), 0.0, 1.0))

                        const tangent = normalize(vec3(hitPos.z.negate(), 0.0, hitPos.x))
                        const beta = clamp(sqrt(u.uRs.mul(0.5).div(max(rHit, 0.35))), 0.0, 0.94)
                        const viewDir = normalize(dir.negate())
                        const cosA = dot(tangent, viewDir)
                        const gamma = float(1.0).div(sqrt(max(float(1.0).sub(beta.mul(beta)), 0.001)))
                        const dopp = float(1.0).div(max(gamma.mul(float(1.0).sub(beta.mul(cosA))), 0.05))
                        const beaming = clamp(pow(dopp, 3.0), 0.0, 6.0)

                        const redshift = sqrt(clamp(float(1.0).sub(u.uRs.div(max(rHit, 0.35))), 0.05, 1.0))

                        const audioBoost = float(1.0).add(u.uAudioVolume.mul(1.6)).add(u.uKick.mul(1.4))
                        const diskCol = blackbody(temp).mul(u.uDiskColor).mul(beaming).mul(redshift).mul(density).mul(1.5).mul(audioBoost)

                        outColor.addAssign(diskCol.mul(float(1.0).sub(accAlpha)))
                        accAlpha.assign(clamp(accAlpha.add(density.mul(0.85)), 0.0, 1.0))
                    })
                })

                If(r.lessThan(u.uRs.mul(1.02)), () => {
                    captured.assign(1.0)
                    Break()
                })

                If(r.greaterThan(80.0), () => {
                    Break()
                })
            })

            const bg = starfield(dir).mul(u.uBgColor).mul(float(1.0).sub(captured)).mul(u.uKick.mul(0.5).add(1.0))
            const finalColor = outColor.add(bg.mul(float(1.0).sub(accAlpha)))

            return vec4(finalColor, 1.0)
        })

        this.material = new NodeMaterial()
        this.material.depthTest = false
        this.material.depthWrite = false
        this.material.vertexNode = vec4(positionGeometry.xy, 0.9999, 1.0)
        this.material.fragmentNode = fragment()
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
