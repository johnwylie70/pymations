/**
 * The 3D camera (Contract v4), Manim's ThreeDCamera: rotate the scene by
 * phi/theta/gamma about frame_center, divide by depth (focal_distance
 * perspective), zoom, then sort the shaded parts back to front (painter's
 * algorithm, by each part's bounding-box centre) and light each face with
 * Manim's corner-to-corner gradient.
 *
 * WHAT IS CACHED: flat objects (text, pictures, 2D shapes turned in 3D) are
 * drawn through one affine map per object, built from where three of their
 * local points land, so their Path2D is still built once. Only 3D polygons
 * (faces, 3D curves) are projected point by point each frame.
 */
import type { Mat } from './math'
import { mul, invert, matScale } from './math'
import { apply3, embed, mul3, proj, type Mat3, type V3 } from './math3'
import type { CamState } from './ops'
import type { DrawItem } from './frame'
import { parseColor } from './color'

/** Manim's light: 9·DOWN + 7·LEFT + 10·OUT, in the scene. */
const LIGHT: V3 = [-7, -9, 10]

export interface Projector {
  three: boolean
  /** Scene point → [x, y, depth] in the camera's 2D frame (scene units). */
  p(x: number, y: number, z: number): V3
}

function rz(a: number): number[] { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1] }
function rx(a: number): number[] { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c] }
function m33(A: number[], B: number[]): number[] {
  const r = new Array(9).fill(0)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]
  return r
}

export function projector(cam: CamState | null): Projector {
  if (!cam || !cam.three_d) return { three: false, p: (x, y, z) => [x, y, z] }
  // Manim: rotation(gamma, OUT) · rotation(−phi, RIGHT) · rotation(−theta − 90°, OUT).
  const R = m33(m33(rz(cam.gamma), rx(-cam.phi)), rz(-cam.theta - Math.PI / 2))
  const [cx, cy, cz] = cam.center
  const f = cam.focal, zoom = cam.zoom
  return {
    three: true,
    p(x, y, z) {
      x -= cx; y -= cy; z -= cz
      const X = R[0] * x + R[1] * y + R[2] * z, Y = R[3] * x + R[4] * y + R[5] * z, Z = R[6] * x + R[7] * y + R[8] * z
      const k = f - Z > 0 ? f / (f - Z) : 1e6
      return [X * k * zoom, Y * k * zoom, Z]
    },
  }
}

/** Manim's get_shaded_rgb: rgb (0–1) + 0.5·(n·to_light)³, halved when negative (not clipped). */
export function shadeRGB(rgb: V3, point: V3, n: V3): V3 {
  const l: V3 = [LIGHT[0] - point[0], LIGHT[1] - point[1], LIGHT[2] - point[2]]
  const ll = Math.hypot(...l) || 1
  let f = 0.5 * Math.pow((n[0] * l[0] + n[1] * l[1] + n[2] * l[2]) / ll, 3)
  if (f < 0) f *= 0.5
  return [rgb[0] + f, rgb[1] + f, rgb[2] + f]
}

function shade(hex: string, n: V3, point: V3): string {
  const rgb = parseColor(hex)
  if (!rgb) return hex
  const r = shadeRGB([rgb[0] / 255, rgb[1] / 255, rgb[2] / 255], point, n)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')
  return '#' + c(r[0]) + c(r[1]) + c(r[2])
}

/**
 * The two corners Manim's 3D gradient runs between (get_3d_vmob_start_corner /
 * end_corner) for a polygon of corners: the first corner, and the point at
 * index (4n // 6)·3 of its cubic points (n straight curves of 4 points each).
 */
export function gradientCorners(w: number[]): { start: V3; end: V3 } {
  const n = w.length / 3
  const idx = Math.floor((4 * n) / 6) * 3
  const c = Math.floor(idx / 4) % n, k = idx % 4, d = (c + 1) % n
  const t = k / 3
  return {
    start: [w[0], w[1], w[2]],
    end: [0, 1, 2].map(i => w[3 * c + i] + (w[3 * d + i] - w[3 * c + i]) * t) as V3,
  }
}

/** Newell's method: the unit normal of a polygon (world coordinates). */
export function normal(w: number[]): V3 {
  let nx = 0, ny = 0, nz = 0
  const n = w.length / 3
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const x1 = w[3 * i], y1 = w[3 * i + 1], z1 = w[3 * i + 2], x2 = w[3 * j], y2 = w[3 * j + 1], z2 = w[3 * j + 2]
    nx += (y1 - y2) * (z1 + z2); ny += (z1 - z2) * (x1 + x2); nz += (x1 - x2) * (y1 + y2)
  }
  const l = Math.hypot(nx, ny, nz) || 1
  return [nx / l, ny / l, nz / l]
}

/** The part of a polyline from fraction a to b of its 3D length (Create on a 3D curve or face). */
function partialPoly(w: number[], a: number, b: number, closed: boolean): number[] {
  const pts: number[] = closed && w.length >= 6 ? [...w, w[0], w[1], w[2]] : w
  const n = pts.length / 3
  const cum = [0]
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[3 * i] - pts[3 * i - 3], pts[3 * i + 1] - pts[3 * i - 2], pts[3 * i + 2] - pts[3 * i - 1]))
  const L = cum[n - 1] || 1
  const A = a * L, B = b * L
  const out: number[] = []
  const at = (d: number) => {
    let i = 1
    while (i < n - 1 && cum[i] < d) i++
    const t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1)
    return [0, 1, 2].map(c => pts[3 * (i - 1) + c] + (pts[3 * i + c] - pts[3 * (i - 1) + c]) * t)
  }
  out.push(...at(A))
  for (let i = 0; i < n; i++) if (cum[i] > A && cum[i] < B) out.push(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2])
  out.push(...at(B))
  return out
}

/** The 3D map an item is drawn with: its own, adjusted by any 2D change an animation made on top. */
export function reconcile(m2: Mat, m3: Mat3 | undefined): Mat3 | undefined {
  if (!m3) return undefined
  const P = proj(m3)
  if (P.every((v, i) => Math.abs(v - m2[i]) < 1e-12)) return m3
  const det = P[0] * P[3] - P[1] * P[2]
  const D: Mat = Math.abs(det) < 1e-9 ? [1, 0, 0, 1, m2[4] - P[4], m2[5] - P[5]] : mul(m2, invert(P))
  return mul3(embed(D), m3)
}

interface Prepared {
  it: DrawItem
  /** Camera-space z of the part's bounding-box centre; null = drawn after every shaded part, in scene order (Manim's z_key = inf). */
  depth: number | null
  draw(ctx: CanvasRenderingContext2D, V: Mat): void
}

/** Camera-space z of a point (Manim's rot_matrix · p; the order is all that matters). */
function camZ(P: Projector, x: number, y: number, z: number): number {
  return P.p(x, y, z)[2]
}

/**
 * Draw items through the camera. `flat2D` draws one flat item with a 2D map
 * (the renderer's own drawItem, so text, pictures, shadows and partial paths
 * behave as in 2D).
 *
 * ORDER, as Manim's ThreeDCamera: parts shaded in 3D (faces) are sorted by the
 * camera-space depth of their bounding-box centre, farthest first; everything
 * else (axes, text, 3D curves, fixed-in-frame objects) is drawn after them, in
 * scene order.
 */
export function render3D(ctx: CanvasRenderingContext2D, items: DrawItem[], V: Mat, cam: CamState | null,
  flat2D: (it: DrawItem, V: Mat) => void) {
  const P = projector(cam)
  const prepared: Prepared[] = []
  for (const it of items) {
    if (it.fixed === 'frame' && P.three) {
      prepared.push({ it, depth: null, draw: (_g, VV) => flat2D({ ...it, m3: undefined }, VV) })
      continue
    }
    if (it.p3 && it.p3.length) {
      // A 3D polygon or curve: every point through the camera.
      const M = it.m3 ?? embed(it.m)
      let wpts: number[] = []
      for (let k = 0; k < it.p3.length; k += 3) wpts.push(...apply3(M, it.p3[k], it.p3[k + 1], it.p3[k + 2]))
      const full = wpts
      if (it.partial) {
        // Nothing of it drawn yet (a Create not started on this piece): nothing, not a round-capped dot.
        if (it.partial[1] - it.partial[0] <= 1e-9) continue
        wpts = partialPoly(wpts, it.partial[0], it.partial[1], !!it.closed3)
      }
      if (wpts.length < 6) continue
      const scr: number[] = []
      for (let k = 0; k < wpts.length; k += 3) {
        const q = P.p(wpts[k], wpts[k + 1], wpts[k + 2])
        scr.push(q[0], q[1])
      }
      const st = it.style
      const shaded = !!it.shade3 && P.three
      let depth: number | null = null
      // Shaded faces: Manim's gradient from the start corner to the end corner, each lit by the light.
      let grad: { a: V3; b: V3; fill: [string, string]; stroke: [string, string] } | null = null
      if (shaded) {
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
        for (let k = 0; k < full.length; k += 3) {
          x0 = Math.min(x0, full[k]); x1 = Math.max(x1, full[k]); y0 = Math.min(y0, full[k + 1]); y1 = Math.max(y1, full[k + 1]); z0 = Math.min(z0, full[k + 2]); z1 = Math.max(z1, full[k + 2])
        }
        depth = camZ(P, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
        if (full.length >= 9) {
          const n = normal(full), { start, end } = gradientCorners(full)
          grad = {
            a: P.p(...start), b: P.p(...end),
            fill: [shade(st.fc, n, start), shade(st.fc, n, end)],
            stroke: [shade(st.sc, n, start), shade(st.sc, n, end)],
          }
        }
      }
      const closed = !!it.closed3 && !it.partial
      prepared.push({
        it, depth,
        draw: (g, VV) => {
          const alpha = it.alpha
          const fillOp = closed ? st.fo * alpha : 0, strokeOp = st.sw > 0 ? st.so * alpha : 0
          if (fillOp <= 0 && strokeOp <= 0) return
          g.setTransform(VV[0], VV[1], VV[2], VV[3], VV[4], VV[5])
          g.beginPath()
          g.moveTo(scr[0], scr[1])
          for (let k = 2; k < scr.length; k += 2) g.lineTo(scr[k], scr[k + 1])
          if (closed) g.closePath()
          const paint = (pair: [string, string]): string | CanvasGradient => {
            if (!grad || pair[0] === pair[1]) return pair[0]
            const lg = g.createLinearGradient(grad.a[0], grad.a[1], grad.b[0], grad.b[1])
            lg.addColorStop(0, pair[0]); lg.addColorStop(1, pair[1])
            return lg
          }
          if (fillOp > 0) { g.globalAlpha = Math.min(1, fillOp); g.fillStyle = grad ? paint(grad.fill) : st.fc; g.fill() }
          if (strokeOp > 0) {
            g.globalAlpha = Math.min(1, strokeOp)
            g.strokeStyle = grad ? paint(grad.stroke) : st.sc
            // Manim keeps stroke widths in frame units: scale by the camera's zoom only.
            g.lineWidth = (st.sw * 0.01) * (cam && cam.three_d ? cam.zoom : 1)
            g.stroke()
          }
        },
      })
      continue
    }
    // A flat item (2D shape, text, picture): one affine map from where three local points land.
    const M3 = it.m3 ?? embed(it.m)
    const o = apply3(M3, 0, 0, 0), ex = apply3(M3, 1, 0, 0), ey = apply3(M3, 0, 1, 0)
    let o2: V3, x2: V3, y2: V3
    if (it.fixed === 'orientation' && P.three) {
      // Placed by the camera, never turned: the 2D map, moved to where its origin projects.
      o2 = P.p(o[0], o[1], o[2])
      const L = proj(M3)
      x2 = [o2[0] + L[0], o2[1] + L[1], o2[2]]
      y2 = [o2[0] + L[2], o2[1] + L[3], o2[2]]
    } else {
      o2 = P.p(o[0], o[1], o[2]); x2 = P.p(ex[0], ex[1], ex[2]); y2 = P.p(ey[0], ey[1], ey[2])
    }
    const A: Mat = [x2[0] - o2[0], x2[1] - o2[1], y2[0] - o2[0], y2[1] - o2[1], o2[0], o2[1]]
    // Stroke widths stay as in 2D: undo the map's own scale, which drawItem divides by.
    // The item's own scale is that of its plane in 3D (|ex × ey|): its 2D front view collapses when it is turned edge-on (a z axis).
    const ux = ex[0] - o[0], uy = ex[1] - o[1], uz = ex[2] - o[2], vx = ey[0] - o[0], vy = ey[1] - o[1], vz = ey[2] - o[2]
    const keep = Math.sqrt(Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)) || 1, now = matScale(A) || 1
    let style = it.style.sw > 0 ? { ...it.style, sw: it.style.sw * (now / keep) } : it.style
    let depth: number | null = null
    if (it.shade3 && P.three) {
      // A flat shape shaded in 3D (set_shade_in_3d): sorted with the faces, lit at its centre.
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const sp of it.paths) for (const p of sp.points) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]) }
      const c = x0 <= x1 ? apply3(M3, (x0 + x1) / 2, (y0 + y1) / 2, 0) : o
      depth = camZ(P, c[0], c[1], c[2])
      const u: V3 = [ex[0] - o[0], ex[1] - o[1], ex[2] - o[2]], v: V3 = [ey[0] - o[0], ey[1] - o[1], ey[2] - o[2]]
      const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
      const nl = Math.hypot(...n) || 1
      const nn: V3 = [n[0] / nl, n[1] / nl, n[2] / nl]
      style = { ...style, fc: shade(style.fc, nn, c), sc: shade(style.sc, nn, c) }
    }
    const flat = { ...it, m: A, m3: undefined, style }
    prepared.push({ it, depth, draw: (_g, VV) => flat2D(flat, VV) })
  }
  if (P.three) {
    // Shaded parts back to front (ties keep the scene's order), then the rest in scene order.
    const order = new Map(prepared.map((p, i) => [p, i]))
    prepared.sort((a, b) => {
      if (a.depth == null || b.depth == null) return a.depth == null && b.depth == null ? order.get(a) - order.get(b) : a.depth == null ? 1 : -1
      return a.depth - b.depth || order.get(a) - order.get(b)
    })
  }
  for (const p of prepared) p.draw(ctx, V)
}
