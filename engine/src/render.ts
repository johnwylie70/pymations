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
import { CAMERA, hasGeom, type Shadow } from './scene'
import { parseColor } from './color'
import { cssFamily } from './text'
import type { DrawItem, Frame } from './frame'

export interface RenderOpts {
  pxW: number
  pxH: number
  /** Frame size in scene units. */
  fw: number
  fh: number
  /** Clear the area first (default true). */
  clear?: boolean
  /** Scene transitions: an opacity for everything, a sideways shift (scene units), a clip [x0, x1] in pixels. */
  alpha?: number
  shiftX?: number
  clipX?: [number, number]
}

/** Multiplies every item's opacity while one frame is drawn (a crossfade). */
let alphaMul = 1

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
        ? { paths: mob.paths, m: o.m, style: o.style, alpha: o.alpha, partial: o.partial, z: mob.z, text: mob.text, image: o.image ?? mob.image, shadow: mob.shadow, evenodd: mob.evenodd }
        : { paths: mob.paths, m: mob.m, style: mob.style, alpha: 1, partial: null, z: mob.z, text: mob.text, image: mob.image, shadow: mob.shadow, evenodd: mob.evenodd })
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
  if (o.clipX) {
    setT(ctx, base)
    ctx.beginPath()
    ctx.rect(o.clipX[0], 0, Math.max(0, o.clipX[1] - o.clipX[0]), o.pxH)
    ctx.clip()
  }
  let V = viewMatrix(f, o, base)
  if (o.shiftX) V = mul(V, [1, 0, 0, 1, o.shiftX, 0])
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  alphaMul = o.alpha == null ? 1 : Math.max(0, Math.min(1, o.alpha))
  try {
    if (alphaMul > 0) for (const it of collectItems(f)) drawItem(ctx, alphaMul === 1 ? it : { ...it, alpha: it.alpha * alphaMul }, V)
  } finally {
    alphaMul = 1
  }
  ctx.restore()
}

/** Canvas shadow settings for a drop shadow, in device pixels (shadows ignore the transform). */
function setShadow(ctx: CanvasRenderingContext2D, sh: Shadow | undefined, pxPerUnit: number, alpha: number) {
  if (!sh) return
  const rgb = parseColor(sh.color) || [0, 0, 0]
  ctx.shadowColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.max(0, Math.min(1, sh.opacity * alpha))})`
  ctx.shadowBlur = sh.blur * pxPerUnit
  ctx.shadowOffsetX = sh.dx * pxPerUnit
  ctx.shadowOffsetY = -sh.dy * pxPerUnit
}

function clearShadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = 'rgba(0,0,0,0)'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
}

const roundCache = new Map<string, Path2D>()

function roundTrace(p: { moveTo: Function; arcTo: Function; closePath: Function }, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  const x = -w / 2, y = -h / 2
  p.moveTo(x + rr, y)
  p.arcTo(x + w, y, x + w, y + h, rr)
  p.arcTo(x + w, y + h, x, y + h, rr)
  p.arcTo(x, y + h, x, y, rr)
  p.arcTo(x, y, x + w, y, rr)
  p.closePath()
}

/** A rounded box centred on the origin, y down (the image's space); cached by size (null without Path2D). */
function roundBox(w: number, h: number, r: number): Path2D | null {
  if (!hasPath2D) return null
  const key = `${w}|${h}|${r}`
  let p = roundCache.get(key)
  if (p) return p
  p = new Path2D()
  roundTrace(p, w, h, r)
  if (roundCache.size > 500) roundCache.clear()
  roundCache.set(key, p)
  return p
}

/** Use a rounded box (clip, fill or stroke), with or without Path2D. */
function withBox(ctx: CanvasRenderingContext2D, box: Path2D | null, w: number, h: number, r: number, op: 'clip' | 'fill' | 'stroke') {
  if (box) { (ctx as any)[op](box); return }
  ctx.beginPath()
  roundTrace(ctx as any, w, h, r)
  ;(ctx as any)[op]()
}

/**
 * A big picture drawn small is downscaled ONCE to the size it is drawn at
 * (rounded up), and that copy is drawn from then on; a larger draw later makes
 * a larger copy. Live canvases (PycturesCanvas) are drawn as they are.
 */
const downCache = new WeakMap<object, { canvas: HTMLCanvasElement; k: number }>()

function sourceSize(src: CanvasImageSource): [number, number] {
  const s = src as any
  return [s.naturalWidth || s.videoWidth || s.width || 0, s.naturalHeight || s.videoHeight || s.height || 0]
}

function downscaled(src: CanvasImageSource, k: number): { img: CanvasImageSource; k: number } {
  if (k >= 0.5 || typeof document === 'undefined') return { img: src, k: 1 }
  const hit = downCache.get(src as object)
  if (hit && hit.k >= k) return { img: hit.canvas, k: hit.k }
  const [nw, nh] = sourceSize(src)
  // Round the scale up to the next power of two step, so a slow zoom does not rebuild every frame.
  const kk = Math.min(1, Math.pow(2, Math.ceil(Math.log2(k * 1.25))))
  if (kk >= 0.5 || !nw || !nh) return { img: src, k: 1 }
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(nw * kk))
  c.height = Math.max(1, Math.round(nh * kk))
  const g = c.getContext('2d')
  g.imageSmoothingQuality = 'high'
  g.drawImage(src, 0, 0, c.width, c.height)
  downCache.set(src as object, { canvas: c, k: kk })
  return { img: c, k: kk }
}

function drawImageItem(ctx: CanvasRenderingContext2D, it: DrawItem, M: Mat, pxPerUnit: number) {
  const im = it.image
  const st = it.style
  if (!im.src) return
  const alpha = Math.min(1, it.alpha * (st.fo > 0 ? st.fo : 1))
  if (alpha <= 0) return
  // y is up in the scene and down in the image: flip, then fill the local box.
  ctx.setTransform(M[0], M[1], -M[2], -M[3], M[4], M[5])
  ctx.globalAlpha = alpha
  const [nw, nh] = sourceSize(im.src)
  const [x0, y0, x1, y1] = im.crop || [0, 0, 1, 1]
  const drawnPx = Math.hypot(M[0], M[1]) * im.w
  let img = im.src, k = 1
  if (!im.live && nw && nh) ({ img, k } = downscaled(im.src, drawnPx / (nw * (x1 - x0))))
  const sx = x0 * nw * k, sy = (1 - y1) * nh * k, sw = (x1 - x0) * nw * k, sh = (y1 - y0) * nh * k
  const r = im.radius || 0
  const box = r > 0 || im.border ? roundBox(im.w, im.h, r) : null
  const draw = () => {
    try {
      if (nw && nh) ctx.drawImage(img, sx, sy, sw, sh, -im.w / 2, -im.h / 2, im.w, im.h)
      else ctx.drawImage(img, -im.w / 2, -im.h / 2, im.w, im.h)
    } catch { /* not decoded yet */ }
  }
  if (it.shadow) {
    if (r > 0) {
      // The shadow of the rounded box, under the picture.
      ctx.save()
      setShadow(ctx, it.shadow, pxPerUnit, alpha)
      ctx.fillStyle = '#000'
      withBox(ctx, box, im.w, im.h, r, 'fill')
      ctx.restore()
    } else {
      // Square corners: the shadow follows the picture's own transparency.
      setShadow(ctx, it.shadow, pxPerUnit, alpha)
      draw()
      clearShadow(ctx)
      if (!im.border) return
    }
  }
  if (r > 0) {
    ctx.save()
    withBox(ctx, box, im.w, im.h, r, 'clip')
    draw()
    ctx.restore()
  } else if (!it.shadow) draw()
  if (im.border && im.border.width > 0) {
    ctx.strokeStyle = im.border.color
    ctx.lineWidth = (im.border.width * 0.01) / matScale(it.m)
    withBox(ctx, box, im.w, im.h, r, 'stroke')
  }
}

function drawItem(ctx: CanvasRenderingContext2D, it: DrawItem, V: Mat) {
  const st = it.style
  const alpha = it.alpha
  if (alpha <= 0) return
  const M = mul(V, it.m)
  const pxPerUnit = matScale(V)
  if (it.image) {
    drawImageItem(ctx, it, M, pxPerUnit)
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
    const fam = t.family === 'mono' ? 'Menlo, Consolas, "Liberation Mono", monospace' : cssFamily(t.family || '')
    ctx.font = `${t.slant === 'italic' ? 'italic ' : ''}${t.weight === 'bold' ? 'bold ' : ''}${t.em * 100}px ${fam}`
    ctx.textAlign = t.left ? 'left' : 'center'
    ctx.textBaseline = 'middle'
    const lines = t.str.split('\n')
    const x0 = t.left ? (-t.w / 2) * 100 : 0
    setShadow(ctx, it.shadow, pxPerUnit, op)
    lines.forEach((l, i) => ctx.fillText(l, x0, (i - (lines.length - 1) / 2) * t.em * 120))
    if (it.shadow) clearShadow(ctx)
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
  const rule: CanvasFillRule = it.evenodd ? 'evenodd' : 'nonzero'
  // A shadow is cast by the fill if there is one, else by the stroke.
  setShadow(ctx, it.shadow, pxPerUnit, Math.max(fillOp, strokeOp))
  if (fillOp > 0) {
    ctx.globalAlpha = Math.min(1, fillOp)
    ctx.fillStyle = st.fc
    if (p2d) ctx.fill(p2d, rule)
    else ctx.fill(rule)
    if (it.shadow) clearShadow(ctx)
  }
  if (strokeOp > 0) {
    ctx.globalAlpha = Math.min(1, strokeOp)
    ctx.strokeStyle = st.sc
    ctx.lineWidth = (st.sw * 0.01) / matScale(it.m)
    if (p2d) ctx.stroke(p2d)
    else ctx.stroke()
  }
  if (it.shadow) clearShadow(ctx)
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
    // fillText runs and pictures have no outline: their box corners stand in.
    const rect = it.text || it.image
    if (rect && !paths.length) {
      for (const c of [[-rect.w / 2, -rect.h / 2], [rect.w / 2, -rect.h / 2], [rect.w / 2, rect.h / 2], [-rect.w / 2, rect.h / 2]] as Array<[number, number]>) {
        const q = apply(it.m, c)
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
