/**
 * Drawing a Frame onto a 2D canvas.
 *
 * NOTHING EXPENSIVE PER FRAME: each outline's Path2D is built once and cached
 * by the outline array itself (outlines are immutable), and a moved, scaled,
 * turned or faded object is drawn with that same Path2D under a new
 * setTransform and globalAlpha. Only morphs and partial paths (Create/Write in
 * progress) make a fresh path, because their points really change.
 *
 * Scene units → pixels: the frame (height 8, width from config) is fitted
 * inside pxW × pxH and centred; the camera frame (object 0) pans and zooms it.
 * Line widths are stroke_width × 0.01 scene units, so they scale with the
 * picture (and with camera zoom, as in Manim), never with an object's own scale.
 */
import type { Subpath } from './geometry-types'
import { partialPaths } from './geometry'
import { apply, IDENTITY, matScale, mul, type Mat } from './math'
import { CAMERA, hasGeom } from './scene'
import type { DrawItem, Frame } from './frame'

export interface RenderOpts {
  pxW: number
  pxH: number
  /** Frame size in scene units. */
  fw: number
  fh: number
  /** Clear the area first (default true). */
  clear?: boolean
}

const pathCache = new WeakMap<Subpath[], Path2D>()
const hasPath2D = typeof Path2D !== 'undefined'

function buildPath(paths: Subpath[]): Path2D {
  const p = new Path2D()
  for (const s of paths) {
    const P = s.points
    if (!P.length) continue
    p.moveTo(P[0][0], P[0][1])
    for (let i = 1; i + 2 < P.length; i += 3) p.bezierCurveTo(P[i][0], P[i][1], P[i + 1][0], P[i + 1][1], P[i + 2][0], P[i + 2][1])
    if (s.closed) p.closePath()
  }
  return p
}

function cachedPath(paths: Subpath[]): Path2D {
  let p = pathCache.get(paths)
  if (!p) {
    p = buildPath(paths)
    pathCache.set(paths, p)
  }
  return p
}

/** Without Path2D (tests, old engines): trace onto the context directly. */
function trace(ctx: CanvasRenderingContext2D, paths: Subpath[]) {
  ctx.beginPath()
  for (const s of paths) {
    const P = s.points
    if (!P.length) continue
    ctx.moveTo(P[0][0], P[0][1])
    for (let i = 1; i + 2 < P.length; i += 3) ctx.bezierCurveTo(P[i][0], P[i][1], P[i + 1][0], P[i + 1][1], P[i + 2][0], P[i + 2][1])
    if (s.closed) ctx.closePath()
  }
}

function setT(ctx: CanvasRenderingContext2D, m: Mat) {
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5])
}

/**
 * The draw list for a frame: scene order, families parents-first, morphs in
 * their object's place. `roots` limits it to those objects' families (and
 * leaves out extras), for measuring one object as drawn.
 */
export function collectItems(f: Frame, roots?: number[]): DrawItem[] {
  const items: DrawItem[] = []
  const seen = new Set<number>()
  const { mobs } = f.scene
  const walk = (id: number) => {
    if (seen.has(id)) return
    seen.add(id)
    const o = f.over.get(id)
    if (o && o.hidden) return
    if (o && o.replace) { for (const it of o.replace) items.push(it); return }
    const mob = mobs.get(id)
    if (!mob) return
    if (hasGeom(mob)) {
      items.push(o
        ? { paths: mob.paths, m: o.m, style: o.style, alpha: o.alpha, partial: o.partial, z: mob.z, text: mob.text, image: mob.image }
        : { paths: mob.paths, m: mob.m, style: mob.style, alpha: 1, partial: null, z: mob.z, text: mob.text, image: mob.image })
    }
    for (const c of mob.children) walk(c)
  }
  for (const id of roots || f.scene.display) walk(id)
  if (!roots) for (const e of f.extras) items.push(e)
  if (items.some(it => it.z !== 0)) {
    const idx = new Map(items.map((it, i) => [it, i]))
    items.sort((a, b) => a.z - b.z || idx.get(a) - idx.get(b))
  }
  return items
}

/** Scene → device matrix for these options and the frame's camera. */
export function viewMatrix(f: Frame, o: RenderOpts, base: Mat = IDENTITY): Mat {
  const cam = f.over.get(CAMERA)?.m ?? f.scene.mobs.get(CAMERA)?.m ?? IDENTITY
  const c = apply(cam, [0, 0])
  const zoom = matScale(cam)
  const s = Math.min(o.pxW / o.fw, o.pxH / o.fh) / zoom
  return mul(base, [s, 0, 0, -s, o.pxW / 2 - s * c[0], o.pxH / 2 + s * c[1]])
}

export function renderFrame(ctx: CanvasRenderingContext2D, f: Frame, o: RenderOpts) {
  let base: Mat = IDENTITY
  if (typeof ctx.getTransform === 'function') {
    const t = ctx.getTransform()
    base = [t.a, t.b, t.c, t.d, t.e, t.f]
  }
  ctx.save()
  if (o.clear !== false) {
    setT(ctx, base)
    ctx.clearRect(0, 0, o.pxW, o.pxH)
  }
  const V = viewMatrix(f, o, base)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (const it of collectItems(f)) drawItem(ctx, it, V)
  ctx.restore()
}

function drawItem(ctx: CanvasRenderingContext2D, it: DrawItem, V: Mat) {
  const st = it.style
  const alpha = it.alpha
  if (alpha <= 0) return
  const M = mul(V, it.m)
  if (it.image) {
    // y is up in the scene and down in the image: flip, then fill the local box.
    const im = it.image
    if (!im.src) return
    ctx.setTransform(M[0], M[1], -M[2], -M[3], M[4], M[5])
    ctx.globalAlpha = Math.min(1, alpha * (st.fo > 0 ? st.fo : 1))
    try { ctx.drawImage(im.src, -im.w / 2, -im.h / 2, im.w, im.h) } catch { /* not ready yet */ }
    return
  }
  if (it.text) {
    const t = it.text
    const op = st.fo * alpha
    if (op <= 0) return
    // Drawn 100× larger under a 1/100 scale: browsers round tiny font sizes.
    const k = 0.01
    ctx.setTransform(M[0] * k, M[1] * k, -M[2] * k, -M[3] * k, M[4], M[5])
    ctx.globalAlpha = Math.min(1, op)
    ctx.fillStyle = st.fc
    const fam = t.family === 'mono' ? 'Menlo, Consolas, "Liberation Mono", monospace' : '"Liberation Sans", Arial, sans-serif'
    ctx.font = `${t.slant === 'italic' ? 'italic ' : ''}${t.weight === 'bold' ? 'bold ' : ''}${t.em * 100}px ${fam}`
    ctx.textAlign = t.left ? 'left' : 'center'
    ctx.textBaseline = 'middle'
    const lines = t.str.split('\n')
    const x0 = t.left ? (-t.w / 2) * 100 : 0
    lines.forEach((l, i) => ctx.fillText(l, x0, (i - (lines.length - 1) / 2) * t.em * 120))
    return
  }
  let paths = it.paths
  if (it.partial) {
    paths = partialPaths(paths, it.partial[0], it.partial[1])
    if (!paths.length) return
  }
  if (!paths.length) return
  const fillOp = st.fo * alpha, strokeOp = st.sw > 0 ? st.so * alpha : 0
  if (fillOp <= 0 && strokeOp <= 0) return
  setT(ctx, M)
  // A partial path is new every frame; anything else (including a morph's
  // blended points, which simply fall out of the weak cache) is looked up.
  const p2d = hasPath2D ? (it.partial ? buildPath(paths) : cachedPath(paths)) : null
  if (!p2d) trace(ctx, paths)
  if (fillOp > 0) {
    ctx.globalAlpha = Math.min(1, fillOp)
    ctx.fillStyle = st.fc
    if (p2d) ctx.fill(p2d)
    else ctx.fill()
  }
  if (strokeOp > 0) {
    ctx.globalAlpha = Math.min(1, strokeOp)
    ctx.strokeStyle = st.sc
    ctx.lineWidth = (st.sw * 0.01) / matScale(it.m)
    if (p2d) ctx.stroke(p2d)
    else ctx.stroke()
  }
}

/**
 * One object as drawn in a frame, in the terms Manim's tests use: its box,
 * first point, style (opacities include fades) and, mid-Create, where the
 * drawn part ends. For tests and for Python's reads of the current state.
 */
export function measure(f: Frame, id: number) {
  const items = collectItems(f, [id])
  let box: [number, number, number, number] | null = null
  let first: [number, number] | null = null, partialEnd: [number, number] | null = null
  for (const it of items) {
    let paths = it.partial ? partialPaths(it.paths, it.partial[0], it.partial[1]) : it.paths
    // Nothing drawn yet (Create at 0): Manim reports the point it starts from.
    if (it.partial && !paths.length && it.paths.length) {
      const p0 = it.paths[0].points[0]
      paths = [{ points: [p0], closed: false }]
    }
    for (const sp of paths) {
      for (const p of sp.points) {
        const q = apply(it.m, p)
        if (!first) first = q
        box = box ? [Math.min(box[0], q[0]), Math.min(box[1], q[1]), Math.max(box[2], q[0]), Math.max(box[3], q[1])] : [q[0], q[1], q[0], q[1]]
      }
    }
    if (it === items[0] && paths.length) {
      const last = paths[paths.length - 1].points
      partialEnd = apply(it.m, last[last.length - 1])
    }
  }
  const it = items[0]
  const st = it ? it.style : f.scene.mobs.get(id)?.style
  const b = box || [0, 0, 0, 0]
  const p3 = (p: [number, number] | null) => (p ? [p[0], p[1], 0] : null)
  return {
    center: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2, 0], width: b[2] - b[0], height: b[3] - b[1],
    left: b[0], right: b[2], bottom: b[1], top: b[3],
    first_point: p3(first), partial_end_point: p3(partialEnd),
    stroke_width: st ? st.sw : 0,
    stroke_opacity: st && it ? st.so * it.alpha : st ? st.so : 0,
    fill_opacity: st && it ? st.fo * it.alpha : st ? st.fo : 0,
    color: st ? (st.fo > 0 ? st.fc : st.sc) : null,
    fill_color: st ? st.fc : null,
    stroke_color: st ? st.sc : null,
    items: items.length,
  }
}
