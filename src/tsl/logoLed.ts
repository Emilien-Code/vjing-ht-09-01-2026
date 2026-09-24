import * as TSL from 'three/tsl'
import { LOGO_POLYGONS, type Pt } from "../utils/logoGeometry"

// Untyped: @types/three's TSL typings can't follow this kind of graph building.
const {
    Fn, If, Loop, Break, float, vec2, uniform, uniformArray,
    min, max, clamp, dot, length, exp, fract, abs, select,
} = TSL as any

// Shared LED-edge machinery for the HT logo outline, used by both
// LogoLedScene (a full-screen fragment shader) and FallingBody (the same
// shader applied to a flat plane parented to the falling 3D logo). Written in
// TSL: logoEval() below builds the node graph. Keeping
// this in one place means both get pixel-identical LED glow/chase math
// instead of two different techniques that happen to look similar.
//
// Coordinate space: "logo space" is LOGO_POLYGONS' own space — centred on
// the SVG viewBox, y-up, height normalised to 1 (see logoGeometry.ts). Every
// export here (edge literals baked into the shader, uMouseU indices, etc.)
// assumes the fragment shader's `p` is in that same space; callers are
// responsible for getting their local coordinate into it (LogoLedScene does
// it via toLogo(), FallingBody's plane is simply built directly in it).

export type LogoEdge = { a: Pt, b: Pt, poly: number, mid: Pt, angle: number }

const EDGES: LogoEdge[] = []
LOGO_POLYGONS.forEach((poly, pi) => {
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i]
        const b = poly[(i + 1) % poly.length]
        const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 }
        EDGES.push({ a, b, poly: pi, mid, angle: Math.atan2(mid.y, mid.x) })
    }
})

export const LOGO_EDGES = EDGES
export const LOGO_EDGE_COUNT = EDGES.length
export const LOGO_POLYGON_COUNT = LOGO_POLYGONS.length

// Spectrum bands are handed out by walking around the logo, so neighbouring
// LEDs get neighbouring frequencies and the outline reads as a ring analyser.
const EDGE_BAND_ORDER: number[] = EDGES
    .map((e, i) => ({ i, angle: e.angle }))
    .sort((p, q) => p.angle - q.angle)
    .map(e => e.i)

export const LOGO_EDGE_BAND_SLOT = new Array<number>(LOGO_EDGE_COUNT)
EDGE_BAND_ORDER.forEach((edgeIndex, slot) => { LOGO_EDGE_BAND_SLOT[edgeIndex] = slot })

// ---------------------------------------------------------------------------
// TSL graph
// ---------------------------------------------------------------------------

export interface LogoLedUniformInit {
    ledWidth: number
    ledCore: number
    ledHalo: number
    pulseOn: boolean
    pulseWidth: number
    pulseCount: number
    pulseIntensity: number
}

// Every caller creates these uniforms once (keeping them in its own
// `uniforms` map so the GUI can keep doing `u.uLedWidth.value = v`) and hands
// them to logoEval().
//
// `edgeAudio` / `mouseU` are the live Float32Arrays the scene mutates in
// place every frame: uniformArray re-uploads them on each render.
//
// uMouseU: per-polygon chase-light position, 0..1 arc-length fraction along
// that polygon's own outline. LogoLedScene drives this from the mouse (real or
// auto-orbiting); FallingBody drives every entry with the same time-based
// value since it has no cursor to project.
export function createLogoLedUniforms(
    edgeAudio: Float32Array,
    mouseU: Float32Array,
    init: LogoLedUniformInit,
) {
    return {
        uEdgeAudio: uniformArray(edgeAudio as any, 'float'),
        uMouseU: uniformArray(mouseU as any, 'float'),
        uLedWidth: uniform(init.ledWidth),
        uLedCore: uniform(init.ledCore),
        uLedHalo: uniform(init.ledHalo),
        uPulseOn: uniform(init.pulseOn ? 1 : 0),
        uPulseWidth: uniform(init.pulseWidth),
        uPulseCount: uniform(init.pulseCount),
        uPulseIntensity: uniform(init.pulseIntensity),
    }
}

export type LogoLedUniforms = ReturnType<typeof createLogoLedUniforms>

// Builds `logoEval(p, blur)` for a given set of uniforms:
//
//   x = signed distance to the union of the logo polygons (negative inside),
//   y = accumulated, audio-weighted + chase-lit LED glow.
//
// `p` is a vec2 node in logo space; `blur` is 1.0 for a direct view, >1.0 to
// soften the falloff (LogoLedScene uses this for its floor reflection).
//
// One unrolled block per edge: unsigned distance to the segment (feeds the LED
// falloff, weighted by that edge's own audio level) plus the crossing test that
// builds the polygon's inside/outside sign. Each edge also gets its position
// along its polygon's perimeter baked in as constants (arc-length start / this
// edge's length / the polygon's total perimeter), so the chase light can tell
// where along the loop the current pixel sits.
export function createLogoEval(u: LogoLedUniforms) {
    // Two exponentials: a tight filament that reads as the LED itself, plus a
    // wide halo for the light it throws into the air.
    const ledFalloff = Fn(([d, blur]: any[]) => {
        const w = max(u.uLedWidth.mul(blur), 1e-4)
        return u.uLedCore.mul(exp(d.negate().div(w.mul(0.16))))
            .add(u.uLedHalo.mul(exp(d.negate().div(w.mul(1.7)))))
    })

    // arcU is the pixel's position along its polygon's perimeter, 0..1;
    // mouseU is the cursor's own position along that same loop. Sums up to
    // uPulseCount bright comets, evenly spaced, all locked to the cursor.
    const pulseGlow = Fn(([arcU, mouseU]: any[]) => {
        const sum = float(0).toVar()
        If(u.uPulseOn.greaterThanEqual(0.5), () => {
            const width = max(u.uPulseWidth, 1e-4)
            Loop(8, ({ i }: any) => {
                If(float(i).greaterThanEqual(u.uPulseCount), () => { Break() })
                const c = fract(mouseU.add(float(i).div(max(u.uPulseCount, 1.0))))
                const dd = abs(arcU.sub(c)).toVar()
                dd.assign(min(dd, float(1.0).sub(dd)))
                sum.addAssign(exp(dd.mul(dd).negate().div(width.mul(width).mul(2.0))))
            })
        })
        return sum
    })

    return Fn(([p, blur]: any[]) => {
        const sd = float(1e6).toVar()
        const glow = float(0).toVar()
        const pd = float(0).toVar()
        const ps = float(0).toVar()

        let edgeIndex = -1
        LOGO_POLYGONS.forEach((poly, pi) => {
            const edgeLengths = poly.map((_, i) => {
                const a = poly[i]
                const b = poly[(i + 1) % poly.length]
                return Math.hypot(b.x - a.x, b.y - a.y)
            })
            const perimeter = edgeLengths.reduce((s, l) => s + l, 0)
            let arc = 0

            pd.assign(1e6)
            ps.assign(1.0)

            poly.forEach((_, i) => {
                edgeIndex++
                const a = poly[i]
                const b = poly[(i + 1) % poly.length]
                const arcStart = arc
                arc += edgeLengths[i]

                const av = vec2(a.x, a.y)
                const e = vec2(b.x - a.x, b.y - a.y)
                const ee = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
                const w = p.sub(av)
                const h = clamp(dot(w, e).div(ee), 0.0, 1.0)
                const d = length(w.sub(e.mul(h)))
                pd.assign(min(pd, d))

                const c1 = p.y.greaterThanEqual(a.y)
                const c2 = p.y.lessThan(b.y)
                const c3 = e.x.mul(w.y).greaterThan(e.y.mul(w.x))
                // all(cnd) || all(not(cnd))
                const flip = c1.and(c2).and(c3).or(c1.not().and(c2.not()).and(c3.not()))
                ps.assign(select(flip, ps.negate(), ps))

                const arcU = h.mul(edgeLengths[i]).add(arcStart).div(perimeter)
                glow.addAssign(
                    u.uEdgeAudio.element(edgeIndex)
                        .add(pulseGlow(arcU, u.uMouseU.element(pi)).mul(u.uPulseOn).mul(u.uPulseIntensity))
                        .mul(ledFalloff(d, blur))
                )
            })

            sd.assign(min(sd, ps.mul(pd)))
        })

        return vec2(sd, glow)
    })
}

// Sensible shared defaults for the uniforms above — both scenes start from
// these so the LED look matches out of the box; each still exposes its own
// GUI on top.
export const LOGO_LED_DEFAULTS = {
    ledWidth: 0.045,
    ledCore: 1.4,
    ledHalo: 0.28,
    pulseWidth: 0.06,
    pulseCount: 2,
    pulseIntensity: 2.2,
}

// ---------------------------------------------------------------------------
// Per-edge audio reactivity (JS side)
// ---------------------------------------------------------------------------

// Averages a log-spaced slice of the FFT for one LED slot, so the low end
// (where most of the movement is) gets more of the outline than the highs.
export function logoEdgeBandLevel(
    slot: number,
    bins: Float32Array,
    bandStart: number,
    bandEnd: number,
    bandCurve: number,
): number {
    const n = bins.length
    const t0 = slot / LOGO_EDGE_COUNT
    const t1 = (slot + 1) / LOGO_EDGE_COUNT
    const lo = Math.floor((bandStart + (bandEnd - bandStart) * Math.pow(t0, bandCurve)) * n)
    const hi = Math.max(lo + 1, Math.ceil((bandStart + (bandEnd - bandStart) * Math.pow(t1, bandCurve)) * n))

    let sum = 0
    let count = 0
    for (let i = lo; i < Math.min(hi, n); i++) { sum += bins[i]; count++ }
    return count > 0 ? sum / count : 0
}

export interface LogoEdgeAudioParams {
    baseLevel: number
    audioAmount: number
    volumeAmount: number
    kickPunch: number
    attack: number
    release: number
    bandStart: number
    bandEnd: number
    bandCurve: number
}

// Drives `edgeAudio` (one entry per LOGO_EDGES, bound straight to a
// uEdgeAudio uniform) from that edge's own slice of the spectrum plus overall
// volume/kick, with attack/release smoothing. Shared by LogoLedScene and
// FallingBody so a given track lights up both the same way. `chaseOffset`
// (in slots) rotates which band of the spectrum each edge reads — LogoLedScene
// uses this for its "spectrum band chase" GUI control; other callers can
// leave it at 0.
export function updateLogoEdgeAudio(
    edgeAudio: Float32Array,
    bins: Float32Array | undefined,
    smoothVolume: number,
    punch: number,
    p: LogoEdgeAudioParams,
    dt: number,
    chaseOffset = 0,
) {
    for (let i = 0; i < LOGO_EDGE_COUNT; i++) {
        const slot = ((LOGO_EDGE_BAND_SLOT[i] + chaseOffset) % LOGO_EDGE_COUNT + LOGO_EDGE_COUNT) % LOGO_EDGE_COUNT
        const band = bins ? logoEdgeBandLevel(slot, bins, p.bandStart, p.bandEnd, p.bandCurve) : 0

        const target = p.baseLevel
            + band * p.audioAmount
            + smoothVolume * p.volumeAmount
            + punch * p.kickPunch

        const prev = edgeAudio[i]
        const rate = target > prev ? p.attack : p.release
        edgeAudio[i] = prev + (target - prev) * Math.min(1, rate * dt * 60)
    }
}
