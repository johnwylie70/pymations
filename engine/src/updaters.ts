/**
 * Updaters, traced in Python and run here every frame (Contract v2 in
 * docs-internal/notes/pyctures-animation.md).
 *
 * WHY THEY STAY SCRUBBABLE: an updater is a pure function of the moment being
 * drawn. "op" and "redraw" updaters read the frame (animations and earlier
 * updaters applied) and rewrite their target from its timeline state at t.
 * A "dt" updater (m.rotate(dt)) is integrated at a fixed 1/60 s step from the
 * start of the segment being drawn; the steps are cached per segment, so
 * drawing any t costs at most one partial step after the first visit. At the
 * end of every play/wait the engine bakes the updaters' result into the scene,
 * which is what Manim's later commands would see.
 *
 * Lifetimes are timeline intervals: added at the cursor, removed or suspended
 * at a later cursor, so scrubbing back before a remove_updater shows it again.
 */
import { invert, mul, type Mat } from './math'
import { deref, evalClock } from './args'
import { copyFamily, family, World, type Mob } from './scene'
import { resolveTarget } from './args'
import { runOp, type OpEnv } from './ops'
import { setNumberValue } from './kinds'

export interface UpdaterSpec {
  uid?: unknown
  /** 'python': the updater runs in Python (its changes arrive as live ops); nothing to do here. */
  kind: 'op' | 'dt' | 'redraw' | 'python'
  /** [name, args] or [name, args, target]; args and targets may hold templates. */
  ops?: Array<[string, unknown, unknown?]>
  /** Relative ops (shift, rotate…) in a plain updater: applied once per 1/60 s, like Manim at 60 fps. */
  accumulate?: boolean
  make?: [string, unknown]
  /** always_redraw: {key, kind, props, ops}, with nested templates and {tmpl: key} references. */
  template?: Template
}

/** An object made inside a traced function: built afresh whenever it is evaluated. */
export interface Template {
  key: number
  kind: string
  props: unknown
  ops: Array<[string, unknown]>
}

function isTemplate(v: any): v is Template {
  return v && typeof v === 'object' && !Array.isArray(v) && 'key' in v && 'kind' in v && 'props' in v
}

/**
 * Turn templates inside a value into real (temporary) objects in `w` and
 * {tmpl: key, path?} references into targets. `keys` maps template keys to
 * the ids made for them during this evaluation.
 */
export function resolveTemplates(w: World, v: any, keys: Map<number, number>, deps: ApplyDeps): any {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(x => resolveTemplates(w, x, keys, deps))
  if (isTemplate(v)) return instantiate(w, v, keys, deps)
  if ('tmpl' in v && Object.keys(v).every(k => k === 'tmpl' || k === 'path')) {
    const id = keys.get(Number(v.tmpl))
    if (id == null) throw new Error('an object made inside an updater was used before it was made')
    return v.path && v.path.length ? { id, path: v.path } : id
  }
  let changed = false
  const out: any = {}
  for (const k of Object.keys(v)) {
    out[k] = resolveTemplates(w, v[k], keys, deps)
    if (out[k] !== v[k]) changed = true
  }
  return changed ? out : v
}

/** Build a template into `w` (with `id`, or a fresh one) and run its ops. */
export function instantiate(w: World, t: Template, keys: Map<number, number>, deps: ApplyDeps, id?: number): number {
  const had = keys.get(t.key)
  if (had != null) return had
  const nid = id ?? w.newId()
  keys.set(t.key, nid)
  const props = deref(w, resolveTemplates(w, t.props, keys, deps))
  if (t.kind === 'copy') copyFamily(w, resolveTarget(w, (props as any).mobject), nid)
  else deps.make(w, nid, t.kind, props)
  if (!w.has(nid)) throw new Error(`${t.kind} could not be built here yet`)
  for (const [name, args] of t.ops || []) runOp(w, nid, name, deref(w, resolveTemplates(w, args, keys, deps)), deps.env)
  return nid
}

/** Run a list of [name, args, target?] ops on a world (templates resolved, expressions evaluated now). */
export function runOps(w: World, ops: Array<[string, unknown, unknown?]>, defaultTarget: number | null, deps: ApplyDeps): number[] {
  const keys = new Map<number, number>()
  const touched: number[] = []
  for (const op of ops || []) {
    const [name, args, target] = op
    const tid = target != null ? resolveTarget(w, resolveTemplates(w, target, keys, deps)) : defaultTarget
    if (tid == null) continue
    runOp(w, tid, String(name), deref(w, resolveTemplates(w, args, keys, deps)), deps.env)
    touched.push(tid)
  }
  return touched
}

export interface UpdaterRec {
  uid: string
  target: number
  spec: UpdaterSpec
  from: number
  to: number
  off: Array<[number, number]>
}

const STEP = 1 / 60

/** A segment's start state and time, for dt integration. */
export interface SegRef {
  t0: number
  before: { mobs: Map<number, Mob>; display: number[] }
}

export interface ApplyDeps {
  env: OpEnv
  /** The engine's id counter, so objects made while drawing never reuse a real id. */
  ids: { n: number }
  /** Build a template object into a world (always_redraw); returns nothing useful if it must wait for a font. */
  make: (w: World, id: number, kind: string, props: unknown) => void
}

export class Updaters {
  list: UpdaterRec[] = []
  private dtCache = new WeakMap<object, Map<string, { states: Array<{ m: Mat; value: number }>; sim: World }>>()
  private redrawCache = new Map<string, { key: string; mobs: Mob[] }>()

  reset() {
    this.list = []
    this.dtCache = new WeakMap()
    this.redrawCache.clear()
  }

  add(target: number, spec: UpdaterSpec, t: number) {
    const uid = spec.uid != null ? String(spec.uid) : `u${this.list.length}`
    this.list.push({ uid, target, spec, from: t, to: Infinity, off: [] })
  }

  remove(target: number, uid: unknown, t: number) {
    for (const r of this.list) if (r.target === target && r.uid === String(uid) && r.to === Infinity) r.to = t
  }

  clear(target: number, t: number) {
    for (const r of this.list) if (r.target === target && r.to === Infinity) r.to = t
  }

  suspend(target: number, t: number) {
    for (const r of this.list) {
      if (r.target !== target || r.to !== Infinity) continue
      const last = r.off[r.off.length - 1]
      if (!last || last[1] !== Infinity) r.off.push([t, Infinity])
    }
  }

  resume(target: number, t: number) {
    for (const r of this.list) {
      const last = r.off[r.off.length - 1]
      if (r.target === target && last && last[1] === Infinity) last[1] = t
    }
  }

  active(t: number): UpdaterRec[] {
    return this.list.filter(r => r.from <= t && t < r.to && !r.off.some(([a, b]) => a <= t && t < b))
  }

  /**
   * Run the active updaters on `view` (a world showing the frame at time t).
   * `seg` is the segment being drawn (null at or past the end). Returns the
   * ids whose families were rewritten.
   */
  apply(view: World, t: number, seg: SegRef | null, deps: ApplyDeps): number[] {
    const touched: number[] = []
    for (const r of this.active(t)) {
      if (!view.has(r.target) && r.spec.kind !== 'redraw') continue
      evalClock.t = t
      evalClock.dt = 0
      try {
        if (r.spec.kind === 'op' && !r.spec.accumulate) touched.push(...runOps(view, r.spec.ops, r.target, deps))
        else if (r.spec.kind === 'redraw') this.redraw(view, r, deps)
        else if ((r.spec.kind === 'dt' || r.spec.kind === 'op') && seg) this.integrate(view, r, t, seg, deps)
        else continue
      } catch {
        // An updater that cannot run at this moment (an object gone) leaves its target as it is.
        continue
      }
      touched.push(r.target)
    }
    return touched
  }

  /** always_redraw: rebuild from the template; reuse the last build while the evaluated props are unchanged. */
  private redraw(view: World, r: UpdaterRec, deps: ApplyDeps) {
    // The cache key: the template with every expression evaluated now.
    const tm = r.spec.template
    const [kind, props] = r.spec.make || [tm ? tm.kind : 'group', tm ? tm : {}]
    const evaluated = deref(view, props)
    const key = JSON.stringify(evaluated)
    const ck = `${r.uid}|${r.target}`
    const hit = this.redrawCache.get(ck)
    if (hit && hit.key === key) {
      for (const m of hit.mobs) view.set(m)
      return
    }
    const tmp = view.fork()
    const old = tmp.has(r.target) ? tmp.get(r.target) : null
    if (tm) instantiate(tmp, tm, new Map(), deps, r.target)
    else deps.make(tmp, r.target, kind, evaluated)
    if (!tmp.has(r.target)) return
    // Keep what the scene did to it (z, opacity changes are rare; position comes from the template).
    if (old) tmp.update(r.target, { z: old.z })
    const mobs = family(tmp, r.target).map(i => tmp.get(i))
    this.redrawCache.set(ck, { key, mobs })
    for (const m of mobs) view.set(m)
  }

  /** dt updater: fixed-step integration from the segment start, cached; applied as a change relative to that start. */
  private integrate(view: World, r: UpdaterRec, t: number, seg: SegRef, deps: ApplyDeps) {
    const from = Math.max(seg.t0, r.from)
    if (t <= from) return
    let bySeg = this.dtCache.get(seg)
    if (!bySeg) { bySeg = new Map(); this.dtCache.set(seg, bySeg) }
    const ck = `${r.uid}|${r.target}|${from}`
    let c = bySeg.get(ck)
    if (!c) {
      const sim = new World(new Map(seg.before.mobs), seg.before.display.slice(), deps.ids)
      if (!sim.has(r.target)) return
      const m0 = sim.get(r.target)
      c = { states: [{ m: m0.m, value: Number(m0.data?.value ?? 0) }], sim }
      bySeg.set(ck, c)
    }
    const step = (w: World, dt: number, at: number) => {
      evalClock.t = at
      evalClock.dt = dt
      runOps(w, r.spec.ops, r.target, deps)
    }
    const k = Math.floor((t - from) / STEP + 1e-9)
    while (c.states.length <= k) {
      step(c.sim, STEP, from + (c.states.length - 1) * STEP)
      const m = c.sim.get(r.target)
      c.states.push({ m: m.m, value: Number(m.data?.value ?? 0) })
    }
    let end = c.states[k]
    const rest = t - from - k * STEP
    if (rest > 1e-9) {
      // The last partial step, from the cached state k (not cached itself).
      const w = new World(new Map(c.sim.mobs), c.sim.display.slice(), deps.ids)
      w.update(r.target, { m: end.m, data: { ...(w.get(r.target).data || {}), value: end.value } })
      step(w, rest, from + k * STEP)
      const m = w.get(r.target)
      end = { m: m.m, value: Number(m.data?.value ?? 0) }
    }
    const start = c.states[0]
    const D = mul(end.m, invert(start.m))
    for (const i of family(view, r.target)) {
      const mob = view.get(i)
      view.set({ ...mob, m: mul(D, mob.m) })
    }
    if (end.value !== start.value) setNumberValue(view, r.target, Number(view.get(r.target).data?.value ?? 0) + end.value - start.value)
    evalClock.dt = 0
  }

  get any(): boolean {
    return this.list.length > 0
  }
}
