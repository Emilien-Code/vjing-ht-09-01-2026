import * as TSL from 'three/tsl'

// NOTE: the functions below are deliberately written without any
// .assign()/.mulAssign(). TSL expressions are lazy — a pure expression is
// emitted at the first statement that consumes it — so mutating a variable
// halfway through (as the GLSL does with `i = mod(i, 289.0)`, `p0 *= norm.x`)
// would make earlier-written expressions see the *mutated* value. Every
// "reassignment" is therefore a new name here.
//
// The shader maths below is swizzle-heavy, and @types/three's TSL typings
// infer `float` for anything they can't follow, so use the functions untyped.
const {
    Fn, float, vec2, vec3, vec4,
    floor, fract, mod, step, dot, abs, max, min, clamp, sin, mix,
} = TSL as any

// TSL ports of the noise / hash helpers that used to live as GLSL strings
// (shaders/simplex3D.ts, the cnoise blob in Sphere.ts, simplex4DNoise in
// DancingBody.ts, ...). The maths is a line-for-line translation so the
// visuals stay identical.

// ---------------------------------------------------------------------------
// smoothstep that tolerates edge0 > edge1
// ---------------------------------------------------------------------------

// GLSL's smoothstep(radius, 0.0, x) (reversed edges) is technically undefined
// and WGSL's builtin gives no guarantee for it, so spell the formula out.
export const smoothstepAny = (edge0: any, edge1: any, x: any) => {
    const t = clamp(x.sub(edge0).div(float(edge1).sub(edge0)), 0.0, 1.0)
    return t.mul(t).mul(float(3.0).sub(t.mul(2.0)))
}

// ---------------------------------------------------------------------------
// Hashes
// ---------------------------------------------------------------------------

// The classic `fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453)`.
export const randd = (co: any) =>
    fract(sin(dot(co.xy, vec2(12.9898, 78.233))).mul(43758.5453))

// Dave Hoskins hash without sine (used for the film grain in LogoLedScene).
export const hash12 = (p: any) => {
    const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar()
    p3.addAssign(dot(p3, p3.yzx.add(33.33)))
    return fract(p3.x.add(p3.y).mul(p3.z))
}

// ---------------------------------------------------------------------------
// Shared permutation helpers (McEwan / Gustavson, webgl-noise)
// ---------------------------------------------------------------------------

const permute4 = (x: any) => mod(x.mul(34.0).add(1.0).mul(x), 289.0)
const permute1 = (x: any) => floor(mod(x.mul(34.0).add(1.0).mul(x), 289.0))
const taylorInvSqrt = (r: any) => float(1.79284291400159).sub(r.mul(0.85373472095314))

// ---------------------------------------------------------------------------
// Simplex 3D — snoise(vec3) -> float, range roughly [-1, 1]
// ---------------------------------------------------------------------------

export const snoise3 = Fn(([v]: any[]) => {
    const C = vec2(1.0 / 6.0, 1.0 / 3.0)

    // First corner
    const i = floor(v.add(dot(v, C.yyy)))
    const x0 = v.sub(i).add(dot(i, C.xxx))

    // Other corners
    const g = step(x0.yzx, x0.xyz)
    const l = float(1.0).sub(g)
    const i1 = min(g.xyz, l.zxy)
    const i2 = max(g.xyz, l.zxy)

    const x1 = x0.sub(i1).add(C.xxx)
    const x2 = x0.sub(i2).add(C.xxx.mul(2.0))
    const x3 = x0.sub(1.0).add(C.xxx.mul(3.0))

    // Permutations
    const im = mod(i, 289.0)
    const pz = permute4(im.z.add(vec4(0.0, i1.z, i2.z, 1.0)))
    const py = permute4(pz.add(im.y).add(vec4(0.0, i1.y, i2.y, 1.0)))
    const p = permute4(py.add(im.x).add(vec4(0.0, i1.x, i2.x, 1.0)))

    // Gradients: N*N points uniformly over a square, mapped onto an octahedron.
    const n_ = 1.0 / 7.0
    const ns = vec3(n_ * 2.0, n_ * 0.5 - 1.0, n_) // n_ * D.wyz - D.xzx

    const j = p.sub(floor(p.mul(ns.z).mul(ns.z)).mul(49.0))

    const x_ = floor(j.mul(ns.z))
    const y_ = floor(j.sub(x_.mul(7.0)))

    const x = x_.mul(ns.x).add(ns.yyyy)
    const y = y_.mul(ns.x).add(ns.yyyy)
    const h = float(1.0).sub(abs(x)).sub(abs(y))

    const b0 = vec4(x.x, x.y, y.x, y.y)
    const b1 = vec4(x.z, x.w, y.z, y.w)

    const s0 = floor(b0).mul(2.0).add(1.0)
    const s1 = floor(b1).mul(2.0).add(1.0)
    const sh = step(h, vec4(0.0)).negate()

    const a0 = b0.xzyw.add(s0.xzyw.mul(sh.xxyy))
    const a1 = b1.xzyw.add(s1.xzyw.mul(sh.zzww))

    const p0 = vec3(a0.x, a0.y, h.x)
    const p1 = vec3(a0.z, a0.w, h.y)
    const p2 = vec3(a1.x, a1.y, h.z)
    const p3 = vec3(a1.z, a1.w, h.w)

    // Normalise gradients
    const norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)))
    const q0 = p0.mul(norm.x)
    const q1 = p1.mul(norm.y)
    const q2 = p2.mul(norm.z)
    const q3 = p3.mul(norm.w)

    // Mix final noise value
    const m = max(float(0.6).sub(vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3))), 0.0)
    const m2 = m.mul(m)
    return float(42.0).mul(dot(m2.mul(m2), vec4(dot(q0, x0), dot(q1, x1), dot(q2, x2), dot(q3, x3))))
})

// ---------------------------------------------------------------------------
// Classic Perlin 3D — cnoise(vec3) -> float
// ---------------------------------------------------------------------------

const fade3 = (t: any) => t.mul(t).mul(t).mul(t.mul(t.mul(6.0).sub(15.0)).add(10.0))

export const cnoise3 = Fn(([P]: any[]) => {
    const Pfloor = floor(P)
    const Pi0 = mod(Pfloor, 289.0)
    const Pi1 = mod(Pfloor.add(1.0), 289.0)
    const Pf0 = fract(P)
    const Pf1 = Pf0.sub(1.0)

    const ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x)
    const iy = vec4(Pi0.y, Pi0.y, Pi1.y, Pi1.y)
    const iz0 = vec4(Pi0.z)
    const iz1 = vec4(Pi1.z)

    const ixy = permute4(permute4(ix).add(iy))
    const ixy0 = permute4(ixy.add(iz0))
    const ixy1 = permute4(ixy.add(iz1))

    // Octahedral gradient decode, z = 0 layer then z = 1 layer.
    const decode = (ixyz: any) => {
        const g0 = ixyz.div(7.0)
        const gy = fract(floor(g0).div(7.0)).sub(0.5)
        const gx = fract(g0)
        const gz = vec4(0.5).sub(abs(gx)).sub(abs(gy))
        const sz = step(gz, vec4(0.0))
        return {
            gx: gx.sub(sz.mul(step(0.0, gx).sub(0.5))),
            gy: gy.sub(sz.mul(step(0.0, gy).sub(0.5))),
            gz,
        }
    }
    const d0 = decode(ixy0)
    const d1 = decode(ixy1)

    const g000 = vec3(d0.gx.x, d0.gy.x, d0.gz.x)
    const g100 = vec3(d0.gx.y, d0.gy.y, d0.gz.y)
    const g010 = vec3(d0.gx.z, d0.gy.z, d0.gz.z)
    const g110 = vec3(d0.gx.w, d0.gy.w, d0.gz.w)
    const g001 = vec3(d1.gx.x, d1.gy.x, d1.gz.x)
    const g101 = vec3(d1.gx.y, d1.gy.y, d1.gz.y)
    const g011 = vec3(d1.gx.z, d1.gy.z, d1.gz.z)
    const g111 = vec3(d1.gx.w, d1.gy.w, d1.gz.w)

    const norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)))
    const h000 = g000.mul(norm0.x)
    const h010 = g010.mul(norm0.y)
    const h100 = g100.mul(norm0.z)
    const h110 = g110.mul(norm0.w)
    const norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)))
    const h001 = g001.mul(norm1.x)
    const h011 = g011.mul(norm1.y)
    const h101 = g101.mul(norm1.z)
    const h111 = g111.mul(norm1.w)

    const n000 = dot(h000, Pf0)
    const n100 = dot(h100, vec3(Pf1.x, Pf0.y, Pf0.z))
    const n010 = dot(h010, vec3(Pf0.x, Pf1.y, Pf0.z))
    const n110 = dot(h110, vec3(Pf1.x, Pf1.y, Pf0.z))
    const n001 = dot(h001, vec3(Pf0.x, Pf0.y, Pf1.z))
    const n101 = dot(h101, vec3(Pf1.x, Pf0.y, Pf1.z))
    const n011 = dot(h011, vec3(Pf0.x, Pf1.y, Pf1.z))
    const n111 = dot(h111, Pf1)

    const fade_xyz = fade3(Pf0)
    const n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z)
    const n_yz = mix(vec2(n_z.x, n_z.y), vec2(n_z.z, n_z.w), fade_xyz.y)
    const n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x)
    return float(2.2).mul(n_xyz)
})

// ---------------------------------------------------------------------------
// Simplex 4D — snoise(vec4) -> float
// ---------------------------------------------------------------------------

const grad4 = (j: any, ip: any) => {
    const pxyz = floor(fract(vec3(j).mul(ip.xyz)).mul(7.0)).mul(ip.z).sub(1.0)
    const pw = float(1.5).sub(abs(pxyz.x).add(abs(pxyz.y)).add(abs(pxyz.z)))
    const p = vec4(pxyz, pw)
    // s = vec4(lessThan(p, vec4(0))); p never sits exactly on 0 here (its
    // components are multiples of 1/7 offset from an integer / half-integer)
    // so step() is an exact stand-in.
    const s = step(p, vec4(0.0))
    const shifted = pxyz.add(s.xyz.mul(2.0).sub(1.0).mul(s.www))
    return vec4(shifted, pw)
}

export const snoise4 = Fn(([v]: any[]) => {
    const C = vec2(0.138196601125010504, 0.309016994374947451)

    const i = floor(v.add(dot(v, C.yyyy)))
    const x0 = v.sub(i).add(dot(i, C.xxxx))

    const isX = step(x0.yzw, x0.xxx)
    const isYZ = step(x0.zww, x0.yyz)
    const one = float(1.0)
    const i0 = vec4(
        isX.x.add(isX.y).add(isX.z),
        one.sub(isX.x).add(isYZ.x).add(isYZ.y),
        one.sub(isX.y).add(one.sub(isYZ.x)).add(isYZ.z),
        one.sub(isX.z).add(one.sub(isYZ.y)).add(one.sub(isYZ.z)),
    )

    const i3 = clamp(i0, 0.0, 1.0)
    const i2 = clamp(i0.sub(1.0), 0.0, 1.0)
    const i1 = clamp(i0.sub(2.0), 0.0, 1.0)

    const x1 = x0.sub(i1).add(C.xxxx)
    const x2 = x0.sub(i2).add(C.xxxx.mul(2.0))
    const x3 = x0.sub(i3).add(C.xxxx.mul(3.0))
    const x4 = x0.sub(1.0).add(C.xxxx.mul(4.0))

    const im = mod(i, 289.0)
    const j0 = permute1(permute1(permute1(permute1(im.w).add(im.z)).add(im.y)).add(im.x))
    const j1 = permute4(
        permute4(
            permute4(
                permute4(im.w.add(vec4(i1.w, i2.w, i3.w, 1.0)))
                    .add(im.z).add(vec4(i1.z, i2.z, i3.z, 1.0))
            ).add(im.y).add(vec4(i1.y, i2.y, i3.y, 1.0))
        ).add(im.x).add(vec4(i1.x, i2.x, i3.x, 1.0))
    )

    const ip = vec4(1.0 / 294.0, 1.0 / 49.0, 1.0 / 7.0, 0.0)
    const p0 = grad4(j0, ip)
    const p1 = grad4(j1.x, ip)
    const p2 = grad4(j1.y, ip)
    const p3 = grad4(j1.z, ip)
    const p4 = grad4(j1.w, ip)

    const norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)))
    const q0 = p0.mul(norm.x)
    const q1 = p1.mul(norm.y)
    const q2 = p2.mul(norm.z)
    const q3 = p3.mul(norm.w)
    const q4 = p4.mul(taylorInvSqrt(dot(p4, p4)))

    const m0 = max(float(0.6).sub(vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2))), 0.0)
    const m1 = max(float(0.6).sub(vec2(dot(x3, x3), dot(x4, x4))), 0.0)
    const m0s = m0.mul(m0)
    const m1s = m1.mul(m1)

    return float(49.0).mul(
        dot(m0s.mul(m0s), vec3(dot(q0, x0), dot(q1, x1), dot(q2, x2)))
            .add(dot(m1s.mul(m1s), vec2(dot(q3, x3), dot(q4, x4))))
    )
})
