/**
 * THE ANIMATION ENGINE — `window.__cirAnim` in the preview frame (handle 6 in
 * Python). Python's `pyctures.anim` records commands (make, op, play, wait…)
 * that arrive here through the page's pipelined `call`; this owns the scene,
 * the timeline and drawing. Contract: docs-internal/notes/pyctures-animation.md
 * ("Build contract v1").
 *
 * TIMELINE: play() and wait() append a segment at the end (the cursor); every
 * other command changes the scene at the cursor. Each segment keeps the scene
 * snapshot it starts from plus its built animations, so renderAt(t) finds the
 * segment and draws snapshot + animations at that moment: O(objects), never a
 * replay from zero, which is what makes scrubbing and frame-locked recording
 * cheap. Appending while playing simply grows the timeline.
 *
 * ORDER: commands run in order. Most finish at once (and a mistake throws
 * straight back to the page, which reports it with the Python line). Text and
 * TeX may need a font or outlines first: such a command holds every command
 * after it until it is done. ready() resolves when nothing is waiting; value()
 * answers after everything before it has run. Errors from held commands are
 * collected in `errors` (takeErrors() hands them over).
 *
 * UPDATERS AND LIVE INPUT (Contract v2): a frame is the segment's snapshot +
 * its animations, then live values/ops (sent while a Python loop runs), then
 * the updaters active at t, then traced paths. That stage builds a view of
 * the scene only when something needs it, so a scene without updaters draws
 * exactly as before.
 */
import type { Pt, TexInput, TexOutline } from './geometry-types'
import { polySub, rectCorners } from './geometry'
import { IDENTITY } from './math'
import {
  addToDisplay, boxCenter, CAMERA, copyFamily, family, familyBox, hasGeom, leaves, newMob, removeFromDisplay, World,
  type Mob, type Snap,
} from './scene'
import { deref, evalClock, evalValue, isMobRef, normArgs, num, readValue, resolvePoint, resolveTarget } from './args'
import { runOp, OP_NAMES, type OpEnv } from './ops'
import {
  make as makeKind, KIND_NAMES, setCanvasFactory, setNumberValue, setSharedText, type MakeEnv, type TexFn,
} from './kinds'
import { Updaters, type UpdaterSpec } from './updaters'
import { buildPlay, orderedEvents, ANIM_KINDS, type AnimSpec, type Node } from './animations'
import { Frame } from './frame'
import { measure, renderFrame } from './render'
import { TextOutliner } from './text'
import { RATE_NAMES } from './rate'

export interface EngineOptions {
  /** Folder URL of the bundle (ending in "/"): opentype.min.js and fonts/ live there. */
  base?: string | null
  tex?: ((input: TexInput) => Promise<TexOutline>) | null
}

export interface Segment {
  t0: number
  t1: number
  before: Snap
  node: Node | null
}

interface Cfg {
  frame_height: number
  frame_width: number | null
  background: string
}

const DEFAULT_ASPECT = 16 / 9

export function createAnimEngine(options: EngineOptions = {}) {
  const text = new TextOutliner(options.base ?? null)
  const texCache = new Map<string, TexOutline | Promise<TexOutline>>()
  const tex: TexFn | null = options.tex ?? null

  let cfg: Cfg = { frame_height: 8, frame_width: null, background: '#000000' }
  let w = new World()
  let segments: Segment[] = []
  let duration = 0
  let sections: Array<{ name: string; t: number }> = []
  let version = 0
  let errors: string[] = []

  const updaters = new Updaters()
  /** Live overrides from a running Python loop: latest per (target, op); tracker values. */
  const live = { ops: new Map<string, { target: number; name: string; args: unknown }>(), values: new Map<number, number>() }
  let liveVersion = 0
  /** Traced paths: sampled points per object, rebuilt when the timeline changes. */
  const traceCache = new Map<number, { version: number; pts: Pt[] }>()
  let tracing = false
  let anyTraced = false
  setSharedText(text)
  setCanvasFactory((pw, ph) => {
    if (typeof document === 'undefined') return null
    const c = document.createElement('canvas')
    c.width = pw
    c.height = ph
    return c
  })

  const fh = () => cfg.frame_height
  const fw = () => cfg.frame_width ?? cfg.frame_height * DEFAULT_ASPECT
  const opEnv = (): OpEnv => ({ fw: fw(), fh: fh() })
  const makeEnv = (): MakeEnv => ({ w, fw: fw(), fh: fh(), text, tex, texCache })

  function cameraMob(m = IDENTITY) {
    return newMob(CAMERA, 'camera', { sc: '#FFFFFF', fc: '#FFFFFF', sw: 0, so: 0, fo: 0 }, [polySub(rectCorners(fw(), fh()), true)], { m })
  }
  w.set(cameraMob())

  function changed() {
    version++
  }

  /* ------------------------------------------------------------ queue */

  let gen = 0
  let pending: Promise<void> | null = null
  const queue: Array<() => unknown> = []
  let idle: Array<() => void> = []

  function report(e: unknown) {
    const msg = (e && (e as Error).message) || String(e)
    errors.push(msg)
    if (typeof console !== 'undefined') console.error('[pyctures.anim]', msg)
  }

  function exec(fn: () => unknown) {
    const r = fn() as Promise<unknown> | undefined
    if (r && typeof r.then === 'function') {
      const my = gen
      pending = r.then(() => changed(), report).then(() => {
        if (my !== gen) return
        pending = null
        drain()
      })
    } else changed()
  }

  function drain() {
    while (!pending && queue.length) {
      const fn = queue.shift()
      try { exec(fn) } catch (e) { report(e) }
    }
    if (!pending && !queue.length) {
      const waiters = idle
      idle = []
      for (const r of waiters) r()
    }
  }

  /** Run now if nothing is waiting (so a mistake throws back to the caller), else in turn. */
  function run(fn: () => unknown) {
    if (pending || queue.length) queue.push(fn)
    else exec(fn)
  }

  /* --------------------------------------------------------- commands */

  function config(c: unknown) {
    const k = normArgs(c, [])
    if (k.frame_height != null) cfg.frame_height = num(k.frame_height, 8)
    if (k.frame_width != null) cfg.frame_width = num(k.frame_width, fw())
    if (k.background != null || k.background_color != null) cfg.background = String(k.background ?? k.background_color)
    if (k.frame_height != null || k.frame_width != null) w.set(cameraMob(w.get(CAMERA).m))
  }

  /** Expressions in animation args are evaluated when the play is built (targets stay as they are). */
  function derefSpecs(anims: unknown): unknown {
    const fix = (sp: any): any => {
      if (!sp || typeof sp !== 'object') return sp
      const out = { ...sp }
      if (sp.args != null) out.args = deref(w, sp.args)
      if (Array.isArray(sp.items)) out.items = sp.items.map(fix)
      return out
    }
    return Array.isArray(anims) ? anims.map(fix) : fix(anims)
  }

  function targets(list: unknown): number[] {
    const arr = Array.isArray(list) ? list : [list]
    return arr.map(t => resolveTarget(w, t))
  }

  function play(anims: unknown, opts: unknown) {
    const specs = (Array.isArray(anims) ? anims : [anims]) as AnimSpec[]
    if (!specs.length) return
    const pre = w.snapshot()
    const node = buildPlay(specs, normArgs(opts, []), { w: w.fork(), pre, env: opEnv() })
    const events = orderedEvents(node)
    // The scene the segment draws from: everything any of its animations
    // brings in is present (hidden until its animation starts).
    const bw = w.fork()
    for (const e of events) if (!e.end) e.fn(bw)
    const before = bw.snapshot()
    for (const e of events) e.fn(w)
    if (node.run > 0) {
      const seg = { t0: duration, t1: duration + node.run, before, node }
      segments.push(seg)
      duration += node.run
      bake(seg)
    }
  }

  /** At the end of a play/wait, write what the updaters made of their targets into the scene (Manim's state then). */
  function bake(seg: Segment) {
    if (!updaters.any) return
    const view = w.fork()
    for (const r of updaters.apply(view, seg.t1, seg, deps())) {
      for (const i of family(view, r)) if (view.has(i)) w.set(view.get(i))
    }
  }

  const deps = () => ({
    env: opEnv(),
    ids: w.ids,
    make: (into: World, id: number, kind: string, props: unknown) => { makeKind({ ...makeEnv(), w: into }, id, kind, props) },
  })

  function wait(seconds: unknown) {
    const s = Math.max(0, num(Array.isArray(seconds) ? seconds[0] : seconds, 1))
    if (s <= 0) return
    const seg = { t0: duration, t1: duration + s, before: w.snapshot(), node: null }
    segments.push(seg)
    duration += s
    bake(seg)
  }

  /** Data back to Python (get_center, width, …), after every earlier command has run. */
  function valueNow(target: unknown, what: string, args: unknown): unknown {
    const name = String(what).replace(/^get_/, '')
    const a = normArgs(args, ['arg'])
    if (name === 'frame') return { width: fw(), height: fh() }
    evalClock.t = duration
    // A point expression on its own (target null or 0): {"$pt": expr}.
    if (name === 'point' && (target == null || target === 0)) {
      const p = resolvePoint(w, a.arg ?? args)
      return [p[0], p[1], 0]
    }
    if ((name === 'expr' || name === 'eval') && (target == null || target === 0)) return evalValue(w, a.arg ?? args)
    const id = resolveTarget(w, target)
    if (name === 'describe' || name === 'state') return measure(new Frame(w.snapshot()), id)
    if (name === 'point') {
      const p = isMobRef(a.arg) ? boxCenter(familyBox(w, resolveTarget(w, a.arg))) : resolvePoint(w, a.arg)
      return [p[0], p[1], 0]
    }
    const list = Array.isArray(args) ? args : args == null ? [] : [args]
    return readValue(w, id, name, list)
  }

  /* ------------------------------------------------------------ drawing */

  function segmentAt(t: number): Segment | null {
    if (!segments.length || t >= duration) return null
    let lo = 0, hi = segments.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (segments[mid].t0 <= t) lo = mid
      else hi = mid - 1
    }
    return segments[lo]
  }

  /** The frame at time t (exported for tests and the recorder). */
  function frameAt(t: number, withLive = true): Frame {
    t = Math.max(0, t)
    const seg = segmentAt(t)
    const f = new Frame(seg ? seg.before : w.snapshot())
    if (seg && seg.node) seg.node.frame(t - seg.t0, f)
    const hasLive = withLive && (live.ops.size > 0 || live.values.size > 0)
    if (updaters.any || hasLive || anyTraced) postFrame(f, t, seg, hasLive)
    return f
  }

  /** The scene as this frame shows it (animation overrides applied), as a world updaters can read and change. */
  function viewOf(f: Frame): World {
    const mobs = new Map(f.scene.mobs)
    for (const [id, o] of f.over) {
      const m = mobs.get(id)
      if (!m || (o.m === m.m && o.style === m.style && o.value == null)) continue
      mobs.set(id, { ...m, m: o.m, style: o.style, data: o.value != null ? { ...(m.data || {}), value: o.value } : m.data })
    }
    return new World(mobs, f.scene.display.slice(), w.ids)
  }

  /** Live values and ops, updaters, traced paths: applied to a view, then written back as overrides. */
  function postFrame(f: Frame, t: number, seg: Segment | null, withLive: boolean) {
    const view = viewOf(f)
    const base = view.snapshot()
    const touched: number[] = []
    evalClock.t = t
    if (withLive) {
      for (const [id, v] of live.values) if (view.has(id)) { setNumberValue(view, id, v); touched.push(id) }
      for (const o of live.ops.values()) {
        if (!view.has(o.target)) continue
        try { runOp(view, o.target, o.name, deref(view, o.args), opEnv()) ; touched.push(o.target) } catch { /* skip */ }
      }
    }
    touched.push(...updaters.apply(view, t, seg, deps()))
    if (!tracing) {
      for (const m of Array.from(view.mobs.values())) {
        if (m.kind !== 'traced_path') continue
        const pts = tracePoints(m, t, view)
        view.set({ ...m, paths: pts.length >= 2 ? [polySub(pts, false)] : [] })
        touched.push(m.id)
      }
    }
    writeBack(f, view, base, touched)
  }

  /** Changed families become overrides: same structure → matrix/style/value; new structure → drawn as items. */
  function writeBack(f: Frame, view: World, base: Snap, touched: number[]) {
    for (const r of Array.from(new Set(touched))) {
      const famV = family(view, r), famB = family(base, r)
      const same = famV.length === famB.length && famV.every((id, i) => {
        if (id !== famB[i]) return false
        const a = view.get(id), b = base.mobs.get(id)
        return a.paths === b.paths && a.text === b.text && a.image === b.image
      })
      if (same) {
        for (const id of famV) {
          const a = view.get(id)
          if (a === base.mobs.get(id)) continue
          const o = f.get(id)
          if (!o) continue
          o.m = a.m
          o.style = a.style
          if (a.data?.value != null) o.value = Number(a.data.value)
        }
      } else {
        const o = f.get(r)
        if (!o) continue
        const alpha = o.alpha
        o.replace = famV.map(id => view.get(id)).filter(hasGeom).map((m: Mob) => ({
          paths: m.paths, m: m.m, style: m.style, alpha, partial: null, z: m.z, text: m.text, image: m.image,
        }))
      }
    }
  }

  /** TracedPath: the point sampled every 1/30 s from when it was made, cached until the timeline changes. */
  function tracePoints(m: Mob, t: number, now: World): Pt[] {
    const tr = m.data?.trace
    if (!tr || tr.point == null) return []
    const from = Number(tr.from ?? 0)
    const h = 1 / 30
    let c = traceCache.get(m.id)
    if (!c || c.version !== version) { c = { version, pts: [] }; traceCache.set(m.id, c) }
    const k = Math.floor((Math.min(t, duration) - from) / h + 1e-9)
    tracing = true
    try {
      while (c.pts.length <= k && c.pts.length < 20000) {
        const at = from + c.pts.length * h
        const v = viewOf(frameAt(at, false))
        evalClock.t = at
        const p = resolvePoint(v, tr.point)
        c.pts.push(p)
      }
    } catch {
      // The traced object is gone at that moment: stop sampling there.
    } finally {
      tracing = false
      evalClock.t = t
    }
    const pts = c.pts.slice(0, Math.max(0, k + 1))
    try {
      const p = resolvePoint(now, tr.point), last = pts[pts.length - 1]
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-9) pts.push(p)
    } catch { /* nothing */ }
    if (tr.dissipating != null && tr.dissipating > 0) {
      const keep = Math.ceil(tr.dissipating / h)
      return pts.slice(Math.max(0, pts.length - keep))
    }
    return pts
  }

  const engine = {
    reset(c?: unknown) {
      gen++
      pending = null
      queue.length = 0
      cfg = { frame_height: 8, frame_width: null, background: '#000000' }
      w = new World()
      w.set(cameraMob())
      segments = []
      duration = 0
      sections = []
      errors = []
      updaters.reset()
      live.ops.clear()
      live.values.clear()
      traceCache.clear()
      anyTraced = false
      if (c) config(c)
      changed()
      drain()
    },
    config(c: unknown) { run(() => config(c)) },
    make(id: number, kind: string, props?: unknown) {
      run(() => {
        evalClock.t = duration
        // A traced path keeps its point expression: it is evaluated at every sampled moment.
        const traced = String(kind).toLowerCase().replace(/_/g, '') === 'tracedpath'
        const r = makeKind(makeEnv(), id, kind, traced ? props || {} : deref(w, props || {}))
        // A traced path samples its point from the moment it is made.
        if (traced && w.has(id)) {
          const d = w.get(id).data
          w.update(id, { data: { ...d, trace: { ...d.trace, from: duration } } })
          anyTraced = true
        }
        return r
      })
    },
    copy(newId: number, src: unknown) { run(() => { copyFamily(w, resolveTarget(w, src), newId) }) },
    op(target: unknown, name: string, args?: unknown) {
      run(() => {
        evalClock.t = duration
        runOp(w, resolveTarget(w, target), name, deref(w, args), opEnv())
      })
    },

    /* Updaters (timeline: they start, stop and pause at the cursor). */
    add_updater(target: number, spec: UpdaterSpec) {
      run(() => {
        evalClock.t = duration
        if (spec && spec.kind === 'redraw' && !w.has(target)) {
          const [kind, props] = spec.make || ['group', {}]
          const r = makeKind(makeEnv(), target, kind, deref(w, props))
          if (r && typeof (r as Promise<void>).then === 'function') return (r as Promise<void>).then(() => updaters.add(target, spec, duration))
        } else resolveTarget(w, target)
        updaters.add(target, spec, duration)
      })
    },
    remove_updater(target: unknown, uid: unknown) { run(() => updaters.remove(resolveTarget(w, target), uid, duration)) },
    clear_updaters(target: unknown) { run(() => updaters.clear(resolveTarget(w, target), duration)) },
    suspend_updating(target: unknown) { run(() => updaters.suspend(resolveTarget(w, target), duration)) },
    resume_updating(target: unknown) { run(() => updaters.resume(resolveTarget(w, target), duration)) },

    /* Live overrides from a running Python loop: on top of the timeline at whatever time is drawn. */
    live_op(target: unknown, name: string, args?: unknown) {
      const id = resolveTarget(w, target)
      if (name === 'set_value' || name === 'increment_value') {
        const a = normArgs(args, ['value'])
        const cur = live.values.has(id) ? live.values.get(id) : Number(w.get(id).data?.value ?? 0)
        live.values.set(id, name === 'set_value' ? num(a.value, 0) : cur + num(a.value, 0))
      } else live.ops.set(`${id}|${name}`, { target: id, name, args })
      liveVersion++
    },
    live_set(target: unknown, value: unknown) {
      live.values.set(resolveTarget(w, target), num(value, 0))
      liveVersion++
    },
    live_clear() {
      live.ops.clear()
      live.values.clear()
      liveVersion++
    },
    /** A PycturesCanvas's canvas, for Python to draw on (cv.getContext('2d')). */
    canvas_for(target: unknown) {
      const m = w.get(resolveTarget(w, target))
      if (!m.image) throw new Error('that object is not a PycturesCanvas')
      return m.image.src
    },
    /** Use a canvas the page already has for a PycturesCanvas. */
    attach_canvas(target: unknown, canvas: CanvasImageSource) {
      const id = resolveTarget(w, target)
      const m = w.get(id)
      if (m.image) m.image.src = canvas
    },
    add(list: unknown) { run(() => addToDisplay(w, targets(list))) },
    remove(list: unknown) { run(() => removeFromDisplay(w, targets(list))) },
    clear() {
      run(() => {
        w.setDisplay([])
        w.set(cameraMob())
      })
    },
    play(anims: unknown, opts?: unknown) {
      run(() => {
        evalClock.t = duration
        play(derefSpecs(anims), opts)
      })
    },
    wait(seconds?: unknown) { run(() => wait(seconds)) },
    section(name: unknown) { run(() => { sections.push({ name: String(name ?? ''), t: duration }) }) },
    value(target: unknown, what: string, args?: unknown): Promise<unknown> {
      return new Promise((resolve, reject) => {
        run(() => {
          try { resolve(valueNow(target, what, args)) } catch (e) { reject(e) }
        })
      })
    },
    ready(): Promise<void> {
      if (!pending && !queue.length) return Promise.resolve()
      return new Promise(r => idle.push(r))
    },
    /** Draw time t into pxW × pxH of ctx's current coordinate space (cleared first unless opts.clear is false). */
    renderAt(ctx: CanvasRenderingContext2D, t: number, pxW: number, pxH: number, opts?: { clear?: boolean }) {
      renderFrame(ctx, frameAt(t), { pxW, pxH, fw: fw(), fh: fh(), clear: opts?.clear })
    },
    frameAt,
    /** An object as drawn at time t (box, first point, style with fades): for tests and debugging. */
    measure(t: number, target: unknown) {
      const f = frameAt(t)
      return measure(f, resolveTarget(w, target))
    },
    /** Is the object on screen (itself or inside something shown) at the end of the timeline? */
    isShown(target: unknown) {
      const id = resolveTarget(w, target)
      return w.display.some(top => family(w, top).includes(id))
    },
    takeErrors(): string[] {
      const e = errors
      errors = []
      return e
    },
    get errors() { return errors.slice() },
    get duration() { return duration },
    get sections() { return sections.slice() },
    get background() { return cfg.background },
    get version() { return version },
    get liveVersion() { return liveVersion },
    get frameSize() { return { width: fw(), height: fh() } },
    get hasContent() { return duration > 0 || w.display.length > 0 },
    get busy() { return !!pending || queue.length > 0 },
    /** What this build understands (for the Python half's checks and for debugging). */
    get capabilities() { return { kinds: KIND_NAMES(), anims: ANIM_KINDS, ops: OP_NAMES, rates: RATE_NAMES } },
  }
  return engine
}

export type AnimEngine = ReturnType<typeof createAnimEngine>
