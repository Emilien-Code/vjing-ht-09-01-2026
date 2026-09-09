import * as THREE from "three"
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'

const exporter = new GLTFExporter()

export async function exportSceneToGLB(scene: THREE.Scene, fileName = 'scene.glb') {
    const result = await exporter.parseAsync(scene, { binary: true }) as ArrayBuffer

    const blob = new Blob([result], { type: 'model/gltf-binary' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()

    URL.revokeObjectURL(url)
}
