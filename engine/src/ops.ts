/**
 * Instant changes to an object (Manim's Mobject methods), resolved here at the
 * timeline cursor so Python never needs coordinates: shift, move_to, next_to,
 * to_edge, arrange, scale, rotate, set_color and the rest. The same functions
 * build the end state of `.animate`.
 *
 * Defaults follow Manim: next_to/arrange buff 0.25, to_edge/to_corner buff 0.5,
 * scale and rotate about the object's centre.
 */
import type { Pt } from './geometry-types'
import { IDENTITY, mul, rotateAbout, scaleAbout, translate, type Mat } from './math'
import { polySub, smoothSub } from './geometry'
import { setNumberValue } from './kinds'
import {
  become, boxCenter, copyFamily, critical, family, familyBox, hasGeom, styleFamily,
  transformFamily, type ImageRef, type Style, type World,
} from './scene'
import { endPoint, isMobRef, normArgs, num, resolvePoint, resolveTarget, resolveVec, type Kw } from './args'
import { lerpColor, normColor } from './color'

export interface OpEnv {
  /** Frame size used for to_edge/to_corner (the scene's, not the camera's). */
  fw: number
  fh: number
}

type OpFn = (w: World, id: number, a: Kw, env: OpEnv) => void

const ORIGIN: Pt = [0, 0]
const RIGHT: Pt = [1, 0]
const UP: Pt = [0, 1]
const BUFF = 0.25
const EDGE_BUFF = 0.5

function boxOrPoint(w: World, v: unknown): [number, number, number, number] {
  if (isMobRef(v)) return familyBox(w, resolveTarget(w, v))
  const p = resolvePoint(w, v)
  return [p[0], p[1], p[0], p[1]]
}

function shiftBy(w: World, id: number, d: Pt) {
  if (d[0] || d[1]) transformFamily(w, id, translate(d[0], d[1]))
}

/** about_point / about_edge → the fixed point of a scale or turn (default: centre). */
function aboutPoint(w: World, id: number, a: Kw): Pt {
  if (a.about_point != null) return resolvePoint(w, a.about_point)
  const box = familyBox(w, id)
  if (a.about_edge != null) return critical(box, resolveVec(w, a.about_edge, ORIGIN))
  return boxCenter(box)
}

function sign(v: number) {
  return v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0
}

/** Rotation about a 3D axis, projected onto the screen plane (Rodrigues, top-left 2×2). */
export function rotationMat(angle: number, axis: unknown, about: Pt): Mat {
  let ax = 0, ay = 0, az = 1
  if (Array.isArray(axis)) { ax = Number(axis[0]) || 0; ay = Number(axis[1]) || 0; az = Number(axis[2]) || 0 }
  const n = Math.hypot(ax, ay, az) || 1
  ax /= n; ay /= n; az /= n
  if (Math.abs(Math.abs(az) - 1) < 1e-9) return rotateAbout(angle * az, about)
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c
  const r00 = c + ax * ax * t, r01 = ax * ay * t - az * s
  const r10 = ay * ax * t + az * s, r11 = c + ay * ay * t
  // Column-major canvas order: a=r00, b=r10, c=r01, d=r11.
  const R: Mat = [r00, r10, r01, r11, 0, 0]
  return mul(translate(about[0], about[1]), mul(R, translate(-about[0], -about[1])))
}

/** A list of colours (set_color([...]), set_color_by_gradient): spread over the drawn parts, as Manim does. */
export function isColorList(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.length > 0 && v.every(c => typeof c === 'string' || Array.isArray(c))
}

function gradientAt(cols: string[], t: number): string {
  if (cols.length === 1) return cols[0]
  const x = Math.max(0, Math.min(1, t)) * (cols.length - 1)
  const i = Math.min(cols.length - 2, Math.floor(x))
  return lerpColor(cols[i], cols[i + 1], x - i)
}

function setColorFamily(w: World, id: number, color: unknown, which: 'both' | 'fill' | 'stroke' = 'both') {
  if (color == null) return
  const put = (s: Style, c: string): Style => (which === 'fill' ? { ...s, fc: c } : which === 'stroke' ? { ...s, sc: c } : { ...s, sc: c, fc: c })
  if (isColorList(color)) {
    const cols = color.map(c => normColor(c, '#FFFFFF'))
    const parts = family(w, id).filter(i => hasGeom(w.get(i)))
    parts.forEach((i, k) => { const m = w.get(i); w.set({ ...m, style: put(m.style, gradientAt(cols, parts.length > 1 ? k / (parts.length - 1) : 0)) }) })
    return
  }
  const c = normColor(color, '#FFFFFF')
  styleFamily(w, id, s => put(s, c))
}

function firstLeafStyle(w: World, id: number) {
  for (const i of family(w, id)) {
    const m = w.get(i)
    if (hasGeom(m)) return m.style
  }
  return w.get(id).style
}

function scaleToFit(w: World, id: number, dim: 0 | 1, size: number, stretch = false) {
  const b = familyBox(w, id)
  const cur = dim === 0 ? b[2] - b[0] : b[3] - b[1]
  if (cur <= 1e-12) return
  const k = size / cur
  const c = boxCenter(b)
  transformFamily(w, id, stretch ? scaleAbout(dim === 0 ? k : 1, dim === 0 ? 1 : k, c) : scaleAbout(k, k, c))
}

function nextTo(w: World, id: number, a: Kw) {
  const target = boxOrPoint(w, a.mobject_or_point ?? ORIGIN)
  const dir = resolveVec(w, a.direction, RIGHT)
  const edge = resolveVec(w, a.aligned_edge, ORIGIN)
  const buff = num(a.buff, BUFF)
  const tp = critical(target, [edge[0] + dir[0], edge[1] + dir[1]])
  const me = critical(familyBox(w, id), [edge[0] - dir[0], edge[1] - dir[1]])
  shiftBy(w, id, [tp[0] - me[0] + buff * dir[0], tp[1] - me[1] + buff * dir[1]])
}

function toEdge(w: World, id: number, dir: Pt, buff: number, env: OpEnv) {
  const target: Pt = [sign(dir[0]) * env.fw / 2, sign(dir[1]) * env.fh / 2]
  const me = critical(familyBox(w, id), dir)
  shiftBy(w, id, [
    (target[0] - me[0] - buff * sign(dir[0])) * Math.abs(sign(dir[0])),
    (target[1] - me[1] - buff * sign(dir[1])) * Math.abs(sign(dir[1])),
  ])
}

/** Chain next_to through the children, then put the group back on its old centre (center=True). */
function arrange(w: World, id: number, a: Kw) {
  const kids = w.get(id).children
  const dir = resolveVec(w, a.direction, RIGHT)
  const buff = num(a.buff, BUFF)
  const edge = a.aligned_edge != null ? resolveVec(w, a.aligned_edge, ORIGIN) : ORIGIN
  const before = boxCenter(familyBox(w, id))
  for (let i = 1; i < kids.length; i++) nextTo(w, kids[i], { mobject_or_point: kids[i - 1], direction: dir, buff, aligned_edge: edge })
  if (a.center !== false) {
    const c = boxCenter(familyBox(w, id))
    shiftBy(w, id, [before[0] - c[0], before[1] - c[1]])
  }
}

function arrangeInGrid(w: World, id: number, a: Kw) {
  const kids = w.get(id).children
  const n = kids.length
  if (!n) return
  const start = boxCenter(familyBox(w, id))
  let rows = a.rows != null ? Number(a.rows) : 0
  let cols = a.cols != null ? Number(a.cols) : 0
  if (!rows && !cols) { cols = Math.ceil(Math.sqrt(n)); rows = Math.ceil(n / cols) }
  else if (!rows) rows = Math.ceil(n / cols)
  else if (!cols) cols = Math.ceil(n / rows)
  let bx = BUFF, by = BUFF
  if (Array.isArray(a.buff)) { bx = num(a.buff[0], BUFF); by = num(a.buff[1], BUFF) }
  else if (a.buff != null) bx = by = num(a.buff, BUFF)
  // flow_order: the first letter is the fill direction, the second the next line's ("rd" = rows first).
  const flow = String(a.flow_order || 'rd').toLowerCase()
  const cell = (i: number): [number, number] => {
    const p = flow[0], q = flow[1] || (p === 'r' || p === 'l' ? 'd' : 'r')
    if (p === 'r' || p === 'l') {
      const pos = i % cols, other = Math.floor(i / cols)
      return [q === 'u' ? rows - 1 - other : other, p === 'l' ? cols - 1 - pos : pos]
    }
    const pos = i % rows, other = Math.floor(i / rows)
    return [p === 'u' ? rows - 1 - pos : pos, q === 'l' ? cols - 1 - other : other]
  }
  // Rows/columns no object lands in take no room (rows=2, cols=3 with 4 objects filled down uses 2 columns).
  const cells = kids.map((_, i) => cell(i))
  let usedR = 0, usedC = 0
  for (const [r, c] of cells) { usedR = Math.max(usedR, r + 1); usedC = Math.max(usedC, c + 1) }
  rows = Math.min(rows, usedR); cols = Math.min(cols, usedC)
  const boxes = kids.map(k => familyBox(w, k))
  const colW = new Array(cols).fill(0), rowH = new Array(rows).fill(0)
  boxes.forEach((b, i) => {
    const [r, c] = cells[i]
    if (r >= rows || c >= cols) return
    colW[c] = Math.max(colW[c], b[2] - b[0])
    rowH[r] = Math.max(rowH[r], b[3] - b[1])
  })
  const totalW = colW.reduce((s, v) => s + v, 0) + bx * (cols - 1)
  const totalH = rowH.reduce((s, v) => s + v, 0) + by * (rows - 1)
  // cell_alignment: where each object sits in its cell (centre by default).
  const al = a.cell_alignment != null ? resolveVec(w, a.cell_alignment, ORIGIN) : ORIGIN
  kids.forEach((k, i) => {
    const [r, c] = cells[i]
    if (r >= rows || c >= cols) return
    const x = -totalW / 2 + colW.slice(0, c).reduce((s, v) => s + v, 0) + bx * c + colW[c] / 2
    const y = totalH / 2 - rowH.slice(0, r).reduce((s, v) => s + v, 0) - by * r - rowH[r] / 2
    const target: Pt = [start[0] + x + al[0] * colW[c] / 2, start[1] + y + al[1] * rowH[r] / 2]
    const me = critical(boxes[i], al)
    shiftBy(w, k, [target[0] - me[0], target[1] - me[1]])
  })
}

const SETTERS: Record<string, (w: World, id: number, v: any, env: OpEnv) => void> = {
  width: (w, id, v) => scaleToFit(w, id, 0, num(v, 1)),
  height: (w, id, v) => scaleToFit(w, id, 1, num(v, 1)),
  color: (w, id, v) => setColorFamily(w, id, v),
  fill_color: (w, id, v) => { const c = normColor(v, '#FFFFFF'); styleFamily(w, id, s => ({ ...s, fc: c })) },
  stroke_color: (w, id, v) => { const c = normColor(v, '#FFFFFF'); styleFamily(w, id, s => ({ ...s, sc: c })) },
  fill_opacity: (w, id, v) => styleFamily(w, id, s => ({ ...s, fo: num(v, s.fo) })),
  stroke_opacity: (w, id, v) => styleFamily(w, id, s => ({ ...s, so: num(v, s.so) })),
  stroke_width: (w, id, v) => styleFamily(w, id, s => ({ ...s, sw: num(v, s.sw) })),
  opacity: (w, id, v) => styleFamily(w, id, s => ({ ...s, fo: num(v, 1), so: num(v, 1) })),
  z_index: (w, id, v) => { for (const i of family(w, id)) w.update(i, { z: num(v, 0) }) },
  x: (w, id, v) => { const c = boxCenter(familyBox(w, id)); shiftBy(w, id, [num(v, 0) - c[0], 0]) },
  y: (w, id, v) => { const c = boxCenter(familyBox(w, id)); shiftBy(w, id, [0, num(v, 0) - c[1]]) },
}

export const OPS: Record<string, { params: string[]; run: OpFn }> = {
  shift: {
    params: ['*vectors'],
    run: (w, id, a) => {
      const vs: unknown[] = a.vectors || []
      let dx = 0, dy = 0
      for (const v of vs) { const p = resolvePoint(w, v); dx += p[0]; dy += p[1] }
      shiftBy(w, id, [dx, dy])
    },
  },
  move_to: {
    params: ['point_or_mobject', 'aligned_edge'],
    run: (w, id, a) => {
      const edge = resolveVec(w, a.aligned_edge, ORIGIN)
      const target = isMobRef(a.point_or_mobject)
        ? critical(familyBox(w, resolveTarget(w, a.point_or_mobject)), edge)
        : resolvePoint(w, a.point_or_mobject ?? ORIGIN)
      const me = critical(familyBox(w, id), edge)
      const mask = Array.isArray(a.coor_mask) ? [num(a.coor_mask[0], 1), num(a.coor_mask[1], 1)] : [1, 1]
      shiftBy(w, id, [(target[0] - me[0]) * mask[0], (target[1] - me[1]) * mask[1]])
    },
  },
  center: { params: [], run: (w, id) => { const c = boxCenter(familyBox(w, id)); shiftBy(w, id, [-c[0], -c[1]]) } },
  next_to: { params: ['mobject_or_point', 'direction', 'buff', 'aligned_edge'], run: (w, id, a) => nextTo(w, id, a) },
  to_edge: {
    params: ['edge', 'buff'],
    run: (w, id, a, env) => toEdge(w, id, resolveVec(w, a.edge, [-1, 0]), num(a.buff, EDGE_BUFF), env),
  },
  to_corner: {
    params: ['corner', 'buff'],
    run: (w, id, a, env) => toEdge(w, id, resolveVec(w, a.corner, [-1, -1]), num(a.buff, EDGE_BUFF), env),
  },
  align_to: {
    params: ['mobject_or_point', 'direction'],
    run: (w, id, a) => {
      const dir = resolveVec(w, a.direction, ORIGIN)
      const tp = critical(boxOrPoint(w, a.mobject_or_point), dir)
      const me = critical(familyBox(w, id), dir)
      shiftBy(w, id, [dir[0] ? tp[0] - me[0] : 0, dir[1] ? tp[1] - me[1] : 0])
    },
  },
  arrange: { params: ['direction', 'buff', 'center'], run: (w, id, a) => arrange(w, id, a) },
  arrange_in_grid: { params: ['rows', 'cols', 'buff'], run: (w, id, a) => arrangeInGrid(w, id, a) },
  scale: {
    params: ['scale_factor', 'about_point', 'about_edge'],
    run: (w, id, a) => {
      const f = a.scale_factor
      const sx = Array.isArray(f) ? num(f[0], 1) : num(f, 1)
      const sy = Array.isArray(f) ? num(f[1], 1) : sx
      transformFamily(w, id, scaleAbout(sx, sy, aboutPoint(w, id, a)))
    },
  },
  rotate: {
    params: ['angle', 'axis', 'about_point', 'about_edge'],
    run: (w, id, a) => transformFamily(w, id, rotationMat(num(a.angle, 0), a.axis, aboutPoint(w, id, a))),
  },
  rotate_about_origin: {
    params: ['angle', 'axis'],
    run: (w, id, a) => transformFamily(w, id, rotationMat(num(a.angle, 0), a.axis, ORIGIN)),
  },
  flip: {
    params: ['axis', 'about_point', 'about_edge'],
    run: (w, id, a) => transformFamily(w, id, rotationMat(Math.PI, a.axis ?? [0, 1, 0], aboutPoint(w, id, a))),
  },
  stretch: {
    params: ['factor', 'dim', 'about_point', 'about_edge'],
    run: (w, id, a) => {
      const f = num(a.factor, 1), d = num(a.dim, 0)
      transformFamily(w, id, scaleAbout(d === 0 ? f : 1, d === 1 ? f : 1, aboutPoint(w, id, a)))
    },
  },
  scale_to_fit_width: { params: ['width'], run: (w, id, a) => scaleToFit(w, id, 0, num(a.width, 1)) },
  scale_to_fit_height: { params: ['height'], run: (w, id, a) => scaleToFit(w, id, 1, num(a.height, 1)) },
  set_width: { params: ['width', 'stretch'], run: (w, id, a) => scaleToFit(w, id, 0, num(a.width, 1), !!a.stretch) },
  set_height: { params: ['height', 'stretch'], run: (w, id, a) => scaleToFit(w, id, 1, num(a.height, 1), !!a.stretch) },
  stretch_to_fit_width: { params: ['width'], run: (w, id, a) => scaleToFit(w, id, 0, num(a.width, 1), true) },
  stretch_to_fit_height: { params: ['height'], run: (w, id, a) => scaleToFit(w, id, 1, num(a.height, 1), true) },
  set_x: { params: ['x'], run: (w, id, a, env) => SETTERS.x(w, id, a.x, env) },
  set_y: { params: ['y'], run: (w, id, a, env) => SETTERS.y(w, id, a.y, env) },
  set: {
    params: [],
    run: (w, id, a, env) => {
      for (const k of Object.keys(a)) {
        const f = SETTERS[k]
        if (!f) throw new Error(`set() does not know "${k}"`)
        f(w, id, a[k], env)
      }
    },
  },
  set_color: { params: ['color'], run: (w, id, a) => setColorFamily(w, id, a.color) },
  set_fill: {
    params: ['color', 'opacity'],
    run: (w, id, a) => {
      if (isColorList(a.color)) setColorFamily(w, id, a.color, 'fill')
      const c = a.color != null && !isColorList(a.color) ? normColor(a.color, '#FFFFFF') : null
      styleFamily(w, id, s => ({ ...s, fc: c ?? s.fc, fo: num(a.opacity, s.fo) }))
    },
  },
  set_stroke: {
    params: ['color', 'width', 'opacity'],
    run: (w, id, a) => {
      if (isColorList(a.color)) setColorFamily(w, id, a.color, 'stroke')
      const c = a.color != null && !isColorList(a.color) ? normColor(a.color, '#FFFFFF') : null
      styleFamily(w, id, s => ({ ...s, sc: c ?? s.sc, sw: num(a.width, s.sw), so: num(a.opacity, s.so) }))
    },
  },
  set_opacity: { params: ['opacity'], run: (w, id, a) => SETTERS.opacity(w, id, a.opacity, null) },
  set_fill_opacity: { params: ['opacity'], run: (w, id, a) => SETTERS.fill_opacity(w, id, a.opacity, null) },
  set_stroke_width: { params: ['width'], run: (w, id, a) => SETTERS.stroke_width(w, id, a.width, null) },
  fade: {
    params: ['darkness'],
    run: (w, id, a) => {
      const k = 1 - num(a.darkness, 0.5)
      styleFamily(w, id, s => ({ ...s, fo: s.fo * k, so: s.so * k }))
    },
  },
  set_z_index: { params: ['z_index'], run: (w, id, a, env) => SETTERS.z_index(w, id, a.z_index, env) },
  become: {
    params: ['mobject', 'match_height', 'match_width', 'match_depth', 'match_center', 'stretch'],
    run: (w, id, a) => {
      // match_* keep this object's size/centre: fit the source's copy to it first.
      const old = familyBox(w, id)
      become(w, id, resolveTarget(w, a.mobject))
      if (a.match_height) scaleToFit(w, id, 1, old[3] - old[1], !!a.stretch)
      if (a.match_width) scaleToFit(w, id, 0, old[2] - old[0], !!a.stretch)
      if (a.match_center) {
        const c = boxCenter(familyBox(w, id)), o = boxCenter(old)
        shiftBy(w, id, [o[0] - c[0], o[1] - c[1]])
      }
    },
  },
  save_state: {
    params: [],
    run: (w, id) => {
      const saved = copyFamily(w, id)
      w.update(id, { data: { ...(w.get(id).data || {}), saved } })
    },
  },
  restore: {
    params: [],
    run: (w, id) => {
      const saved = w.get(id).data?.saved
      if (saved == null || !w.has(saved)) throw new Error('restore() needs save_state() first')
      const keep = w.get(id).data
      become(w, id, saved)
      w.update(id, { data: { ...(w.get(id).data || {}), saved: keep.saved } })
    },
  },
  /** Move/turn/scale a line-like object so its ends land on start and end. */
  put_start_and_end_on: {
    params: ['start', 'end'],
    run: (w, id, a) => {
      const s0 = endPoint(w, id, 'start'), e0 = endPoint(w, id, 'end')
      const s1 = resolvePoint(w, a.start), e1 = resolvePoint(w, a.end)
      const v0: Pt = [e0[0] - s0[0], e0[1] - s0[1]], v1: Pt = [e1[0] - s1[0], e1[1] - s1[1]]
      const l0 = Math.hypot(v0[0], v0[1]) || 1e-9
      const k = Math.hypot(v1[0], v1[1]) / l0
      const ang = Math.atan2(v1[1], v1[0]) - Math.atan2(v0[1], v0[0])
      const M = mul(translate(s1[0], s1[1]), mul(rotateAbout(ang, ORIGIN), mul(scaleAbout(k, k, ORIGIN), translate(-s0[0], -s0[1]))))
      transformFamily(w, id, M)
    },
  },
  /** Replace the outline with points (scene coordinates), straight or smooth. */
  set_points: {
    params: ['points', 'smooth'],
    run: (w, id, a) => {
      const pts = ((a.points || []) as unknown[]).map(p => resolvePoint(w, p))
      w.update(id, { paths: pts.length ? [a.smooth ? smoothSub(pts, false) : polySub(pts, false)] : [], m: IDENTITY })
    },
  },
  set_z: { params: ['z'], run: () => {} },
  /** Pictures: rounded corners (scene units), a border (Manim stroke width), a crop (fractions, origin bottom-left). */
  set_corner_radius: { params: ['radius'], run: (w, id, a) => withImages(w, id, im => ({ ...im, radius: num(a.radius ?? a.corner_radius, 0) })) },
  set_border: {
    params: ['color', 'width'],
    run: (w, id, a) => withImages(w, id, im => ({ ...im, border: num(a.width ?? a.stroke_width, 4) > 0 ? { color: normColor(a.color ?? '#FFFFFF', '#FFFFFF'), width: num(a.width ?? a.stroke_width, 4) } : undefined })),
  },
  crop: {
    params: ['box'],
    run: (w, id, a) => withImages(w, id, im => {
      const b = (a.box || [0, 0, 1, 1]).map(Number) as [number, number, number, number]
      const box: [number, number, number, number] = [Math.max(0, b[0]), Math.max(0, b[1]), Math.min(1, b[2]), Math.min(1, b[3])]
      const fw = im.fullW ?? im.w, fh = im.fullH ?? im.h
      // The object's size follows the crop (it keeps its scale and centre).
      const kx = im.w / (fw * ((im.crop ? im.crop[2] - im.crop[0] : 1) || 1)), ky = im.h / (fh * ((im.crop ? im.crop[3] - im.crop[1] : 1) || 1))
      return { ...im, crop: box, w: fw * (box[2] - box[0]) * kx, h: fh * (box[3] - box[1]) * ky }
    }),
  },
  /** A drop shadow on anything (blur and offset in scene units); blur 0 and no offset removes it. */
  set_shadow: {
    params: ['blur', 'offset', 'color', 'opacity'],
    run: (w, id, a) => {
      const off = Array.isArray(a.offset) ? a.offset.map(Number) : [0.05, -0.08]
      const sh = { blur: num(a.blur, 0.2), dx: off[0] || 0, dy: off[1] || 0, color: normColor(a.color ?? '#000000', '#000000'), opacity: num(a.opacity, 0.5) }
      const none = sh.blur <= 0 && !sh.dx && !sh.dy
      for (const i of family(w, id)) {
        const m = w.get(i)
        if (hasGeom(m)) w.set({ ...m, shadow: none ? undefined : sh })
      }
    },
  },
  /** ApplyMatrix's end state: a 2×2 (or 3×3) matrix about a point (default ORIGIN). */
  apply_matrix: {
    params: ['matrix', 'about_point'],
    run: (w, id, a) => {
      const M = a.matrix as number[][]
      const p: Pt = a.about_point != null ? resolvePoint(w, a.about_point) : ORIGIN
      const L: Mat = [M[0][0], M[1][0], M[0][1], M[1][1], 0, 0]
      transformFamily(w, id, mul(translate(p[0], p[1]), mul(L, translate(-p[0], -p[1]))))
    },
  },
  /** Rebuild with more settings (keeping where it is): numbers on axes, new bar values, a new graph layout. */
  add_coordinates: { params: ['num_decimal_places'], run: (w, id, a) => remake(w, id, { include_numbers: true }) },
  change_bar_values: { params: ['values'], run: (w, id, a) => remake(w, id, { values: a.values }) },
  change_layout: {
    params: ['layout', 'layout_scale', 'layout_config', 'root_vertex'],
    run: (w, id, a) => remake(w, id, Object.fromEntries(Object.entries(a).filter(([, v]) => v != null))),
  },
  /** ValueTracker / DecimalNumber / Integer. */
  set_value: { params: ['value'], run: (w, id, a) => setNumberValue(w, id, num(a.value, 0)) },
  increment_value: {
    params: ['value'],
    run: (w, id, a) => setNumberValue(w, id, Number(w.get(id).data?.value ?? 0) + num(a.value ?? a.d_value, 0)),
  },
  /** Scale and centre to enclose another object (buffer_factor 1.2 = 20% larger, Manim's default). */
  surround: {
    params: ['mobject', 'dim_to_match', 'stretch', 'buff', 'buffer_factor'],
    run: (w, id, a) => {
      const t = familyBox(w, resolveTarget(w, a.mobject))
      const k = num(a.buffer_factor, 1.2)
      const dim = num(a.dim_to_match, 0) === 1 ? 1 : 0
      const size = (dim === 0 ? t[2] - t[0] : t[3] - t[1]) * k + 2 * num(a.buff, 0)
      scaleToFit(w, id, dim, size, !!a.stretch)
      if (a.stretch) scaleToFit(w, id, dim === 0 ? 1 : 0, (dim === 0 ? t[3] - t[1] : t[2] - t[0]) * k + 2 * num(a.buff, 0), true)
      const c = boxCenter(familyBox(w, id)), o = boxCenter(t)
      shiftBy(w, id, [o[0] - c[0], o[1] - c[1]])
    },
  },
  match_width: { params: ['mobject'], run: (w, id, a) => { const b = familyBox(w, resolveTarget(w, a.mobject)); scaleToFit(w, id, 0, b[2] - b[0]) } },
  match_height: { params: ['mobject'], run: (w, id, a) => { const b = familyBox(w, resolveTarget(w, a.mobject)); scaleToFit(w, id, 1, b[3] - b[1]) } },
  match_x: { params: ['mobject'], run: (w, id, a, env) => SETTERS.x(w, id, boxCenter(familyBox(w, resolveTarget(w, a.mobject)))[0], env) },
  match_y: { params: ['mobject'], run: (w, id, a, env) => SETTERS.y(w, id, boxCenter(familyBox(w, resolveTarget(w, a.mobject)))[1], env) },
  match_color: {
    params: ['mobject'],
    run: (w, id, a) => {
      const s = firstLeafStyle(w, resolveTarget(w, a.mobject))
      styleFamily(w, id, x => ({ ...x, sc: s.sc, fc: s.fc }))
    },
  },
  match_style: {
    params: ['mobject'],
    run: (w, id, a) => {
      const s = firstLeafStyle(w, resolveTarget(w, a.mobject))
      styleFamily(w, id, () => ({ ...s }))
    },
  },
  set_color_by_tex: {
    params: ['tex', 'color', 'substring'],
    run: (w, id, a) => {
      for (const p of w.get(id).children) {
        const t = w.get(p).data?.tex
        if (typeof t === 'string' && (a.substring === false ? t === a.tex : t.includes(String(a.tex)))) setColorFamily(w, p, a.color)
      }
    },
  },
  set_color_by_tex_to_color_map: {
    params: ['texs_to_color_map'],
    run: (w, id, a) => {
      const map = a.texs_to_color_map || {}
      for (const k of Object.keys(map)) OPS.set_color_by_tex.run(w, id, { tex: k, color: map[k] }, null)
    },
  },
  /** VGroup.add / remove: change the children list. */
  add: {
    params: ['*mobjects'],
    run: (w, id, a) => {
      const add = (a.mobjects || []).map((m: unknown) => resolveTarget(w, m)).filter((m: number) => m !== id)
      const kids = w.get(id).children.filter(k => !add.includes(k))
      w.update(id, { children: [...kids, ...add] })
    },
  },
  remove: {
    params: ['*mobjects'],
    run: (w, id, a) => {
      const rm = (a.mobjects || []).map((m: unknown) => resolveTarget(w, m))
      w.update(id, { children: w.get(id).children.filter(k => !rm.includes(k)) })
    },
  },
}

export const OP_NAMES = Object.keys(OPS)

/** Apply a change to every picture in a family. */
function withImages(w: World, id: number, f: (im: ImageRef) => ImageRef) {
  let any = false
  for (const i of family(w, id)) {
    const m = w.get(i)
    if (m.image) { w.set({ ...m, image: f(m.image) }); any = true }
  }
  if (!any) throw new Error('this works on images (ImageMobject)')
}

/** The engine's way to rebuild an object from its make() props (set once by the engine). */
let remakeHook: ((w: World, id: number, kind: string, props: Kw) => void) | null = null
export function setRemake(f: (w: World, id: number, kind: string, props: Kw) => void) {
  remakeHook = f
}

function remake(w: World, id: number, patch: Kw) {
  const old = w.get(id)
  const props = old.data?.props
  if (!props || !remakeHook) throw new Error(`this ${old.kind} cannot be rebuilt here`)
  remakeHook(w, id, old.kind, { ...props, ...patch })
  // Rebuilt at the origin: put it back where it was.
  transformFamily(w, id, old.m)
  w.update(id, { z: old.z })
}

/** The Python half's dict keys → this table's parameter names, per op. */
const KEY_ALIASES: Record<string, Record<string, string>> = {
  move_to: { target: 'point_or_mobject' },
  next_to: { target: 'mobject_or_point' },
  align_to: { target: 'mobject_or_point' },
  scale: { factor: 'scale_factor' },
  become: { source: 'mobject' },
  surround: { target: 'mobject' },
  match_width: { source: 'mobject' },
  match_height: { source: 'mobject' },
  match_x: { source: 'mobject' },
  match_y: { source: 'mobject' },
  match_color: { source: 'mobject' },
  match_style: { source: 'mobject' },
}

/** Run one named op on a target (already resolved). */
export function runOp(w: World, id: number, name: string, args: unknown, env: OpEnv) {
  const op = OPS[name]
  if (!op) throw new Error(`"${name}" is not something the animation layer can do yet`)
  const a = normArgs(args, op.params)
  const alias = KEY_ALIASES[name]
  if (alias) for (const k of Object.keys(alias)) if (k in a && !(alias[k] in a)) { a[alias[k]] = a[k]; delete a[k] }
  if (name === 'shift' && a.vector != null && a.vectors == null) a.vectors = [a.vector]
  op.run(w, id, a, env)
}
