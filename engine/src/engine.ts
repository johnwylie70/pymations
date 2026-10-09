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
import { IDENTITY, invert, mul, type Mat } from './math'
import {
  addToDisplay, boxCenter, CAMERA, copyFamily, family, familyBox, hasGeom, leaves, newMob, removeFromDisplay, World,
  type Mob, type Snap,
} from './scene'
import { deref, evalClock, evalValue, isMobRef, normArgs, num, readValue, resolvePoint, resolveTarget } from './args'
import { camOf, runOp, OP_NAMES, setRemake, type CamState, type OpEnv } from './ops'
import {
  make as makeKind, KIND_NAMES, setCanvasFactory, setNumberValue, setSharedText, type MakeEnv, type TexFn,
} from './kinds'
import { arrTemplate, instantiate, isArrTemplate, runOps, Updaters, type UpdaterSpec } from './updaters'
import { buildPlay, orderedEvents, ANIM_KINDS, type AnimSpec, type Node } from './animations'
import { Frame } from './frame'
import { measure, renderFrame } from './render'
import { reconcile } from './render3d'
import { TextOutliner } from './text'
import { RATE_NAMES, smooth } from './rate'

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
  /** The default scene transition (config(transition=…, transition_time=…)). */
  transition?: string
  transition_time?: number
}

/**
 * A sound on the timeline (Contract v3; the page plays these with WebAudio and
 * the recorder mixes them). The engine only keeps the list.
 */
export interface SoundEntry {
  src: string
  /** Timeline seconds where it starts. */
  t0: number
  volume: number
  fade_in: number
  fade_out: number
  loop: boolean
  /** Optional timeline end; without it a sound plays its length (a loop to the timeline's end). */
  t1?: number
  kind: string
}

const DEFAULT_ASPECT = 16 / 9

type LiveOp = [string, unknown, unknown?]

const TRANSITIONS = new Set(['none', 'crossfade', 'slide_left', 'slide', 'slide_right', 'wipe'])

const NEEDS_FONT = new Set(['add_coordinates', 'change_bar_values', 'change_layout'])

const RELATIVE = new Set(['shift', 'rotate', 'scale', 'stretch', 'flip', 'increment_value', 'rotate_about_origin'])

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
  let errors: Array<{ message: string; line: number }> = []
  /** The user's line of the command running now (the page sets engine.line before each call). */
  let curLine = 0

  const updaters = new Updaters()
  /** Live overrides from a running Python loop: latest per (target, op); tracker values. */
  const live = {
    ops: new Map<string, { target: number; name: string; args: unknown }>(),
    values: new Map<number, number>(),
    /** live(key, ops, {mode:'set'}): the latest list per key. */
    sets: new Map<string, LiveOp[]>(),
    /** live(key, ops, {mode:'add'}): absolute ops, latest per (key, target, name)… */
    adds: new Map<string, Map<string, LiveOp>>(),
    /** …and relative ones (shift, rotate, increment_value) summed as a change per target. */
    deltas: new Map<string, Map<number, { M: Mat; dv: number }>>(),
  }
  const liveSize = () => live.ops.size + live.values.size + live.sets.size + live.adds.size + live.deltas.size
  let liveVersion = 0
  let tvCache: { key: string; out: Record<number, number> } | null = null
  /** Traced paths: sampled points per object, rebuilt when the timeline changes. */
  const traceCache = new Map<number, { version: number; pts: Pt[] }>()
  let tracing = false
  let anyTraced = false
  setSharedText(text)
  setRemake((into, id, kind, props) => {
    const r = makeKind({ ...makeEnv(), w: into }, id, kind, props)
    if (r && typeof (r as Promise<void>).then === 'function') throw new Error('rebuilding this needs a font first; try again after it has loaded')
  })
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
  const queue: Array<{ fn: () => unknown; line: number }> = []
  let idle: Array<() => void> = []

  function report(e: unknown, line = curLine) {
    const msg = (e && (e as Error).message) || String(e)
    errors.push({ message: msg, line })
    if (typeof console !== 'undefined') console.error('[pyctures.anim]', msg)
  }

  function exec(fn: () => unknown, line: number) {
    curLine = line
    const r = fn() as Promise<unknown> | undefined
    if (r && typeof r.then === 'function') {
      const my = gen
      pending = r.then(() => changed(), e => report(e, line)).then(() => {
        if (my !== gen) return
        pending = null
        drain()
      })
    } else changed()
  }

  function drain() {
    while (!pending && queue.length) {
      const q = queue.shift()
      try { exec(q.fn, q.line) } catch (e) { report(e, q.line) }
    }
    if (!pending && !queue.length) {
      const waiters = idle
      idle = []
      for (const r of waiters) r()
    }
  }

  /** Run now if nothing is waiting (so a mistake throws back to the caller), else in turn. */
  function run(fn: () => unknown) {
    const line = Number((engine as { line?: number }).line) || 0
    if (pending || queue.length) queue.push({ fn, line })
    else exec(fn, line)
  }

  /* --------------------------------------------------------- commands */

  function config(c: unknown) {
    const k = normArgs(c, [])
    if (k.frame_height != null) cfg.frame_height = num(k.frame_height, 8)
    if (k.frame_width != null) cfg.frame_width = num(k.frame_width, fw())
    if (k.background != null || k.background_color != null) cfg.background = String(k.background ?? k.background_color)
    if (k.transition != null) cfg.transition = String(k.transition)
    // ThreeDScene: the 3D camera with Manim's defaults (until set_camera_orientation says otherwise).
    if (k.three_d) {
      const m = w.get(CAMERA)
      w.update(CAMERA, { data: { ...(m.data || {}), cam: { ...camOf(w), three_d: true } } })
    }
    if (k.transition_time != null) cfg.transition_time = num(k.transition_time, 0.5)
    if (k.frame_height != null || k.frame_width != null) w.set(cameraMob(w.get(CAMERA).m))
  }

  /**
   * Register an updater at the cursor. always_redraw's object is built now
   * (waiting for a font or TeX if it must), so it exists for add() and reads.
   */
  function addUpdater(target: number, spec: UpdaterSpec): void | Promise<void> {
    evalClock.t = duration
    if (!spec) return
    if (spec.kind === 'redraw' && !spec.template && spec.make && isArrTemplate(spec.make)) spec.template = arrTemplate(spec.make)
    if (spec.kind === 'python' || spec.kind !== 'redraw' || w.has(target)) {
      resolveTarget(w, target)
      updaters.add(target, spec, duration)
      return
    }
    const waits: Promise<void>[] = []
    const d = { ...deps(), make: (into: World, id: number, kind: string, props: unknown) => {
      const r = makeKind({ ...makeEnv(), w: into }, id, kind, props)
      if (r && typeof (r as Promise<void>).then === 'function') waits.push(r as Promise<void>)
    } }
    const build = () => {
      if (spec.template) instantiate(w, spec.template, new Map(), d, target)
      else { const [kind, props] = spec.make || ['group', {}]; d.make(w, target, kind, deref(w, props)) }
    }
    try { build() } catch (e) { if (!waits.length) throw e }
    if (waits.length) {
      // A font or TeX was needed: wait, then build again from the caches.
      return Promise.all(waits).then(() => { waits.length = 0; build(); updaters.add(target, spec, duration) })
    }
    updaters.add(target, spec, duration)
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
  /* --------------------------------------------------- camera rotation */

  /**
   * Ambient and 3D-illusion camera rotation (ThreeDScene): intervals on the
   * timeline. A frame adds what turned since its segment began; each
   * segment's turn is written into the camera when it ends, so any moment is
   * exact and nothing is replayed.
   */
  let ambient: Array<{ about: 'theta' | 'phi' | 'gamma'; rate: number; from: number; to: number }> = []
  let illusion: Array<{ rate: number; phi0: number; theta0: number; from: number; to: number }> = []

  function camAt(base: CamState, t: number, seg: { t0: number } | null): CamState {
    let cam = base
    if (seg) for (const a of ambient) {
      const d = Math.min(t, a.to) - Math.max(seg.t0, a.from)
      if (d > 0) cam = { ...cam, [a.about]: cam[a.about] + a.rate * d }
    }
    for (const il of illusion) {
      if (t < il.from) continue
      const tau = Math.min(t, il.to) - il.from
      cam = { ...cam, theta: il.theta0 + 0.2 * Math.sin(il.rate * tau), phi: il.phi0 + 0.1 * Math.cos(il.rate * tau) - 0.1 }
    }
    return cam
  }

  function bakeCamera(seg: Segment) {
    if (!ambient.length && !illusion.length) return
    const cam = camAt(camOf(w), seg.t1, seg)
    const m = w.get(CAMERA)
    w.update(CAMERA, { data: { ...(m.data || {}), cam } })
  }

  function bake(seg: Segment) {
    bakeCamera(seg)
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
    if (name === 'camera') {
      const c = camOf(w)
      return { phi: c.phi, theta: c.theta, gamma: c.gamma, zoom: c.zoom, focal_distance: c.focal, frame_center: c.center, three_d: c.three_d }
    }
    evalClock.t = duration
    // A point expression on its own (target null or 0): {"$pt": expr}.
    if (name === 'point' && (target == null || target === 0)) {
      const p = resolvePoint(w, a.arg ?? args)
      return [p[0], p[1], 0]
    }
    if ((name === 'expr' || name === 'eval' || name === 'number') && (target == null || target === 0)) return evalValue(w, a.arg ?? args)
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

  let sounds: SoundEntry[] = []

  /** Scene transitions, each over the first `dur` seconds of the scene after it. */
  let transitions: Array<{ t: number; dur: number; kind: string; out: Snap }> = []
  function transitionAt(t: number) {
    for (const tr of transitions) if (t >= tr.t && t < tr.t + tr.dur) return tr
    return null
  }

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
    return frameAndView(t, withLive).f
  }

  /**
   * The frame at t and, when updaters, live input or traced paths ran, the
   * scene as they left it (redrawn objects included) — what a traced point
   * must be read from.
   */
  function frameAndView(t: number, withLive: boolean): { f: Frame; view: World | null } {
    t = Math.max(0, t)
    const seg = segmentAt(t)
    const f = new Frame(seg ? seg.before : w.snapshot())
    if (seg && seg.node) seg.node.frame(t - seg.t0, f)
    if (seg && (ambient.length || illusion.length)) {
      const o = f.get(CAMERA)
      if (o) o.cam = camAt(o.cam ?? camOf(f.scene), t, seg)
    }
    const hasLive = withLive && liveSize() > 0
    const view = updaters.any || hasLive || anyTraced ? postFrame(f, t, seg, hasLive) : null
    return { f, view }
  }

  /** The scene as this frame shows it (animation overrides applied), as a world updaters can read and change. */
  function viewOf(f: Frame): World {
    const mobs = new Map(f.scene.mobs)
    for (const [id, o] of f.over) {
      const m = mobs.get(id)
      if (!m || (o.m === m.m && o.style === m.style && o.value == null && o.m3 === m.m3)) continue
      const m3 = reconcile(o.m, o.m3 ?? m.m3)
      mobs.set(id, { ...m, m: o.m, ...(m3 ? { m3 } : {}), style: o.style, data: o.value != null ? { ...(m.data || {}), value: o.value } : m.data })
    }
    return new World(mobs, f.scene.display.slice(), w.ids)
  }

  /** Live values and ops, updaters, traced paths: applied to a view, then written back as overrides. */
  function postFrame(f: Frame, t: number, seg: Segment | null, withLive: boolean): World {
    const view = viewOf(f)
    const base = view.snapshot()
    const touched: number[] = []
    evalClock.t = t
    if (withLive) {
      for (const [id, v] of live.values) if (view.has(id)) { setNumberValue(view, id, v); touched.push(id) }
      const d = deps()
      const runList = (ops: LiveOp[]) => { try { touched.push(...runOps(view, ops, null, d)) } catch { /* an object gone: skip */ } }
      // "u<uid>" / "d<uid>": a Python-run updater's changes, only while that updater is on.
      const on = (key: string) => {
        const mm = /^[ud](\d+)$/.exec(key)
        return !mm || updaters.activeUid(mm[1], t) !== false
      }
      for (const [k, ops] of live.sets) if (on(k)) runList(ops)
      for (const [k, m] of live.adds) if (on(k)) runList(Array.from(m.values()))
      for (const [k, m] of live.deltas) {
        if (!on(k)) continue
        for (const [id, dl] of m) {
          if (!view.has(id)) continue
          for (const i of family(view, id)) { const mob = view.get(i); view.set({ ...mob, m: mul(dl.M, mob.m) }) }
          if (dl.dv) setNumberValue(view, id, Number(view.get(id).data?.value ?? 0) + dl.dv)
          touched.push(id)
        }
      }
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
    return view
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
          if (a.m3) o.m3 = a.m3
          o.style = a.style
          if (a.data?.value != null) o.value = Number(a.data.value)
        }
      } else {
        const o = f.get(r)
        if (!o) continue
        const alpha = o.alpha
        o.replace = famV.map(id => view.get(id)).filter(hasGeom).map((m: Mob) => ({
          paths: m.paths, m: m.m, style: m.style, alpha, partial: null, z: m.z, text: m.text, image: m.image, shadow: m.shadow, evenodd: m.evenodd,
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
        const fv = frameAndView(at, false)
        const v = fv.view || viewOf(fv.f)
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
      const keep = Math.ceil(tr.dissipating / h) + 1
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
      live.sets.clear()
      live.adds.clear()
      live.deltas.clear()
      traceCache.clear()
      anyTraced = false
      transitions = []
      sounds = []
      ambient = []
      illusion = []
      if (c) config(c)
      changed()
      drain()
    },
    config(c: unknown) { run(() => config(c)) },
    make(id: number, kind: string, props?: unknown, extra?: unknown) {
      run(() => {
        evalClock.t = duration
        // An element Python hands over after the props: a PycturesCanvas's canvas,
        // an ImageMobject's picture, or an SVGMobject's traced SVG.
        if (extra != null) {
          const k = String(kind).replace(/_/g, '').toLowerCase()
          if (k === 'pycturescanvas') props = { ...(props as object), canvas: extra }
          else if (k === 'imagemobject') props = { ...(props as object), element: extra }
          else if (k === 'svgmobject') props = typeof extra === 'string' || (extra as any).outerHTML ? { ...(props as object), svg_element: extra } : { ...(props as object), element: extra }
        }
        // A traced path keeps its point expression: it is evaluated at every sampled moment.
        const traced = String(kind).toLowerCase().replace(/_/g, '') === 'tracedpath'
        let r = makeKind(makeEnv(), id, kind, traced ? props || {} : deref(w, props || {}))
        // If it fails later (an image op refused, a TeX error), leave an empty
        // stand-in under its id: the one real error shows, and later commands
        // that use the object do not each add "that object does not exist".
        if (r && typeof (r as Promise<void>).then === 'function') {
          r = (r as Promise<void>).catch(e => {
            if (!w.has(id)) w.set(newMob(id, 'group', { sc: '#FFFFFF', fc: '#FFFFFF', sw: 0, so: 1, fo: 0 }, []))
            throw e
          })
        }
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
        const go = () => runOp(w, resolveTarget(w, target), name, deref(w, args), opEnv())
        // Rebuilding with numbers or labels needs the text font: load it first (holding later commands).
        if (NEEDS_FONT.has(name) && text.font('normal|normal') === undefined) return text.load('normal|normal').then(go)
        go()
      })
    },

    /* Updaters (timeline: they start, stop and pause at the cursor). */
    add_updater(target: number, spec: UpdaterSpec) {
      run(() => addUpdater(target, spec))
    },
    /** The Python half's name for add_updater. */
    updater(target: number, spec: UpdaterSpec) {
      run(() => addUpdater(target, spec))
    },
    remove_updater(target: unknown, uid: unknown) { run(() => updaters.remove(resolveTarget(w, target), uid, duration)) },
    clear_updaters(target: unknown) { run(() => updaters.clear(resolveTarget(w, target), duration)) },
    suspend_updating(target: unknown) { run(() => updaters.suspend(resolveTarget(w, target), duration)) },
    resume_updating(target: unknown) { run(() => updaters.resume(resolveTarget(w, target), duration)) },

    /* Live overrides from a running Python loop: on top of the timeline at whatever time is drawn. */
    live_op(target: unknown, name: string, args?: unknown, opts?: unknown) {
      const id = resolveTarget(w, target)
      // A dt updater that runs in Python sends each frame's change: sum them.
      if (opts && (opts as { accumulate?: boolean }).accumulate) {
        engine.live(`acc|${id}`, [[name, args, id]], { mode: 'add' })
        return
      }
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
      live.sets.clear()
      live.adds.clear()
      live.deltas.clear()
      liveVersion++
    },
    /**
     * The Python half's live channel: live(key, ops, {mode}). 'set' replaces
     * the key's ops (an empty list clears it, including what 'add' gathered);
     * 'add' keeps the latest absolute op per target and sums relative ones
     * (a Python dt updater sends a small shift every tick).
     */
    live(key: unknown, ops: unknown, opts?: unknown) {
      const k = String(key)
      const list = (Array.isArray(ops) ? ops : []) as LiveOp[]
      const mode = (opts && (opts as { mode?: string }).mode) || 'set'
      if (mode === 'set') {
        live.adds.delete(k)
        live.deltas.delete(k)
        if (list.length) live.sets.set(k, list)
        else live.sets.delete(k)
      } else {
        const adds = live.adds.get(k) || new Map<string, LiveOp>()
        const deltas = live.deltas.get(k) || new Map<number, { M: Mat; dv: number }>()
        for (const op of list) {
          const [name, args, target] = op
          let tid: number
          try { tid = resolveTarget(w, target) } catch { continue }
          if (RELATIVE.has(String(name))) {
            // The change this op makes, measured on the current scene, added to what the key has.
            const probe = w.fork()
            const before = probe.get(tid)
            try { runOp(probe, tid, String(name), deref(probe, args), opEnv()) } catch { continue }
            const after = probe.get(tid)
            const D = mul(after.m, invert(before.m))
            const cur = deltas.get(tid) || { M: IDENTITY, dv: 0 }
            deltas.set(tid, { M: mul(D, cur.M), dv: cur.dv + (Number(after.data?.value ?? 0) - Number(before.data?.value ?? 0)) })
          } else adds.set(`${tid}|${name}`, op)
        }
        live.adds.set(k, adds)
        live.deltas.set(k, deltas)
      }
      liveVersion++
    },
    /**
     * sound({src, time_offset, volume, fade_in, fade_out, loop, kind}): at the
     * cursor (+ time_offset). "music" loops and runs to the timeline's end.
     */
    sound(spec: unknown) {
      run(() => {
        const a = normArgs(spec, ['src'])
        if (a.src == null || a.src === '') throw new Error('add_sound needs a file')
        const music = a.kind === 'music'
        sounds.push({
          src: String(a.src), t0: duration + num(a.time_offset, 0), volume: Math.max(0, num(a.volume, music ? 0.3 : 1)),
          fade_in: Math.max(0, num(a.fade_in, 0)), fade_out: Math.max(0, num(a.fade_out, music ? 1 : 0)),
          loop: a.loop != null ? !!a.loop : music, kind: music ? 'music' : 'sound',
          ...(a.t1 != null ? { t1: num(a.t1, 0) } : {}),
        })
      })
    },
    /**
     * wait_sound({src, extra}): the timeline lasts until that sound (or the
     * last one started) has finished, plus extra. Its length comes from the
     * page (window.__cirSoundDuration(src) → seconds); later commands wait.
     */
    wait_sound(spec?: unknown) {
      run(() => {
        const a = normArgs(spec, ['src', 'extra'])
        const s = a.src != null ? [...sounds].reverse().find(x => x.src === String(a.src)) : sounds[sounds.length - 1]
        if (!s) return
        const probe = (globalThis as any).__cirSoundDuration
        if (typeof probe !== 'function') return
        return Promise.resolve(probe(s.src)).then((len: number) => {
          const end = s.t0 + Math.max(0, Number(len) || 0) + num(a.extra, 0)
          if (end > duration + 1e-9) wait(end - duration)
        })
      })
    },
    /** ThreeDScene camera rotation, at the cursor. */
    begin_ambient_camera_rotation(rate?: unknown, about?: unknown) {
      run(() => {
        const ab = String(about ?? 'theta') as 'theta' | 'phi' | 'gamma'
        ambient = ambient.map(a => (a.about === ab && a.to === Infinity ? { ...a, to: duration } : a))
        ambient.push({ about: ab, rate: num(rate, 0.02), from: duration, to: Infinity })
      })
    },
    stop_ambient_camera_rotation(about?: unknown) {
      run(() => {
        const ab = about == null ? null : String(about)
        ambient = ambient.map(a => ((ab == null || a.about === ab) && a.to === Infinity ? { ...a, to: duration } : a))
      })
    },
    begin_3dillusion_camera_rotation(rate?: unknown, originPhi?: unknown, originTheta?: unknown) {
      run(() => {
        const cam = camOf(w)
        illusion.push({ rate: num(rate, 1), phi0: num(originPhi, cam.phi), theta0: num(originTheta, cam.theta), from: duration, to: Infinity })
      })
    },
    stop_3dillusion_camera_rotation() {
      run(() => { illusion = illusion.map(il => (il.to === Infinity ? { ...il, to: duration } : il)) })
    },
    /** Every ValueTracker's value at timeline time t, live overrides included (the tick payload's anim_v). */
    trackerValues(t: number) {
      return engine.values_at(t)
    },
    /** Tracker values at time t (for a Python updater that runs in Python and reads them). */
    values_at(t: number) {
      const key = `${t}|${version}|${liveVersion}`
      if (tvCache && tvCache.key === key) return tvCache.out
      const f = frameAt(t)
      const out: Record<number, number> = {}
      for (const [id, m] of f.scene.mobs) {
        if (m.kind !== 'value_tracker') continue
        const o = f.over.get(id)
        out[id] = o && o.value != null ? o.value : Number(m.data?.value ?? 0)
      }
      tvCache = { key, out }
      return out
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
    /**
     * section(name, {transition, transition_time}): a new scene starts here.
     * With a transition, the scene as it stands now (before the clear that
     * follows) is kept and drawn going out over the new one's first moments.
     */
    section(name: unknown, opts?: unknown) {
      run(() => {
        sections.push({ name: String(name ?? ''), t: duration })
        const o = (opts && typeof opts === 'object' ? opts : {}) as { transition?: string; transition_time?: number }
        let kind = String(o.transition || cfg.transition || 'none')
        // Unknown names fall back to a crossfade, with one warning (on the user's line).
        if (!TRANSITIONS.has(kind)) {
          report(new Error(`unknown transition '${kind}'; use crossfade, slide_left, slide_right or wipe`))
          kind = 'crossfade'
        }
        const dur = num(o.transition_time ?? cfg.transition_time, 0.5)
        if (kind !== 'none' && dur > 0 && duration > 0) transitions.push({ t: duration, dur, kind, out: w.snapshot() })
      })
    },
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
      const o = { pxW, pxH, fw: fw(), fh: fh(), clear: opts?.clear }
      const tr = transitionAt(t)
      if (!tr) { renderFrame(ctx, frameAt(t), o); return }
      // Scene transition: the outgoing scene (as it ended) and the incoming one, by kind.
      const x = smooth((t - tr.t) / tr.dur)
      const out = new Frame(tr.out), inn = frameAt(t)
      // Slides move by one frame width (scene units, before the camera's zoom).
      const zoom = Math.hypot(w.get(CAMERA).m[0], w.get(CAMERA).m[1]) || 1
      const W = fw() * zoom
      if (tr.kind === 'slide_left' || tr.kind === 'slide') {
        renderFrame(ctx, out, { ...o, shiftX: -W * x })
        renderFrame(ctx, inn, { ...o, clear: false, shiftX: W * (1 - x) })
      } else if (tr.kind === 'slide_right') {
        renderFrame(ctx, out, { ...o, shiftX: W * x })
        renderFrame(ctx, inn, { ...o, clear: false, shiftX: -W * (1 - x) })
      } else if (tr.kind === 'wipe') {
        renderFrame(ctx, out, { ...o, clipX: [x * pxW, pxW] })
        renderFrame(ctx, inn, { ...o, clear: false, clipX: [0, x * pxW] })
      } else {
        renderFrame(ctx, out, { ...o, alpha: 1 - x })
        renderFrame(ctx, inn, { ...o, clear: false, alpha: x })
      }
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
    /** Set by the page before each call: the user's line, kept with commands that must wait. */
    line: 0,
    /** Errors from commands that waited behind text/TeX, with the user's line (0 when unknown). */
    takeErrors(): Array<{ message: string; line: number }> {
      const e = errors
      errors = []
      return e
    },
    get errors() { return errors.slice() },
    get duration() { return duration },
    get sections() { return sections.slice() },
    get background() { return cfg.background },
    /** Bumps on any timeline change and on any live override (the page redraws when it changes). */
    /** The sounds on the timeline (rebuilt with the timeline; `version` bumps on any change). */
    get sounds() { return sounds.slice() },
    get version() { return version + liveVersion },
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
