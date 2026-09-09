import Experience from "../Experience"
import * as THREE from "three"
import GUI from "lil-gui";
import World from "../classes/World";


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


export default class Sphere extends World {

    private exp: Experience
    private scene: THREE.Scene
    private gui: GUI

    private boxes: THREE.Mesh[] = []
    private geo!: THREE.SphereGeometry
    private mesh!: THREE.Mesh
    private mat!: THREE.ShaderMaterial
    private uniforms: { [key: string]: THREE.IUniform }

    private holder: THREE.Object3D
    private guiFolder!: GUI
    private params = {
        noiseScale: 100,
        color1: '#43ae0a',
        color2: '#000000',
        color3: '#dedede',
        elevation: 31,
        elevationIntensity: 1.48,
        grainAmount: 0.052,
        grainDensity: 5.0,
        beatBoostAmount: 59,
        beatDuration: 1.26,
    }

    private beatPhase: number = 0
    private beatCounter: number = 0

    constructor(exp: Experience) {
        super()
        this.exp = exp
        this.scene = exp.scene
        this.gui = this.exp.helpers.GUI

        this.uniforms = {
            uTime: { value: 0 },
            uNoiseScale: { value: this.params.noiseScale },
            uElevation: { value: this.params.elevation },
            uElevationIntensity: { value: this.params.elevationIntensity },
            uColor1: { value: new THREE.Color(this.params.color1) },
            uColor2: { value: new THREE.Color(this.params.color2) },
            uColor3: { value: new THREE.Color(this.params.color3) },
            uGrainAmount: { value: this.params.grainAmount },
            uGrainDensity: { value: this.params.grainDensity },
        }

        this.holder = new THREE.Object3D()

        this.createSphere()
        this.createMaterial()
        this.createMesh()
        this.addScene()

        this.setupGUI()
    }
    createSphere() {
        this.geo = new THREE.SphereGeometry(1.5, 128, 128);
    }
    createMaterial() {
        this.mat = new THREE.ShaderMaterial({
            wireframe: false,
            uniforms: this.uniforms,
            vertexShader: `
            uniform float uTime;
            uniform float uElevation;
            uniform float uNoiseScale;

            uniform vec3 uColor1;
            uniform vec3 uColor2;
            uniform vec3 uColor3;

            varying float vElevation;
            varying float vNoise;
            varying float vFof;
            varying vec3 vNormal;
            varying vec3 vColor;

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
                 modelPosition.xyz += displaced;

                vNoise = noiseValue;
                vElevation = noiseValue * fresnel;
                vNormal = normalize(position);


          

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

            varying float vElevation;
            varying float vNoise;
            varying vec3 vNormal;
            varying float vFof;
            varying vec3 vColor;

            float randd(vec2 co) {
                return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
            }

            void main() {

                float brightness = 1.0 + vElevation * uElevationIntensity;
                vec3 color = clamp(vColor * brightness, 0.0, 1.0);

                float resolution = 1.0 / uGrainDensity;
                vec2 uv = gl_FragCoord.xy + uTime ;
                vec2 lowresxy = vec2(floor(uv.x / resolution), floor(uv.y / resolution));
                float grain = randd(lowresxy) * 2.0 - 1.0;
                color = clamp(color + grain * uGrainAmount, 0.0, 1.0);

                gl_FragColor = vec4(color, 1.0);
                #include <colorspace_fragment>
            }
            `
        })
    }

    createMesh() {
        this.mesh = new THREE.Mesh(this.geo, this.mat);
        // this.mesh.layers.enable(6)
    }
    addScene() {
        this.holder.add(this.mesh)
        this.scene.add(this.holder)
    }
    private setupGUI() {
        this.guiFolder = this.gui.addFolder('Sphere')

        const noiseFolder = this.guiFolder.addFolder('Noise')
        noiseFolder.add(this.params, 'noiseScale', 0.1, 100.0, 0.1).onChange((v: number) => {
            this.uniforms.uNoiseScale.value = v
        })
        noiseFolder.add(this.params, 'elevation', 0.0, 100.0, 1).onChange((v: number) => {
            this.uniforms.uElevation.value = v
            console.log(this.uniforms)
        })

        const gradientFolder = this.guiFolder.addFolder('Gradient')
        gradientFolder.addColor(this.params, 'color1').name('Color A').onChange((v: string) => {
            this.uniforms.uColor1.value.set(v)
        })
        gradientFolder.addColor(this.params, 'color2').name('Color B').onChange((v: string) => {
            this.uniforms.uColor2.value.set(v)
        })
        gradientFolder.addColor(this.params, 'color3').name('Color C').onChange((v: string) => {
            this.uniforms.uColor3.value.set(v)
        })
        gradientFolder.add(this.params, 'elevationIntensity', 0.0, 2.0, 0.01).name('Elevation Intensity').onChange((v: number) => {
            this.uniforms.uElevationIntensity.value = v
        })

        const grainFolder = this.guiFolder.addFolder('Grain')
        grainFolder.add(this.params, 'grainAmount', 0.0, 0.5, 0.001).name('Amount').onChange((v: number) => {
            this.uniforms.uGrainAmount.value = v
        })
        grainFolder.add(this.params, 'grainDensity', 0.1, 5.0, 0.1).name('Density').onChange((v: number) => {
            this.uniforms.uGrainDensity.value = v
        })

        const beatFolder = this.guiFolder.addFolder('Beat')
        beatFolder.add(this.params, 'beatBoostAmount', 0, 500, 1).name('Boost Amount')
        beatFolder.add(this.params, 'beatDuration', 0.05, 2, 0.01).name('Duration')

        this.guiFolder.hide()
    }

    showGUI(v: boolean) {
        v ? this.guiFolder.show() : this.guiFolder.hide()
    }

    onBPMBeat() {
        this.beatCounter++
        if (this.beatCounter % 2 === 0) this.beatPhase = 1.0
    }

    setVisible(v: boolean) {
        this.holder.visible = v
    }

    update() {
        this.uniforms.uTime.value = this.exp.time.elapsedTime / 1000

        const delta = this.exp.time.delta / 1000
        if (this.beatPhase > 0) {
            this.beatPhase = Math.max(0, this.beatPhase - delta / this.params.beatDuration)
        }
        const easeOutCirc = (x: number) => Math.sqrt(1 - Math.pow(x - 1, 2))
        const boost = this.beatPhase > 0
            ? this.params.beatBoostAmount * (1 - easeOutCirc(1 - this.beatPhase))
            : 0
        this.uniforms.uElevation.value = this.params.elevation + boost
    }

    leave() {
        this.boxes.forEach(m => this.dispose(m, this.scene))
        this.boxes = []
    }

}