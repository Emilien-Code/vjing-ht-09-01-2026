import { LOGO_POLYGONS, type Pt } from "../utils/logoGeometry"

// Shared LED-edge machinery for the HT logo outline, used by both
// LogoLedScene (a full-screen fragment shader) and FallingBody (the same
// shader applied to a flat plane parented to the falling 3D logo). Keeping
// this in one place means both get pixel-identical LED glow/chase math
// instead of two different techniques that happen to look similar.
//
// Coordinate space: "logo space" is LOGO_POLYGONS' own space — centred on
// the SVG viewBox, y-up, height normalised to 1 (see logoGeometry.ts). Every
// export here (edge literals baked into the GLSL, uMouseU indices, etc.)
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
// GLSL generation
// ---------------------------------------------------------------------------

const f = (n: number) => {
    const s = n.toFixed(5)
    return s.includes('.') ? s : s + '.0'
}

// One unrolled block per edge: unsigned distance to the segment (feeds the LED
// falloff, weighted by that edge's own audio level) plus the crossing test that
// builds the polygon's inside/outside sign. Each edge also gets its position
// along its polygon's perimeter baked in as literals (arc-length start / this
// edge's length / the polygon's total perimeter), so the chase light can tell
// where along the loop the current pixel sits.
function generateEdgeCode(): string {
    let edgeIndex = -1
    return LOGO_POLYGONS.map((poly, pi) => {
        const edgeLengths = poly.map((_, i) => {
            const a = poly[i]
            const b = poly[(i + 1) % poly.length]
            return Math.hypot(b.x - a.x, b.y - a.y)
        })
        const perimeter = edgeLengths.reduce((s, l) => s + l, 0)
        let arc = 0

        const body = poly.map((_, i) => {
            edgeIndex++
            const a = poly[i]
            const b = poly[(i + 1) % poly.length]
            const arcStart = arc
            arc += edgeLengths[i]
            return `
            a = vec2(${f(a.x)}, ${f(a.y)}); b = vec2(${f(b.x)}, ${f(b.y)});
            e = b - a; w = p - a;
            h = clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
            d = length(w - e * h);
            pd = min(pd, d);
            cnd = bvec3(p.y >= a.y, p.y < b.y, e.x * w.y > e.y * w.x);
            if (all(cnd) || all(not(cnd))) ps = -ps;
            arcU = (${f(arcStart)} + h * ${f(edgeLengths[i])}) / ${f(perimeter)};
            glow += (uEdgeAudio[${edgeIndex}] + pulseGlow(arcU, uMouseU[${pi}]) * uPulseOn * uPulseIntensity) * ledFalloff(d, blur);`
        }).join('')

        return `
        // ---- polygon ${pi} ----
        pd = 1e6; ps = 1.0;${body}
        sd = min(sd, ps * pd);`
    }).join('\n')
}

// Uniforms + logoEval()/ledFalloff()/pulseGlow() — every caller declares
// these uniforms (see LOGO_LED_UNIFORM_DEFAULTS below) and calls
// `logoEval(p, blur)` with `p` in logo space; `blur` is 1.0 for a direct
// view, >1.0 to soften the falloff (LogoLedScene uses this for its floor
// reflection).
//
// x = signed distance to the union of the logo polygons (negative inside),
// y = accumulated, audio-weighted + chase-lit LED glow.
export const LOGO_LED_GLSL = /* glsl */`
    uniform float uEdgeAudio[${LOGO_EDGE_COUNT}];
    uniform float uLedWidth;
    uniform float uLedCore;
    uniform float uLedHalo;

    uniform float uPulseOn;
    uniform float uPulseWidth;
    uniform float uPulseCount;
    uniform float uPulseIntensity;

    // Per-polygon chase-light position, 0..1 arc-length fraction along that
    // polygon's own outline. LogoLedScene drives this from the mouse (real or
    // auto-orbiting); FallingBody drives every entry with the same
    // time-based value since it has no cursor to project.
    uniform float uMouseU[${LOGO_POLYGON_COUNT}];

    // Two exponentials: a tight filament that reads as the LED itself, plus a
    // wide halo for the light it throws into the air.
    float ledFalloff(float d, float blur) {
        float w = max(uLedWidth * blur, 1e-4);
        return uLedCore * exp(-d / (w * 0.16)) + uLedHalo * exp(-d / (w * 1.7));
    }

    // u is the pixel's position along its polygon's perimeter, 0..1; mouseU
    // is the cursor's own position along that same loop. Sums up to
    // uPulseCount bright comets, evenly spaced, all locked to the cursor.
    float pulseGlow(float u, float mouseU) {
        if (uPulseOn < 0.5) return 0.0;
        float width = max(uPulseWidth, 1e-4);
        float sum = 0.0;
        for (int k = 0; k < 8; k++) {
            if (float(k) >= uPulseCount) break;
            float c = fract(mouseU + float(k) / max(uPulseCount, 1.0));
            float dd = abs(u - c);
            dd = min(dd, 1.0 - dd);
            sum += exp(-(dd * dd) / (2.0 * width * width));
        }
        return sum;
    }

    vec2 logoEval(vec2 p, float blur) {
        float sd = 1e6;
        float glow = 0.0;
        float pd, ps, d, h, arcU;
        vec2 a, b, e, w;
        bvec3 cnd;
${generateEdgeCode()}
        return vec2(sd, glow);
    }
`

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
