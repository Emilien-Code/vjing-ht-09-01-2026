import * as THREE from 'three/webgpu'

// Same HT logo outline as LogoLedScene (three SVG polygons, no curves), but
// built here as solid extruded 3D geometry so it can stand in for the
// falling/levitating human body in SquaresFallingScene, SphereLevitatingScene
// and LightStormLevitatingScene.

const SVG_VIEWBOX = { width: 522, height: 470 }

const SVG_PATHS = [
    "M519.5 2.5H411.5L350.59 94H459.538L519.5 2.5Z",
    "M124 94L45.5 2.5H341.5L158.5 269H2.5L124 94Z",
    "M301.5 394L506 94H461H459.538H350.59H350H123.5L200.5 184.5H289.5L99.5 467.5L301.5 394Z",
]

export type Pt = { x: number, y: number }

// Minimal absolute-command path parser — enough for M / L / H / V / Z, which
// is all these three paths use (no curves).
function parsePath(d: string): Pt[] {
    const tokens = d.match(/[MLHVZmlhvz]|-?\d*\.?\d+/g) ?? []
    const pts: Pt[] = []
    let cmd = ''
    let x = 0, y = 0
    let i = 0

    const num = () => parseFloat(tokens[i++])

    while (i < tokens.length) {
        const t = tokens[i]
        if (/[MLHVZmlhvz]/.test(t)) { cmd = t; i++; if (cmd.toUpperCase() === 'Z') continue }
        switch (cmd.toUpperCase()) {
            case 'M': x = num(); y = num(); pts.push({ x, y }); cmd = 'L'; break
            case 'L': x = num(); y = num(); pts.push({ x, y }); break
            case 'H': x = num(); pts.push({ x, y }); break
            case 'V': y = num(); pts.push({ x, y }); break
            default: i++
        }
    }
    return pts
}

// Drops the closing duplicate and any vertex sitting on the straight line
// between its neighbours.
function cleanPolygon(pts: Pt[]): Pt[] {
    const out = pts.slice()
    if (out.length > 1) {
        const a = out[0], b = out[out.length - 1]
        if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-4) out.pop()
    }

    let changed = true
    while (changed && out.length > 3) {
        changed = false
        for (let i = 0; i < out.length; i++) {
            const a = out[(i - 1 + out.length) % out.length]
            const b = out[i]
            const c = out[(i + 1) % out.length]
            const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
            const scale = Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y)
            if (scale > 1e-6 && Math.abs(cross) / scale < 1e-3) {
                out.splice(i, 1)
                changed = true
                break
            }
        }
    }
    return out
}

// SVG pixel space -> logo space: centred on the viewBox, y flipped (SVG is
// y-down), height normalised to 1.
function toLogoSpace(p: Pt): Pt {
    return {
        x: (p.x - SVG_VIEWBOX.width * 0.5) / SVG_VIEWBOX.height,
        y: -(p.y - SVG_VIEWBOX.height * 0.5) / SVG_VIEWBOX.height,
    }
}

const POLYGONS: Pt[][] = SVG_PATHS.map(d => cleanPolygon(parsePath(d)).map(toLogoSpace))

// Exposed so callers can build their own outline overlays (e.g. an edge-light
// chase) in the same logo-space coordinates the extruded meshes use — height
// still needs to be applied the same way createLogoGroup does (scale by
// `height`, matching geo.scale(height, height, height) below).
export const LOGO_POLYGONS: Pt[][] = POLYGONS

// Defaults mirrored by createLogoGroup below — exported so an edge-light
// overlay built from LOGO_POLYGONS can be scaled/positioned to match the
// extruded mesh's front face exactly.
export const LOGO_DEFAULT_HEIGHT = 2.2
export const LOGO_DEFAULT_DEPTH_RATIO = 0.14

// Builds a static, non-skinned group of extruded meshes for the HT logo,
// sized so its overall height equals `height` world units. No animation, no
// bobbing/swaying baked in — callers own all motion (falling, orbiting,
// levitating, ...) by moving/rotating the returned group like any other
// object.
export function createLogoGroup(opts: {
    material: THREE.Material | THREE.Material[]
    height?: number
    depthRatio?: number // extrude depth, as a fraction of `height`
    bevelRatio?: number // bevel size, as a fraction of `height`
}): THREE.Group {
    const height = opts.height ?? LOGO_DEFAULT_HEIGHT
    const depthNorm = opts.depthRatio ?? LOGO_DEFAULT_DEPTH_RATIO
    const bevelNorm = opts.bevelRatio ?? 0.015

    const group = new THREE.Group()

    for (const poly of POLYGONS) {
        const shape = new THREE.Shape()
        poly.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, p.y) : shape.lineTo(p.x, p.y)))
        shape.closePath()

        const geo = new THREE.ExtrudeGeometry(shape, {
            depth: depthNorm,
            bevelEnabled: true,
            bevelThickness: bevelNorm,
            bevelSize: bevelNorm,
            bevelSegments: 2,
            curveSegments: 1,
        })
        geo.translate(0, 0, -depthNorm * 0.5)
        // Logo space is normalised to ~1 unit tall; scale (uniformly, so
        // depth stays proportional) up to the requested world height.
        geo.scale(height, height, height)
        geo.computeVertexNormals()

        const mesh = new THREE.Mesh(geo, opts.material)
        group.add(mesh)
    }

    return group
}
