import * as THREE from 'three/webgpu'
import { vec4 } from 'three/tsl'

// Plain white points (the old shaders/particules/{vertex,fragment}.glsl pair:
// standard MVP transform + a constant white fragment).
//
// The old vertex shader also set `gl_PointSize = 2.0`. WebGPU can only draw
// 1px points, so a size isn't expressible here — for sized particles render
// instanced sprites instead (see tsl/gpuParticles.ts).
export function createWhitePointsMaterial() {
    const material = new THREE.PointsNodeMaterial()
    material.colorNode = vec4(1.0, 1.0, 1.0, 1.0)
    return material
}
