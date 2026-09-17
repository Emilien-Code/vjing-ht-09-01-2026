import Experience from "../Experience"
import World from "../classes/World"
import GUI from "lil-gui"
import * as THREE from "three"
import simplex3D from "../shaders/simplex3D"

// Holographic HT logo — the real ht_logo.glb asset (loaded via
// Ressources/sources.ts, same pattern as LightStorm's storm_light model)
// wearing a ported version of the holographic-planet shader: fresnel-driven
// edge glow, scrolling scanline stripes and a rotating colour gradient. The
// planet's version sampled an earth texture and a specular/clouds texture to
// drive its "stroke"/"lights" masks; this project has no such textures for
// the logo, so those masks are procedural simplex noise sampled in world
// space instead. The glb mesh also has no UV attribute, which is the other
// reason the shader avoids vUv entirely.

export default class HolographicLogoScene extends World {

    private exp: Experience
    private scene: THREE.Scene
    private gui: GUI

    private group!: THREE.Group
    private material!: THREE.ShaderMaterial
    private uniforms: { [key: string]: THREE.IUniform }

    private folder!: GUI
    private visible = false
    private guiState = { visible: false }

    // Set by the owning world so the GUI toggle can also swap out whatever
    // other full-screen scene is running — mirrors LogoLedScene.onToggle.
    public onToggle: ((v: boolean) => void) | null = null

    private smoothVolume = 0
    private punch = 0

    public params = {
        // shape
        scale: 1,
        rotationSpeed: 0.12, // revolutions/sec
        // camera orbit
        camRadius: 5,
        camHeight: 0.6,
        camSpeed: 0.05, // revolutions/sec
        // colour
        colorA: '#43144f',
        colorB: '#6e12c2',
        // shader look
        intensity: 2.2,
        baseBrightness: 0.6,
        fresnelPower: 1.6,
        stripeSpeed: 0.4,
        stripeFrequency: 6.0,
        noiseScale: 1.4,
        displaceStrength: 0.125,
        // hidden light behind the surface, sound-reactive — analog of
        // LogoLedScene's "hidden light behind the slab".
        glowBase: 0.4,
        glowAudio: 1.2,
        glowKick: 0.8,
        soundReactive: true,
        volumeAttack: 8,
        punchRelease: 6,
    }

    constructor(exp: Experience) {
        super()
        this.exp = exp
        this.scene = exp.scene
        this.gui = exp.helpers.GUI

        this.uniforms = {
            uTime: { value: 0 },
            uDisplaceStrength: { value: this.params.displaceStrength },

            uColorA: { value: new THREE.Color(this.params.colorA) },
            uColorB: { value: new THREE.Color(this.params.colorB) },

            uIntensity: { value: this.params.intensity },
            uBaseBrightness: { value: this.params.baseBrightness },
            uFresnelPower: { value: this.params.fresnelPower },
            uStripeSpeed: { value: this.params.stripeSpeed },
            uStripeFrequency: { value: this.params.stripeFrequency },
            uNoiseScale: { value: this.params.noiseScale },

            uGlowBase: { value: this.params.glowBase },
            uGlowAudio: { value: this.params.glowAudio },
            uGlowKick: { value: this.params.glowKick },
            uVolume: { value: 0 },
            uPunch: { value: 0 },
        }

        this.createMaterial()
        this.createMesh()
        this.setupGUI()
        this.setVisible(false)
    }

    private createMaterial() {
        this.material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            transparent: true,
            // depthWrite: false,
            // Additive instead of normal alpha blending: a holographic glow on a
            // near-black scene needs to add light against the background, not
            // fade between two colours — alpha-blended low-alpha fragments just
            // read as invisible. This also sidesteps needing correct back-to-
            // front sorting across the three overlapping logo shapes.
            // blending: THREE.AdditiveBlending,
            // side: THREE.DoubleSide,
            vertexShader: /* glsl */`
                varying vec3 vPosition;
                varying vec3 vNormal;
                varying vec3 vViewDir;

                uniform float uTime;
                uniform float uDisplaceStrength;

                float random2D(vec2 value){return fract(sin(dot(value.xy, vec2(12.9898,78.233))) * 43758.5453123);}

                void main(){
                    vec4 modelPosition = modelMatrix * vec4(position, 1.0);

                    float variationTime = uTime - modelPosition.y;
                    float variationStrength = sin(variationTime) + sin(variationTime * 3.45) + sin(variationTime * 8.76);
                    variationStrength /= 3.0;
                    variationStrength = smoothstep(0.3, 1.0, variationStrength);
                    variationStrength *= uDisplaceStrength;

                    modelPosition.x += (random2D(modelPosition.xz * uTime) - 0.5) * variationStrength;
                    modelPosition.z += (random2D(modelPosition.zx * uTime) - 0.5) * variationStrength;

                    gl_Position = projectionMatrix * viewMatrix * modelPosition;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vViewDir = normalize(-mvPosition.xyz);
                    vec4 modelNormal = modelMatrix * vec4(normal, 0.0);
                    vPosition = modelPosition.xyz;
                    vNormal = modelNormal.xyz;
                }
            `,
            fragmentShader: /* glsl */`
                uniform float uTime;
                uniform vec3 uColorA;
                uniform vec3 uColorB;
                uniform float uIntensity;
                uniform float uBaseBrightness;
                uniform float uFresnelPower;
                uniform float uStripeSpeed;
                uniform float uStripeFrequency;
                uniform float uNoiseScale;
                uniform float uGlowBase;
                uniform float uGlowAudio;
                uniform float uGlowKick;
                uniform float uVolume;
                uniform float uPunch;

                varying vec3 vPosition;
                varying vec3 vNormal;
                varying vec3 vViewDir;

                ${simplex3D}

                void main(){
                    vec3 normal = normalize(vNormal);

                    // Procedural stand-ins for the planet's earth/specular-clouds
                    // texture reads, sampled in world space (not vUv, which the
                    // extrusion's cap/side faces map inconsistently).
                    float strokeNoise = snoise(vPosition * uNoiseScale + vec3(0.0, 0.0, uTime * 0.15));
                    float stroke = smoothstep(0.15, 0.85, strokeNoise);

                    float lightsNoise = snoise(vPosition * uNoiseScale * 2.3 + vec3(11.0, 0.0, uTime * 0.22));
                    float lights = smoothstep(0.55, 1.0, lightsNoise);

                    float stripes = mod((vPosition.y - uTime * uStripeSpeed) * uStripeFrequency, 1.0);
                    stripes = pow(stripes, 3.0);

                    // Rotating colour gradient — angle around the logo instead of
                    // the planet's cos(vUv.x)/sin(vUv.y), which divides by zero
                    // at the extrusion's UV seams.
                    float angle = atan(vPosition.y, vPosition.x);
                    vec3 gradient = mix(uColorA, uColorB, sin(angle + uTime * 2.0) * 0.5 + 0.5);

                    vec3 viewDirection = normalize(vPosition - cameraPosition);
                    float fresnel = dot(viewDirection, normal) + 1.0;
                    fresnel = pow(fresnel, uFresnelPower);

                    // Base fill: the whole silhouette reads clearly on its own —
                    // with additive blending, a pure fresnel-only rim leaves the
                    // rest of the surface literally black (invisible against the
                    // scene background), so this is not just an accent term.
                    vec3 base = mix(uColorA, gradient, stroke) * uBaseBrightness;

                    // Rim glow + scanlines running across it.
                    vec3 rim = gradient * fresnel * (0.6 + stripes * 1.4);

                    // Sound-reactive hidden light — analog of the planet's
                    // texture-driven "lights" term.
                    float glow = uGlowBase + uVolume * uGlowAudio + uPunch * uGlowKick;
                    vec3 hidden = gradient * lights * glow;

                    vec3 col = (base + rim + hidden) * uIntensity;




//Recreate fresnel
        // vec3 viewDirection2 = normalize(vPosition - cameraPosition);
        // float fresnel2 = dot(viewDirection2, normal) + 1.0;



        vec3 baseColor = vec3(0.102, 0.114, 0.141);  // 0x1a1d24
        vec3 fresnelColor = vec3(0.416, 0.831, 1.000);  // 0x6ad4ff
        float fresnelPower = 2.2;
        float fresnelIntensity = 1.6;
        float baseOpacity = 0.06;
            vec3 lightDir = vec3(0.4, 0.8, 0.6);

        vec3 V = normalize(vViewDir);
            vec3 N = normalize(vNormal);
            if (!gl_FrontFacing) { N = -N; }
            float diff = max(dot(N, normalize(lightDir)), 0.0);
            vec3 diffuse = baseColor * (0.35 + 0.65 * diff);
            float fresnel2 = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), fresnelPower);
            vec3 color = mix(diffuse, fresnelColor, fresnel2);
            float alpha = clamp(mix(baseOpacity, 1.0, fresnel2) * fresnelIntensity, 0.0, 1.0);
            gl_FragColor = vec4(color, alpha);




    // 3. Output to screen (Alpha set to 1.0)
    // gl_FragColor = vec4(debugColor, 1.0);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }
            `,
        })
    }

    private createMesh() {
        // Loaded eagerly via Ressources/sources.ts (name: "ht_logo") — same
        // pattern as LightStorm's storm_light model. Scenes are only ever
        // constructed after Ressources' 'ready' event, so this is populated
        // by the time we get here.
        const gltf = this.exp.ressources.items.ht_logo
        this.group = gltf.scene as THREE.Group
        this.group.traverse((child: THREE.Object3D) => {
            if ((child as THREE.Mesh).isMesh) {
                (child as THREE.Mesh).material = this.material
            }
        })
        this.scene.add(this.group)
    }

    // -----------------------------------------------------------------------
    // GUI
    // -----------------------------------------------------------------------

    private setupGUI() {
        const u = this.uniforms
        this.folder = this.gui.addFolder('holographic_logo')

        this.folder.add(this.guiState, 'visible').name('visible').listen()
            .onChange((v: boolean) => {
                this.onToggle ? this.onToggle(v) : this.setVisible(v)
            })

        const shape = this.folder.addFolder('shape')
        shape.add(this.params, 'scale', 0.1, 3, 0.01).name('scale')
            .onChange((v: number) => { this.group.scale.setScalar(v) })
        shape.add(this.params, 'rotationSpeed', -1, 1, 0.01).name('rotation speed')
        shape.add(this.params, 'displaceStrength', 0, 0.5, 0.001).name('displace strength')
            .onChange((v: number) => { u.uDisplaceStrength.value = v })
        shape.close()

        const camera = this.folder.addFolder('camera')
        camera.add(this.params, 'camRadius', 1, 15, 0.1).name('orbit radius')
        camera.add(this.params, 'camHeight', -5, 5, 0.05).name('orbit height')
        camera.add(this.params, 'camSpeed', -0.3, 0.3, 0.005).name('orbit speed')
        camera.close()

        const color = this.folder.addFolder('color')
        color.addColor(this.params, 'colorA').name('color A')
            .onChange((v: string) => { u.uColorA.value.set(v) })
        color.addColor(this.params, 'colorB').name('color B')
            .onChange((v: string) => { u.uColorB.value.set(v) })
        color.close()

        const look = this.folder.addFolder('look')
        look.add(this.params, 'intensity', 0, 6, 0.01).name('intensity')
            .onChange((v: number) => { u.uIntensity.value = v })
        look.add(this.params, 'baseBrightness', 0, 2, 0.01).name('base brightness')
            .onChange((v: number) => { u.uBaseBrightness.value = v })
        look.add(this.params, 'fresnelPower', 0.2, 6, 0.01).name('fresnel power')
            .onChange((v: number) => { u.uFresnelPower.value = v })
        look.add(this.params, 'stripeSpeed', -2, 2, 0.01).name('stripe speed')
            .onChange((v: number) => { u.uStripeSpeed.value = v })
        look.add(this.params, 'stripeFrequency', 0.5, 20, 0.1).name('stripe frequency')
            .onChange((v: number) => { u.uStripeFrequency.value = v })
        look.add(this.params, 'noiseScale', 0.1, 5, 0.01).name('noise scale')
            .onChange((v: number) => { u.uNoiseScale.value = v })
        look.close()

        const audio = this.folder.addFolder('hidden light (audio)')
        audio.add(this.params, 'soundReactive').name('sound reactive')
        audio.add(this.params, 'glowBase', 0, 2, 0.01).name('base level')
            .onChange((v: number) => { u.uGlowBase.value = v })
        audio.add(this.params, 'glowAudio', 0, 5, 0.01).name('volume amount')
            .onChange((v: number) => { u.uGlowAudio.value = v })
        audio.add(this.params, 'glowKick', 0, 5, 0.01).name('kick punch')
            .onChange((v: number) => { u.uGlowKick.value = v })
        audio.close()

        this.folder.close()
    }

    showGUI(v: boolean) {
        v ? this.folder.show() : this.folder.hide()
    }

    setVisible(v: boolean) {
        this.visible = v
        this.guiState.visible = v
        this.group.visible = v
    }

    // -----------------------------------------------------------------------
    // Audio
    // -----------------------------------------------------------------------

    private updateAudio(dt: number) {
        const an = this.exp.audioManager
        const p = this.params

        const volume = p.soundReactive ? (an?.volumeSmooth ?? 0) : 0
        this.smoothVolume += (volume - this.smoothVolume) * Math.min(1, dt * p.volumeAttack)

        this.punch += (0 - this.punch) * Math.min(1, dt * p.punchRelease)

        this.uniforms.uVolume.value = this.smoothVolume
        this.uniforms.uPunch.value = this.punch
    }

    onBPMBeat() {
        if (!this.visible || !this.params.soundReactive) return
        this.punch = 1
    }

    // -----------------------------------------------------------------------

    update() {
        if (!this.visible) return

        const dt = Math.min(this.exp.time.delta * 0.001, 0.1)
        const t = this.exp.time.elapsedTime * 0.001
        const p = this.params

        this.updateAudio(dt)
        this.uniforms.uTime.value = t

        this.group.rotation.y += p.rotationSpeed * dt * Math.PI * 2

        const angle = t * p.camSpeed * Math.PI * 2
        this.exp.camera.instance.position.set(
            Math.sin(angle) * p.camRadius,
            p.camHeight,
            Math.cos(angle) * p.camRadius,
        )
        this.exp.camera.instance.lookAt(this.group.position)
    }

    clean() {
        this.scene.remove(this.group)
        this.group.traverse((child: THREE.Object3D) => {
            if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).geometry.dispose()
        })
        this.material.dispose()
        this.folder.destroy()
    }
}
