/**
 * What Python sends, made usable: arguments (positional list, optionally
 * ending in a kwargs dict, or just a dict), targets ({id, path} sub-objects)
 * and point expressions ({"$pt": expr}), all resolved against the scene as it
 * stands when the command runs.
 */
import type { Pt } from './geometry-types'
import { apply, invert } from './math'
import { pointAt, transformPaths } from './geometry'
import { boxCenter, CAMERA, centerOf, critical, familyBox, leaves, type World } from './scene'
import { graphPoint } from './more-kinds'

export type Kw = Record<string, any>

function isPlainObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function isTargetObj(v: unknown): v is { id: number; path?: number[] } {
  return isPlainObject(v) && typeof v.id === 'number' && Object.keys(v).every(k => k === 'id' || k === 'path')
}

function isKwargs(v: unknown): v is Kw {
  return isPlainObject(v) && !('$pt' in v) && !isTargetObj(v)
}

/**
 * Name the arguments. `names` is the Python signature in order; a name
 * starting with `*` collects the rest of the positionals.
 */
export function normArgs(args: unknown, names: string[]): Kw {
  const out: Kw = {}
  let pos: unknown[] = []
  if (Array.isArray(args)) {
    pos = args.slice()
    if (pos.length && isKwargs(pos[pos.length - 1])) Object.assign(out, pos.pop() as Kw)
  } else if (isKwargs(args)) Object.assign(out, args)
  else if (args !== undefined && args !== null) pos = [args]
  for (let i = 0; i < names.length && i < pos.length; i++) {
    const n = names[i]
    if (n[0] === '*') {
      out[n.slice(1)] = pos.slice(i)
      break
    }
    if (!(n in out)) out[n] = pos[i]
  }
  return out
}

/** An int id or {id, path} → the object's id (path indexes children; negatives count from the end). */
export function resolveTarget(w: World, t: unknown): number {
  if (typeof t === 'number') {
    if (!w.has(t)) throw new Error(t === CAMERA ? 'no camera frame' : `that object does not exist (#${t})`)
    return t
  }
  if (isTargetObj(t)) {
    let id = resolveTarget(w, t.id)
    for (const raw of t.path || []) {
      const kids = w.get(id).children
      const i = raw < 0 ? kids.length + raw : raw
      if (i < 0 || i >= kids.length) throw new IndexError(`index ${raw} is out of range (it has ${kids.length} parts)`)
      id = kids[i]
    }
    return id
  }
  throw new Error('expected an object, got ' + JSON.stringify(t))
}

class IndexError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'IndexError'
  }
}

export function isMobRef(v: unknown): boolean {
  return typeof v === 'number' || isTargetObj(v)
}

const ANCHORS: Record<string, Pt> = {
  center: [0, 0], centre: [0, 0], origin: [0, 0],
  top: [0, 1], up: [0, 1], bottom: [0, -1], down: [0, -1], left: [-1, 0], right: [1, 0],
  ul: [-1, 1], ur: [1, 1], dl: [-1, -1], dr: [1, -1],
  top_left: [-1, 1], top_right: [1, 1], bottom_left: [-1, -1], bottom_right: [1, -1],
}

export function anchorDir(a: unknown): Pt | null {
  if (Array.isArray(a)) return [Number(a[0]) || 0, Number(a[1]) || 0]
  if (typeof a === 'string') return ANCHORS[a.toLowerCase().replace(/^get_/, '')] || null
  return null
}

/** A named point of an object: an anchor, a direction, or start/end. */
export function pointOf(w: World, id: number, anchor: unknown): Pt {
  if (typeof anchor === 'string') {
    const a = anchor.toLowerCase().replace(/^get_/, '')
    if (a === 'start' || a === 'end') return endPoint(w, id, a)
  }
  const d = anchorDir(anchor ?? 'center')
  if (!d) throw new Error(`unknown point "${anchor}"`)
  return critical(familyBox(w, id), d)
}

/** get_start / get_end: a line's ends, else the first/last anchor drawn. */
export function endPoint(w: World, id: number, which: 'start' | 'end'): Pt {
  const mob = w.get(id)
  if (mob.data && mob.data[which]) return apply(mob.m, mob.data[which])
  const subs = mob.paths
  if (!subs.length) {
    const kids = mob.children
    if (kids.length) return endPoint(w, which === 'start' ? kids[0] : kids[kids.length - 1], which)
    return centerOf(w, id)
  }
  const p = which === 'start' ? subs[0].points[0] : subs[subs.length - 1].points[subs[subs.length - 1].points.length - 1]
  return apply(mob.m, p)
}

/** Axis coords → scene point, through the axes' current matrix. */
export function c2p(w: World, axesId: number, x: number, y: number): Pt {
  const mob = w.get(axesId)
  const map = mob.data && mob.data.axes
  if (!map) throw new Error('c2p needs Axes, a NumberPlane or a NumberLine')
  return apply(mob.m, axisToLocal(map, x, y))
}

export interface AxisMap {
  /** local = (x - x0) * sx, (y - y0) * sy + origin offset */
  x0: number
  y0: number
  sx: number
  sy: number
  ox: number
  oy: number
}

export function axisToLocal(m: AxisMap, x: number, y: number): Pt {
  return [m.ox + (x - m.x0) * m.sx, m.oy + (y - m.y0) * m.sy]
}

/** Evaluate a point: [x,y,z], {"$pt": expr}, or an object (its centre). */
export function resolvePoint(w: World, v: unknown): Pt {
  if (Array.isArray(v)) {
    if (typeof v[0] === 'string') return toPt(evalValue(w, v))
    return [Number(v[0]) || 0, Number(v[1]) || 0]
  }
  if (isPlainObject(v) && ('$pt' in v || '$x' in v)) return toPt(evalValue(w, v.$pt ?? v.$x))
  if (isMobRef(v)) return centerOf(w, resolveTarget(w, v))
  throw new Error('expected a point, got ' + JSON.stringify(v))
}

function toPt(v: Val): Pt {
  if (Array.isArray(v)) return [v[0] || 0, v[1] || 0]
  return [v, 0]
}

/* ------------------------------------------------------------ expressions */

/**
 * Expressions traced in Python (updaters, always_redraw, DecimalNumber of a
 * tracker…) arrive as JSON trees and are evaluated here — against whatever
 * world is passed: the scene at the cursor for commands, or a frame's view
 * of it (animations and earlier updaters applied) while drawing. Values are
 * numbers or vectors; arithmetic works element-wise with scalars broadcast.
 * Format: docs-internal/notes/pyctures-animation.md, Contract v2.
 */
export type Val = number | number[]

/** Time and step for ["t"] / ["dt"]; set by whoever is evaluating. */
export const evalClock = { t: 0, dt: 0, alpha: 0 }

/** The point being mapped by ApplyPointwiseFunction / Homotopy (["p"]). */
let pointVar: Pt | null = null
export function withPoint<T>(p: Pt, fn: () => T): T {
  const prev = pointVar
  pointVar = p
  try { return fn() } finally { pointVar = prev }
}

function bin(a: Val, b: Val, f: (x: number, y: number) => number): Val {
  if (typeof a === 'number' && typeof b === 'number') return f(a, b)
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => f(x, b[i] ?? 0))
  if (Array.isArray(a)) return a.map(x => f(x, b as number))
  return (b as number[]).map(y => f(a as number, y))
}

function un(a: Val, f: (x: number) => number): Val {
  return typeof a === 'number' ? f(a) : a.map(f)
}

const scalar = (v: Val) => (typeof v === 'number' ? v : v[0] ?? 0)
const vec3 = (p: Pt): number[] => [p[0], p[1], 0]

const FNS: Record<string, (...a: Val[]) => Val> = {
  hypot: (a, b) => bin(a, b, Math.hypot),
  sin: a => un(a, Math.sin), cos: a => un(a, Math.cos), tan: a => un(a, Math.tan),
  arcsin: a => un(a, Math.asin), arccos: a => un(a, Math.acos), arctan: a => un(a, Math.atan),
  arctan2: (y, x) => bin(y, x, Math.atan2), sinh: a => un(a, Math.sinh), cosh: a => un(a, Math.cosh),
  tanh: a => un(a, Math.tanh), exp: a => un(a, Math.exp), log: a => un(a, Math.log), log10: a => un(a, Math.log10),
  log2: a => un(a, Math.log2), sqrt: a => un(a, Math.sqrt), abs: a => un(a, Math.abs), floor: a => un(a, Math.floor),
  ceil: a => un(a, Math.ceil), round: (a, d) => {
    const k = Math.pow(10, d == null ? 0 : scalar(d))
    return un(a, x => Math.round(x * k) / k)
  },
  sign: a => un(a, Math.sign),
  min: (...a) => a.reduce((x, y) => bin(x, y, Math.min)), max: (...a) => a.reduce((x, y) => bin(x, y, Math.max)),
  clip: (x, lo, hi) => bin(bin(x, lo, Math.max), hi, Math.min),
  interpolate: (a, b, t) => bin(a, bin(bin(b, a, (x, y) => x - y), t, (x, y) => x * y), (x, y) => x + y),
  norm: a => (typeof a === 'number' ? Math.abs(a) : Math.hypot(...a)),
  dot: (a, b) => (a as number[]).reduce((s, x, i) => s + x * ((b as number[])[i] ?? 0), 0),
  cross: (a, b) => (a as number[])[0] * (b as number[])[1] - (a as number[])[1] * (b as number[])[0],
  normalize: a => {
    if (typeof a === 'number') return Math.sign(a)
    const n = Math.hypot(...a) || 1
    return a.map(x => x / n)
  },
  rotate_vector: (v, ang) => {
    const a = v as number[], t = scalar(ang), c = Math.cos(t), s = Math.sin(t)
    return [a[0] * c - a[1] * s, a[0] * s + a[1] * c, a[2] ?? 0]
  },
  deg: a => un(a, x => (x * 180) / Math.PI), rad: a => un(a, x => (x * Math.PI) / 180),
}
// numpy / math spellings the Python half may send.
Object.assign(FNS, {
  asin: FNS.arcsin, acos: FNS.arccos, atan: FNS.arctan, atan2: FNS.arctan2, degrees: FNS.deg, radians: FNS.rad,
  absolute: FNS.abs, fabs: FNS.abs, minimum: FNS.min, maximum: FNS.max,
})

const CMP: Record<string, (x: number, y: number) => number> = {
  '<': (x, y) => +(x < y), '<=': (x, y) => +(x <= y), '>': (x, y) => +(x > y), '>=': (x, y) => +(x >= y),
  '==': (x, y) => +(x === y), '!=': (x, y) => +(x !== y),
}
Object.assign(CMP, { lt: CMP['<'], le: CMP['<='], gt: CMP['>'], ge: CMP['>='], eq: CMP['=='], ne: CMP['!='] })

export function evalValue(w: World, e: any): Val {
  if (typeof e === 'number') return e
  if (typeof e === 'boolean') return +e
  if (isPlainObject(e)) {
    if ('$x' in e) return evalValue(w, e.$x)
    if ('$pt' in e) return evalValue(w, e.$pt)
    if (isTargetObj(e)) return vec3(centerOf(w, resolveTarget(w, e)))
  }
  if (!Array.isArray(e)) throw new Error('cannot evaluate ' + JSON.stringify(e))
  if (typeof e[0] !== 'string') return e.map(x => scalar(evalValue(w, x)))
  const E = (x: any) => evalValue(w, x)
  switch (e[0]) {
    case 't': return evalClock.t
    case 'dt': return evalClock.dt
    case 'num': return Number(e[1])
    case 'val': return Number(w.get(resolveTarget(w, e[1])).data?.value ?? 0)
    case 'v': return Array.isArray(e[1]) ? e[1].map((x: any) => scalar(E(x))) : E(e[1])
    case 'vec': return e.slice(1).map((x: any) => scalar(E(x)))
    case 'prop': return readValue(w, resolveTarget(w, e[1]), String(e[2]), e.slice(3).map(E)) as Val
    case 'var': {
      // t / time: timeline seconds; dt: the step; alpha: animation progress; p (x, y, z): the mapped point.
      const n = String(e[1])
      if (n === 't' || n === 'time') return evalClock.t
      if (n === 'dt') return evalClock.dt
      if (n === 'alpha') return evalClock.alpha
      const p = pointVar || [0, 0]
      if (n === 'p') return [p[0], p[1], 0]
      if (n === 'x') return p[0]
      if (n === 'y') return p[1]
      return 0
    }
    case 'of': return vec3(pointOf(w, resolveTarget(w, e[1]), Array.isArray(e[2]) ? (E(e[2]) as number[]) : e[2]))
    case 'c2p': return vec3(c2p(w, resolveTarget(w, e[1]), scalar(E(e[2])), scalar(E(e[3]))))
    case 'p2c': {
      const p = toPt(E(e[2]))
      const r = p2c(w, resolveTarget(w, e[1]), p)
      return [r[0], r[1]]
    }
    case 'get': return readValue(w, resolveTarget(w, e[1]), String(e[2]), e.slice(3).map(E)) as Val
    case 'graph_point': return vec3(graphPoint(w, resolveTarget(w, e[1]), scalar(E(e[2]))))
    case 'p': return pointVar ? [pointVar[0], pointVar[1], 0] : [0, 0, 0]
    case 'alpha': return evalClock.alpha
    case '+': case 'add': return bin(E(e[1]), E(e[2]), (x, y) => x + y)
    case '-': case 'sub': return bin(E(e[1]), E(e[2]), (x, y) => x - y)
    case '*': case 'mul': return bin(E(e[1]), E(e[2]), (x, y) => x * y)
    case '/': case 'div': return bin(E(e[1]), E(e[2]), (x, y) => x / y)
    case '**': case 'pow': return bin(E(e[1]), E(e[2]), Math.pow)
    case '%': case 'mod': return bin(E(e[1]), E(e[2]), (x, y) => ((x % y) + y) % y)
    case '//': return bin(E(e[1]), E(e[2]), (x, y) => Math.floor(x / y))
    case 'neg': return un(E(e[1]), x => -x)
    case 'idx': { const a = E(e[1]); return typeof a === 'number' ? a : a[Number(E(e[2]))] ?? 0 }
    case 'cmp': return bin(E(e[2]), E(e[3]), CMP[e[1]] || (() => 0))
    case 'where': return scalar(E(e[1])) ? E(e[2]) : E(e[3])
    case 'fn': {
      const f = FNS[e[1]]
      if (!f) throw new Error(`the animation layer cannot evaluate ${e[1]}() yet`)
      return f(...e.slice(2).map(E))
    }
  }
  throw new Error('unknown expression ' + e[0])
}

/** Replace every {"$x"} / {"$pt"} in a value with what it evaluates to now (targets and plain data untouched). */
export function deref(w: World, v: any): any {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(x => deref(w, x))
  if ('$x' in v) return evalValue(w, v.$x)
  if ('$pt' in v) {
    const r = evalValue(w, v.$pt)
    return typeof r === 'number' ? [r, 0, 0] : r
  }
  let changed = false
  const out: any = {}
  for (const k of Object.keys(v)) {
    out[k] = deref(w, v[k])
    if (out[k] !== v[k]) changed = true
  }
  return changed ? out : v
}

/** Does a value contain an expression (so it must be re-evaluated per frame)? */
export function hasExpr(v: any): boolean {
  if (v === null || typeof v !== 'object') return false
  if (Array.isArray(v)) return v.some(hasExpr)
  if ('$x' in v || '$pt' in v) return true
  return Object.keys(v).some(k => hasExpr(v[k]))
}

/** Scene point → axis coordinates (inverse of c2p). */
export function p2c(w: World, axesId: number, p: Pt): Pt {
  const mob = w.get(axesId)
  const map: AxisMap = mob.data && mob.data.axes
  if (!map) throw new Error('p2c needs Axes, a NumberPlane or a NumberLine')
  const l = apply(invert(mob.m), p)
  return [map.sx ? map.x0 + (l[0] - map.ox) / map.sx : 0, map.sy ? map.y0 + (l[1] - map.oy) / map.sy : 0]
}

/**
 * Data about an object (Python's value() reads and ["get", …] in expressions):
 * points come back as [x, y, 0].
 */
export function readValue(w: World, id: number, what: string, args: unknown[] = []): unknown {
  const name = String(what).replace(/^get_/, '')
  const b = familyBox(w, id)
  const arg = args[0]
  switch (name) {
    case 'center': return vec3(boxCenter(b))
    case 'width': return b[2] - b[0]
    case 'height': return b[3] - b[1]
    case 'x': return boxCenter(b)[0]
    case 'y': return boxCenter(b)[1]
    case 'z': return 0
    case 'top': case 'bottom': case 'left': case 'right':
      return vec3(pointOf(w, id, name))
    case 'corner': case 'critical_point': case 'edge_center':
      return vec3(pointOf(w, id, arg))
    case 'start': case 'end': return vec3(endPoint(w, id, name))
    case 'len': case 'length_of_children': case 'submobject_count': return w.get(id).children.length
    case 'value': return Number(w.get(id).data?.value ?? 0)
    case 'point_from_proportion': {
      const paths = []
      for (const i of leaves(w, id)) paths.push(...transformPaths(w.get(i).paths, w.get(i).m))
      return vec3(pointAt(paths, num(arg, 0)))
    }
    case 'c2p': case 'coords_to_point': case 'n2p': case 'number_to_point': {
      const xy = Array.isArray(arg) ? arg : [arg, args[1] ?? 0]
      return vec3(c2p(w, id, num(xy[0], 0), num(xy[1], 0)))
    }
    case 'p2c': case 'point_to_coords': case 'p2n': case 'point_to_number': {
      const r = p2c(w, id, resolvePoint(w, arg))
      return name === 'p2n' || name === 'point_to_number' ? r[0] : [r[0], r[1]]
    }
    case 'color': { const m = w.get(leaves(w, id)[0] ?? id); return m.style.fo > 0 ? m.style.fc : m.style.sc }
    case 'length': case 'arc_length': {
      const s0 = endPoint(w, id, 'start'), e0 = endPoint(w, id, 'end')
      return Math.hypot(e0[0] - s0[0], e0[1] - s0[1])
    }
    case 'angle': {
      const s0 = endPoint(w, id, 'start'), e0 = endPoint(w, id, 'end')
      return Math.atan2(e0[1] - s0[1], e0[0] - s0[0])
    }
    case 'unit_vector': {
      const s0 = endPoint(w, id, 'start'), e0 = endPoint(w, id, 'end')
      const l = Math.hypot(e0[0] - s0[0], e0[1] - s0[1]) || 1
      return [(e0[0] - s0[0]) / l, (e0[1] - s0[1]) / l, 0]
    }
  }
  throw new Error(`cannot read "${what}" from an object`)
}

/** A direction vector, given as a list or a point expression. */
export function resolveVec(w: World, v: unknown, fallback: Pt): Pt {
  if (v === undefined || v === null) return fallback
  return resolvePoint(w, v)
}

export function num(v: unknown, fallback: number): number {
  if (v === undefined || v === null) return fallback
  const n = Number(Array.isArray(v) ? v[0] : v)
  return Number.isFinite(n) ? n : fallback
}
