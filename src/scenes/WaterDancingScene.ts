import Experience from "../Experience"
import World from "../classes/World"
import Water from "../components/Water"
import DancingBody from "../components/DancingBody"
import GUI from "lil-gui"
import * as THREE from "three"

const cnoise = `


// Classic Perlin 3D Noise
// by Stefan Gustavson
//
vec4 permute(vec4 x)
{
    return mod(((x*34.0)+1.0)*x, 289.0);
}
vec4 taylorInvSqrt(vec4 r)
{
    return 1.79284291400159 - 0.85373472095314 * r;
}
vec3 fade(vec3 t)
{
    return t*t*t*(t*(t*6.0-15.0)+10.0);
}

float cnoise(vec3 P)
{
    vec3 Pi0 = floor(P); // Integer part for indexing
    vec3 Pi1 = Pi0 + vec3(1.0); // Integer part + 1
    Pi0 = mod(Pi0, 289.0);
    Pi1 = mod(Pi1, 289.0);
    vec3 Pf0 = fract(P); // Fractional part for interpolation
    vec3 Pf1 = Pf0 - vec3(1.0); // Fractional part - 1.0
    vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
    vec4 iy = vec4(Pi0.yy, Pi1.yy);
    vec4 iz0 = Pi0.zzzz;
    vec4 iz1 = Pi1.zzzz;

    vec4 ixy = permute(permute(ix) + iy);
    vec4 ixy0 = permute(ixy + iz0);
    vec4 ixy1 = permute(ixy + iz1);

    vec4 gx0 = ixy0 / 7.0;
    vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5;
    gx0 = fract(gx0);
    vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
    vec4 sz0 = step(gz0, vec4(0.0));
    gx0 -= sz0 * (step(0.0, gx0) - 0.5);
    gy0 -= sz0 * (step(0.0, gy0) - 0.5);

    vec4 gx1 = ixy1 / 7.0;
    vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5;
    gx1 = fract(gx1);
    vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
    vec4 sz1 = step(gz1, vec4(0.0));
    gx1 -= sz1 * (step(0.0, gx1) - 0.5);
    gy1 -= sz1 * (step(0.0, gy1) - 0.5);

    vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
    vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
    vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
    vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
    vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
    vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
    vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
    vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);

    vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
    g000 *= norm0.x;
    g010 *= norm0.y;
    g100 *= norm0.z;
    g110 *= norm0.w;
    vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
    g001 *= norm1.x;
    g011 *= norm1.y;
    g101 *= norm1.z;
    g111 *= norm1.w;

    float n000 = dot(g000, Pf0);
    float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
    float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
    float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
    float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
    float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
    float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
    float n111 = dot(g111, Pf1);

    vec3 fade_xyz = fade(Pf0);
    vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
    vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
    float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
    return 2.2 * n_xyz;
}

`

export default class WaterDancingScene extends World {

    private exp: Experience
    private water: Water
    private dancingBody: DancingBody
    private guiFolder!: GUI
    private pathMesh!: THREE.Mesh
    private curve!: THREE.CatmullRomCurve3
    private visible = false
    private progressController!: any
    private params = {
        autoPlay: true,
        speed: 0.03, // loops per second
        progress: 0, // manual camera travel progress along the path (0-1)
    }

    private floorGeo!: THREE.PlaneGeometry
    private floorMesh!: THREE.Mesh
    private floorMat!: THREE.ShaderMaterial
    private floorUniforms: { [key: string]: THREE.IUniform }
    private floorGuiFolder!: GUI
    private floorParams = {
        noiseScale: 100,
        color1: '#5c5c5c',
        color2: '#000000',
        color3: '#dedede',
        elevation: 31,
        elevationIntensity: 1.48,
        grainAmount: 0.052,
        grainDensity: 5.0,
        beatBoostAmount: 59,
        beatDuration: 1.26,
        footBaseRadius: 0.06,
        footRippleSpeed: 0.5, // units/sec the ripple radius grows
        footRippleDuration: 0.9, // seconds for a ripple to fully fade out
        footBumpHeight: 0.06,
        footGroundProximity: 0.35, // how close a foot's lowest point must be to the floor to count as a step
        bodyCircleRadius: 0.8,
    }

    private floorBeatPhase: number = 0
    private floorBeatCounter: number = 0

    private leftFootPos: THREE.Vector3 = new THREE.Vector3()
    private rightFootPos: THREE.Vector3 = new THREE.Vector3()
    private hipsPos: THREE.Vector3 = new THREE.Vector3()

    private leftRippleAge: number | null = null
    private rightRippleAge: number | null = null
    private leftRippleOrigin: THREE.Vector3 = new THREE.Vector3()
    private rightRippleOrigin: THREE.Vector3 = new THREE.Vector3()

    // one-frame history of each foot's Y to detect the exact moment it hits the bottom of its arc
    private leftPrevY: number = Infinity
    private leftPrevPrevY: number = Infinity
    private leftPrevPos: THREE.Vector3 = new THREE.Vector3()
    private rightPrevY: number = Infinity
    private rightPrevPrevY: number = Infinity
    private rightPrevPos: THREE.Vector3 = new THREE.Vector3()

    constructor(exp: Experience, water: Water) {
        super()
        this.exp = exp
        this.water = water
        this.dancingBody = new DancingBody(exp)

        this.floorUniforms = {
            uTime: { value: 0 },
            uNoiseScale: { value: this.floorParams.noiseScale },
            uElevation: { value: this.floorParams.elevation },
            uElevationIntensity: { value: this.floorParams.elevationIntensity },
            uColor1: { value: new THREE.Color(this.floorParams.color1) },
            uColor2: { value: new THREE.Color(this.floorParams.color2) },
            uColor3: { value: new THREE.Color(this.floorParams.color3) },
            uGrainAmount: { value: this.floorParams.grainAmount },
            uGrainDensity: { value: this.floorParams.grainDensity },
            uLeftFootPos: { value: new THREE.Vector3() },
            uRightFootPos: { value: new THREE.Vector3() },
            uFootTouchL: { value: 0 },
            uFootTouchR: { value: 0 },
            uLeftFootRadius: { value: this.floorParams.footBaseRadius },
            uRightFootRadius: { value: this.floorParams.footBaseRadius },
            uFootBumpHeight: { value: this.floorParams.footBumpHeight },
            uBodyCirclePos: { value: new THREE.Vector3() },
            uBodyCircleRadius: { value: this.floorParams.bodyCircleRadius },
        }

        this.setupPath()
        this.createFloor()
        this.setupGUI()
        this.setVisible(false)
    }

    private createFloor() {
        this.floorGeo = new THREE.PlaneGeometry(40, 40, 256, 256)

        this.floorMat = new THREE.ShaderMaterial({
            wireframe: false,
            uniforms: this.floorUniforms,
            vertexShader: `
            uniform float uTime;
            uniform float uElevation;
            uniform float uNoiseScale;

            uniform vec3 uColor1;
            uniform vec3 uColor2;
            uniform vec3 uColor3;

            uniform vec3 uLeftFootPos;
            uniform vec3 uRightFootPos;
            uniform float uFootTouchL;
            uniform float uFootTouchR;
            uniform float uLeftFootRadius;
            uniform float uRightFootRadius;
            uniform float uFootBumpHeight;

            varying float vElevation;
            varying float vNoise;
            varying float vFof;
            varying vec3 vNormal;
            varying vec3 vColor;
            varying vec3 vWorldPos;

            ${cnoise}

            float exponentialIn(float t) {
  return t == 0.0 ? t : pow(2.0, 10.0 * (t - 1.0));
}

            void main()
            {
                vec4 modelPosition = modelMatrix * vec4(position, 1.0);


                //FRESNEL
                vec3 viewDirection = normalize(modelPosition.xyz - cameraPosition);
                float fresnel = dot(viewDirection, normal) + 1.0;
                // fresnel = pow(fresnel, 10.0);


                float noiseValue = cnoise(vec3(modelPosition.xz * 200000.0, uTime * 0.5));
                vec3 displaced = normalize(normal) * exponentialIn(noiseValue) * fresnel * uElevation;

                //FOOTSTEPS
                float footDistL = length(modelPosition.xz - uLeftFootPos.xz);
                float footDistR = length(modelPosition.xz - uRightFootPos.xz);
                float footGlowL = uFootTouchL * smoothstep(uLeftFootRadius, 0.0, footDistL);
                float footGlowR = uFootTouchR * smoothstep(uRightFootRadius, 0.0, footDistR);
                float footGlow = clamp(footGlowL + footGlowR, 0.0, 1.0);
                displaced += normalize(normal) * footGlow * uFootBumpHeight;

                 modelPosition.xyz += displaced;

                vNoise = noiseValue;
                vElevation = noiseValue * fresnel;
                vNormal = normalize(position);
                vWorldPos = modelPosition.xyz;




                vFof = fresnel;



                float color_noise_value = cnoise(vec3(modelPosition * .5 + uTime *0.2));

                vec3 colorLow  = mix(uColor1, uColor2, color_noise_value);
                vec3 colorHigh = mix(uColor2, uColor3, color_noise_value);
                vec3 color = mix(colorLow, colorHigh, color_noise_value);

                vColor = color;


                vec4 viewPosition = viewMatrix * modelPosition;
                vec4 projectedPosition = projectionMatrix * viewPosition;
                gl_Position = projectedPosition;
            }
            `,
            fragmentShader: `
            uniform float uTime;
            uniform float uElevationIntensity;
            uniform vec3 uColor1;
            uniform vec3 uColor2;
            uniform vec3 uColor3;
            uniform float uGrainAmount;
            uniform float uGrainDensity;
            uniform vec3 uLeftFootPos;
            uniform vec3 uRightFootPos;
            uniform float uFootTouchL;
            uniform float uFootTouchR;
            uniform float uLeftFootRadius;
            uniform float uRightFootRadius;
            uniform vec3 uBodyCirclePos;
            uniform float uBodyCircleRadius;

            varying float vElevation;
            varying float vNoise;
            varying vec3 vNormal;
            varying float vFof;
            varying vec3 vColor;
            varying vec3 vWorldPos;

            float randd(vec2 co) {
                return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
            }

            void main() {

                float brightness = 1.0 + vElevation * uElevationIntensity;
                vec3 noiseColor = clamp(vColor * brightness, 0.0, 1.0);

                float resolution = 1.0 / uGrainDensity;
                vec2 uv = gl_FragCoord.xy + uTime ;
                vec2 lowresxy = vec2(floor(uv.x / resolution), floor(uv.y / resolution));
                float grain = randd(lowresxy) * 2.0 - 1.0;
                noiseColor = clamp(noiseColor + grain * uGrainAmount, 0.0, 1.0);

                //FOOTSTEPS (per-pixel so the glow stays smooth regardless of mesh resolution)
                float footDistL = length(vWorldPos.xz - uLeftFootPos.xz);
                float footDistR = length(vWorldPos.xz - uRightFootPos.xz);
                float footGlowL = uFootTouchL * smoothstep(uLeftFootRadius, 0.0, footDistL);
                float footGlowR = uFootTouchR * smoothstep(uRightFootRadius, 0.0, footDistR);

                //BODY CIRCLE (same reveal technique, always on, centered under the body)
                float bodyDist = length(vWorldPos.xz - uBodyCirclePos.xz);
                float bodyGlow = smoothstep(uBodyCircleRadius, 0.0, bodyDist);

                float footGlow = clamp(footGlowL + footGlowR + bodyGlow, 0.0, 1.0);

                vec3 color = mix(vec3(0.0), noiseColor, footGlow);

                gl_FragColor = vec4(color, 1.0);
                #include <colorspace_fragment>
            }
            `
        })

        this.floorMesh = new THREE.Mesh(this.floorGeo, this.floorMat)
        this.floorMesh.rotation.x = -Math.PI / 2
        this.floorMesh.position.y = this.dancingBody.feetY - 0.05
        this.exp.scene.add(this.floorMesh)
    }

    private setupPath() {
        this.curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(3.76, 2.85, -0.63),
            new THREE.Vector3(5.08, 1.15, 6.9),
            new THREE.Vector3(2.05, 1.68, 0.26),
            new THREE.Vector3(1.46, 1.45, -0.48),
        ], true)

        const geometry = new THREE.TubeGeometry(this.curve, 200, 0.02, 8, true)
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff })
        this.pathMesh = new THREE.Mesh(geometry, material)
        this.exp.scene.add(this.pathMesh)
    }

    private setupGUI() {
        this.guiFolder = this.exp.helpers.GUI.addFolder('WaterDancing')

        this.guiFolder.add(this.params, 'autoPlay').name('Auto Travel')
        this.guiFolder.add(this.params, 'speed', 0, 0.2, 0.001).name('Travel Speed')
        this.progressController = this.guiFolder.add(this.params, 'progress', 0, 1, 0.001).name('Travel Progress')

        this.floorGuiFolder = this.guiFolder.addFolder('Floor')

        const noiseFolder = this.floorGuiFolder.addFolder('Noise')
        noiseFolder.add(this.floorParams, 'noiseScale', 0.1, 100.0, 0.1).onChange((v: number) => {
            this.floorUniforms.uNoiseScale.value = v
        })
        noiseFolder.add(this.floorParams, 'elevation', 0.0, 100.0, 1).onChange((v: number) => {
            this.floorUniforms.uElevation.value = v
        })

        const gradientFolder = this.floorGuiFolder.addFolder('Gradient')
        gradientFolder.addColor(this.floorParams, 'color1').name('Color A').onChange((v: string) => {
            this.floorUniforms.uColor1.value.set(v)
        })
        gradientFolder.addColor(this.floorParams, 'color2').name('Color B').onChange((v: string) => {
            this.floorUniforms.uColor2.value.set(v)
        })
        gradientFolder.addColor(this.floorParams, 'color3').name('Color C').onChange((v: string) => {
            this.floorUniforms.uColor3.value.set(v)
        })
        gradientFolder.add(this.floorParams, 'elevationIntensity', 0.0, 2.0, 0.01).name('Elevation Intensity').onChange((v: number) => {
            this.floorUniforms.uElevationIntensity.value = v
        })

        const grainFolder = this.floorGuiFolder.addFolder('Grain')
        grainFolder.add(this.floorParams, 'grainAmount', 0.0, 0.5, 0.001).name('Amount').onChange((v: number) => {
            this.floorUniforms.uGrainAmount.value = v
        })
        grainFolder.add(this.floorParams, 'grainDensity', 0.1, 5.0, 0.1).name('Density').onChange((v: number) => {
            this.floorUniforms.uGrainDensity.value = v
        })

        const beatFolder = this.floorGuiFolder.addFolder('Beat')
        beatFolder.add(this.floorParams, 'beatBoostAmount', 0, 500, 1).name('Boost Amount')
        beatFolder.add(this.floorParams, 'beatDuration', 0.05, 2, 0.01).name('Duration')

        const footFolder = this.floorGuiFolder.addFolder('Footsteps')
        footFolder.add(this.floorParams, 'footBaseRadius', 0.01, 1, 0.01).name('Base Radius')
        footFolder.add(this.floorParams, 'footRippleSpeed', 0, 3, 0.01).name('Ripple Speed')
        footFolder.add(this.floorParams, 'footRippleDuration', 0.05, 3, 0.01).name('Ripple Duration')
        footFolder.add(this.floorParams, 'footBumpHeight', 0, 2, 0.01).name('Bump Height').onChange((v: number) => {
            this.floorUniforms.uFootBumpHeight.value = v
        })
        footFolder.add(this.floorParams, 'footGroundProximity', 0.05, 2, 0.01).name('Ground Proximity')

        this.floorGuiFolder.add(this.floorParams, 'bodyCircleRadius', 0.05, 5, 0.01).name('Body Circle Radius').onChange((v: number) => {
            this.floorUniforms.uBodyCircleRadius.value = v
        })

        this.guiFolder.hide()
    }

    setVisible(v: boolean) {
        this.visible = v
        this.water.water.visible = false
        this.dancingBody.setVisible(v)
        this.pathMesh.visible = false
        this.floorMesh.visible = v
        this.showGUI(v)
    }

    showGUI(v: boolean) {
        v ? this.guiFolder.show() : this.guiFolder.hide()
        this.dancingBody.showGUI(v)
    }

    onBPMBeat() {
        this.dancingBody.onBPMBeat()

        this.floorBeatCounter++
        if (this.floorBeatCounter % 2 === 0) this.floorBeatPhase = 1.0
    }

    update() {
        this.dancingBody.update()

        // this.floorUniforms.uTime.value = this.exp.time.elapsedTime / 1000

        const delta = this.exp.time.delta / 1000
        if (this.floorBeatPhase > 0) {
            this.floorBeatPhase = Math.max(0, this.floorBeatPhase - delta / this.floorParams.beatDuration)
        }
        // const easeOutCirc = (x: number) => Math.sqrt(1 - Math.pow(x - 1, 2))
        // const floorBoost = this.floorBeatPhase > 0
        //     ? this.floorParams.beatBoostAmount * (1 - easeOutCirc(1 - this.floorBeatPhase))
        //     : 0
        this.floorUniforms.uElevation.value = this.floorParams.elevation //+ floorBoost

        this.dancingBody.getLeftFootPosition(this.leftFootPos)
        this.dancingBody.getRightFootPosition(this.rightFootPos)
        this.dancingBody.getHipsPosition(this.hipsPos)
        this.floorUniforms.uBodyCirclePos.value.copy(this.hipsPos)

        const floorY = this.floorMesh.position.y

        // a foot "lands" the moment it hits the bottom of its arc (Y stops falling and starts rising),
        // not when it crosses some fixed height above the floor - that kept the ripple out of sync
        // with when the foot visually reaches the ground.
        const leftIsLocalMin = this.leftPrevY <= this.leftPrevPrevY && this.leftPrevY <= this.leftFootPos.y
        const leftNearFloor = (this.leftPrevY - floorY) < this.floorParams.footGroundProximity
        if (leftIsLocalMin && leftNearFloor && this.leftRippleAge === null) {
            this.leftRippleAge = 0
            this.leftRippleOrigin.copy(this.leftPrevPos)
        }
        this.leftPrevPrevY = this.leftPrevY
        this.leftPrevY = this.leftFootPos.y
        this.leftPrevPos.copy(this.leftFootPos)

        const rightIsLocalMin = this.rightPrevY <= this.rightPrevPrevY && this.rightPrevY <= this.rightFootPos.y
        const rightNearFloor = (this.rightPrevY - floorY) < this.floorParams.footGroundProximity
        if (rightIsLocalMin && rightNearFloor && this.rightRippleAge === null) {
            this.rightRippleAge = 0
            this.rightRippleOrigin.copy(this.rightPrevPos)
        }
        this.rightPrevPrevY = this.rightPrevY
        this.rightPrevY = this.rightFootPos.y
        this.rightPrevPos.copy(this.rightFootPos)

        if (this.leftRippleAge !== null) {
            this.leftRippleAge += delta
            if (this.leftRippleAge > this.floorParams.footRippleDuration) this.leftRippleAge = null
        }
        if (this.rightRippleAge !== null) {
            this.rightRippleAge += delta
            if (this.rightRippleAge > this.floorParams.footRippleDuration) this.rightRippleAge = null
        }

        if (this.leftRippleAge !== null) {
            const t = this.leftRippleAge / this.floorParams.footRippleDuration
            this.floorUniforms.uLeftFootPos.value.copy(this.leftRippleOrigin)
            this.floorUniforms.uLeftFootRadius.value = this.floorParams.footBaseRadius + t * this.floorParams.footRippleSpeed * this.floorParams.footRippleDuration
            this.floorUniforms.uFootTouchL.value = 1 - t
        } else {
            this.floorUniforms.uFootTouchL.value = 0
        }

        if (this.rightRippleAge !== null) {
            const t = this.rightRippleAge / this.floorParams.footRippleDuration
            this.floorUniforms.uRightFootPos.value.copy(this.rightRippleOrigin)
            this.floorUniforms.uRightFootRadius.value = this.floorParams.footBaseRadius + t * this.floorParams.footRippleSpeed * this.floorParams.footRippleDuration
            this.floorUniforms.uFootTouchR.value = 1 - t
        } else {
            this.floorUniforms.uFootTouchR.value = 0
        }

        if (!this.visible) return


        if (this.params.autoPlay) {
            // this.params.progress = ((this.exp.time.elapsedTime / 1000) * this.params.speed) % 1
            this.progressController.updateDisplay()
        }

        const camPos = this.curve.getPoint(this.params.progress)
        this.exp.camera.instance.position.copy(camPos)
        this.exp.camera.instance.lookAt(this.dancingBody.bodyCenter)
    }

    leave() {
        this.dancingBody.leave()
    }
}
