import * as THREE from 'three/webgpu';
import {
    Fn, If, uniform, texture, float, vec2, vec3, vec4, floor, clamp, dot,
} from 'three/tsl';

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
    // No mip chain: with WebGL, LinearFilter alone meant "no mipmaps", but the
    // WebGPU backend still builds them (and the glyphs get blurry when a
    // 64px glyph is squeezed into a ~4-10px cell).
    texture.generateMipmaps = false;
    return texture;
}

// ASCII-art post effect: the screen is cut into `cellSize`-pixel cells, each
// cell's luminance picks a glyph from CHARSET, and the glyph mask darkens the
// cell's colour.
//
// Unlike the old ShaderPass this isn't a pass with its own render target: it
// builds a TSL function of `uv` (see Renderer.ts) that pulls the cell-centre
// colour from whatever stage comes before it, and is switched on/off through
// the `enabled` uniform.
export class AsciiPass {
    private uEnabled = uniform(0);
    private uCellSize = uniform(4.0);
    private uResolution = uniform(new THREE.Vector2(1, 1));
    private charset = createCharsetTexture(CHARSET);

    constructor(width: number, height: number) {
        this.uResolution.value.set(width, height);
    }

    setSize(width: number, height: number) {
        this.uResolution.value.set(width, height);
    }

    get enabled(): boolean {
        return this.uEnabled.value > 0.5;
    }

    set enabled(v: boolean) {
        this.uEnabled.value = v ? 1 : 0;
    }

    get cellSize(): number {
        return this.uCellSize.value;
    }

    set cellSize(v: number) {
        this.uCellSize.value = v;
    }

    // `previous(uv)` is the image this effect reads from (a function so it can
    // be sampled at the cell centre rather than at the pixel itself). Returns a
    // function of `uv` that yields the ASCII image when enabled and simply
    // forwards `previous(uv)` otherwise.
    apply(previous: (uv: any) => any) {
        const numChars = float(CHARSET.length);
        const charset = this.charset;

        const ascii = Fn(([uvIn]: any[]) => {
            const uvN = uvIn.toVar();
            const cellSizeUV = this.uCellSize.div(this.uResolution);
            const cellOrigin = floor(uvN.div(cellSizeUV)).mul(cellSizeUV);
            const cellCenter = cellOrigin.add(cellSizeUV.mul(0.5));
            const cellColor = previous(cellCenter);

            const lum = dot(cellColor.rgb, vec3(0.299, 0.587, 0.114));
            const charIdx = clamp(floor(lum.mul(numChars)), 0.0, numChars.sub(1.0));

            const charCellUV = uvN.sub(cellOrigin).div(cellSizeUV);
            const charUV = vec2(
                charIdx.add(charCellUV.x).div(numChars),
                charCellUV.y,
            );
            const charMask = texture(charset, charUV).r;

            return vec4(cellColor.rgb.mul(charMask), 1.0);
        });

        return Fn(([uvIn]: any[]) => {
            // Pin the uv before branching (see Renderer.buildPipeline).
            const uvN = uvIn.toVar();
            const result = vec4(0.0).toVar();
            If(this.uEnabled.greaterThan(0.5), () => {
                result.assign(ascii(uvN));
            }).Else(() => {
                result.assign(previous(uvN));
            });
            return result;
        });
    }
}
