/**
 * The second set of objects (Contract v2): more geometry, text layout
 * (Paragraph, BulletedList, MarkupText, Table, Matrix, Code), more graphing
 * (ComplexPlane, PolarPlane, BarChart, area and Riemann rectangles, Graph
 * layouts), SVGMobject and ImageMobject. Same rules as kinds.ts: Manim's
 * keyword names and defaults; anything that waits for a font, TeX or an image
 * returns a Promise and holds later commands.
 */
import type { Pt, Subpath } from './geometry-types'
import { apply, mul, rotateAbout, scaleAbout, translate, type Mat } from './math'
import {
  arcSub, circleSub, lineSub, partialPaths, pointAt, polySub, roundedRectSub, totalLength, transformPaths, TAU, type Box,
} from './geometry'
import { boxCenter, familyBox, leaves, newMob, type Style, type World } from './scene'
import { axisToLocal, endPoint, num, resolvePoint, resolveTarget, type AxisMap, type Kw } from './args'
import { BARCHART_COLORS, NAMED, normColor, WHITE } from './color'
import { fontKey } from './text'
import {
  emFor, formatNumber, lineEnds, makeArrow, makeAxes, makeTex, makeText, pt, put, shiftFamily, styleFrom, targetsBox,
  tipPaths, type Builder, type MakeEnv,
} from './kinds'
import { parsePathData } from './tex/svg-path'

const BLACK = '#000000'
const BLUE = NAMED.BLUE
const BLUE_D = NAMED.BLUE_D
const RED = NAMED.RED

/** Several make() results, some maybe waiting: one Promise when any waits. */
function all(rs: Array<void | Promise<void>>, then: () => void): void | Promise<void> {
  const waits = rs.filter(r => r && typeof (r as Promise<void>).then === 'function') as Promise<void>[]
  if (!waits.length) return then()
  return Promise.all(waits).then(then)
}

function moveCenterTo(w: World, id: number, x: number, y: number) {
  const c = boxCenter(familyBox(w, id))
  shiftFamily(w, id, translate(x - c[0], y - c[1]))
}

function group(env: MakeEnv, id: number, kind: string, props: Kw, children: number[], extra = {}) {
  put(env, id, kind, props, styleFrom(props), [], { children, ...extra })
}

/* ---------------------------------------------------------------- geometry */

/** The two lines' meeting point and the directions Angle measures between. */
function lineDirs(w: World, l1: number, l2: number, quadrant: number[]) {
  const a0 = endPoint(w, l1, 'start'), a1 = endPoint(w, l1, 'end')
  const b0 = endPoint(w, l2, 'start'), b1 = endPoint(w, l2, 'end')
  const d1: Pt = [a1[0] - a0[0], a1[1] - a0[1]], d2: Pt = [b1[0] - b0[0], b1[1] - b0[1]]
  const den = d1[0] * d2[1] - d1[1] * d2[0]
  let p: Pt
  if (Math.abs(den) < 1e-12) p = a1
  else {
    const t = ((b0[0] - a0[0]) * d2[1] - (b0[1] - a0[1]) * d2[0]) / den
    p = [a0[0] + d1[0] * t, a0[1] + d1[1] * t]
  }
  const n = (v: Pt, s: number): Pt => { const l = Math.hypot(v[0], v[1]) || 1; return [(v[0] / l) * s, (v[1] / l) * s] }
  return { p, u: n(d1, quadrant[0] < 0 ? -1 : 1), v: n(d2, quadrant[1] < 0 ? -1 : 1) }
}

function makeAngle(env: MakeEnv, id: number, kind: string, props: Kw, elbow: boolean) {
  const w = env.w
  const { p, u, v } = lineDirs(w, resolveTarget(w, props.line1), resolveTarget(w, props.line2), Array.isArray(props.quadrant) ? props.quadrant : [1, 1])
  const a1 = Math.atan2(u[1], u[0]), a2 = Math.atan2(v[1], v[0])
  let sweep = (((a2 - a1) % TAU) + TAU) % TAU
  if (props.other_angle) sweep -= TAU
  let paths: Subpath[]
  if (elbow || props.elbow) {
    const L = num(props.length, 0.4)
    paths = [polySub([[p[0] + u[0] * L, p[1] + u[1] * L], [p[0] + (u[0] + v[0]) * L, p[1] + (u[1] + v[1]) * L], [p[0] + v[0] * L, p[1] + v[1] * L]], false)]
  } else {
    const r = num(props.radius, 0.4)
    paths = [arcSub(p, r, r, a1, sweep, false, 8)]
  }
  put(env, id, kind, props, styleFrom(props), paths, { data: { value: Math.abs(sweep), vertex: p } })
}

/**
 * Sector / AnnularSector, starting where Manim's do: on the inner arc at the
 * start angle (the centre for a Sector), inner arc forward, out to the outer
 * arc, outer arc back, and closed.
 */
function makeSector(env: MakeEnv, id: number, kind: string, props: Kw, inner: number, outer: number) {
  const c = pt(env, props.arc_center, [0, 0])
  const a0 = num(props.start_angle, 0), ang = num(props.angle, TAU / 4)
  const seg = (pts: Pt[], b: Pt) => {
    const a = pts[pts.length - 1]
    pts.push([a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3], [a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3], [b[0], b[1]])
  }
  const outBack = arcSub(c, outer, outer, a0 + ang, -ang, false, 8).points
  let pts: Pt[]
  if (inner > 1e-9) {
    pts = [...arcSub(c, inner, inner, a0, ang, false, 8).points]
    seg(pts, outBack[0])
    pts.push(...outBack.slice(1))
  } else {
    pts = [[c[0], c[1]]]
    seg(pts, [c[0] + outer * Math.cos(a0), c[1] + outer * Math.sin(a0)])
    pts.push(...arcSub(c, outer, outer, a0, ang, false, 8).points.slice(1))
  }
  seg(pts, pts[0])
  put(env, id, kind, props, styleFrom(props, { sw: 0, fo: 1 }), [{ points: pts, closed: true }], {
    data: { start: pts[0], end: pts[0] },
  })
}

/** An arc from a to b turning through `angle` (positive: counter-clockwise). */
function arcBetween(a: Pt, b: Pt, angle: number): Subpath {
  if (Math.abs(angle) < 1e-6) return lineSub(a, b)
  const c = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9
  const r = c / (2 * Math.sin(Math.abs(angle) / 2))
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
  const nx = -(b[1] - a[1]) / c, ny = (b[0] - a[0]) / c
  const h = r * Math.cos(angle / 2) * Math.sign(angle)
  const cx = mx + nx * h, cy = my + ny * h
  const s = Math.atan2(a[1] - cy, a[0] - cx)
  return arcSub([cx, cy], r, r, s, angle, false, 8)
}

function makeCurvedArrow(env: MakeEnv, id: number, kind: string, props: Kw, two: boolean) {
  const [a, b] = lineEnds(env, props.start ?? props.start_point, props.end ?? props.end_point)
  const arc = arcBetween(a, b, num(props.angle, TAU / 4))
  const L = totalLength([arc])
  const tip = Math.min(num(props.tip_length, 0.35), 0.25 * L)
  const style = styleFrom(props)
  const f0 = two ? tip / L : 0, f1 = 1 - tip / L
  const body = partialPaths([arc], f0, f1)
  const P = arc.points
  const dirAt = (i: number, j: number): Pt => { const d: Pt = [P[i][0] - P[j][0], P[i][1] - P[j][1]]; const l = Math.hypot(d[0], d[1]) || 1; return [d[0] / l, d[1] / l] }
  const tipStyle: Style = { ...style, fc: style.sc, fo: 1, sw: 0 }
  const kids: number[] = []
  const de = dirAt(P.length - 1, P.length - 2)
  const t1 = env.w.newId()
  env.w.set(newMob(t1, 'tip', tipStyle, tipPaths(b, de[0], de[1], tip, tip)))
  kids.push(t1)
  if (two) {
    const ds = dirAt(0, 1)
    const t2 = env.w.newId()
    env.w.set(newMob(t2, 'tip', tipStyle, tipPaths(a, ds[0], ds[1], tip, tip)))
    kids.push(t2)
  }
  put(env, id, kind, props, style, body, { children: kids, data: { start: a, end: b } })
}

/* ------------------------------------------------------------ text layout */

/** Make several text-like objects (some may wait for a font), then lay them out. */
function makeTexts(env: MakeEnv, items: Array<{ id: number; kind: 'text' | 'mathtex' | 'tex' | 'number'; str: string; props: Kw }>): Array<void | Promise<void>> {
  return items.map(it => {
    if (it.kind === 'text') return makeText(env, it.id, 'text', it.props, it.str)
    if (it.kind === 'number') return makeText(env, it.id, 'text', it.props, it.str)
    return makeTex(env, it.id, it.kind, { ...it.props, parts: [it.str] }, it.kind === 'mathtex' ? 'math' : 'text')
  })
}

function makeParagraph(env: MakeEnv, id: number, kind: string, props: Kw, lines: string[], bullets = false) {
  const em = emFor(num(props.font_size, 48))
  const ids = lines.map(() => env.w.newId())
  const rs = makeTexts(env, lines.map((l, i) => ({ id: ids[i], kind: 'text', str: bullets ? `•  ${l}` : l, props: { font_size: props.font_size, color: props.color, weight: props.weight, slant: props.slant, font: props.font, letter_spacing: props.letter_spacing } })))
  return all(rs, () => {
    const align = String(props.alignment || (bullets ? 'left' : 'left')).toLowerCase()
    const pitch = bullets ? em * 1.2 + num(props.buff, 0.5) * 0.5 : em * 1.25 * num(props.line_spacing, 1)
    ids.forEach((lid, i) => {
      const b = familyBox(env.w, lid)
      const x = align === 'center' ? -(b[0] + b[2]) / 2 : align === 'right' ? -b[2] : -b[0]
      shiftFamily(env.w, lid, translate(x, -i * pitch - (b[1] + b[3]) / 2))
    })
    group(env, id, kind, props, ids)
    moveCenterTo(env.w, id, 0, 0)
  })
}

/** MarkupText: <b>, <i>, <span foreground|color="…">, <u> (ignored); glyphs from the character cache. */
function makeMarkup(env: MakeEnv, id: number, kind: string, props: Kw): void | Promise<void> {
  const src = String(props.text ?? '')
  const fk = (b: string, i: string) => fontKey(b, i, props.font)
  const keys = Array.from(new Set([fk('normal', 'normal'), fk('bold', 'normal'), fk('normal', 'italic'), fk('bold', 'italic')]))
  const missing = keys.filter(k => env.text.font(k) === undefined)
  if (missing.length) return Promise.all(missing.map(k => env.text.load(k))).then(() => makeMarkup(env, id, kind, props))
  const base = styleFrom(props, { sw: 0, fo: 1 })
  const runs: Array<{ ch: string; bold: boolean; italic: boolean; color: string | null }> = []
  const stack: Array<{ tag: string; color?: string }> = []
  const re = /<\s*(\/?)\s*(\w+)([^>]*)>|([^<]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m[4] != null) {
      const text = m[4].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      const bold = stack.some(s => s.tag === 'b' || s.tag === 'strong'), italic = stack.some(s => s.tag === 'i' || s.tag === 'em')
      const col = [...stack].reverse().find(s => s.color)?.color ?? null
      for (const ch of Array.from(text)) runs.push({ ch, bold, italic, color: col })
    } else if (m[1]) {
      const i = stack.map(s => s.tag).lastIndexOf(m[2].toLowerCase())
      if (i >= 0) stack.splice(i, 1)
    } else {
      const attrs = m[3] || ''
      const c = /(?:foreground|fgcolor|color)\s*=\s*["']([^"']+)["']/i.exec(attrs)
      stack.push({ tag: m[2].toLowerCase(), color: c ? normColor(c[1], WHITE) : undefined })
    }
  }
  const em = emFor(num(props.font_size, 48))
  let x = 0, y = 0
  const kids: number[] = []
  let fallback = ''
  for (const r of runs) {
    if (r.ch === '\n') { x = 0; y -= em * 1.25; continue }
    const key = fk(r.bold ? 'bold' : 'normal', r.italic ? 'italic' : 'normal')
    const g = env.text.glyph(r.ch, em, key)
    fallback += r.ch
    if (!g) continue
    if (g.paths.length) {
      const gid = env.w.newId()
      const st = r.color ? { ...base, sc: r.color, fc: r.color } : base
      env.w.set(newMob(gid, 'glyph', st, g.paths, { m: translate(x, y), data: { char: r.ch } }))
      kids.push(gid)
    }
    x += g.advance + num(props.letter_spacing, 0) * em
  }
  if (!kids.length && fallback.trim()) return makeText(env, id, kind, props, fallback)
  group(env, id, kind, props, kids, { data: { text: fallback } })
  moveCenterTo(env.w, id, 0, 0)
}

type CellKind = 'text' | 'mathtex' | 'number'

/** Table / MathTable / MobjectTable cells laid out on a grid with lines between. */
function makeTable(env: MakeEnv, id: number, kind: string, props: Kw, cellKind: CellKind) {
  let rows: unknown[][] = (props.table ?? props.data ?? []) as unknown[][]
  if (props.col_labels) rows = [props.col_labels, ...rows]
  if (props.row_labels) {
    const lab = props.row_labels as unknown[]
    rows = rows.map((r, i) => [props.col_labels ? (i === 0 ? props.top_left_entry ?? '' : lab[i - 1]) : lab[i], ...r])
  }
  const nr = rows.length, nc = Math.max(0, ...rows.map(r => r.length))
  const cellIds: number[] = []
  const items: Array<{ id: number; kind: 'text' | 'mathtex' | 'number'; str: string; props: Kw }> = []
  rows.forEach(r => {
    for (let c = 0; c < nc; c++) {
      const cid = env.w.newId()
      cellIds.push(cid)
      const v = r[c] ?? ''
      items.push({ id: cid, kind: cellKind, str: typeof v === 'number' ? String(v) : String(v), props: { font_size: props.font_size, color: props.color } })
    }
  })
  return all(makeTexts(env, items), () => {
    const w = env.w
    const hb = num(props.h_buff, 1.3), vb = num(props.v_buff, 0.8)
    const colW = new Array(nc).fill(0), rowH = new Array(nr).fill(0)
    cellIds.forEach((cid, i) => {
      const b = familyBox(w, cid), r = Math.floor(i / nc), c = i % nc
      colW[c] = Math.max(colW[c], b[2] - b[0])
      rowH[r] = Math.max(rowH[r], b[3] - b[1])
    })
    const xs: number[] = [], ys: number[] = []
    let acc = 0
    for (let c = 0; c < nc; c++) { xs.push(acc + colW[c] / 2); acc += colW[c] + hb }
    const W = acc - hb
    acc = 0
    for (let r = 0; r < nr; r++) { ys.push(-(acc + rowH[r] / 2)); acc += rowH[r] + vb }
    const H = acc - vb
    cellIds.forEach((cid, i) => moveCenterTo(w, cid, xs[i % nc] - W / 2, ys[Math.floor(i / nc)] + H / 2))
    const lineStyle: Style = { ...styleFrom(props.line_config || {}), sw: num(props.line_config?.stroke_width, 2) }
    const outer = !!props.include_outer_lines
    const hl: Subpath[] = [], vl: Subpath[] = []
    // Lines run the table's full width/height, half a buff past the outer cells (Manim's).
    const x0 = -W / 2 - hb / 2, x1 = W / 2 + hb / 2
    const y0 = H / 2 + vb / 2, y1 = -H / 2 - vb / 2
    for (let r = 0; r < nr - 1; r++) { const y = ys[r] - rowH[r] / 2 - vb / 2 + H / 2; hl.push(lineSub([x0, y], [x1, y])) }
    for (let c = 0; c < nc - 1; c++) { const x = xs[c] + colW[c] / 2 + hb / 2 - W / 2; vl.push(lineSub([x, y0], [x, y1])) }
    if (outer) {
      hl.unshift(lineSub([x0, y0], [x1, y0])); hl.push(lineSub([x0, y1], [x1, y1]))
      vl.unshift(lineSub([x0, y0], [x0, y1])); vl.push(lineSub([x1, y0], [x1, y1]))
    }
    const eid = w.newId(), hid = w.newId(), vid = w.newId()
    w.set(newMob(eid, 'group', lineStyle, [], { children: cellIds }))
    const mk = (gid: number, subs: Subpath[]) => {
      const kids = subs.map(s => { const k = w.newId(); w.set(newMob(k, 'line', lineStyle, [s])); return k })
      w.set(newMob(gid, 'group', lineStyle, [], { children: kids }))
    }
    const inner = props.include_inner_lines !== false
    mk(hid, inner ? hl : outer ? [hl[0], hl[hl.length - 1]] : [])
    mk(vid, inner ? vl : outer ? [vl[0], vl[vl.length - 1]] : [])
    // [0] entries row-major (labels included), [1] horizontal lines, [2] vertical lines.
    group(env, id, kind, props, [eid, hid, vid], { data: { rows: nr, cols: nc } })
  })
}

/** A filled square bracket as tall as h, opening right (flip for the right one). */
function bracketPath(h: number, flip: boolean): Subpath[] {
  const wd = 0.14, th = 0.035
  const s = flip ? -1 : 1
  const pts: Pt[] = [[0, h / 2], [s * wd, h / 2], [s * wd, h / 2 - th], [s * th, h / 2 - th], [s * th, -h / 2 + th], [s * wd, -h / 2 + th], [s * wd, -h / 2], [0, -h / 2]]
  return [polySub(pts, true)]
}

function makeMatrix(env: MakeEnv, id: number, kind: string, props: Kw, cellKind: CellKind, places: number) {
  const rows = (props.matrix ?? props.data ?? []) as unknown[][]
  const nr = rows.length, nc = Math.max(0, ...rows.map(r => (r as unknown[]).length))
  const ids: number[] = []
  const items: Array<{ id: number; kind: 'text' | 'mathtex' | 'number'; str: string; props: Kw }> = []
  rows.forEach(r => {
    for (let c = 0; c < nc; c++) {
      const cid = env.w.newId()
      ids.push(cid)
      const v = (r as unknown[])[c]
      const str = cellKind === 'number' ? formatNumber(Number(v), places) : String(v ?? '')
      items.push({ id: cid, kind: cellKind === 'number' ? 'number' : cellKind, str, props: { font_size: props.font_size, color: props.color } })
    }
  })
  return all(makeTexts(env, items), () => {
    const w = env.w
    const vb = num(props.v_buff, 0.8), hb = num(props.h_buff, 1.3)
    // Manim: entry (i, j) is centred at j·h_buff right, i·v_buff down.
    ids.forEach((cid, i) => moveCenterTo(w, cid, (i % nc) * hb, -Math.floor(i / nc) * vb))
    const eid = w.newId()
    w.set(newMob(eid, 'group', styleFrom(props), [], { children: ids }))
    const b = familyBox(w, eid)
    const h = b[3] - b[1] + 2 * num(props.bracket_v_buff, 0.25)
    const bb = num(props.bracket_h_buff, 0.25)
    const st = styleFrom({ ...props, fill_opacity: 1, stroke_width: 0 }, { sw: 0, fo: 1 })
    const l = w.newId(), r = w.newId()
    w.set(newMob(l, 'bracket', st, bracketPath(h, false), { m: translate(b[0] - bb, (b[1] + b[3]) / 2) }))
    w.set(newMob(r, 'bracket', st, bracketPath(h, true), { m: translate(b[2] + bb, (b[1] + b[3]) / 2) }))
    // [0] entries row-major, [1] left bracket, [2] right bracket.
    group(env, id, kind, props, [eid, l, r], { data: { rows: nr, cols: nc } })
    moveCenterTo(w, id, 0, 0)
  })
}

/* --------------------------------------------------------------- Code */

const KEYWORDS: Record<string, string[]> = {
  python: ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'import', 'from', 'as', 'with', 'try', 'except', 'finally', 'raise', 'lambda', 'yield', 'pass', 'break', 'continue', 'and', 'or', 'not', 'is', 'None', 'True', 'False', 'await', 'async', 'global', 'nonlocal', 'del', 'assert'],
  js: ['function', 'const', 'let', 'var', 'return', 'if', 'else', 'for', 'while', 'of', 'in', 'import', 'from', 'export', 'class', 'new', 'this', 'null', 'undefined', 'true', 'false', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'switch', 'case', 'break', 'continue', 'default'],
}
KEYWORDS.javascript = KEYWORDS.js
KEYWORDS.typescript = KEYWORDS.ts = KEYWORDS.js
/** A small dark palette (Monokai-like, no purple). */
const CODE_COLORS = { kw: '#F92672', str: '#E6DB74', com: '#75715E', num: '#FD971F', fn: '#A6E22E', text: '#F8F8F2' }

function tokenizeCode(line: string, lang: string): Array<{ s: string; c: string }> {
  const kws = new Set(KEYWORDS[lang] || KEYWORDS.python)
  const out: Array<{ s: string; c: string }> = []
  const re = /(#.*$|\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)(?=\s*\()|([A-Za-z_]\w*)|(\s+)|(.)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    if (m[1]) out.push({ s: m[1], c: CODE_COLORS.com })
    else if (m[2]) out.push({ s: m[2], c: CODE_COLORS.str })
    else if (m[3]) out.push({ s: m[3], c: CODE_COLORS.num })
    else if (m[4]) out.push({ s: m[4], c: kws.has(m[4]) ? CODE_COLORS.kw : CODE_COLORS.fn })
    else if (m[5]) out.push({ s: m[5], c: kws.has(m[5]) ? CODE_COLORS.kw : CODE_COLORS.text })
    else out.push({ s: m[6] ?? m[7], c: CODE_COLORS.text })
  }
  return out
}

function makeCode(env: MakeEnv, id: number, kind: string, props: Kw) {
  const tab = ' '.repeat(Math.max(1, Math.round(num(props.tab_width, 4))))
  const code = String(props.code_string ?? props.code ?? '').replace(/\t/g, tab).replace(/\s+$/, '')
  const lang = String(props.language || 'python').toLowerCase()
  const em = emFor(num(props.font_size, 24))
  const cw = em * 0.6, lh = em * 1.45
  const lines = code.split('\n')
  const numbers = props.add_line_numbers !== false
  const from = Math.round(num(props.line_numbers_from, 1))
  const gutter = numbers ? (String(lines.length + from - 1).length + 2) * cw : 0
  const w = env.w
  const token = (str: string, color: string, x: number, y: number) => {
    const tid = w.newId()
    const wd = str.length * cw
    w.set(newMob(tid, 'code_token', { sc: color, fc: color, sw: 0, so: 1, fo: 1 }, [], {
      text: { str, em, weight: 'normal', slant: 'normal', w: wd, h: em, family: 'mono', left: true },
      m: translate(x + wd / 2, y), data: { text: str },
    }))
    return tid
  }
  const numIds: number[] = [], lineIds: number[] = []
  lines.forEach((line, i) => {
    const y = -i * lh
    if (numbers) numIds.push(token(String(i + from), '#75715E', 0, y))
    const toks: number[] = []
    let col = 0
    for (const tk of tokenizeCode(line, lang)) {
      if (tk.s.trim()) toks.push(token(tk.s, tk.c, gutter + col * cw, y))
      col += tk.s.length
    }
    const lid = w.newId()
    w.set(newMob(lid, 'code_line', styleFrom(props), [], { children: toks, data: { text: line } }))
    lineIds.push(lid)
  })
  const nid = w.newId(), cid = w.newId()
  w.set(newMob(nid, 'group', styleFrom(props), [], { children: numIds }))
  w.set(newMob(cid, 'group', styleFrom(props), [], { children: lineIds }))
  const b = unionBoxes(w, [nid, cid])
  const pad = 0.3
  const bg = w.newId()
  const bgColor = normColor(props.background_color ?? '#272822', '#272822')
  w.set(newMob(bg, 'code_background', { sc: bgColor, fc: bgColor, sw: 0, so: 1, fo: 1 }, [roundedRectSub(b[2] - b[0] + 2 * pad, b[3] - b[1] + 2 * pad, 0.2)], {
    m: translate((b[0] + b[2]) / 2, (b[1] + b[3]) / 2),
  }))
  // [0] background, [1] line numbers (one per line), [2] code lines.
  group(env, id, kind, props, [bg, nid, cid], { data: { code } })
  moveCenterTo(w, id, 0, 0)
}

function unionBoxes(w: World, ids: number[]): Box {
  let b: Box = null
  for (const i of ids) {
    const x = familyBox(w, i)
    if (x[0] === x[2] && x[1] === x[3] && !w.get(i).children.length) continue
    b = b ? [Math.min(b[0], x[0]), Math.min(b[1], x[1]), Math.max(b[2], x[2]), Math.max(b[3], x[3])] : x
  }
  return b || [0, 0, 0, 0]
}

/* ------------------------------------------------------------- graphing */

/** y of a plotted graph at x (linear between its samples, in axis coordinates). */
export function graphY(samples: Pt[][], x: number): number | null {
  for (const run of samples) {
    if (!run.length) continue
    const lo = Math.min(run[0][0], run[run.length - 1][0]), hi = Math.max(run[0][0], run[run.length - 1][0])
    if (x < lo - 1e-9 || x > hi + 1e-9) continue
    for (let i = 0; i + 1 < run.length; i++) {
      const a = run[i], b = run[i + 1]
      if ((x - a[0]) * (x - b[0]) <= 0) {
        const t = b[0] === a[0] ? 0 : (x - a[0]) / (b[0] - a[0])
        return a[1] + (b[1] - a[1]) * t
      }
    }
  }
  return null
}

function graphInfo(w: World, id: number): { samples: Pt[][]; map: AxisMap; m: Mat } {
  const g = w.get(id)
  const samples = g.data?.samples as Pt[][]
  const map = g.data?.axes as AxisMap
  if (!samples || !map) throw new Error('this needs a graph plotted on axes')
  return { samples, map, m: g.m }
}

function makeArea(env: MakeEnv, id: number, kind: string, props: Kw) {
  const { samples, map, m } = graphInfo(env.w, resolveTarget(env.w, props.graph))
  const xs = samples.flat().map(p => p[0])
  const [a, b] = Array.isArray(props.x_range) ? props.x_range.map(Number) : [Math.min(...xs), Math.max(...xs)]
  const other = props.bounded_graph != null ? graphInfo(env.w, resolveTarget(env.w, props.bounded_graph)).samples : null
  const n = 120
  const top: Pt[] = [], bottom: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const x = a + ((b - a) * i) / n
    const y = graphY(samples, x) ?? 0
    const y2 = other ? graphY(other, x) ?? 0 : 0
    top.push(axisToLocal(map, x, y))
    bottom.push(axisToLocal(map, x, y2))
  }
  const paths = [polySub([...top, ...bottom.reverse()], true)]
  put(env, id, kind, props, styleFrom({ fill_opacity: num(props.opacity, 0.3), ...props }, { color: NAMED.GRAY ?? WHITE, sw: 0 }), paths, { m })
}

function makeRiemann(env: MakeEnv, id: number, kind: string, props: Kw) {
  const { samples, map, m } = graphInfo(env.w, resolveTarget(env.w, props.graph))
  const xs = samples.flat().map(p => p[0])
  const [a, b] = Array.isArray(props.x_range) ? props.x_range.map(Number) : [Math.min(...xs), Math.max(...xs)]
  const dx = num(props.dx, 0.1)
  const type = String(props.input_sample_type || 'left')
  const cols: string[] = Array.isArray(props.color) ? props.color.map((c: unknown) => normColor(c, BLUE)) : [normColor(props.color ?? BLUE, BLUE), normColor(props.color ?? NAMED.GREEN, NAMED.GREEN)]
  const n = Math.max(1, Math.round((b - a) / dx))
  const kids: number[] = []
  for (let i = 0; i < n; i++) {
    const x0 = a + i * dx, x1 = x0 + dx
    const xs0 = type === 'right' ? x1 : type === 'center' ? (x0 + x1) / 2 : x0
    const y = graphY(samples, xs0) ?? 0
    const p00 = axisToLocal(map, x0, 0), p11 = axisToLocal(map, x1, y)
    const col = cols.length > 1 ? lerpHex(cols, n > 1 ? i / (n - 1) : 0) : cols[0]
    const rid = env.w.newId()
    env.w.set(newMob(rid, 'rectangle', {
      sc: normColor(props.stroke_color ?? BLACK, BLACK), fc: col, sw: num(props.stroke_width, 1), so: 1, fo: num(props.fill_opacity, 1),
    }, [polySub([[p11[0], p11[1]], [p00[0], p11[1]], [p00[0], p00[1]], [p11[0], p00[1]]], true)], { m }))
    kids.push(rid)
  }
  group(env, id, kind, props, kids)
}

/** A colour along a gradient of several stops. */
function lerpHex(stops: string[], t: number): string {
  const s = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(s))
  const f = s - i
  const p = (h: string) => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16) || 0)
  const A = p(stops[i]), B = p(stops[i + 1])
  return '#' + A.map((v, k) => Math.round(v + (B[k] - v) * f).toString(16).padStart(2, '0')).join('').toUpperCase()
}

function makeBarChart(env: MakeEnv, id: number, kind: string, props: Kw): void | Promise<void> {
  const values = ((props.values ?? []) as unknown[]).map(Number)
  const n = values.length
  const maxV = Math.max(0, ...values), minV = Math.min(0, ...values)
  const yr = Array.isArray(props.y_range) ? props.y_range : [minV, maxV > 0 ? maxV : 1, Math.max(1, Math.ceil((maxV - minV) / 6))]
  const r = makeAxes(env, id, 'axes', {
    // Manim's BarChart: one unit per bar across, 4 units high (frame height − 4).
    x_range: [0, n, 1], y_range: yr, x_length: num(props.x_length, n), y_length: num(props.y_length, env.fh - 4),
    tips: false, axis_config: { include_tip: false, ...(props.axis_config || {}) }, x_axis_config: { include_ticks: false, ...(props.x_axis_config || {}) },
  })
  return all([r], () => {
    const w = env.w
    const ax = w.get(id)
    const map = ax.data.axes as AxisMap
    const stops: string[] = (Array.isArray(props.bar_colors) ? props.bar_colors : BARCHART_COLORS).map((c: unknown) => normColor(c, BLUE))
    const bw = num(props.bar_width, 0.6)
    const bars = values.map((v, i) => {
      const a = axisToLocal(map, i + 0.5 - bw / 2, 0), b = axisToLocal(map, i + 0.5 + bw / 2, v)
      const col = stops.length > 1 ? lerpHex(stops, n > 1 ? i / (n - 1) : 0) : stops[0]
      const bid = w.newId()
      w.set(newMob(bid, 'bar', { sc: col, fc: col, sw: num(props.bar_stroke_width, 3), so: 1, fo: num(props.bar_fill_opacity, 0.7) },
        [polySub([[b[0], b[1]], [a[0], b[1]], [a[0], a[1]], [b[0], a[1]]], true)], { m: ax.m }))
      return bid
    })
    const gid = w.newId()
    w.set(newMob(gid, 'group', ax.style, [], { children: bars }))
    const names = (props.bar_names ?? []) as unknown[]
    const labelIds: number[] = []
    const rs = names.map((nm, i) => {
      const lid = w.newId()
      labelIds.push(lid)
      return makeText(env, lid, 'text', { font_size: 24 }, String(nm))
    })
    return all(rs, () => {
      labelIds.forEach((lid, i) => {
        const p = apply(ax.m, axisToLocal(map, i + 0.5, 0))
        const b = familyBox(w, lid)
        moveCenterTo(w, lid, p[0], p[1] - 0.25 - (b[3] - b[1]) / 2)
      })
      const lg = w.newId()
      w.set(newMob(lg, 'group', ax.style, [], { children: labelIds }))
      w.update(id, { kind, children: [...ax.children, gid, lg], data: { ...ax.data, bars: gid, values, props } })
    })
  })
}

function makePolarPlane(env: MakeEnv, id: number, kind: string, props: Kw) {
  const rmax = num(props.radius_max, env.fh / 2)
  const size = num(props.size, rmax * 2)
  const k = size / 2 / rmax
  const step = num(props.radius_step, 1)
  const az = Math.max(1, Math.round(num(props.azimuth_step, 12)))
  const st: Style = { sc: normColor(props.background_line_style?.stroke_color ?? BLUE_D, BLUE_D), fc: BLUE_D, sw: 2, so: 1, fo: 0 }
  const circles: Subpath[] = []
  for (let r = step; r <= rmax + 1e-9; r += step) circles.push(circleSub([0, 0], r * k))
  const rays: Subpath[] = []
  for (let i = 0; i < az; i++) {
    const a = (TAU * i) / az
    rays.push(lineSub([0, 0], [Math.cos(a) * rmax * k, Math.sin(a) * rmax * k]))
  }
  const c = env.w.newId(), r = env.w.newId()
  env.w.set(newMob(c, 'background_lines', st, circles))
  env.w.set(newMob(r, 'background_lines', st, rays))
  const axSt: Style = { sc: WHITE, fc: WHITE, sw: 2, so: 1, fo: 0 }
  const xa = env.w.newId(), ya = env.w.newId()
  env.w.set(newMob(xa, 'number_line', axSt, [lineSub([-rmax * k, 0], [rmax * k, 0])]))
  env.w.set(newMob(ya, 'number_line', axSt, [lineSub([0, -rmax * k], [0, rmax * k])]))
  const map: AxisMap = { x0: 0, y0: 0, sx: k, sy: k, ox: 0, oy: 0 }
  put(env, id, kind, props, axSt, [], { children: [c, r, xa, ya], data: { axes: map, polar: true } })
}

/* ---------------------------------------------------------- graph layouts */

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Vertex positions for circular, spring (seeded, deterministic), tree, or given layouts, fitted to layout_scale. */
export function graphLayout(n: number, edges: Array<[number, number]>, layout: unknown, scale: number, root = 0): Pt[] {
  let pos: Pt[]
  if (layout && typeof layout === 'object' && !Array.isArray(layout)) {
    const d = layout as Record<string, number[]>
    pos = Array.from({ length: n }, (_, i) => { const p = d[i] ?? d[String(i)] ?? [0, 0]; return [Number(p[0]), Number(p[1])] as Pt })
    return pos
  }
  const kind = String(layout || 'spring')
  // Circular is not re-centred: vertex 0 sits at (scale, 0), as in Manim.
  if (kind === 'circular' || kind === 'shell') return Array.from({ length: n }, (_, i) => [scale * Math.cos((TAU * i) / n), scale * Math.sin((TAU * i) / n)] as Pt)
  if (kind === 'tree') {
    const adj: number[][] = Array.from({ length: n }, () => [])
    for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a) }
    const depth = new Array(n).fill(-1)
    const order: number[][] = []
    depth[root] = 0
    const q = [root]
    while (q.length) {
      const v = q.shift()
      ;(order[depth[v]] ||= []).push(v)
      for (const u of adj[v]) if (depth[u] < 0) { depth[u] = depth[v] + 1; q.push(u) }
    }
    pos = new Array(n).fill(null).map(() => [0, 0] as Pt)
    order.forEach((lvl, d) => lvl.forEach((v, i) => { pos[v] = [lvl.length > 1 ? (i / (lvl.length - 1)) * 2 - 1 : 0, 1 - (order.length > 1 ? (2 * d) / (order.length - 1) : 0)] }))
  } else {
    // Fruchterman–Reingold with a fixed seed, so the same graph always lays out the same way.
    const rnd = mulberry32(1)
    pos = Array.from({ length: n }, () => [rnd() * 2 - 1, rnd() * 2 - 1] as Pt)
    const k = Math.sqrt(4 / Math.max(1, n))
    let temp = 0.2
    for (let it = 0; it < 120; it++) {
      const disp = pos.map(() => [0, 0])
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const dx = pos[i][0] - pos[j][0], dy = pos[i][1] - pos[j][1]
        const d = Math.hypot(dx, dy) || 1e-6
        const f = (k * k) / d
        disp[i][0] += (dx / d) * f; disp[i][1] += (dy / d) * f
        disp[j][0] -= (dx / d) * f; disp[j][1] -= (dy / d) * f
      }
      for (const [a, b] of edges) {
        const dx = pos[a][0] - pos[b][0], dy = pos[a][1] - pos[b][1]
        const d = Math.hypot(dx, dy) || 1e-6
        const f = (d * d) / k
        disp[a][0] -= (dx / d) * f; disp[a][1] -= (dy / d) * f
        disp[b][0] += (dx / d) * f; disp[b][1] += (dy / d) * f
      }
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(disp[i][0], disp[i][1]) || 1e-6
        pos[i][0] += (disp[i][0] / d) * Math.min(d, temp)
        pos[i][1] += (disp[i][1] / d) * Math.min(d, temp)
      }
      temp *= 0.97
    }
  }
  // Centre and fit into [-scale, scale].
  const xs = pos.map(p => p[0]), ys = pos.map(p => p[1])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const ext = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 || 1
  return pos.map(p => [((p[0] - cx) / ext) * scale, ((p[1] - cy) / ext) * scale] as Pt)
}

function makeNetwork(env: MakeEnv, id: number, kind: string, props: Kw, directed: boolean): void | Promise<void> {
  const verts = (props.vertices ?? []) as unknown[]
  const n = verts.length
  // Edges are vertex indices (the Python half's form); vertex labels are accepted too.
  const idx = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n ? v : Math.max(0, verts.indexOf(v)))
  const edges = ((props.edges ?? []) as unknown[][]).map(e => [idx(e[0]), idx(e[1])] as [number, number])
  const root = typeof props.root_vertex === 'number' ? props.root_vertex : Math.max(0, verts.indexOf(props.root_vertex))
  const pos = graphLayout(n, edges, props.layout, num(props.layout_scale, 2), root)
  // vertex_config / edge_config: one style for all, or {per: {"<index>" | "i,j": style}}.
  const cfgFor = (c: Kw | undefined, key: string): Kw => {
    if (!c) return {}
    if (c.per && typeof c.per === 'object') return { ...(c.per[key] || {}) }
    return c
  }
  const w = env.w
  const vIds = verts.map(() => w.newId())
  const labels = props.labels
  const rs = vIds.map((vid, i) => {
    const vc = cfgFor(props.vertex_config, String(i))
    if (labels) return makeLabeledDot(env, vid, 'labeled_dot', { label: String(verts[i]), point: [...pos[i], 0], ...vc })
    put(env, vid, 'dot', vc, styleFrom(vc, { sw: 0, fo: 1 }), [circleSub([0, 0], num(vc.radius, 0.08))], { m: translate(pos[i][0], pos[i][1]) })
  })
  return all(rs, () => {
    const eIds = edges.map(([a, b]) => {
      const ec = cfgFor(props.edge_config, `${a},${b}`)
      const eid = w.newId()
      const ra = familyBox(w, vIds[a]), rb = familyBox(w, vIds[b])
      const r = Math.max((ra[2] - ra[0]) / 2, (rb[2] - rb[0]) / 2)
      if (directed) makeArrow(env, eid, 'arrow', { stroke_width: 2, ...ec }, pos[a], pos[b], r, false)
      else put(env, eid, 'line', ec, styleFrom(ec), [lineSub(pos[a], pos[b])], { z: -1, data: { start: pos[a], end: pos[b] } })
      return eid
    })
    // [0] vertices in order, [1] edges in order.
    const vg = w.newId(), eg = w.newId()
    w.set(newMob(vg, 'group', styleFrom({}), [], { children: vIds }))
    w.set(newMob(eg, 'group', styleFrom({}), [], { children: eIds }))
    group(env, id, kind, props, [vg, eg], { data: { vertices: verts, edges, props } })
  })
}

/* ---------------------------------------------------------- dots and lines */

function makeLabeledDot(env: MakeEnv, id: number, kind: string, props: Kw): void | Promise<void> {
  const lid = env.w.newId()
  // The label is TeX in Manim (MathTex); plain text when TeX is not available.
  const lp = { font_size: props.font_size ?? 48, color: props.label_color ?? BLACK }
  const r = env.tex && props.label_is_text !== true
    ? makeTex(env, lid, 'mathtex', { ...lp, parts: [String(props.label ?? '')] }, 'math')
    : makeText(env, lid, 'text', lp, String(props.label ?? ''))
  return all([r], () => {
    const b = familyBox(env.w, lid)
    // Measured from Manim: the dot is about 0.92 × the label's larger side in radius.
    const rad = props.radius != null ? num(props.radius, 0.3) : 0.92 * Math.max(b[2] - b[0], b[3] - b[1])
    const at = pt(env, props.point, [0, 0])
    moveCenterTo(env.w, lid, at[0], at[1])
    put(env, id, kind, props, styleFrom(props, { sw: 0, fo: 1 }), [circleSub([0, 0], rad)], { m: translate(at[0], at[1]), children: [lid] })
  })
}

/* ------------------------------------------------------------------- SVG */

type Attrs = Record<string, string>

function attrsOf(s: string): Attrs {
  const out: Attrs = {}
  const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out[m[1]] = m[3] ?? m[4]
  // style="fill:…;stroke:…" wins over the attributes.
  if (out.style) for (const part of out.style.split(';')) {
    const [k, v] = part.split(':').map(x => x && x.trim())
    if (k && v) out[k] = v
  }
  return out
}

/** transform="translate() scale() rotate() matrix()" → an SVG-space affine. */
function svgTransform(s: string | undefined): Mat {
  let M: Mat = [1, 0, 0, 1, 0, 0]
  if (!s) return M
  const re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const a = m[2].split(/[\s,]+/).filter(Boolean).map(Number)
    let T: Mat = [1, 0, 0, 1, 0, 0]
    if (m[1] === 'matrix') T = [a[0], a[1], a[2], a[3], a[4], a[5]]
    else if (m[1] === 'translate') T = [1, 0, 0, 1, a[0] || 0, a[1] || 0]
    else if (m[1] === 'scale') T = [a[0], 0, 0, a[1] ?? a[0], 0, 0]
    else if (m[1] === 'rotate') {
      const r = ((a[0] || 0) * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r)
      T = [c, sn, -sn, c, 0, 0]
      if (a.length >= 3) T = mul(mul([1, 0, 0, 1, a[1], a[2]], T), [1, 0, 0, 1, -a[1], -a[2]])
    }
    M = mul(M, T)
  }
  return M
}

function shapeOf(tag: string, a: Attrs): Subpath[] {
  const n = (k: string, d = 0) => (a[k] != null ? parseFloat(a[k]) : d)
  switch (tag) {
    case 'path': return a.d ? parsePathData(a.d) : []
    case 'rect': {
      const x = n('x'), y = n('y'), wd = n('width'), ht = n('height'), rx = n('rx', n('ry'))
      if (rx > 0) return transformPaths([roundedRectSub(wd, ht, rx)], translate(x + wd / 2, y + ht / 2))
      return [polySub([[x, y], [x + wd, y], [x + wd, y + ht], [x, y + ht]], true)]
    }
    case 'circle': return [circleSub([n('cx'), n('cy')], n('r'))]
    case 'ellipse': return [arcSub([n('cx'), n('cy')], n('rx'), n('ry'), 0, TAU, true)]
    case 'line': return [lineSub([n('x1'), n('y1')], [n('x2'), n('y2')])]
    case 'polyline': case 'polygon': {
      const v = (a.points || '').trim().split(/[\s,]+/).map(Number)
      const pts: Pt[] = []
      for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]])
      return [polySub(pts, tag === 'polygon')]
    }
  }
  return []
}

/**
 * SVGMobject: each shape element becomes a part (fill and stroke from the
 * file unless the script overrides them), y flipped, fitted to `height`
 * (Manim's default 2) and centred.
 */
function makeSvg(env: MakeEnv, id: number, kind: string, props: Kw) {
  const src = String(props.svg ?? props.svg_string ?? props.file_content ?? '')
  const w = env.w
  const kids: number[] = []
  const stack: Array<{ M: Mat; a: Attrs }> = [{ M: [1, 0, 0, 1, 0, 0], a: {} }]
  const re = /<(\/?)([\w:-]+)([^>]*?)(\/?)>/g
  let m: RegExpExecArray | null
  const inherit = (k: string, a: Attrs) => a[k] ?? [...stack].reverse().find(s => s.a[k] != null)?.a[k]
  while ((m = re.exec(src))) {
    const [, close, tagRaw, attrStr, self] = m
    const tag = tagRaw.toLowerCase().replace(/^svg:/, '')
    if (close) { if (tag === 'g' || tag === 'svg') stack.pop(); continue }
    const a = attrsOf(attrStr)
    const M = mul(stack[stack.length - 1].M, svgTransform(a.transform))
    if (tag === 'g' || tag === 'svg') { if (!self) stack.push({ M, a }); continue }
    if (tag === 'defs' || tag === 'clippath' || tag === 'mask') continue
    const shape = shapeOf(tag, a)
    if (!shape.length) continue
    const fill = inherit('fill', a), stroke = inherit('stroke', a)
    const fc = fill && fill !== 'none' ? normColor(fill, WHITE) : WHITE
    const sc = stroke && stroke !== 'none' ? normColor(stroke, WHITE) : fc
    const sw = stroke && stroke !== 'none' ? parseFloat(inherit('stroke-width', a) || '1') : 0
    const style: Style = {
      sc, fc, sw, so: 1,
      fo: fill === 'none' ? 0 : parseFloat(inherit('fill-opacity', a) || inherit('opacity', a) || '1'),
    }
    const gid = w.newId()
    // SVG y runs down; scene y runs up.
    w.set(newMob(gid, 'svg_part', style, transformPaths(shape, mul([1, 0, 0, -1, 0, 0], M)), {
      evenodd: (inherit('fill-rule', a) || '').trim() === 'evenodd',
    }))
    kids.push(gid)
  }
  put(env, id, kind, props, styleFrom(props), [], { children: kids })
  const b = familyBox(w, id)
  const ht = props.width != null && props.height == null ? num(props.width, 2) * ((b[3] - b[1]) / ((b[2] - b[0]) || 1)) : num(props.height, 2)
  const k = b[3] - b[1] > 1e-9 ? ht / (b[3] - b[1]) : 1
  const c = boxCenter(b)
  shiftFamily(w, id, mul(scaleAbout(k, k, [0, 0]), translate(-c[0], -c[1])))
  // Explicit style kwargs override the file's (as Manim does), stroke widths scale with the art.
  const over: Partial<Style> = {}
  if (props.color != null) { over.sc = normColor(props.color, WHITE); over.fc = over.sc }
  if (props.fill_color != null) over.fc = normColor(props.fill_color, WHITE)
  if (props.stroke_color != null) over.sc = normColor(props.stroke_color, WHITE)
  if (props.fill_opacity != null) over.fo = num(props.fill_opacity, 1)
  if (props.stroke_width != null) over.sw = num(props.stroke_width, 0)
  for (const kid of kids) {
    const mob = w.get(kid)
    w.set({ ...mob, style: { ...mob.style, sw: props.stroke_width != null ? mob.style.sw : mob.style.sw * k * 100 / 4, ...over } })
  }
}

/**
 * The editor's image operations (remove_background, resize, trace…), run by
 * the imageops host on the editor window: parent.__cirImages.chain(window,
 * src, ops, trace) → JSON {kind:'picture', url, width, height} or
 * {kind:'vector', svg, width, height}. Results are cached there by source and
 * ops, so a re-run or a recording gets them at once.
 */
async function runImageChain(src: unknown, ops: unknown[], trace: unknown): Promise<any> {
  let api: any = null
  try { api = (globalThis as any).parent?.__cirImages || (globalThis as any).__cirImages } catch { api = null }
  if (!api || typeof api.chain !== 'function') throw new Error('Image operations need the Circuitry editor')
  const r = await api.chain(globalThis, src, ops, trace ?? null)
  return typeof r === 'string' ? JSON.parse(r) : r
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/**
 * ImageMobject: a picture from a URL / data URI / the host's local URL, an
 * element Python hands over (4th make argument: an image, bitmap or canvas),
 * or the result of an op chain (ops) run by the editor first. 1080 px is the
 * frame height (Manim's scale_to_resolution).
 */
function makeImage(env: MakeEnv, id: number, kind: string, props: Kw): void | Promise<void> {
  const src = props.src ?? props.filename_or_array ?? props.url ?? null
  const el = props.element as CanvasImageSource | undefined
  const place = (img: CanvasImageSource | null, pw: number, ph: number) => {
    const res = num(props.scale_to_resolution, 1080)
    let h = (ph / res) * env.fh, wd = (pw / res) * env.fh
    if (props.height != null) { const k = num(props.height, h) / (h || 1); h *= k; wd *= k }
    if (props.width != null) { const k = num(props.width, wd) / (wd || 1); h *= k; wd *= k }
    put(env, id, kind, props, styleFrom({ fill_opacity: 1, ...props }, { sw: 0 }), [], {
      image: { src: img, w: wd || 1, h: h || 1, fullW: wd || 1, fullH: h || 1 },
    })
  }
  const sizeOf = (img: any): [number, number] => [img.naturalWidth || img.width || 1080, img.naturalHeight || img.height || 1080]
  const ops = Array.isArray(props.ops) ? props.ops : []
  if (ops.length) {
    return runImageChain(el ?? src, ops, null).then(async r => {
      const img = r && r.url ? await loadImage(r.url) : null
      if (!img) throw new Error('the image from ' + String(ops.map((o: any) => o[0]).join(', ')) + ' could not be loaded')
      place(img, r.width || img.naturalWidth, r.height || img.naturalHeight)
    })
  }
  if (el) { const [pw, ph] = sizeOf(el); place(el, pw, ph); return }
  if (typeof Image === 'undefined' || !src) { place(null, num(props.px_width, 1080), num(props.px_height, 1080)); return }
  return loadImage(String(src)).then(img => {
    if (img) place(img, img.naturalWidth, img.naturalHeight)
    else place(null, 1080, 1080)
  })
}

/** SVGMobject from a file's text, an element/string Python hands over, or an image traced to vectors by the editor. */
function makeSvgFrom(env: MakeEnv, id: number, kind: string, props: Kw): void | Promise<void> {
  const given = props.svg_element
  if (given != null) {
    const text = typeof given === 'string' ? given : (given as any).outerHTML ?? String(given)
    return makeSvg(env, id, kind, { ...props, svg: text })
  }
  if (props.svg == null && (props.image_src != null || props.element != null) && props.trace != null) {
    const ops = Array.isArray(props.ops) ? props.ops : []
    return runImageChain(props.element ?? props.image_src, ops, props.trace).then(r => {
      if (!r || !r.svg) throw new Error('tracing the image gave no shapes')
      // Sized as the picture itself would be when no height/width is given (ImageMobject(..., trace=True)).
      const res = num(props.scale_to_resolution, 1080)
      const height = props.height != null ? props.height : props.width != null ? undefined : ((r.height || 1080) / res) * env.fh
      makeSvg(env, id, kind, { ...props, svg: r.svg, height })
    })
  }
  return makeSvg(env, id, kind, props)
}

/* ------------------------------------------------------------- the table */

export const MORE_KINDS: Record<string, Builder> = {
  angle: (env, id, p, kind) => makeAngle(env, id, kind, p, false),
  right_angle: (env, id, p, kind) => makeAngle(env, id, kind, p, true),
  sector: (env, id, p, kind) => makeSector(env, id, kind, p, num(p.inner_radius, 0), num(p.outer_radius ?? p.radius, 1)),
  annular_sector: (env, id, p, kind) => makeSector(env, id, kind, p, num(p.inner_radius, 1), num(p.outer_radius, 2)),
  arc_between_points: (env, id, p, kind) => {
    const [a, b] = lineEnds(env, p.start, p.end)
    put(env, id, kind, p, styleFrom(p), [arcBetween(a, b, num(p.angle, TAU / 4))], { data: { start: a, end: b } })
  },
  curved_arrow: (env, id, p, kind) => makeCurvedArrow(env, id, kind, p, false),
  curved_double_arrow: (env, id, p, kind) => makeCurvedArrow(env, id, kind, p, true),
  elbow: (env, id, p, kind) => {
    const s = num(p.width, 0.2)
    put(env, id, kind, p, styleFrom(p), transformPaths([polySub([[0, s], [s, s], [s, 0]], false)], rotateAbout(num(p.angle, 0), [0, 0])))
  },
  cross: (env, id, p, kind) => {
    const st = { ...styleFrom({ stroke_width: 6, ...p }, { color: RED, sw: 6 }), fc: p.fill_color != null ? normColor(p.fill_color, WHITE) : WHITE }
    let box: Box = [-1, -1, 1, 1]
    if (p.mobject != null || p.target != null) box = targetsBox(env.w, p.mobject ?? p.target)
    const k = num(p.scale_factor, 1)
    const c = boxCenter(box), hw = ((box[2] - box[0]) / 2) * k, hh = ((box[3] - box[1]) / 2) * k
    const l1 = env.w.newId(), l2 = env.w.newId()
    env.w.set(newMob(l1, 'line', st, [lineSub([c[0] - hw, c[1] + hh], [c[0] + hw, c[1] - hh])]))
    env.w.set(newMob(l2, 'line', st, [lineSub([c[0] + hw, c[1] + hh], [c[0] - hw, c[1] - hh])]))
    put(env, id, kind, p, st, [], { children: [l1, l2] })
  },
  underline: (env, id, p, kind) => {
    const b = targetsBox(env.w, p.mobject ?? p.target)
    const y = b[1] - num(p.buff, 0.1)
    put(env, id, kind, p, styleFrom(p), [lineSub([b[0], y], [b[2], y])], { data: { start: [b[0], y], end: [b[2], y] } })
  },
  labeled_dot: (env, id, p, kind) => makeLabeledDot(env, id, kind, p),
  dashed_vmobject: (env, id, p, kind) => {
    // num_dashes per part, each dashed_ratio/n long; open paths end on a dash.
    const src = resolveTarget(env.w, p.vmobject ?? p.target)
    const n = Math.max(1, Math.round(num(p.num_dashes, 15))), ratio = num(p.dashed_ratio, 0.5)
    const kids: number[] = []
    for (const i of leaves(env.w, src)) {
      const m = env.w.get(i)
      const paths = transformPaths(m.paths, m.m)
      const closed = paths.length === 1 && paths[0].closed
      const d = ratio / n, step = closed || n === 1 ? 1 / n : (1 - d) / (n - 1)
      for (let k = 0; k < n; k++) {
        for (const sp of partialPaths(paths, k * step, Math.min(1, k * step + d))) {
          const did = env.w.newId()
          env.w.set(newMob(did, 'dash', m.style, [{ points: sp.points, closed: false }]))
          kids.push(did)
        }
      }
    }
    put(env, id, kind, p, styleFrom(p), [], { children: kids })
  },
  /** TangentLine(vmobject, alpha, length): a line of `length` touching the curve at proportion alpha. */
  tangent_line: (env, id, p, kind) => {
    const src = resolveTarget(env.w, p.vmobject ?? p.target)
    const paths = leaves(env.w, src).flatMap(i => transformPaths(env.w.get(i).paths, env.w.get(i).m))
    const al = Math.max(0, Math.min(1, num(p.alpha, 0.5))), d = num(p.d_alpha, 1e-6)
    const a = pointAt(paths, Math.max(0, al - d)), b = pointAt(paths, Math.min(1, al + d)), c = pointAt(paths, al)
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1
    const h = num(p.length, 1) / 2
    const s0: Pt = [c[0] - (dx / l) * h, c[1] - (dy / l) * h], s1: Pt = [c[0] + (dx / l) * h, c[1] + (dy / l) * h]
    put(env, id, kind, p, styleFrom(p), [lineSub(s0, s1)], { data: { start: s0, end: s1 } })
  },
  cubic_bezier: (env, id, p, kind) => {
    const P = [p.start_anchor, p.start_handle, p.end_handle, p.end_anchor].map(v => resolvePoint(env.w, v))
    put(env, id, kind, p, styleFrom(p), [{ points: P, closed: false }], { data: { start: P[0], end: P[3] } })
  },
  paragraph: (env, id, p, kind) => {
    const lines: string[] = Array.isArray(p.lines) ? p.lines.map(String) : String(p.text ?? '').split('\n')
    return makeParagraph(env, id, kind, p, lines)
  },
  bulleted_list: (env, id, p, kind) => makeParagraph(env, id, kind, p, ((p.items ?? []) as unknown[]).map(String), true),
  markup_text: (env, id, p, kind) => makeMarkup(env, id, kind, p),
  table: (env, id, p, kind) => makeTable(env, id, kind, p, p.element === 'mathtex' ? 'mathtex' : 'text'),
  math_table: (env, id, p, kind) => makeTable(env, id, kind, p, 'mathtex'),
  decimal_table: (env, id, p, kind) => makeTable(env, id, kind, p, 'number'),
  integer_table: (env, id, p, kind) => makeTable(env, id, kind, p, 'number'),
  matrix: (env, id, p, kind) => makeMatrix(env, id, kind, p, 'mathtex', 0),
  integer_matrix: (env, id, p, kind) => makeMatrix(env, id, kind, p, 'number', 0),
  decimal_matrix: (env, id, p, kind) => makeMatrix(env, id, kind, p, 'number', num(p.element_to_mobject_config?.num_decimal_places, 1)),
  mobject_matrix: (env, id, p, kind) => makeMatrix(env, id, kind, p, 'text', 0),
  code: (env, id, p, kind) => makeCode(env, id, kind, p),
  complex_plane: (env, id, p) => makeAxes(env, id, 'number_plane', p),
  polar_plane: (env, id, p, kind) => makePolarPlane(env, id, kind, p),
  bar_chart: (env, id, p, kind) => makeBarChart(env, id, kind, p),
  area: (env, id, p, kind) => makeArea(env, id, kind, p),
  riemann_rectangles: (env, id, p, kind) => makeRiemann(env, id, kind, p),
  network_graph: (env, id, p, kind) => makeNetwork(env, id, kind, p, !!p.directed),
  di_graph: (env, id, p, kind) => makeNetwork(env, id, kind, p, true),
  svg_mobject: (env, id, p, kind) => makeSvgFrom(env, id, kind, p),
  image_mobject: (env, id, p, kind) => makeImage(env, id, kind, p),
}

/** For the expression evaluator: a graph's point at x (["graph_point", graph, x]). */
export function graphPoint(w: World, id: number, x: number): Pt {
  const { samples, map, m } = graphInfo(w, id)
  const y = graphY(samples, x)
  return apply(m, axisToLocal(map, x, y ?? 0))
}
