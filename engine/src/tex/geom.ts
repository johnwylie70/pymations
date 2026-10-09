/**
 * Small cubic-Bézier helpers for the TeX outliner. Everything is a run of cubic
 * segments (see geometry-types.ts) so glyphs, rules and KaTeX's SVG pieces can
 * all be written and morphed the same way. Pure functions, no DOM.
 */
import type { Pt, Subpath } from '../geometry-types'

/** A 2D affine map [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f (SVG's matrix order). */
export type Affine = [number, number, number, number, number, number]

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/** Builds subpaths from move/line/quad/cubic/close calls; lines and quads become cubics. */
export class PathBuilder {
  readonly subpaths: Subpath[] = []
  private cur: Pt[] | null = null
  private start: Pt = [0, 0]

  get current(): Pt {
    return this.cur ? this.cur[this.cur.length - 1] : this.start
  }

  moveTo(p: Pt): void {
    this.flush(false)
    this.cur = [p]
    this.start = p
  }

  lineTo(p: Pt): void {
    const a = this.ensure()
    this.cur!.push(lerp(a, p, 1 / 3), lerp(a, p, 2 / 3), p)
  }

  quadTo(c: Pt, p: Pt): void {
    const a = this.ensure()
    this.cur!.push(lerp(a, c, 2 / 3), lerp(p, c, 2 / 3), p)
  }

  cubicTo(c1: Pt, c2: Pt, p: Pt): void {
    this.ensure()
    this.cur!.push(c1, c2, p)
  }

  close(): void {
    if (!this.cur) return
    const last = this.cur[this.cur.length - 1]
    if (last[0] !== this.start[0] || last[1] !== this.start[1]) this.lineTo(this.start)
    this.flush(true)
    // After Z the pen sits at the subpath's start (SVG rule).
  }

  finish(): Subpath[] {
    this.flush(false)
    return this.subpaths
  }

  private ensure(): Pt {
    if (!this.cur) this.cur = [this.start]
    return this.cur[this.cur.length - 1]
  }

  private flush(closed: boolean): void {
    if (this.cur && this.cur.length > 1) this.subpaths.push({ points: this.cur, closed })
    this.cur = null
  }
}

/**
 * An SVG elliptical arc (endpoint form) as cubic control points after the start
 * point: [h, h, p, h, h, p, ...]. Follows the SVG spec's endpoint → centre
 * conversion (appendix B.2.4), then one cubic per quarter turn or less.
 */
export function arcToCubics(
  p1: Pt,
  rx: number,
  ry: number,
  phiDeg: number,
  largeArc: boolean,
  sweep: boolean,
  p2: Pt,
): Pt[] {
  if (p1[0] === p2[0] && p1[1] === p2[1]) return []
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  if (rx === 0 || ry === 0) return [lerp(p1, p2, 1 / 3), lerp(p1, p2, 2 / 3), p2]
  const phi = (phiDeg * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (p1[0] - p2[0]) / 2
  const dy = (p1[1] - p2[1]) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) {
    const s = Math.sqrt(lambda)
    rx *= s
    ry *= s
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  let k = Math.sqrt(Math.max(0, num / den))
  if (largeArc === sweep) k = -k
  const cx1 = (k * rx * y1) / ry
  const cy1 = (-k * ry * x1) / rx
  const cx = cos * cx1 - sin * cy1 + (p1[0] + p2[0]) / 2
  const cy = sin * cx1 + cos * cy1 + (p1[1] + p2[1]) / 2
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    return a
  }
  const theta1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
  let dTheta = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI

  const n = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2) - 1e-9))
  const step = dTheta / n
  const alpha = (4 / 3) * Math.tan(step / 4)
  const map = (ex: number, ey: number): Pt => [cos * rx * ex - sin * ry * ey + cx, sin * rx * ex + cos * ry * ey + cy]
  const out: Pt[] = []
  let t = theta1
  for (let i = 0; i < n; i++) {
    const c0 = Math.cos(t), s0 = Math.sin(t)
    const t2 = t + step
    const c1 = Math.cos(t2), s1 = Math.sin(t2)
    out.push(map(c0 - alpha * s0, s0 + alpha * c0), map(c1 + alpha * s1, s1 - alpha * c1))
    // Land exactly on the endpoint so the next command starts where SVG says it does.
    out.push(i === n - 1 ? p2 : map(c1, s1))
    t = t2
  }
  return out
}

export function applyAffine(m: Affine, p: Pt): Pt {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]
}

export function transformSubpaths(subs: Subpath[], m: Affine): Subpath[] {
  return subs.map((s) => ({ closed: s.closed, points: s.points.map((p) => applyAffine(m, p)) }))
}

/**
 * The viewBox → viewport map for an <svg> of `w`×`h` px (SVG spec 8.2), for
 * preserveAspectRatio values like "none", "xMinYMin slice", "xMidYMid meet".
 * Offsets are added by the caller (the element's page position).
 */
export function viewBoxAffine(
  vb: [number, number, number, number],
  w: number,
  h: number,
  par: string | null | undefined,
): Affine {
  const [vx, vy, vw, vh] = vb
  let sx = vw ? w / vw : 1
  let sy = vh ? h / vh : 1
  const parts = (par || 'xMidYMid meet').trim().split(/\s+/)
  const align = parts[0] || 'xMidYMid'
  if (align !== 'none') {
    const s = parts[1] === 'slice' ? Math.max(sx, sy) : Math.min(sx, sy)
    sx = sy = s
  }
  let tx = -vx * sx
  let ty = -vy * sy
  if (align !== 'none') {
    const fx = align.includes('xMid') ? 0.5 : align.includes('xMax') ? 1 : 0
    const fy = align.includes('YMid') ? 0.5 : align.includes('YMax') ? 1 : 0
    tx += (w - vw * sx) * fx
    ty += (h - vh * sy) * fy
  }
  return [sx, 0, 0, sy, tx, ty]
}

/** Splits a cubic at t (de Casteljau). */
function splitCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): [Pt[], Pt[]] {
  const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t)
  const d = lerp(a, b, t), e = lerp(b, c, t)
  const f = lerp(d, e, t)
  return [[p0, a, d, f], [f, e, c, p3]]
}

function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]
}

/** The sub-cubic between t0 and t1. */
function subCubic(seg: Pt[], t0: number, t1: number): Pt[] {
  let s = seg
  if (t1 < 1) s = splitCubic(s[0], s[1], s[2], s[3], t1)[0]
  if (t0 > 0) s = splitCubic(s[0], s[1], s[2], s[3], t0 / t1)[1]
  return s
}

/**
 * Clips one closed subpath to a half-plane (Sutherland–Hodgman, but curve
 * aware): curve pieces inside are kept as cubics, and the gap left by each
 * outside run is bridged by a straight line along the clip edge. `side(p)` is
 * a signed distance, >= 0 inside.
 */
function clipHalfPlane(sub: Subpath, side: (p: Pt) => number): Subpath | null {
  const pts = sub.points
  const n = (pts.length - 1) / 3
  if (n < 1) return null
  let allIn = true, allOut = true
  for (const p of pts) {
    if (side(p) >= 0) allOut = false
    else allIn = false
  }
  if (allIn) return sub
  if (allOut) return null

  // Cut every segment where it crosses the edge, then keep the inside pieces.
  const pieces: { seg: Pt[]; inside: boolean }[] = []
  for (let i = 0; i < n; i++) {
    const seg = pts.slice(i * 3, i * 3 + 4)
    const ts: number[] = [0]
    const N = 24
    let prevT = 0
    let prevV = side(seg[0])
    for (let k = 1; k <= N; k++) {
      const t = k / N
      const v = side(cubicAt(seg[0], seg[1], seg[2], seg[3], t))
      if ((prevV < 0) !== (v < 0)) {
        let lo = prevT, hi = t, vlo = prevV
        for (let it = 0; it < 40; it++) {
          const mid = (lo + hi) / 2
          const vm = side(cubicAt(seg[0], seg[1], seg[2], seg[3], mid))
          if ((vm < 0) === (vlo < 0)) { lo = mid; vlo = vm } else hi = mid
        }
        ts.push((lo + hi) / 2)
      }
      prevT = t
      prevV = v
    }
    ts.push(1)
    for (let k = 0; k < ts.length - 1; k++) {
      const t0 = ts[k], t1 = ts[k + 1]
      if (t1 - t0 < 1e-9) continue
      const piece = subCubic(seg, t0, t1)
      const mid = cubicAt(seg[0], seg[1], seg[2], seg[3], (t0 + t1) / 2)
      pieces.push({ seg: piece, inside: side(mid) >= 0 })
    }
  }
  // Rotate so we start at the beginning of an inside run.
  let startIdx = pieces.findIndex((p, i) => p.inside && !pieces[(i - 1 + pieces.length) % pieces.length].inside)
  if (startIdx < 0) startIdx = 0
  const ordered = pieces.slice(startIdx).concat(pieces.slice(0, startIdx))
  const b = new PathBuilder()
  let started = false
  let pendingGap = false
  for (const p of ordered) {
    if (!p.inside) {
      pendingGap = true
      continue
    }
    if (!started) {
      b.moveTo(p.seg[0])
      started = true
    } else if (pendingGap) {
      b.lineTo(p.seg[0])
    }
    pendingGap = false
    b.cubicTo(p.seg[1], p.seg[2], p.seg[3])
  }
  if (!started) return null
  b.close()
  return b.finish()[0] ?? null
}

/** Clips closed subpaths to an axis-aligned rectangle; open ones are dropped if they leave it. */
export function clipSubpathsToRect(subs: Subpath[], r: Rect): Subpath[] {
  const sides: ((p: Pt) => number)[] = [
    (p) => p[0] - r.x0,
    (p) => r.x1 - p[0],
    (p) => p[1] - r.y0,
    (p) => r.y1 - p[1],
  ]
  const out: Subpath[] = []
  for (const s of subs) {
    let cur: Subpath | null = s
    for (const side of sides) {
      if (!cur) break
      cur = clipHalfPlane(cur, side)
    }
    if (cur) out.push(cur)
  }
  return out
}

/** Tight bounds of subpaths (samples each cubic, so handles that stick out don't count). */
export function boundsOf(subs: Subpath[]): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const add = (p: Pt) => {
    if (p[0] < x0) x0 = p[0]
    if (p[0] > x1) x1 = p[0]
    if (p[1] < y0) y0 = p[1]
    if (p[1] > y1) y1 = p[1]
  }
  for (const s of subs) {
    const pts = s.points
    add(pts[0])
    for (let i = 0; i + 3 < pts.length; i += 3) {
      for (let k = 1; k <= 8; k++) add(cubicAt(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], k / 8))
    }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 }
}

/** An axis-aligned rectangle as one closed cubic subpath, clockwise from the top left. */
export function rectSubpath(r: Rect): Subpath {
  const b = new PathBuilder()
  b.moveTo([r.x0, r.y0])
  b.lineTo([r.x1, r.y0])
  b.lineTo([r.x1, r.y1])
  b.lineTo([r.x0, r.y1])
  b.close()
  return b.finish()[0]
}
