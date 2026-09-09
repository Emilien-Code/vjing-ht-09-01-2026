import EventEmitter from "./EventEmitter"
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

interface Loaders {
    textureLoader : THREE.TextureLoader
    gltfLoader : GLTFLoader
}
interface Source {
    name: string;
    type: string;
    path: string[];
}
export default class Ressources extends EventEmitter{

    public sources : Source[]
    public items :  { [key: string]: any | THREE.Texture }
    public toLoad : number
    public loaded : number
    private loaders : Loaders | null = null


    constructor(sources : Source[]) {
        super()
        //Setup
        this.sources = sources

        //SetUp
        this.items = {}
        this.toLoad = 0
        this.loaded = 0
        this.setLoaders()
        // this.startLoading()
        this.startLoading = this.startLoading.bind(this)
    }
    setLoaders(){

        this.loaders = {
            textureLoader : new THREE.TextureLoader(),
            gltfLoader :  new GLTFLoader()
        }
        // this.loaders.dracoLoader = new DRACOLoader()
        // this.loaders.dracoLoader.setDecoderPath('/3D/loader/draco/')
        // this.loaders.gltfLoader =
        // this.loaders.gltfLoader.setDRACOLoader(this.loaders.dracoLoader)
        // this.loaders.cubeTextureLoader = new THREE.CubeTextureLoader()
    }
    startLoading(){ 
        if(!this.loaders) return false
        const hasBeenLoaded = false
        this.toLoad = this.sources.length
        for(const source of this.sources){
                if(source.type === "GLTFModel"){
                    this.loaders.gltfLoader.load(
                        source.path[0],
                        (file: any) => {
                            this.sourceLoaded(source, file)
                        }

                    )
                }
            if(source.type === "texture"){
                this.loaders.textureLoader.load(
                    source.path[0],
                    (file) => {
                        this.sourceLoaded(source, file)
                    }

                )
            }
        }
        

        return hasBeenLoaded
    }
    sourceLoaded(source : Source, file : THREE.Texture){
        this.items[source.name] = file
        this.loaded++
        if(this.loaded === this.toLoad){
            this.trigger('ready')
        }
    }
}