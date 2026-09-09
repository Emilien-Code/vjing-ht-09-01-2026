import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const CHARSET = ' .:-=+*#@%';

function createCharsetTexture(chars: string): THREE.CanvasTexture {
    const fontSize = 64;
    const canvas = document.createElement('canvas');
    canvas.width = fontSize * chars.length;
    canvas.height = fontSize;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < chars.length; i++) {
        ctx.fillText(chars[i], i * fontSize + fontSize * 0.5, fontSize * 0.5);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    return texture;
}

const AsciiShader = {
    uniforms: {
        tDiffuse: { value: null as THREE.Texture | null },
        tCharset: { value: null as THREE.Texture | null },
        resolution: { value: new THREE.Vector2(1, 1) },
        cellSize: { value: 4.0 },
        numChars: { value: CHARSET.length },
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform sampler2D tCharset;
        uniform vec2 resolution;
        uniform float cellSize;
        uniform float numChars;
        varying vec2 vUv;

        float lu(vec3 c) {
            return dot(c, vec3(0.299, 0.587, 0.114));
        }

        void main() {
            vec2 cellSizeUV = vec2(cellSize) / resolution;
            vec2 cellOrigin = floor(vUv / cellSizeUV) * cellSizeUV;
            vec2 cellCenter = cellOrigin + cellSizeUV * 0.5;
            vec4 cellColor = texture2D(tDiffuse, cellCenter);

            float lum = lu(cellColor.rgb);
            float charIdx = clamp(floor(lum * numChars), 0.0, numChars - 1.0);

            vec2 charCellUV = (vUv - cellOrigin) / cellSizeUV;
            vec2 charUV = vec2(
                (charIdx + charCellUV.x) / numChars,
                charCellUV.y
            );
            float charMask = texture2D(tCharset, charUV).r;

            gl_FragColor = vec4(cellColor.rgb * charMask, 1.0);
        }
    `,
};

export class AsciiPass extends ShaderPass {
    constructor(width: number, height: number) {
        super(AsciiShader);
        this.uniforms['tCharset'].value = createCharsetTexture(CHARSET);
        this.uniforms['resolution'].value.set(width, height);
        this.uniforms['numChars'].value = CHARSET.length;
        this.enabled = false;
    }

    setSize(width: number, height: number) {
        this.uniforms['resolution'].value.set(width, height);
    }

    get cellSize(): number {
        return this.uniforms['cellSize'].value;
    }

    set cellSize(v: number) {
        this.uniforms['cellSize'].value = v;
    }
}
