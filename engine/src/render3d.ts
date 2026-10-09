/**
 * The 3D camera (Contract v4), Manim's ThreeDCamera: rotate the scene by
 * phi/theta/gamma about frame_center, divide by depth (focal_distance
 * perspective), zoom, then sort what is drawn back to front (painter's
 * algorithm, by each part's centre) and shade faces from the light source.
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

/** Brighten or darken a colour by Manim's light factor (0.5·(n·l)³, halved when negative). */
function shade(hex: string, n: V3, centre: V3): string {
  const rgb = parseColor(hex)
  if (!rgb) return hex
  const l: V3 = [LIGHT[0] - centre[0], LIGHT[1] - centre[1], LIGHT[2] - centre[2]]
  const ll = Math.hypot(...l) || 1
  let f = 0.5 * Math.pow((n[0] * l[0] + n[1] * l[1] + n[2] * l[2]) / ll, 3)
  if (f < 0) f *= 0.5
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v + f * 255))).toString(16).padStart(2, '0')
  return '#' + c(rgb[0]) + c(rgb[1]) + c(rgb[2])
}

/** Newell's method: the unit normal of a polygon (world coordinates). */
function normal(w: number[]): V3 {
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
  depth: number
  draw(ctx: CanvasRenderingContext2D, V: Mat): void
}

/**
 * Draw items through the camera. `flat2D` draws one flat item with a 2D map
 * (the renderer's own drawItem, so text, pictures, shadows and partial paths
 * behave as in 2D).
 */
export function render3D(ctx: CanvasRenderingContext2D, items: DrawItem[], V: Mat, cam: CamState | null,
  flat2D: (it: DrawItem, V: Mat) => void) {
  const P = projector(cam)
  const prepared: Prepared[] = []
  const hud: DrawItem[] = []
  for (const it of items) {
    if (it.fixed === 'frame' && P.three) { hud.push(it); continue }
    if (it.p3 && it.p3.length) {
      // A 3D polygon or curve: every point through the camera.
      const M = it.m3 ?? embed(it.m)
      let wpts: number[] = []
      for (let k = 0; k < it.p3.length; k += 3) wpts.push(...apply3(M, it.p3[k], it.p3[k + 1], it.p3[k + 2]))
      const full = wpts
      if (it.partial) wpts = partialPoly(wpts, it.partial[0], it.partial[1], !!it.closed3)
      if (wpts.length < 6) continue
      const scr: number[] = []
      let depth = 0
      for (let k = 0; k < wpts.length; k += 3) {
        const q = P.p(wpts[k], wpts[k + 1], wpts[k + 2])
        scr.push(q[0], q[1])
        depth += q[2]
      }
      depth /= wpts.length / 3
      let st = it.style
      if (it.shade3 && P.three && full.length >= 9) {
        const n = normal(full), c: V3 = [0, 0, 0]
        for (let k = 0; k < full.length; k += 3) { c[0] += full[k]; c[1] += full[k + 1]; c[2] += full[k + 2] }
        const cnt = full.length / 3
        c[0] /= cnt; c[1] /= cnt; c[2] /= cnt
        st = { ...st, fc: shade(st.fc, n, c), sc: shade(st.sc, n, c) }
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
          if (fillOp > 0) { g.globalAlpha = Math.min(1, fillOp); g.fillStyle = st.fc; g.fill() }
          if (strokeOp > 0) {
            g.globalAlpha = Math.min(1, strokeOp)
            g.strokeStyle = st.sc
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
    // Depth: of the item's centre (bbox of its outline), as Manim sorts by centre.
    let cdepth = o2[2]
    if (it.paths.length) {
      let sx = 0, sy = 0, n = 0
      for (const sp of it.paths) for (const p of sp.points) { sx += p[0]; sy += p[1]; n++ }
      if (n) { const c = apply3(M3, sx / n, sy / n, 0); cdepth = P.p(c[0], c[1], c[2])[2] }
    }
    // Stroke widths stay as in 2D: undo the map's own scale, which drawItem divides by.
    const keep = matScale(it.m) || 1, now = matScale(A) || 1
    const flat = { ...it, m: A, m3: undefined, style: it.style.sw > 0 ? { ...it.style, sw: it.style.sw * (now / keep) } : it.style }
    prepared.push({ it, depth: cdepth, draw: (_g, VV) => flat2D(flat, VV) })
  }
  if (P.three) {
    // Back to front; ties keep the scene's order.
    const order = new Map(prepared.map((p, i) => [p, i]))
    prepared.sort((a, b) => a.depth - b.depth || order.get(a) - order.get(b))
  }
  for (const p of prepared) p.draw(ctx, V)
  // Fixed-in-frame objects: flat on screen, on top.
  for (const it of hud) flat2D({ ...it, m3: undefined }, V)
}
