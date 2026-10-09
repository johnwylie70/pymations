/**
 * make(id, kind, props): every shape Python can create, built with Manim's
 * defaults (sizes, colours, stroke widths). Props use Manim's own keyword
 * names (radius, side_length, start, end, buff, x_range, font_size…), so the
 * Python half can pass a constructor's kwargs straight through.
 *
 * Text, TeX and axes with numbers may need a font or outlines first: those
 * return a Promise and the engine holds later commands until it settles.
 */
import type { Pt, Subpath, TexInput, TexOutline } from './geometry-types'
import { IDENTITY, rotateAbout, translate, mul, apply, type Mat } from './math'
import {
  arcSub, circleSub, dashedPaths, lineSub, polySub, rectCorners, regularPolygonPts, roundedRectSub,
  smoothSub, starPts, TAU, transformPaths, unionBox, type Box,
} from './geometry'
import { boxCenter, family, familyBox, mobBox, newMob, type Mob, type Style, type TextRun, type World } from './scene'
import { axisToLocal, c2p3, isMobRef, normArgs, num, resolvePoint, resolvePoint3, resolveTarget, type AxisMap, type Kw } from './args'
import { normColor, NAMED, PURE_YELLOW, WHITE, YELLOW } from './color'
import { fontKey, type TextOutliner } from './text'
import { MORE_KINDS } from './more-kinds'
import { curve3, KINDS_3D } from './kinds3d'

export type TexFn = (input: TexInput) => Promise<TexOutline>

export interface MakeEnv {
  w: World
  fw: number
  fh: number
  text: TextOutliner
  tex: TexFn | null
  texCache: Map<string, TexOutline | Promise<TexOutline>>
}

/**
 * Manim's font_size → scene units per em of the TEXT font. 0.65 makes
 * Liberation Sans match what Manim measures for Text at size 48 ("Hello" is
 * 0.467 high; widths within a few percent, as Manim's own font varies by
 * system). TeX has its own scale in tex/ (KaTeX's em is a different size).
 */
export function emFor(fontSize: number): number {
  return (fontSize / 48) * 0.65
}

const RED = NAMED.RED
const BLUE = NAMED.BLUE
const BLUE_D = NAMED.BLUE_D
const BLACK = '#000000'

export interface StyleDefaults {
  color?: string
  sw?: number
  fo?: number
}

/** Style from Manim kwargs: color sets both, fill_color/stroke_color override, fill follows color. */
export function styleFrom(p: Kw, d: StyleDefaults = {}): Style {
  const color = p.color != null ? normColor(p.color, WHITE) : null
  const sc = p.stroke_color != null ? normColor(p.stroke_color, WHITE) : color ?? d.color ?? WHITE
  const fc = p.fill_color != null ? normColor(p.fill_color, WHITE) : color ?? d.color ?? WHITE
  const op = p.opacity != null ? num(p.opacity, 1) : 1
  return {
    sc,
    fc,
    sw: num(p.stroke_width, d.sw ?? 4),
    so: num(p.stroke_opacity, 1) * op,
    fo: num(p.fill_opacity, d.fo ?? 0) * op,
  }
}

export function pt(env: MakeEnv, v: unknown, fallback: Pt): Pt {
  return v == null ? fallback : resolvePoint(env.w, v)
}

/** The point of an object's outline farthest along `dir` (Manim's get_boundary_point). */
function boundaryPoint(env: MakeEnv, id: number, dir: Pt): Pt {
  let best: Pt = null, bestD = -Infinity
  for (const i of family(env.w, id)) {
    const m = env.w.get(i)
    for (const sp of transformPaths(m.paths, m.m)) {
      const P = sp.points
      for (let k = 0; k + 3 < P.length; k += 3) {
        for (let j = 0; j <= 8; j++) {
          const t = j / 8, u = 1 - t
          const x = u * u * u * P[k][0] + 3 * u * u * t * P[k + 1][0] + 3 * u * t * t * P[k + 2][0] + t * t * t * P[k + 3][0]
          const y = u * u * u * P[k][1] + 3 * u * u * t * P[k + 1][1] + 3 * u * t * t * P[k + 2][1] + t * t * t * P[k + 3][1]
          const d = x * dir[0] + y * dir[1]
          if (d > bestD) { bestD = d; best = [x, y] }
        }
      }
    }
  }
  return best || boxCenter(familyBox(env.w, id))
}

/**
 * Line/Arrow ends: points as given; an object end sits on that object's
 * outline, facing the other end (Line(circle, square) runs between them).
 */
export function lineEnds(env: MakeEnv, sv: unknown, ev: unknown): [Pt, Pt] {
  const center = (v: unknown, fb: Pt): Pt => (v == null ? fb : isMobRef(v) ? boxCenter(familyBox(env.w, resolveTarget(env.w, v))) : resolvePoint(env.w, v))
  let s = center(sv, [-1, 0]), e = center(ev, [1, 0])
  const d: Pt = [e[0] - s[0], e[1] - s[1]]
  if (isMobRef(sv)) s = boundaryPoint(env, resolveTarget(env.w, sv), d)
  if (isMobRef(ev)) e = boundaryPoint(env, resolveTarget(env.w, ev), [-d[0], -d[1]])
  return [s, e]
}

export function put(env: MakeEnv, id: number, kind: string, props: Kw, style: Style, paths: Subpath[], extra?: Partial<Mob>) {
  const mob = newMob(id, kind, style, paths, { z: num(props.z_index, 0), ...extra })
  env.w.set(mob)
  return mob
}

/* ------------------------------------------------------------ line family */

export function trimmed(a: Pt, b: Pt, buff: number): [Pt, Pt] {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (L <= 2 * buff || buff <= 0) return [a, b]
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L
  return [[a[0] + ux * buff, a[1] + uy * buff], [b[0] - ux * buff, b[1] - uy * buff]]
}

export function tipPaths(at: Pt, dirx: number, diry: number, len: number, width: number): Subpath[] {
  const bx = at[0] - dirx * len, by = at[1] - diry * len
  const nx = -diry * width / 2, ny = dirx * width / 2
  return [polySub([at, [bx + nx, by + ny], [bx - nx, by - ny]], true)]
}

export function makeArrow(env: MakeEnv, id: number, kind: string, props: Kw, a: Pt, b: Pt, buff: number, twoTips: boolean) {
  const [s, e] = trimmed(a, b, buff)
  const L = Math.hypot(e[0] - s[0], e[1] - s[1]) || 1e-9
  const ux = (e[0] - s[0]) / L, uy = (e[1] - s[1]) / L
  const tipLen = Math.min(num(props.tip_length, 0.35), num(props.max_tip_length_to_length_ratio, 0.25) * L)
  // Short arrows thin out: stroke ≤ 5 × length. A double arrow measures the
  // line left between its two tips (Manim's DoubleArrow ends at 4, not 6).
  const swLen = twoTips ? Math.max(0, L - 2 * tipLen) : L
  const sw = Math.min(num(props.stroke_width, 6), num(props.max_stroke_width_to_length_ratio, 5) * swLen)
  const style = styleFrom({ ...props, stroke_width: sw }, { sw: 6 })
  const ls: Pt = twoTips ? [s[0] + ux * tipLen, s[1] + uy * tipLen] : s
  const le: Pt = [e[0] - ux * tipLen, e[1] - uy * tipLen]
  const tipStyle: Style = { ...style, fc: style.sc, fo: 1, sw: 0 }
  const children: number[] = []
  const tip = env.w.newId()
  env.w.set(newMob(tip, 'tip', tipStyle, tipPaths(e, ux, uy, tipLen, tipLen)))
  children.push(tip)
  if (twoTips) {
    const tip2 = env.w.newId()
    env.w.set(newMob(tip2, 'tip', tipStyle, tipPaths(s, -ux, -uy, tipLen, tipLen)))
    children.push(tip2)
  }
  put(env, id, kind, props, style, [lineSub(ls, le)], { children, data: { start: s, end: e } })
}

/* ---------------------------------------------------------------- text */

export function formatNumber(v: number, places: number, includeSign = false): string {
  const s = places > 0 ? v.toFixed(places) : String(Math.round(v))
  const t = s.replace(/^-/, '−')
  return includeSign && v >= 0 ? '+' + t : t
}

/** Builds text now if the font is ready, else after it loads. */
export function makeText(env: MakeEnv, id: number, kind: string, props: Kw, str: string): void | Promise<void> {
  const key = fontKey(props.weight, props.slant, props.font)
  if (env.text.font(key) === undefined) return env.text.load(key).then(() => makeText(env, id, kind, props, str))
  const em = emFor(num(props.font_size, 48))
  const style = styleFrom(props, { sw: 0, fo: 1 })
  // letter_spacing is in em (0.05 = 5% of the font size), added after each character.
  // line_spacing: Manim's −1 (and anything not positive) means the font's own spacing.
  const ls = num(props.line_spacing, 1.2)
  const outline = env.text.outline(str, em, key, ls > 0 ? ls : 1.2, num(props.letter_spacing, 0) * em)
  if (!outline) {
    // No outlines: a fillText run of about the right size.
    const lines = str.split('\n')
    const w = Math.max(...lines.map(l => l.length)) * em * 0.55
    const h = lines.length * em * 0.75
    const [wt, sl] = key.replace(/^[a-z]+:/, '').split('|')
    put(env, id, kind, props, style, [], {
      text: { str, em, weight: key.startsWith('url:') ? 'normal' : wt, slant: key.startsWith('url:') ? 'normal' : sl, w, h, family: key },
      data: { text: str },
    })
    return
  }
  // t2c: colour every glyph of each matching substring (glyph i is the i-th
  // visible character, so match in the text with spaces taken out).
  const glyphColor: Array<string | null> = outline.glyphs.map(() => null)
  const t2c = props.t2c || props.text_to_color_map
  if (t2c && typeof t2c === 'object') {
    const visible = Array.from(str).filter(c => c.trim()).join('')
    for (const key of Object.keys(t2c)) {
      const k = Array.from(key).filter(c => c.trim()).join('')
      if (!k) continue
      let at = visible.indexOf(k)
      while (at >= 0) {
        for (let i = at; i < at + Array.from(k).length && i < glyphColor.length; i++) glyphColor[i] = normColor(t2c[key], WHITE)
        at = visible.indexOf(k, at + 1)
      }
    }
  }
  const children = outline.glyphs.map((g, i) => {
    const gid = env.w.newId()
    const c = glyphColor[i]
    env.w.set(newMob(gid, 'glyph', c ? { ...style, sc: c, fc: c } : style, g.paths, { data: { char: g.char } }))
    return gid
  })
  put(env, id, kind, props, style, [], { children, data: { text: str } })
}

/* ---------------------------------------------------------------- TeX */

export function makeTex(env: MakeEnv, id: number, kind: string, props: Kw, mode: 'math' | 'text'): void | Promise<void> {
  let parts: string[] = props.parts ?? props.tex_strings ?? (props.tex != null ? [props.tex] : [])
  if (!Array.isArray(parts)) parts = [String(parts)]
  parts = parts.map(String)
  const fontSize = num(props.font_size, 48)
  // MathTex joins its arguments with a space, Tex with nothing (arg_separator).
  const sep = props.arg_separator != null ? String(props.arg_separator) : mode === 'math' ? ' ' : ''
  // tex_environment (Manim's) decides how lines (\\) are laid out; part of the cache key.
  const environment = props.tex_environment != null ? String(props.tex_environment) : props.environment != null ? String(props.environment) : undefined
  const key = `${mode}|${fontSize}|${sep}|${environment ?? ''}|${parts.join('\u0001')}`
  const build = (out: TexOutline) => {
    const style = styleFrom(props, { sw: 0, fo: 1 })
    const children = out.parts.map((glyphs, i) => {
      const pid = env.w.newId()
      const gids = glyphs.map(paths => {
        const gid = env.w.newId()
        env.w.set(newMob(gid, 'glyph', style, paths))
        return gid
      })
      env.w.set(newMob(pid, 'tex_part', style, [], { children: gids, data: { tex: parts[i] ?? '' } }))
      return pid
    })
    put(env, id, kind, props, style, [], { children, data: { tex: parts.join(sep), parts } })
  }
  const hit = env.texCache.get(key)
  if (hit && !(hit instanceof Promise)) return build(hit)
  if (!env.tex) throw new Error('MathTex is not available in this preview')
  const p = (hit as Promise<TexOutline>) || env.tex({ tex: parts.join(sep), mode, parts, fontSize, ...(environment ? { environment } : {}) })
  env.texCache.set(key, p)
  return p.then(
    out => { env.texCache.set(key, out); build(out) },
    e => { env.texCache.delete(key); throw e },
  )
}

/* ---------------------------------------------------------------- axes */

export function range3(r: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(r)) return fallback
  return [num(r[0], fallback[0]), num(r[1], fallback[1]), num(r[2], 1)]
}

export function ticksOf(r: [number, number, number]): number[] {
  const out: number[] = []
  const [a, b, s] = r
  if (s <= 0) return out
  const n = Math.floor((b - a) / s + 1e-9)
  for (let i = 0; i <= n && i < 1000; i++) out.push(+(a + i * s).toFixed(10))
  return out
}

/** Grid values: origin ± k·step, inside (lo, hi) — or [lo, hi] when inclusive. */
function gridValues(lo: number, hi: number, origin: number, step: number, inclusive: boolean): number[] {
  const out: number[] = []
  if (step <= 0) return out
  const eps = 1e-9
  const kMin = Math.ceil((lo - origin) / step - eps), kMax = Math.floor((hi - origin) / step + eps)
  for (let k = kMin; k <= kMax && out.length < 2000; k++) {
    const v = +(origin + k * step).toFixed(10)
    if (!inclusive && (Math.abs(v - lo) < eps || Math.abs(v - hi) < eps)) continue
    out.push(v)
  }
  return out
}

function placesFor(step: number): number {
  const s = String(+step.toFixed(6))
  const i = s.indexOf('.')
  return i < 0 ? 0 : Math.min(3, s.length - i - 1)
}

export interface AxisOpts {
  color: string
  sw: number
  tip: boolean
  tipLen: number
  tipWidth: number
  ticks: boolean
  tickSize: number
  numbers: boolean
  fontSize: number
  exclude: number[]
  numberBuff: number
  labelDir: Pt
}

export function axisOpts(cfg: Kw, base: Partial<AxisOpts>): AxisOpts {
  const tipLen = num(cfg.tip_height ?? cfg.tip_length, 0.35)
  return {
    color: normColor(cfg.color ?? cfg.stroke_color ?? base.color ?? WHITE, WHITE),
    sw: num(cfg.stroke_width, base.sw ?? 2),
    tip: cfg.include_tip ?? base.tip ?? false,
    tipLen,
    tipWidth: num(cfg.tip_width, tipLen),
    ticks: cfg.include_ticks ?? base.ticks ?? true,
    tickSize: num(cfg.tick_size, 0.1),
    numbers: cfg.include_numbers ?? base.numbers ?? false,
    fontSize: num(cfg.font_size, base.fontSize ?? 36),
    exclude: (cfg.numbers_to_exclude ?? base.exclude ?? []).map(Number),
    numberBuff: num(cfg.line_to_number_buff, base.numberBuff ?? 0.25),
    labelDir: Array.isArray(cfg.label_direction) ? [Number(cfg.label_direction[0]), Number(cfg.label_direction[1])] : base.labelDir ?? [0, -1],
  }
}

/**
 * One axis as a number line: the line is the object's own path; ticks, tip
 * and numbers are its parts, as in Manim's NumberLine (ticks are a group with
 * one object per tick, which is what Create's lag counts). `toLocal(v)` places
 * the value v in the parent's coordinates. `skipTicks` are values with no tick
 * (Axes leave out the origin and the end under the tip).
 */
export function buildAxis(env: MakeEnv, id: number, r: [number, number, number], o: AxisOpts, toLocal: (v: number) => Pt, along: Pt, skipTicks: number[] = []): void {
  const a = toLocal(r[0]), b = toLocal(r[1])
  const style: Style = { sc: o.color, fc: o.color, sw: o.sw, so: 1, fo: 0 }
  const children: number[] = []
  const nx = -along[1], ny = along[0]
  const skip = (v: number) => skipTicks.some(x => Math.abs(x - v) < 1e-9)
  if (o.ticks) {
    const ids = ticksOf(r).filter(v => !skip(v)).map(v => {
      const p = toLocal(v)
      const tid = env.w.newId()
      env.w.set(newMob(tid, 'tick', style, [lineSub([p[0] - nx * o.tickSize, p[1] - ny * o.tickSize], [p[0] + nx * o.tickSize, p[1] + ny * o.tickSize])]))
      return tid
    })
    const gid = env.w.newId()
    env.w.set(newMob(gid, 'group', style, [], { children: ids }))
    children.push(gid)
  }
  let lineEnd = b
  if (o.tip) {
    const tid = env.w.newId()
    env.w.set(newMob(tid, 'tip', { ...style, fo: 1, sw: 0 }, tipPaths(b, along[0], along[1], o.tipLen, o.tipWidth)))
    children.push(tid)
    lineEnd = [b[0] - along[0] * o.tipLen, b[1] - along[1] * o.tipLen]
  }
  if (o.numbers) {
    const places = placesFor(r[2])
    const nums = ticksOf(r).filter(v => !o.exclude.some(x => Math.abs(x - v) < 1e-9) && !(o.tip && Math.abs(v - r[1]) < 1e-9))
    const gid = env.w.newId()
    const labels = nums.map(v => {
      const lid = env.w.newId()
      makeText(env, lid, 'text', { font_size: o.fontSize, color: o.color }, formatNumber(v, places))
      // Place: the label's edge facing the line sits numberBuff from the tick.
      const p = toLocal(v)
      const box = familyBox(env.w, lid)
      const d = o.labelDir
      const hw = (box[2] - box[0]) / 2, hh = (box[3] - box[1]) / 2
      const cx = p[0] + d[0] * (o.numberBuff + hw), cy = p[1] + d[1] * (o.numberBuff + hh)
      shiftFamily(env.w, lid, translate(cx - (box[0] + box[2]) / 2, cy - (box[1] + box[3]) / 2))
      return lid
    })
    env.w.set(newMob(gid, 'group', style, [], { children: labels }))
    children.push(gid)
  }
  env.w.set(newMob(id, 'number_line', style, [lineSub(a, lineEnd)], { children, data: { start: a, end: b } }))
}

export function shiftFamily(w: World, id: number, M: Mat) {
  for (const i of family(w, id)) {
    const m = w.get(i)
    w.set({ ...m, m: mul(M, m.m) })
  }
}

/** Where the other axis crosses: 0, or the range end nearest it when 0 is outside. */
function originIn(r: [number, number, number]): number {
  return r[0] > 0 ? r[0] : r[1] < 0 ? r[1] : 0
}

/** Does an axis config ask for numbers (so the font must be loaded first)? */
function wantsNumbers(...cfgs: Kw[]): boolean {
  return cfgs.some(c => c && c.include_numbers)
}

/**
 * Axes / NumberPlane, Manim's sizes: Axes default to x [-7, 7], y [-4, 4] on
 * 12 × 6 units (unequal units), tips 0.35, no tick at the origin or under a
 * tip. A NumberPlane covers the frame at 1 unit per step with BLUE_D lines
 * strictly inside the range (plus faded lines when faded_line_ratio > 1).
 */
export function makeAxes(env: MakeEnv, id: number, kind: string, props: Kw): void | Promise<void> {
  const plane = kind === 'number_plane'
  const axisCfg: Kw = props.axis_config || {}
  const xCfg: Kw = { ...axisCfg, ...(props.x_axis_config || {}) }
  const yCfg: Kw = { ...axisCfg, ...(props.y_axis_config || {}) }
  if (props.include_numbers != null) { xCfg.include_numbers ??= props.include_numbers; yCfg.include_numbers ??= props.include_numbers }
  if (wantsNumbers(xCfg, yCfg)) {
    const key = fontKey('normal', 'normal')
    if (env.text.font(key) === undefined) return env.text.load(key).then(() => makeAxes(env, id, kind, props))
  }
  const fw = env.fw, fh = env.fh
  const xr = range3(props.x_range, plane ? [-fw / 2, fw / 2, 1] : [-Math.round(fw / 2), Math.round(fw / 2), 1])
  const yr = range3(props.y_range, [-fh / 2, fh / 2, 1])
  const xl = num(props.x_length, plane ? (xr[1] - xr[0]) : Math.round(fw) - 2)
  const yl = num(props.y_length, plane ? (yr[1] - yr[0]) : Math.round(fh) - 2)
  const map: AxisMap = {
    x0: xr[0], y0: yr[0],
    sx: xl / (xr[1] - xr[0] || 1), sy: yl / (yr[1] - yr[0] || 1),
    ox: -xl / 2, oy: -yl / 2,
  }
  const L = (x: number, y: number) => axisToLocal(map, x, y)
  const color = props.color != null ? normColor(props.color, WHITE) : undefined
  const tips = props.tips ?? !plane
  const base: Partial<AxisOpts> = plane
    ? { color: color ?? WHITE, sw: 2, tip: false, ticks: false, numberBuff: 0.1, fontSize: 24, labelDir: [1, -1] }
    : { color: color ?? WHITE, sw: 2, tip: tips, exclude: [0] }
  const xo = axisOpts(xCfg, { ...base })
  const yo = axisOpts(yCfg, { ...base, labelDir: plane ? [1, -1] : [-1, 0] })
  const y0 = originIn(yr), x0 = originIn(xr)
  const children: number[] = []
  if (plane) {
    const bg = props.background_line_style || {}
    const bstyle: Style = {
      sc: normColor(bg.stroke_color ?? bg.color ?? BLUE_D, BLUE_D), fc: BLUE_D,
      sw: num(bg.stroke_width, 2), so: num(bg.stroke_opacity, 1), fo: 0,
    }
    const lines = (xs: number[], ys: number[]) => [
      ...xs.map(x => lineSub(L(x, yr[0]), L(x, yr[1]))),
      ...ys.map(y => lineSub(L(xr[0], y), L(xr[1], y))),
    ]
    const bid = env.w.newId(), fid = env.w.newId()
    const xMain = gridValues(xr[0], xr[1], x0, xr[2], false), yMain = gridValues(yr[0], yr[1], y0, yr[2], false)
    env.w.set(newMob(bid, 'background_lines', bstyle, lines(xMain, yMain)))
    const ratio = Math.round(num(props.faded_line_ratio, 1))
    let faded: Subpath[] = []
    if (ratio > 1) {
      // Every 1/ratio step to the very edges, except where a main line already is.
      const without = (vals: number[], main: number[]) => vals.filter(v => !main.some(m => Math.abs(m - v) < 1e-9))
      faded = lines(
        without(gridValues(xr[0], xr[1], x0, xr[2] / ratio, true), xMain),
        without(gridValues(yr[0], yr[1], y0, yr[2] / ratio, true), yMain),
      )
    }
    env.w.set(newMob(fid, 'faded_lines', { ...bstyle, sw: bstyle.sw / 2, so: bstyle.so * 0.5 }, faded))
    children.push(bid, fid)
  }
  const xid = env.w.newId(), yid = env.w.newId()
  buildAxis(env, xid, xr, xo, v => L(v, y0), [1, 0], plane ? [] : [x0, ...(xo.tip ? [xr[1]] : [])])
  buildAxis(env, yid, yr, yo, v => L(x0, v), [0, 1], plane ? [] : [y0, ...(yo.tip ? [yr[1]] : [])])
  env.w.update(xid, { data: { ...env.w.get(xid).data, axes: { ...map, sy: 0, oy: L(0, y0)[1], y0: 0 } } })
  env.w.update(yid, { data: { ...env.w.get(yid).data, axes: { x0: yr[0], y0: 0, sx: 0, sy: map.sy, ox: L(x0, 0)[0], oy: map.oy } } })
  children.push(xid, yid)
  put(env, id, kind, props, { sc: WHITE, fc: WHITE, sw: 2, so: 1, fo: 0 }, [], { children, data: { axes: map, props } })
}

function makeNumberLine(env: MakeEnv, id: number, props: Kw): void | Promise<void> {
  if (props.include_numbers) {
    const key = fontKey('normal', 'normal')
    if (env.text.font(key) === undefined) return env.text.load(key).then(() => makeNumberLine(env, id, props))
  }
  const r = range3(props.x_range, [-7, 7, 1])
  const len = num(props.length, num(props.unit_size, 1) * (r[1] - r[0]))
  const map: AxisMap = { x0: r[0], y0: 0, sx: len / (r[1] - r[0] || 1), sy: 0, ox: -len / 2, oy: 0 }
  const o = axisOpts(props, { color: props.color != null ? normColor(props.color, WHITE) : WHITE, sw: 2, tip: false })
  buildAxis(env, id, r, o, v => axisToLocal(map, v, 0), [1, 0])
  env.w.update(id, { z: num(props.z_index, 0), data: { ...env.w.get(id).data, axes: map } })
}

/**
 * A plotted curve: points sampled by Python, in axis coordinates when `axes`
 * is given (else scene coordinates); a null point lifts the pen.
 */
function makeGraph(env: MakeEnv, id: number, props: Kw) {
  let map: AxisMap | null = null
  let m: Mat | undefined
  if (props.axes != null) {
    const ax = env.w.get(resolveTarget(env.w, props.axes))
    map = ax.data?.axes
    if (!map) throw new Error('plot needs Axes, a NumberPlane or a NumberLine')
    m = ax.m
  }
  const runs: Pt[][] = []
  // The samples in axis coordinates, kept for the axes helpers (area, Riemann rectangles, graph points).
  const raw: Pt[][] = []
  const addRun = (list: unknown[]) => {
    let cur: Pt[] = [], cr: Pt[] = []
    for (const p of list) {
      const ok = Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]))
      if (!ok) { if (cur.length) { runs.push(cur); raw.push(cr) } cur = []; cr = []; continue }
      const x = Number((p as unknown[])[0]), y = Number((p as unknown[])[1])
      cur.push(map ? axisToLocal(map, x, y) : [x, y])
      cr.push([x, y])
    }
    if (cur.length) { runs.push(cur); raw.push(cr) }
  }
  if (Array.isArray(props.segments)) for (const s of props.segments) addRun(s as unknown[])
  else addRun(props.points || [])
  // On ThreeDAxes with z values (plot_parametric_curve): a 3D curve through c2p.
  const raw3 = (Array.isArray(props.segments) ? props.segments : [props.points || []]) as unknown[][]
  if (map && raw3.some(seg => (seg || []).some(q => Array.isArray(q) && Math.abs(Number(q[2]) || 0) > 1e-12))) {
    const axId = resolveTarget(env.w, props.axes)
    const runs3 = raw3.map(seg => (seg || []).filter(q => Array.isArray(q)).map(q => c2p3(env.w, axId, Number(q[0]), Number(q[1]), Number(q[2]) || 0)))
    makeCurve3(env, id, 'graph', props, runs3.map(r => (props.use_smoothing === false ? r : smooth3(r, false))), !!props.closed, { color: YELLOW })
    return
  }
  const smooth = props.use_smoothing !== false && props.smooth !== false
  const closed = !!props.closed
  const paths = runs.filter(r => r.length >= 2).map(r => (smooth ? smoothSub(r, closed) : polySub(r, closed)))
  // A list of colours (get_area / Riemann rectangles' gradient): one object takes the first.
  if (Array.isArray(props.color) && typeof props.color[0] === 'string') props = { ...props, color: props.color[0] }
  // Same matrix as the axes, so the curve sits on them wherever they are.
  put(env, id, 'graph', props, styleFrom(props, { color: YELLOW }), paths, { ...(m ? { m } : {}), data: { ...(map ? { axes: map } : {}), samples: raw } })
}

/* ------------------------------------------------- numbers and trackers */

/**
 * The TextOutliner the engine made (numbers re-lay out outside make(): a
 * set_value op, a tracker updater, ChangeDecimalToValue).
 */
let sharedText: TextOutliner | null = null
export function setSharedText(t: TextOutliner) {
  sharedText = t
}

/**
 * DecimalNumber is TeX in Manim (Computer Modern digits). With the TeX
 * outliner available, each character is outlined ONCE per font size from a
 * few probe strings ("0123456789", "0.0", "-0", "+0", "0{,}0") and kept with
 * its pen origin, baseline and advance — the same shape of cache as the text
 * font's, so a number changing every frame places cached glyphs. Without TeX
 * the text font is used.
 */
interface CharG { paths: Subpath[]; advance: number; box: [number, number, number, number] | null }
const texChars = new Map<number, Map<string, CharG> | Promise<Map<string, CharG>>>()

function boxOfPaths(paths: Subpath[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const sp of paths) for (const p of sp.points) {
    if (p[0] < x0) x0 = p[0]
    if (p[0] > x1) x1 = p[0]
    if (p[1] < y0) y0 = p[1]
    if (p[1] > y1) y1 = p[1]
  }
  return [x0, y0, x1, y1]
}

function shifted(paths: Subpath[], dx: number, dy: number): Subpath[] {
  return paths.map(sp => ({ closed: sp.closed, points: sp.points.map(p => [p[0] - dx, p[1] - dy] as Pt) }))
}

async function loadTexChars(tex: TexFn, fontSize: number): Promise<Map<string, CharG>> {
  const get = (src: string) => tex({ tex: src, mode: 'math', parts: [src], fontSize }).then(o => o.parts.flat())
  const [digits, dot, minus, plus, comma] = await Promise.all([get('0123456789'), get('0.0'), get('-0'), get('+0'), get('0{,}0')])
  const out = new Map<string, CharG>()
  if (digits.length !== 10) throw new Error('unexpected digit layout')
  const boxes = digits.map(boxOfPaths)
  const cx = (b: number[]) => (b[0] + b[2]) / 2
  const adv = (cx(boxes[9]) - cx(boxes[0])) / 9
  const base = boxes[0][1]
  digits.forEach((g, i) => {
    const pen = cx(boxes[i]) - adv / 2
    const paths = shifted(g, pen, base)
    out.set(String(i), { paths, advance: adv, box: boxOfPaths(paths) })
  })
  // A character between digits (".", ","): from where the first 0 ends to where the next 0 starts.
  const between = (gl: Subpath[][], ch: string) => {
    if (gl.length !== 3) return
    const b0 = boxOfPaths(gl[0]), b2 = boxOfPaths(gl[2])
    const pen = cx(b0) + adv / 2, next = cx(b2) - adv / 2
    const paths = shifted(gl[1], pen, b0[1])
    out.set(ch, { paths, advance: next - pen, box: boxOfPaths(paths) })
  }
  between(dot, '.')
  between(comma, ',')
  // A sign before a digit: it starts at its own ink and ends where the 0 starts.
  const before = (gl: Subpath[][], ch: string) => {
    if (gl.length !== 2) return
    const bs = boxOfPaths(gl[0]), b0 = boxOfPaths(gl[1])
    const pen = bs[0], next = cx(b0) - adv / 2
    const paths = shifted(gl[0], pen, b0[1])
    out.set(ch, { paths, advance: next - pen, box: boxOfPaths(paths) })
  }
  before(minus, '-')
  before(minus, '\u2212')
  before(plus, '+')
  return out
}

/** The TeX characters for a font size, if already loaded (else start loading them). */
function texCharsFor(env: MakeEnv | null, fontSize: number): Map<string, CharG> | Promise<Map<string, CharG>> | null {
  const hit = texChars.get(fontSize)
  if (hit) return hit
  if (!env || !env.tex) return null
  const p = loadTexChars(env.tex, fontSize).then(
    m => { texChars.set(fontSize, m); return m },
    () => { texChars.delete(fontSize); return null },
  )
  texChars.set(fontSize, p)
  return p
}

interface NumberData {
  value: number
  places: number
  sign: boolean
  unit: string
  em: number
  key: string
  /** Local x of the left edge: set_value keeps it (Manim's edge_to_fix = LEFT). */
  left: number
  /** Local y of the ink centre of "0", so digits sit on one baseline whatever they are. */
  mid: number
  text: string
  /** 'tex' (Computer Modern digits, as Manim) or 'text' (the text font). */
  src: 'tex' | 'text'
  fontSize: number
  commas: boolean
  ellipsis: boolean
}

/**
 * The pieces a number is drawn from, in order: its characters (with commas),
 * then "\ldots" (show_ellipsis) and the unit, each of those one piece.
 */
function numberTokens(d: NumberData, value: number): string[] {
  let s = formatNumber(value, d.places, d.sign)
  if (d.commas) {
    const [i, f] = s.split('.')
    s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f != null ? '.' + f : '')
  }
  const out = Array.from(s)
  if (d.ellipsis) out.push('\\ldots')
  if (d.unit) out.push(d.unit)
  return out
}

function numberString(d: NumberData, value: number): string {
  return numberTokens(d, value).map(t => (t === '\\ldots' ? '…' : t)).join('')
}

/** One piece's cached glyph, from TeX or the text font. */
function numberGlyph(d: NumberData, ch: string): CharG | null {
  if (d.src === 'tex') {
    const m = texChars.get(d.fontSize)
    if (m && !(m instanceof Promise)) {
      const g = m.get(ch) || (ch === '−' ? m.get('-') : null)
      if (g) return g
    }
  }
  if (!sharedText) return null
  if (ch.length === 1 || Array.from(ch).length === 1) return sharedText.glyph(ch, d.em, d.key)
  // A multi-character piece in the text font: its characters joined into one glyph.
  const parts: Subpath[] = []
  let x = 0
  for (const c of Array.from(ch === '\\ldots' ? '…' : ch.replace(/\\text\{([^}]*)\}/g, '$1'))) {
    const g = sharedText.glyph(c, d.em, d.key)
    if (!g) return null
    parts.push(...g.paths.map(sp => ({ closed: sp.closed, points: sp.points.map(p => [p[0] + x, p[1]] as Pt) })))
    x += g.advance
  }
  return { paths: parts, advance: x, box: parts.length ? boxOfPaths(parts) : null }
}

/** The gap Manim leaves between a number's pieces (they are arranged ink to ink). */
const numberGap = (d: NumberData) => 0.048 * (d.fontSize / 48)

/**
 * Lay a number out as glyph objects under `id`. Each piece's paths are the
 * cached outline, placed by its matrix (so a new value never outlines again),
 * ink to ink with Manim's gap, on one baseline.
 */
function layoutNumber(w: World, id: number, d: NumberData, style: Style, parentM: Mat): { children: number[]; text?: TextRun } {
  const toks = numberTokens(d, d.value)
  const glyphs = toks.map(ch => numberGlyph(d, ch))
  if (glyphs.some(g => !g)) {
    // No font: one fillText run (left edge kept by shifting its centre).
    const str = numberString(d, d.value)
    const wdt = str.length * d.em * 0.55
    return { children: [], text: { str, em: d.em, weight: d.key.split('|')[0], slant: d.key.split('|')[1], w: wdt, h: d.em * 0.75 } }
  }
  let cursor = d.left
  const gap = numberGap(d)
  const children: number[] = []
  toks.forEach((ch, i) => {
    const g = glyphs[i]
    if (!g.paths.length || !g.box) { cursor += g.advance; return }
    const x = cursor - g.box[0]
    const gid = w.newId()
    w.set(newMob(gid, 'glyph', style, g.paths, { m: mul(parentM, translate(x, -d.mid)), data: { char: ch } }))
    children.push(gid)
    cursor += g.box[2] - g.box[0] + gap
  })
  return { children }
}

/** Load the TeX pieces a number needs beyond the digits (its unit, the ellipsis). */
function texTokenFor(env: MakeEnv, fontSize: number, token: string): void | Promise<void> {
  const m = texChars.get(fontSize)
  if (!m || m instanceof Promise || m.has(token) || !env.tex) return
  return env.tex({ tex: token, mode: 'math', parts: [token], fontSize }).then(
    o => {
      const paths = o.parts.flat().flat()
      if (!paths.length) return
      const b = boxOfPaths(paths)
      // Sit it on the digits' baseline (its ink bottom there, as letters and dots do).
      const shiftedPaths = shifted(paths, b[0], b[1])
      m.set(token, { paths: shiftedPaths, advance: b[2] - b[0], box: boxOfPaths(shiftedPaths) })
    },
    () => undefined,
  )
}

function makeNumber(env: MakeEnv, id: number, kind: string, props: Kw): void | Promise<void> {
  const key = fontKey(props.weight, props.slant)
  if (env.text.font(key) === undefined) return env.text.load(key).then(() => makeNumber(env, id, kind, props))
  const fontSize = num(props.font_size, 48)
  const tc = texCharsFor(env, fontSize)
  if (tc instanceof Promise) return tc.then(() => makeNumber(env, id, kind, props))
  const unit = props.unit != null && props.unit !== '' ? String(props.unit) : ''
  for (const tok of [unit, props.show_ellipsis ? '\\ldots' : '']) {
    if (!tok) continue
    const p = texTokenFor(env, fontSize, tok)
    if (p) return p.then(() => makeNumber(env, id, kind, props))
  }
  const places = props.num_decimal_places != null ? num(props.num_decimal_places, 2) : kind === 'integer' ? 0 : 2
  const em = emFor(fontSize)
  const d: NumberData = {
    value: num(props.number ?? props.value, 0), places, sign: !!props.include_sign,
    unit: tc ? unit : unit.replace(/^\^\\circ$/, '°').replace(/\\circ/g, '°').replace(/\\text\{([^}]*)\}/g, '$1'),
    em, key, left: 0, mid: 0, text: '', src: tc ? 'tex' : 'text', fontSize,
    // Manim groups thousands with commas unless told not to.
    commas: props.group_with_commas !== false, ellipsis: !!props.show_ellipsis,
  }
  const zero = numberGlyph(d, '0')
  d.mid = zero && zero.box ? (zero.box[1] + zero.box[3]) / 2 : em * 0.35
  // Centre the first layout on the origin, then keep its left edge from now on (Manim's edge_to_fix).
  let total = 0, count = 0
  for (const ch of numberTokens(d, d.value)) {
    const g = numberGlyph(d, ch)
    if (g && g.box) { total += g.box[2] - g.box[0]; count++ }
  }
  total += Math.max(0, count - 1) * numberGap(d)
  d.left = -total / 2
  d.text = numberString(d, d.value)
  const style = styleFrom(props, { sw: 0, fo: 1 })
  const { children, text } = layoutNumber(env.w, id, d, style, IDENTITY)
  put(env, id, kind, props, style, [], { children, text, data: { ...d, number: true } })
}

/** set_value on a DecimalNumber/Integer: new digits from the glyph cache, same left edge, same transform. */
export function setNumberValue(w: World, id: number, value: number) {
  const mob = w.get(id)
  const d = mob.data as NumberData & { number?: boolean }
  if (!d || !d.number) {
    // A ValueTracker (or anything else with a value).
    w.update(id, { data: { ...(mob.data || {}), value } })
    return
  }
  if (d.value === value && !mob.text) return
  const next = { ...d, value }
  const style = mob.children.length ? w.get(mob.children[0]).style : mob.style
  const { children, text } = layoutNumber(w, id, next, style, mob.m)
  next.text = numberString(d, value)
  w.set({ ...mob, children, text, data: next })
}

/** Is this object a DecimalNumber/Integer (whose value is drawn)? */
export function isNumber(m: Mob): boolean {
  return !!(m.data && m.data.number)
}

/** A PycturesCanvas: the engine makes the canvas; Python draws on it each frame via canvas_for(id). */
export type CanvasFactory = (pxW: number, pxH: number) => CanvasImageSource | null
let canvasFactory: CanvasFactory | null = null
export function setCanvasFactory(f: CanvasFactory) {
  canvasFactory = f
}

/* --------------------------------------------------------------- 3D curves */

/** Catmull-Rom through 3D points, 6 samples per span: a smooth polyline. */
function smooth3(pts: Array<[number, number, number]>, closed: boolean): Array<[number, number, number]> {
  const n = pts.length
  if (n < 3) return pts
  const get = (i: number) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))])
  const out: Array<[number, number, number]> = [pts[0]]
  const spans = closed ? n : n - 1
  for (let i = 0; i < spans; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2)
    for (let k = 1; k <= 6; k++) {
      const t = k / 6, t2 = t * t, t3 = t2 * t
      out.push([0, 1, 2].map(c => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)) as [number, number, number])
    }
  }
  return out
}

/** A 3D curve object: one run as its own 3D polyline, several as parts. */
function makeCurve3(env: MakeEnv, id: number, kind: string, props: Kw, runs: Array<Array<[number, number, number]>>, closed: boolean, d: StyleDefaults = {}) {
  const style = styleFrom(props, d)
  const good = runs.filter(r => r.length >= 2)
  if (good.length === 1) {
    put(env, id, kind, props, style, [], { p3: good[0].flat(), closed3: closed, m3: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], data: { start3: good[0][0], end3: good[0][good[0].length - 1] } })
    return
  }
  const kids = good.map(r => {
    const k = env.w.newId()
    env.w.set(newMob(k, 'curve3', style, [], { p3: r.flat(), closed3: closed, m3: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] }))
    return k
  })
  put(env, id, kind, props, style, [], { children: kids })
}

/* ---------------------------------------------------------------- brace */

function cubicPts(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: number, out: Pt[]) {
  for (let i = out.length ? 1 : 0; i <= n; i++) {
    const t = i / n, u = 1 - t
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ])
  }
}

/** Manim's brace is this deep (outline included), whatever its width. */
const BRACE_DEPTH = 0.273

/** A curly brace of width W, opening up, its top at y = 0 and its tip BRACE_DEPTH below. Filled outline. */
export function bracePaths(W: number): Subpath[] {
  const h = 0.25
  const q = Math.min(0.18, W / 4), x = W / 2
  const half: Pt[] = []
  cubicPts([-x, 0], [-x, -h * 0.45], [-x + q * 0.3, -h / 2], [-x + q, -h / 2], 16, half)
  half.push([-q, -h / 2])
  const tail: Pt[] = []
  cubicPts([-q, -h / 2], [-q * 0.3, -h / 2], [0, -h * 0.55], [0, -h], 16, tail)
  half.push(...tail.slice(1))
  const center: Pt[] = [...half, ...half.slice(0, -1).reverse().map(p => [-p[0], p[1]] as Pt)]
  // Thickness: thin at the ends and the tip, thickest in between.
  const n = center.length
  const left: Pt[] = [], right: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = center[Math.max(0, i - 1)], b = center[Math.min(n - 1, i + 1)]
    let tx = b[0] - a[0], ty = b[1] - a[1]
    const l = Math.hypot(tx, ty) || 1
    tx /= l; ty /= l
    const s = i / (n - 1)
    const th = 0.016 + 0.045 * Math.sin(Math.PI * ((s <= 0.5 ? s : 1 - s) * 2))
    left.push([center[i][0] - ty * th / 2, center[i][1] + tx * th / 2])
    right.push([center[i][0] + ty * th / 2, center[i][1] - tx * th / 2])
  }
  const outline = [...left, ...right.reverse()]
  // Fit exactly: as wide as asked, top at 0, BRACE_DEPTH deep.
  let top = -Infinity, bottom = Infinity, xmax = 0
  for (const p of outline) { top = Math.max(top, p[1]); bottom = Math.min(bottom, p[1]); xmax = Math.max(xmax, Math.abs(p[0])) }
  const k = BRACE_DEPTH / (top - bottom || 1), kx = x / (xmax || 1)
  return [polySub(outline.map(p => [p[0] * kx, (p[1] - top) * k] as Pt), true)]
}

/** One or several objects (a list) → their combined box, measured after `pre` (a rotation for Brace). */
export function targetsBox(w: World, t: unknown, pre?: Mat): Box {
  const list = Array.isArray(t) ? t : [t]
  let box: Box | null = null
  for (const ref of list) {
    for (const i of family(w, resolveTarget(w, ref))) {
      const m = w.get(i)
      if (m.paths.length || m.text) box = unionBox(box, mobBox(m, pre ? mul(pre, m.m) : m.m))
    }
  }
  return box || [0, 0, 0, 0]
}

function makeBrace(env: MakeEnv, id: number, props: Kw) {
  const w = env.w
  const dir: Pt = props.direction ? resolvePoint(w, props.direction) : [0, -1]
  const theta = Math.atan2(dir[1], dir[0]) + Math.PI / 2
  const buff = num(props.buff, 0.2)
  const R = rotateAbout(-theta, [0, 0])
  const target = props.target ?? props.mobject
  let box: Box
  if (target != null) box = targetsBox(w, target, R)
  else {
    const a = apply(R, pt(env, props.start, [-1, 0])), b = apply(R, pt(env, props.end, [1, 0]))
    box = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
  }
  const W = box[2] - box[0]
  const m = mul(rotateAbout(theta, [0, 0]), translate((box[0] + box[2]) / 2, box[1] - buff))
  put(env, id, 'brace', props, styleFrom(props, { sw: 0, fo: 1 }), bracePaths(Math.max(W, 0.1)), {
    m, data: { tip: [0, -BRACE_DEPTH], start: [-W / 2, 0], end: [W / 2, 0] },
  })
}

/** buff as a number or an (x, y) pair. */
function buff2(v: unknown, d: number): [number, number] {
  if (Array.isArray(v)) return [num(v[0], d), num(v[1], d)]
  const b = num(v, d)
  return [b, b]
}

/* ------------------------------------------------------------- the table */

export type Builder = (env: MakeEnv, id: number, p: Kw, kind: string) => void | Promise<void>

function shape(paths: (p: Kw, env: MakeEnv) => Subpath[], d: StyleDefaults = {}, at?: (p: Kw, env: MakeEnv) => Pt | null): Builder {
  return (env, id, p, kind) => {
    const c = at ? at(p, env) : null
    put(env, id, kind, p, styleFrom(p, d), paths(p, env), c ? { m: translate(c[0], c[1]) } : undefined)
  }
}

const arcCenter = (p: Kw, env: MakeEnv) => (p.arc_center != null ? pt(env, p.arc_center, [0, 0]) : null)

function vertices(env: MakeEnv, p: Kw): Pt[] {
  const vs = p.vertices ?? p.points ?? []
  return (vs as unknown[]).map(v => resolvePoint(env.w, v))
}

export const BUILDERS: Record<string, Builder> = {
  circle: shape(p => [circleSub([0, 0], num(p.radius, 1))], { color: RED }, arcCenter),
  dot: shape(p => [circleSub([0, 0], num(p.radius, 0.08))], { sw: 0, fo: 1 }, (p, env) => pt(env, p.point, [0, 0])),
  point: shape(() => [], {}, (p, env) => pt(env, p.location ?? p.point, [0, 0])),
  square: shape(p => [polySub(rectCorners(num(p.side_length, 2), num(p.side_length, 2)), true)]),
  rectangle: shape(p => [polySub(rectCorners(num(p.width, 4), num(p.height, 2)), true)]),
  rounded_rectangle: shape(p => [roundedRectSub(num(p.width, 4), num(p.height, 2), num(p.corner_radius, 0.5))]),
  ellipse: shape(p => [arcSub([0, 0], num(p.width, 2) / 2, num(p.height, 1) / 2, 0, TAU, true)], { color: RED }, arcCenter),
  arc: (env, id, p, kind) => {
    const c = pt(env, p.arc_center, [0, 0])
    // Always 8 curves, like Manim's Arc, whatever the angle.
    put(env, id, kind, p, styleFrom(p), [arcSub(c, num(p.radius, 1), num(p.radius, 1), num(p.start_angle, 0), num(p.angle, TAU / 4), false, 8)])
  },
  annulus: (env, id, p, kind) => {
    const c = pt(env, p.arc_center, [0, 0]), r1 = num(p.inner_radius, 1), r2 = num(p.outer_radius, 2)
    put(env, id, kind, p, styleFrom(p, { sw: 0, fo: 1 }), [arcSub(c, r2, r2, 0, TAU, true), arcSub(c, r1, r1, 0, -TAU, true)])
  },
  triangle: shape(p => [polySub(regularPolygonPts(3, num(p.radius, 1), num(p.start_angle, Math.PI / 2)), true)], { color: BLUE }),
  regular_polygon: shape(p => {
    const n = Math.max(3, Math.round(num(p.n, 6)))
    return [polySub(regularPolygonPts(n, num(p.radius, 1), num(p.start_angle, n % 2 ? Math.PI / 2 : 0)), true)]
  }, { color: BLUE }),
  star: shape(p => {
    const n = Math.max(2, Math.round(num(p.n, 5))), R = num(p.outer_radius, 1), d = num(p.density, 2)
    const r = p.inner_radius != null ? num(p.inner_radius, 0.4) : (R * Math.cos((Math.PI * d) / n)) / Math.cos((Math.PI * (d - 1)) / n)
    return [polySub(starPts(n, R, r, num(p.start_angle, Math.PI / 2)), true)]
  }, { color: BLUE }),
  polygon: (env, id, p, kind) => { put(env, id, kind, p, styleFrom(p, { color: BLUE }), [polySub(vertices(env, p), true)]) },
  polyline: (env, id, p, kind) => { put(env, id, kind, p, styleFrom(p), [polySub(vertices(env, p), false)]) },
  vmobject: (env, id, p, kind) => {
    const subs: unknown[][] = Array.isArray(p.subpaths) ? p.subpaths : [p.points || []]
    const mode = p.mode ?? (p.smooth ? 'smooth' : 'corners')
    const closed = !!p.closed
    // Points off the screen plane: a 3D curve (ParametricFunction in space).
    const s3 = subs.map(s => (s as unknown[]).map(v => resolvePoint3(env.w, v)))
    if (s3.some(s => curve3(s))) {
      const runs = s3.map(s => (mode === 'smooth' ? smooth3(s, closed) : s))
      makeCurve3(env, id, kind, p, runs, closed)
      return
    }
    const paths = subs.map(s => {
      const pts = (s as unknown[]).map(v => resolvePoint(env.w, v))
      if (mode === 'bezier') return { points: pts, closed }
      return mode === 'smooth' ? smoothSub(pts, closed) : polySub(pts, closed)
    }).filter(s => s.points.length)
    put(env, id, kind, p, styleFrom(p), paths)
  },
  line: (env, id, p, kind) => {
    const [s, e] = trimmed(...lineEnds(env, p.start, p.end), num(p.buff, 0))
    put(env, id, kind, p, styleFrom(p), [lineSub(s, e)], { data: { start: s, end: e } })
  },
  dashed_line: (env, id, p, kind) => {
    // Each dash is its own part (Manim's DashedLine: 20 dashes per 2 units by default).
    const [s, e] = trimmed(...lineEnds(env, p.start, p.end), num(p.buff, 0))
    const style = styleFrom(p)
    const children = dashedPaths([lineSub(s, e)], num(p.dash_length, 0.05), num(p.dashed_ratio, 0.5)).map(d => {
      const did = env.w.newId()
      env.w.set(newMob(did, 'dash', style, [d]))
      return did
    })
    put(env, id, kind, p, style, [], { children, data: { start: s, end: e } })
  },
  arrow: (env, id, p, kind) => makeArrow(env, id, kind, p, ...lineEnds(env, p.start, p.end), num(p.buff, 0.25), false),
  double_arrow: (env, id, p, kind) => makeArrow(env, id, kind, p, ...lineEnds(env, p.start, p.end), num(p.buff, 0.25), true),
  vector: (env, id, p, kind) => makeArrow(env, id, kind, p, [0, 0], pt(env, p.direction, [1, 0]), num(p.buff, 0), false),
  group: (env, id, p, kind) => {
    const kids = ((p.children || []) as unknown[]).map(c => resolveTarget(env.w, c))
    put(env, id, kind, p, styleFrom(p), [], { children: kids })
  },
  text: (env, id, p, kind) => makeText(env, id, kind, p, String(p.text ?? '')),
  decimal_number: (env, id, p, kind) => makeNumber(env, id, kind, p),
  value_tracker: (env, id, p, kind) => {
    // A camera tracker (camera.phi_tracker …) also names the camera setting it drives.
    put(env, id, kind, p, styleFrom(p), [], { data: { value: num(p.value, 0), ...(p.camera != null ? { camera: String(p.camera) } : {}) } })
  },
  /** Variable: "label = " then a DecimalNumber ([0] label, [1] number), as Manim's Variable. */
  variable: (env, id, p, kind) => {
    const key = fontKey('normal', 'normal')
    if (env.text.font(key) === undefined) return env.text.load(key).then(() => BUILDERS.variable(env, id, p, kind))
    const lid = env.w.newId(), nid = env.w.newId()
    const v = typeof p.var === 'number' ? p.var : p.var != null ? Number(env.w.get(resolveTarget(env.w, p.var)).data?.value ?? 0) : num(p.value, 0)
    makeText(env, lid, 'text', { font_size: p.font_size, color: p.color }, `${p.label ?? 'x'} =`)
    makeNumber(env, nid, 'decimal_number', { number: v, num_decimal_places: p.num_decimal_places, font_size: p.font_size, color: p.color })
    put(env, id, kind, p, styleFrom(p), [], { children: [lid, nid] })
    const kids = env.w.get(id).children
    const b0 = familyBox(env.w, kids[0])
    const b1 = familyBox(env.w, kids[1])
    shiftFamily(env.w, kids[1], translate(b0[2] + 0.2 - b1[0], (b0[1] + b0[3]) / 2 - (b1[1] + b1[3]) / 2))
    const c = boxCenter(familyBox(env.w, id))
    shiftFamily(env.w, id, translate(-c[0], -c[1]))
  },
  /** TracedPath: the engine samples `point` over the timeline from now on (see engine). */
  traced_path: (env, id, p, kind) => {
    put(env, id, kind, p, styleFrom(p, { sw: num(p.stroke_width, 2) }), [], {
      data: { trace: { point: p.point ?? p.traced_point, dissipating: p.dissipating_time != null ? num(p.dissipating_time, 0) : null } },
    })
  },
  /** PycturesCanvas: a canvas Python draws on, placed in a width × height box. */
  pyctures_canvas: (env, id, p, kind) => {
    const W = num(p.width, 4), H = num(p.height, 3)
    const pxW = Math.max(1, Math.round(num(p.px_width ?? p.pixel_width, W * 100)))
    const pxH = Math.max(1, Math.round(num(p.px_height ?? p.pixel_height, H * 100)))
    // Python may hand over its own canvas element; otherwise the engine makes one (canvas_for(id)).
    const src = p.canvas && typeof p.canvas === 'object' ? (p.canvas as CanvasImageSource) : canvasFactory ? canvasFactory(pxW, pxH) : null
    const at = p.point != null ? pt(env, p.point, [0, 0]) : null
    put(env, id, kind, p, styleFrom({ fill_opacity: 1, ...p }, { sw: 0 }), [], {
      image: { src, w: W, h: H, fullW: W, fullH: H, live: true }, ...(at ? { m: translate(at[0], at[1]) } : {}), data: { pxW, pxH },
    })
  },
  mathtex: (env, id, p, kind) => makeTex(env, id, kind, p, 'math'),
  tex: (env, id, p, kind) => makeTex(env, id, kind, p, 'text'),
  axes: (env, id, p, kind) => makeAxes(env, id, kind, p),
  number_plane: (env, id, p, kind) => makeAxes(env, id, kind, p),
  number_line: (env, id, p) => makeNumberLine(env, id, p),
  graph: (env, id, p) => makeGraph(env, id, p),
  brace: (env, id, p) => makeBrace(env, id, p),
  surrounding_rectangle: (env, id, p, kind) => {
    const b = targetsBox(env.w, p.target ?? p.mobject)
    const [bx, by] = buff2(p.buff, 0.1)
    const W = b[2] - b[0] + 2 * bx, H = b[3] - b[1] + 2 * by
    put(env, id, kind, p, styleFrom(p, { color: PURE_YELLOW }), [roundedRectSub(W, H, num(p.corner_radius, 0))], {
      m: translate((b[0] + b[2]) / 2, (b[1] + b[3]) / 2),
    })
  },
  background_rectangle: (env, id, p, kind) => {
    const b = targetsBox(env.w, p.target ?? p.mobject)
    const [bx, by] = buff2(p.buff, 0)
    const W = b[2] - b[0] + 2 * bx, H = b[3] - b[1] + 2 * by
    put(env, id, kind, p, styleFrom({ fill_opacity: 0.75, stroke_opacity: 0, ...p }, { color: BLACK, sw: 0 }), [polySub(rectCorners(W, H), true)], {
      m: translate((b[0] + b[2]) / 2, (b[1] + b[3]) / 2),
    })
  },
}

const ALIASES: Record<string, string> = {
  vgroup: 'group', v_group: 'group', mobject: 'group', v_mobject: 'vmobject', math_tex: 'mathtex',
  integer: 'decimal_number', regular_polygram: 'regular_polygon', surrounding_rect: 'surrounding_rectangle',
  round_rectangle: 'rounded_rectangle', plot: 'graph', parametric_function: 'graph',
}

/** "MathTex", "VGroup", "number_plane" → this table's name. */
export function kindName(kind: string): string {
  const snake = String(kind).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z])([A-Z][a-z])/g, '$1_$2').toLowerCase()
  return ALIASES[snake] || snake
}

export const KIND_NAMES = (): string[] => [...Object.keys(BUILDERS), ...Object.keys(MORE_KINDS), ...Object.keys(KINDS_3D)]

/** Create object `id`. Returns a Promise when it must wait for a font or TeX. */
export function make(env: MakeEnv, id: number, kind: string, props: unknown): void | Promise<void> {
  const name = kindName(kind)
  const b = BUILDERS[name] || MORE_KINDS[name] || KINDS_3D[name]
  if (!b) throw new Error(`the animation layer cannot make "${kind}" yet`)
  return b(env, id, normArgs(props, []), String(kind).toLowerCase() === 'integer' ? 'integer' : name)
}
