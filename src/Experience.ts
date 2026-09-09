import * as THREE from "three"
import Analyzer from "./sounds/Analyzer.js"
import Renderer from "./utils/Renderer";
import Camera from "./utils/Camera";
import Sizes from "./utils/Sizes";
import Time from "./utils/Time";
import World from "./classes/World";
import Helpers from "./utils/Helpers";
import Ressources from "./utils/Ressources";
import sources from "./common/sources";
import GpgpuScene from "./worlds/SphereScene";
import AudioManager from "./utils/managers/AudioManager";
import BPMManager from "./utils/managers/BPMManager";
import { exportSceneToGLB } from "./utils/SceneExporter";
export default class Experience {

    public canvas: HTMLCanvasElement;
    public isReady: boolean = false;
    public sizes: Sizes;
    public time: Time;

    public scene: THREE.Scene;
    public camera: Camera;
    public renderer: Renderer;
    public helpers: Helpers
    public ressources: Ressources

    public audioManager: AudioManager | undefined
    public bpmManager: BPMManager | undefined
    public isAudioLoaded = false
    public analyzer: any
    public world: World | null = null; // use the genera Page class type

    constructor(canvas: HTMLCanvasElement, a: any) {

        this.canvas = canvas;

        this.scene = new THREE.Scene();

        this.sizes = new Sizes();
        this.time = new Time();
        this.helpers = new Helpers();
        this.camera = new Camera(this);
        this.renderer = new Renderer(this);
        this.ressources = new Ressources(sources)
        this.ressources.startLoading()
        this.analyzer = a


        this.sizes.on("resize", () => this.resize());
        this.time.on("tick", () => this.update());
        this.time.tick()
        this.ressources.on('ready', () => this.onReady())

        this.createAudioManagers()
        this.setupExportGUI()


    }

    public async createAudioManagers() {
        this.isAudioLoaded = true
        this.analyzer.onAudio((a: any) => {
            if (a.kick > 0.8) {

                this.world.onBPMBeat(a)

            }
        })
        // this.audioManager = new AudioManager()
        // console.log("start")
        // await this.audioManager.loadAudioBuffer()
        // console.log("start")
        // this.bpmManager = new BPMManager()
        // this.bpmManager.addEventListener('beat', () => {
        // this.world && this.world.onBPMBeat()
        // })
        // /**
        //  * double check this.audioManager.audio
        //  */
        // await this.bpmManager.detectBPM(this.audioManager.audio.buffer)
        // this.audioManager.play()


        // console.log("ready")


    }

    private setupExportGUI() {
        this.helpers.GUI.add({
            exportGLB: () => exportSceneToGLB(this.scene, `${this.world?.constructor.name ?? 'scene'}.glb`)
        }, 'exportGLB').name('Export scene (.glb)')
    }

    public createWorld(Exp: World) {
        if (!Exp) return
        this.world?.clean()
        this.world = new Exp(this)
        this.isReady && (this.world.show())

    }

    onReady() {
        this.createWorld(GpgpuScene)
        this.isReady = true;
        this.world && this.world.onReady()
    }

    public resize(): void {
        this.camera.resize();
        this.renderer.resize();
        if (this.world) this.world.resize();
        this.sizes.viewWidth = Math.tan(this.camera.instance.fov * Math.PI / 180 / 2) * this.camera.instance.position.z * this.sizes.aspectRatio * 2;
        this.sizes.viewHeight = Math.tan(this.camera.instance.fov * Math.PI / 180 / 2) * this.camera.instance.position.z * 2;
    }
    public update(): void {
        if (this.isReady && this.isAudioLoaded) {
            this.camera.update();
            this.renderer.update();
            this.world?.update();
        }
    }
}





const a = new Analyzer()
a.onLoad(() => {
    document.querySelector('canvas')
    const app = new Experience(document.querySelector('canvas') as HTMLCanvasElement, a)

})