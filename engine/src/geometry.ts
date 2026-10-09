/**
 * Shape geometry for the animation engine: cubic Bézier subpaths (see
 * geometry-types.ts), the builders for every basic shape, bounding boxes, arc
 * length, partial paths (Create/Write) and the point alignment that lets any
 * two shapes be morphed into each other.
 *
 * Arrays are never mutated once built. Caches (arc length here, Path2D in the
 * renderer) are keyed by the array itself, so a shape that only moves keeps
 * its cached data for ever, and a new shape simply gets new entries.
 */
import type { Pt, Subpath } from './geometry-types'
import { apply, type Mat } from './math'

export const TAU = Math.PI * 2

export function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

/* ---------------------------------------------------------------- builders */

/** A straight segment as a cubic (handles at thirds, so it morphs evenly). */
function lineSeg(out: Pt[], a: Pt, b: Pt) {
  out.push(lerpPt(a, b, 1 / 3), lerpPt(a, b, 2 / 3), [b[0], b[1]])
}

export function lineSub(a: Pt, b: Pt): Subpath {
  const pts: Pt[] = [[a[0], a[1]]]
  lineSeg(pts, a, b)
  return { points: pts, closed: false }
}

/** Straight segments through `pts`; closed shapes end on their first point. */
export function polySub(pts: Pt[], closed: boolean): Subpath {
  if (!pts.length) return { points: [[0, 0]], closed: false }
  const out: Pt[] = [[pts[0][0], pts[0][1]]]
  for (let i = 1; i < pts.length; i++) lineSeg(out, pts[i - 1], pts[i])
  if (closed && pts.length > 1) lineSeg(out, pts[pts.length - 1], pts[0])
  return { points: out, closed }
}

/**
 * An elliptical arc as cubics (the standard 4/3·tan(θ/4) handle length): one
 * per eighth of a turn at most, or exactly `curves` of them (Manim's Arc always
 * has 8, whatever its angle, which matters for how it morphs).
 */
export function arcSub(center: Pt, rx: number, ry: number, start: number, sweep: number, closed = false, curves = 0): Subpath {
  const n = curves > 0 ? curves : Math.max(1, Math.ceil(Math.abs(sweep) / (TAU / 8) - 1e-9))
  const d = sweep / n
  const k = (4 / 3) * Math.tan(d / 4)
  const at = (a: number): Pt => [center[0] + rx * Math.cos(a), center[1] + ry * Math.sin(a)]
  const pts: Pt[] = [at(start)]
  for (let i = 0; i < n; i++) {
    const a0 = start + d * i, a1 = a0 + d
    const p0 = at(a0), p3 = at(a1)
    pts.push(
      [p0[0] - k * rx * Math.sin(a0), p0[1] + k * ry * Math.cos(a0)],
      [p3[0] + k * rx * Math.sin(a1), p3[1] - k * ry * Math.cos(a1)],
      p3,
    )
  }
  if (closed) pts[pts.length - 1] = [pts[0][0], pts[0][1]]
  return { points: pts, closed }
}

export function circleSub(center: Pt, r: number): Subpath {
  return arcSub(center, r, r, 0, TAU, true)
}

/**
 * A rounded rectangle centred on the origin, starting at the top right like a
 * plain rectangle so the two morph without a twist.
 */
export function roundedRectSub(w: number, h: number, r: number): Subpath {
  r = Math.max(0, Math.min(r, w / 2, h / 2))
  if (r <= 1e-9) return polySub(rectCorners(w, h), true)
  const x = w / 2, y = h / 2
  const pts: Pt[] = []
  const corner = (cx: number, cy: number, a0: number) => {
    const arc = arcSub([cx, cy], r, r, a0, Math.PI / 2, false, 1)
    if (!pts.length) pts.push(...arc.points)
    else {
      lineSeg(pts, pts[pts.length - 1], arc.points[0])
      pts.push(...arc.points.slice(1))
    }
  }
  corner(x - r, y - r, 0)
  corner(-x + r, y - r, Math.PI / 2)
  corner(-x + r, -y + r, Math.PI)
  corner(x - r, -y + r, Math.PI * 1.5)
  lineSeg(pts, pts[pts.length - 1], pts[0])
  pts[pts.length - 1] = [pts[0][0], pts[0][1]]
  return { points: pts, closed: true }
}

/** Corners in the order UR, UL, DL, DR. */
export function rectCorners(w: number, h: number): Pt[] {
  return [[w / 2, h / 2], [-w / 2, h / 2], [-w / 2, -h / 2], [w / 2, -h / 2]]
}

export function regularPolygonPts(n: number, r: number, startAngle: number): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = startAngle + (TAU * i) / n
    out.push([r * Math.cos(a), r * Math.sin(a)])
  }
  return out
}

export function starPts(n: number, outer: number, inner: number, startAngle: number): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < 2 * n; i++) {
    const a = startAngle + (Math.PI * i) / n
    const r = i % 2 ? inner : outer
    out.push([r * Math.cos(a), r * Math.sin(a)])
  }
  return out
}

/** A smooth curve through the points (Catmull-Rom handles). */
export function smoothSub(pts: Pt[], closed: boolean): Subpath {
  const n = pts.length
  if (n < 3) return polySub(pts, closed)
  const get = (i: number): Pt => {
    if (closed) return pts[((i % n) + n) % n]
    return pts[Math.max(0, Math.min(n - 1, i))]
  }
  const out: Pt[] = [[pts[0][0], pts[0][1]]]
  const segs = closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2)
    out.push(
      [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
      [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
      [p2[0], p2[1]],
    )
  }
  return { points: out, closed }
}

/* ---------------------------------------------------------- transform, box */

export function transformPaths(paths: Subpath[], m: Mat): Subpath[] {
  return paths.map(s => ({ points: s.points.map(p => apply(m, p)), closed: s.closed }))
}

export type Box = [number, number, number, number]

/** Bounding box of all points (anchors and handles), like Manim's. */
export function bbox(paths: Subpath[], m?: Mat): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of paths) {
    for (const p of s.points) {
      const x = m ? m[0] * p[0] + m[2] * p[1] + m[4] : p[0]
      const y = m ? m[1] * p[0] + m[3] * p[1] + m[5] : p[1]
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x0 === Infinity ? null : [x0, y0, x1, y1]
}

export function unionBox(a: Box | null, b: Box | null): Box | null {
  if (!a) return b
  if (!b) return a
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
}

/* ------------------------------------------------------- cubic evaluation */

function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]
}

/** The piece of one cubic between parameters t0 and t1 (de Casteljau). */
export function subCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t0: number, t1: number): [Pt, Pt, Pt, Pt] {
  // Split at t1 and keep the left part, then split that at t0/t1.
  let [a, b, c, d] = splitLeft(p0, p1, p2, p3, t1)
  if (t0 > 0) {
    const s = t1 > 0 ? t0 / t1 : 0
    ;[a, b, c, d] = splitRight(a, b, c, d, s)
  }
  return [a, b, c, d]
}

function splitLeft(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): [Pt, Pt, Pt, Pt] {
  const a = lerpPt(p0, p1, t), b = lerpPt(p1, p2, t), c = lerpPt(p2, p3, t)
  const d = lerpPt(a, b, t), e = lerpPt(b, c, t), f = lerpPt(d, e, t)
  return [p0, a, d, f]
}

function splitRight(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): [Pt, Pt, Pt, Pt] {
  const a = lerpPt(p0, p1, t), b = lerpPt(p1, p2, t), c = lerpPt(p2, p3, t)
  const d = lerpPt(a, b, t), e = lerpPt(b, c, t), f = lerpPt(d, e, t)
  return [f, e, c, p3]
}

/* ------------------------------------------------------------- arc length */

const SAMPLES = 12

interface SegLen { sub: number; i: number; len: number; cum: Float64Array }
export interface LengthTable { segs: SegLen[]; total: number }

const lengthCache = new WeakMap<Subpath[], LengthTable>()

/** Arc length per segment, sampled; cached per path list. */
export function lengthTable(paths: Subpath[]): LengthTable {
  let t = lengthCache.get(paths)
  if (t) return t
  const segs: SegLen[] = []
  let total = 0
  paths.forEach((s, si) => {
    const P = s.points
    for (let i = 0; i + 3 < P.length; i += 3) {
      const cum = new Float64Array(SAMPLES + 1)
      let prev = P[i], acc = 0
      for (let k = 1; k <= SAMPLES; k++) {
        const q = cubicAt(P[i], P[i + 1], P[i + 2], P[i + 3], k / SAMPLES)
        acc += dist(prev, q)
        cum[k] = acc
        prev = q
      }
      segs.push({ sub: si, i, len: acc, cum })
      total += acc
    }
  })
  t = { segs, total }
  lengthCache.set(paths, t)
  return t
}

export function totalLength(paths: Subpath[]): number {
  return lengthTable(paths).total
}

/** Parameter t on a segment at arc length d from its start. */
function paramAt(seg: SegLen, d: number): number {
  if (d <= 0) return 0
  if (d >= seg.len) return 1
  const c = seg.cum
  let k = 1
  while (k < SAMPLES && c[k] < d) k++
  const span = c[k] - c[k - 1] || 1
  return (k - 1 + (d - c[k - 1]) / span) / SAMPLES
}

/**
 * The part of a path list from fraction a to fraction b of its whole length,
 * drawn subpath after subpath (what Create shows at a = 0, b = alpha).
 */
export function partialPaths(paths: Subpath[], a: number, b: number): Subpath[] {
  if (a <= 0 && b >= 1) return paths
  if (b <= a) return []
  const table = lengthTable(paths)
  const L = table.total
  if (L <= 1e-12) return b >= 1 ? paths : []
  const A = a * L, B = b * L
  const out: Subpath[] = []
  let s = 0, cur: Pt[] | null = null, curSub = -1, whole = true
  for (const seg of table.segs) {
    const e = s + seg.len
    const P = paths[seg.sub].points
    if (seg.sub !== curSub) {
      if (cur) out.push({ points: cur, closed: whole && paths[curSub].closed })
      cur = null
      curSub = seg.sub
      whole = true
    }
    const lo = Math.max(A, s), hi = Math.min(B, e)
    if (hi > lo || (seg.len === 0 && s >= A && s <= B)) {
      if (lo > s + 1e-12 || hi < e - 1e-12) whole = false
      const t0 = paramAt(seg, lo - s), t1 = paramAt(seg, hi - s)
      const piece = t0 <= 0 && t1 >= 1
        ? [P[seg.i], P[seg.i + 1], P[seg.i + 2], P[seg.i + 3]]
        : subCubic(P[seg.i], P[seg.i + 1], P[seg.i + 2], P[seg.i + 3], t0, t1)
      if (!cur) cur = [piece[0]]
      cur.push(piece[1], piece[2], piece[3])
    } else whole = false
    s = e
  }
  if (cur) out.push({ points: cur, closed: whole && paths[curSub].closed })
  return out
}

/** The point at fraction `prop` of the whole length (MoveAlongPath, point_from_proportion). */
export function pointAt(paths: Subpath[], prop: number): Pt {
  const table = lengthTable(paths)
  if (!table.segs.length) {
    const p = paths[0]?.points[0]
    return p ? [p[0], p[1]] : [0, 0]
  }
  const D = Math.max(0, Math.min(1, prop)) * table.total
  let s = 0
  for (const seg of table.segs) {
    if (D <= s + seg.len || seg === table.segs[table.segs.length - 1]) {
      const P = paths[seg.sub].points
      return cubicAt(P[seg.i], P[seg.i + 1], P[seg.i + 2], P[seg.i + 3], paramAt(seg, D - s))
    }
    s += seg.len
  }
  return [0, 0]
}

/**
 * Dashes along a path (Manim's DashedLine count: ceil(length / dash_length ×
 * ratio), at least 2). Each dash is ratio/n of the length; on an open path the
 * gaps shrink so the last dash ends exactly at the end.
 */
export function dashedPaths(paths: Subpath[], dashLength: number, ratio: number): Subpath[] {
  const L = totalLength(paths)
  const n = Math.max(2, Math.ceil((L / Math.max(1e-6, dashLength)) * ratio))
  const d = ratio / n
  const closed = paths.length === 1 && paths[0].closed
  const step = closed ? 1 / n : (1 - d) / (n - 1)
  const out: Subpath[] = []
  for (let i = 0; i < n; i++) {
    const a = i * step
    for (const s of partialPaths(paths, a, Math.min(1, a + d))) out.push({ points: s.points, closed: false })
  }
  return out
}

/* ------------------------------------------------------------- morphing */

function segCount(s: Subpath): number {
  return Math.max(0, (s.points.length - 1) / 3)
}

/**
 * Split a subpath's curves until it has `m` of them, spreading the splits
 * evenly over the curves it has (Manim's insert_n_curves), so a 4-sided square
 * meeting an 8-curve circle gets two curves per side.
 */
export function insertCurves(s: Subpath, m: number): Subpath {
  const n = segCount(s)
  if (n === m) return s
  const P = s.points
  if (n === 0) {
    const p = P[0] || [0, 0]
    const out: Pt[] = [p]
    for (let i = 0; i < m; i++) out.push(p, p, p)
    return { points: out, closed: s.closed }
  }
  const split = new Array(n).fill(0)
  for (let i = 0; i < m; i++) split[Math.floor((i * n) / m)]++
  const out: Pt[] = [P[0]]
  for (let c = 0; c < n; c++) {
    const k = split[c]
    const p0 = P[3 * c], p1 = P[3 * c + 1], p2 = P[3 * c + 2], p3 = P[3 * c + 3]
    if (k <= 1) { out.push(p1, p2, p3); continue }
    for (let j = 0; j < k; j++) {
      const q = subCubic(p0, p1, p2, p3, j / k, (j + 1) / k)
      out.push(q[1], q[2], q[3])
    }
  }
  return { points: out, closed: s.closed }
}

/**
 * Make two path lists the same shape of data: equal subpath counts (a missing
 * subpath is a single point at the end of the last one, as Manim does) and,
 * pair by pair, equal curve counts. `fallbackA/B` is where an empty side
 * appears from (usually the other side's centre).
 */
export function alignPaths(A: Subpath[], B: Subpath[], fallbackA: Pt, fallbackB: Pt): [Subpath[], Subpath[]] {
  const a = A.length ? A : [{ points: [fallbackA], closed: false }]
  const b = B.length ? B : [{ points: [fallbackB], closed: false }]
  const n = Math.max(a.length, b.length)
  const outA: Subpath[] = [], outB: Subpath[] = []
  const pad = (L: Subpath[], i: number): Subpath => {
    if (i < L.length) return L[i]
    const last = L[L.length - 1].points
    return { points: [last[last.length - 1]], closed: false }
  }
  for (let i = 0; i < n; i++) {
    const sa = pad(a, i), sb = pad(b, i)
    const m = Math.max(segCount(sa), segCount(sb), 1)
    outA.push(insertCurves(sa, m))
    outB.push(insertCurves(sb, m))
  }
  return [outA, outB]
}

/** Blend two aligned path lists. */
export function lerpPaths(A: Subpath[], B: Subpath[], t: number): Subpath[] {
  if (t <= 0) return A
  if (t >= 1) return B
  const out: Subpath[] = new Array(A.length)
  for (let i = 0; i < A.length; i++) {
    const pa = A[i].points, pb = B[i].points
    const pts: Pt[] = new Array(pa.length)
    for (let k = 0; k < pa.length; k++) {
      pts[k] = [pa[k][0] + (pb[k][0] - pa[k][0]) * t, pa[k][1] + (pb[k][1] - pa[k][1]) * t]
    }
    out[i] = { points: pts, closed: t < 0.5 ? A[i].closed : B[i].closed }
  }
  return out
}
