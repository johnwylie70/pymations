/**
 * Pymations, the browser half.
 *
 * One file, used three ways:
 *   - `pymations run`    the page talks to your own Python over a WebSocket
 *   - `pymations build`  the page runs Python itself, with Pyodide, in a Web
 *                        Worker (a folder, or one self-contained .html file)
 *   - on any web page    `<div data-pymations-src="scene.py"></div>` plus
 *                        `<script type="module" src=".../pymations.js"></script>`
 *
 * It is the Pyctures browser half (the same author, MIT) with the animation
 * layer added. Beside this file:
 *   pyctures.py   the Pyctures runtime the Python half sits on
 *   pymations.py  the Python half (also the module `manim` in these pages)
 *   engine/       the animation engine: anim.js, KaTeX, opentype.js, fonts
 *
 * THE RENDERER keeps a handle table (number -> JavaScript value), replays the
 * commands the Python half records, answers reads, and reports input. Fixed
 * handles (they must match the Python half): 1 window, 2 canvas, 4 the 2D
 * context (made on first use), 6 the animation engine.
 *
 * THE ANIMATION. Python only describes the scene: `play()` appends to a
 * timeline in the engine and returns. The page owns the timeline's clock:
 * each scene has a player that draws the engine's picture at time t on its own
 * canvas, above the program's canvas, with a scrubber (play/pause, the
 * sections as ticks, the time). A scene with no Python loop is idle in Python
 * while it plays; a scene with one (draw(), await frame()) keeps running, and
 * the two share the page.
 *
 * THE PAGE'S MAIN THREAD only draws: Python runs in your own Python (`run`) or
 * in a worker (`build`), so a slow frame, Python's garbage collection or a
 * stuck loop never holds up drawing or input.
 *
 * THE HOST LOOP owns requestAnimationFrame. Each refresh, if Python is live
 * and free and fewer than two frames are waiting to be shown, it asks Python
 * for the next frame (events and read answers in, commands out).
 *
 * A scene starts when it first scrolls into view, and pauses while it is out
 * of view or the tab is hidden, so a page with several scenes stays light.
 *
 * IMAGES BY RELATIVE PATH (`load_image("pictures/photo.png")`) are relative to
 * the scene's file: the packed copy in a single-file build, or the file beside
 * the scene otherwise.
 *
 * Author: John Wylie. MIT licence.
 */

const BASE = new URL('./', import.meta.url)
export const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.29.4/full/'
const STUCK_MS = 3000
const MEASURE_KEY = 'pymations:measure'
/** A file that uses the animation module (the same test `pages.uses_anim` makes). */
export const ANIM_IMPORT = /^[ \t]*(?:from|import)[ \t]+(?:pymations|manim)\b/m

// ---------------------------------------------------------------- renderer

const KEEP_STATE = ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'miterLimit', 'font', 'textAlign', 'textBaseline', 'globalAlpha', 'globalCompositeOperation', 'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'imageSmoothingEnabled']
const camelCache = Object.create(null)

// fill_rect -> fillRect, but only when the snake name is not itself real.
function prop(obj, name) {
  if (obj != null && !(name in Object(obj)) && name.indexOf('_') > 0) {
    const c = camelCache[name] || (camelCache[name] = name.replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase()))
    if (c in Object(obj)) return c
  }
  return name
}

// ---------------------------------------------------------------- images by relative path

/** A relative path to an image: no scheme, not absolute, an image extension (pages.IMAGE_PATH). */
const IMAGE_PATH = /^(?![a-z][a-z0-9+.-]*:|\/)(?:\.\/)?[^\s"'<>?#]+\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
export function isRelativeImagePath(s) { return typeof s === 'string' && s.length < 300 && IMAGE_PATH.test(s) }
export const IMAGE_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
}
/** The key an image is packed under: as written, without a leading "./". */
const packedKey = (s) => s.replace(/^(\.\/)+/, '')

/**
 * Where a scene's relative image paths point: `packed` ({path: base64}, a
 * single-file page's images) first, then the file beside the scene. Returns
 * null when nothing needs changing (no packed images, and the scene is in the
 * page's own folder), so most scenes pay nothing.
 */
export function imageResolver(src, packed) {
  const keys = packed ? Object.keys(packed).filter(isRelativeImagePath) : []
  const scene = new URL(src || '', location.href)
  const besidePage = new URL('./', scene).href === new URL('./', location.href).href
  if (!keys.length && besidePage) return null
  const done = new Map()
  return (s) => {
    if (!isRelativeImagePath(s)) return undefined
    let url = done.get(s)
    if (url === undefined) {
      const key = packedKey(s)
      if (packed && packed[key] != null) url = 'data:' + (IMAGE_TYPES[key.split('.').pop().toLowerCase()] || 'application/octet-stream') + ';base64,' + packed[key]
      else url = besidePage ? null : new URL(s, scene).href
      done.set(s, url)
    }
    return url || undefined
  }
}

/** Swap every string in a frame's commands that `resolve` maps (in place). */
function swapStrings(v, resolve) {
  for (let i = 0; i < v.length; i++) {
    const x = v[i]
    if (typeof x === 'string') { const u = resolve(x); if (u !== undefined) v[i] = u }
    else if (x && typeof x === 'object') {
      if (Array.isArray(x)) swapStrings(x, resolve)
      else for (const k in x) {
        const y = x[k]
        if (typeof y === 'string') { const u = resolve(y); if (u !== undefined) x[k] = u }
        else if (y && typeof y === 'object') swapStrings(Array.isArray(y) ? y : [y], resolve)
      }
    }
  }
}

/**
 * The renderer for one canvas. `anim`: the scene's animation engine (handle
 * 6), or null. `images`: a function from a string in the commands to the URL
 * to use instead (see imageResolver), or null. `hooks`: onEvent(event),
 * onSize(size), onApplied({reads, errors, ms, n, timing}), onReads(reads) (a
 * promise has settled), isActive() (has the keyboard).
 */
export function createRenderer(canvas, { anim = null, images = null, hooks }) {
  const H = new Map()
  let ctx2d = null
  let dpr = 1, cssW = 0, cssH = 0
  const reportedErrors = Object.create(null)
  let timing = null
  let pointerIsDown = false

  function size() {
    dpr = window.devicePixelRatio || 1
    const r = canvas.getBoundingClientRect()
    cssW = Math.max(1, Math.round(r.width)); cssH = Math.max(1, Math.round(r.height))
    // The 2D context is scaled, so drawing is in CSS pixels and stays sharp.
    {
      const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        // Resizing a canvas wipes it and resets its drawing state. A program
        // that drew once (no draw()) would be left blank, so the picture is
        // carried across, and the state the program set is put back.
        let keep = null, state = null
        if (ctx2d && canvas.width && canvas.height) {
          keep = document.createElement('canvas')
          keep.width = canvas.width; keep.height = canvas.height
          keep.getContext('2d').drawImage(canvas, 0, 0)
          state = {}
          for (const k of KEEP_STATE) state[k] = ctx2d[k]
        }
        canvas.width = w; canvas.height = h
        if (ctx2d) {
          ctx2d.setTransform(1, 0, 0, 1, 0, 0)
          if (keep) ctx2d.drawImage(keep, 0, 0)
          ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)
          if (state) for (const k in state) { try { ctx2d[k] = state[k] } catch (e) { /* read-only in this browser */ } }
        }
      }
    }
    hooks.onSize({ width: cssW, height: cssH, pixel_ratio: dpr })
  }

  function getCtx() {
    if (!ctx2d) {
      ctx2d = canvas.getContext('2d')
      if (ctx2d) ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    return ctx2d
  }

  function lookup(h) {
    if (h === 4) return getCtx()
    if ((h === 3 || h === 5) && !H.has(h)) throw new Error('3D (THREE) is not part of Pymations pages; use the pyctures package for 3D scenes')
    if (h === 6 && !H.has(h)) throw new Error('the animation engine is not loaded on this page')
    if (!H.has(h)) throw new Error('that object no longer exists in the page (#' + h + ')')
    return H.get(h)
  }

  function decode(v) {
    if (v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) return v.map(decode)
    if ('$h' in v) return lookup(v.$h)
    if ('$e' in v) return evalExpr(v.$e)
    if ('$cb' in v) {
      const id = v.$cb
      return (ev) => hooks.onEvent({ k: 'cb', id, e: summarize(ev) })
    }
    if ('$d' in v) {
      const o = {}; for (const k in v.$d) o[k] = decode(v.$d[k]); return o
    }
    return v
  }

  function evalExpr(t) {
    switch (t[0]) {
      case 'v': return decode(t[1])
      case 'num': return Number(t[1])
      case 'ref': return decode(t[1])
      case 'get': { const o = evalExpr(t[1]); return o[prop(o, t[2])] }
      case 'neg': return -evalExpr(t[1])
      case '+': return evalExpr(t[1]) + evalExpr(t[2])
      case '-': return evalExpr(t[1]) - evalExpr(t[2])
      case '*': return evalExpr(t[1]) * evalExpr(t[2])
      case '/': return evalExpr(t[1]) / evalExpr(t[2])
      case '%': return evalExpr(t[1]) % evalExpr(t[2])
      case '**': return Math.pow(evalExpr(t[1]), evalExpr(t[2]))
      case '//': return Math.floor(evalExpr(t[1]) / evalExpr(t[2]))
    }
    throw new Error('unknown expression ' + t[0])
  }

  // What Python gets back for a read or an event: plain data only.
  function summarize(v, depth) {
    depth = depth || 0
    if (v === null || v === undefined) return null
    const t = typeof v
    if (t === 'number' || t === 'string' || t === 'boolean') return v
    if (t === 'function') return '<function>'
    if (Array.isArray(v) || ArrayBuffer.isView(v)) {
      if (depth > 2) return null
      const a = []; for (let i = 0; i < Math.min(v.length, 100000); i++) a.push(summarize(v[i], depth + 1)); return a
    }
    if (depth > 1) return null
    const out = {}
    if (typeof Event !== 'undefined' && v instanceof Event) {
      const r = canvas.getBoundingClientRect()
      if ('clientX' in v) { out.x = v.clientX - r.left; out.y = v.clientY - r.top }
    }
    for (const k in v) {
      let x; try { x = v[k] } catch (e) { continue }
      const tx = typeof x
      if (x === null || tx === 'number' || tx === 'string' || tx === 'boolean') out[k] = x
      else if (depth === 0 && tx === 'object' && !(x instanceof Node) && !(x instanceof Window)) {
        const s = summarize(x, depth + 1); if (s !== null) out[k] = s
      }
    }
    return out
  }

  function describe(obj, h) {
    if (h === 4) return 'ctx'
    if (h === 2) return 'canvas'
    if (h === 6) return 'the animation engine'
    if (h === 1) return 'js'
    const n = obj && obj.constructor && obj.constructor.name
    return n || 'this object'
  }

  function apply(cmds) {
    const started = performance.now()
    const reads = {}, errors = []
    for (let i = 0; i < cmds.length; i++) {
      const c = cmds[i]
      try {
        switch (c[0]) {
          case 'get': { const o = lookup(c[3]); H.set(c[2], o[prop(o, c[4])]); break }
          case 'set': { const o = lookup(c[2]); o[prop(o, c[3])] = decode(c[4]); break }
          case 'call': {
            const o = lookup(c[3]), name = prop(o, c[4]), fn = o == null ? undefined : o[name]
            if (typeof fn !== 'function') throw new TypeError(describe(o, c[3]) + ' has no method "' + c[4] + '"')
            const res = fn.apply(o, decode(c[5]))
            if (c[2]) H.set(c[2], res)
            break
          }
          case 'new': {
            const o = lookup(c[3]), Ctor = o == null ? undefined : o[prop(o, c[4])]
            if (typeof Ctor !== 'function') throw new TypeError(describe(o, c[3]) + ' has no "' + c[4] + '"')
            const made = Reflect.construct(Ctor, decode(c[5]))
            if (c[2]) H.set(c[2], made)
            break
          }
          case 'fcall': { const f = lookup(c[3]); const r = f.apply(null, decode(c[4])); if (c[2]) H.set(c[2], r); break }
          case 'fnew': { const F = lookup(c[3]); const m = Reflect.construct(F, decode(c[4])); if (c[2]) H.set(c[2], m); break }
          case 'free': H.delete(c[2]); break
          case 'read': {
            const val = decode(c[3])
            if (val && typeof val.then === 'function') settle(val, c[2], c[4], c[1])
            else reads[c[2]] = summarize(val)
            break
          }
        }
      } catch (e) {
        const msg = (e && e.message) || String(e)
        const key = c[1] + '|' + msg
        if (!reportedErrors[key]) { reportedErrors[key] = 1; errors.push({ line: c[1], message: (e && e.name ? e.name + ': ' : '') + msg }) }
        if (c[0] === 'read') reads[c[2]] = null
      }
    }
    hooks.onApplied({ reads, errors, ms: performance.now() - started, n: cmds.length, timing })
  }

  // A PROMISE is answered when it settles, in a later frame. An object result
  // (a GPU adapter, a device) is kept under the handle Python reserved.
  function settle(promise, rid, newH, line) {
    promise.then((res) => {
      const plain = res === null || res === undefined || typeof res !== 'object' || Array.isArray(res) ||
        ArrayBuffer.isView(res) || Object.getPrototypeOf(res) === Object.prototype
      let answer
      if (plain || !newH) answer = summarize(res)
      else { H.set(newH, res); answer = { $h: newH } }
      if (hooks.onReads) hooks.onReads({ [rid]: answer })
    }, (e) => {
      if (hooks.onReads) hooks.onReads({ [rid]: { $error: 'line ' + line + ': ' + ((e && e.message) || String(e)) } })
    })
  }

  function sendInput(e) {
    const k = { type: e.type }
    if (e.type === 'keydown' || e.type === 'keyup') {
      if (!hooks.isActive()) return
      if (e.repeat) return
      k.key = e.key; k.code = e.code
      if (e.key.indexOf('Arrow') === 0 || e.key === ' ') e.preventDefault()
    } else {
      if (e.type === 'pointerdown') { pointerIsDown = true; canvas.focus({ preventScroll: true }) }
      else if (e.type === 'pointerup') { if (!pointerIsDown) return; pointerIsDown = false }
      const r = canvas.getBoundingClientRect()
      k.x = e.clientX - r.left; k.y = e.clientY - r.top; k.button = e.button
    }
    hooks.onEvent({ k: 'input', e: k })
  }

  H.set(1, window); H.set(2, canvas)
  if (anim) H.set(6, anim)
  window.addEventListener('keydown', sendInput)
  window.addEventListener('keyup', sendInput)
  canvas.addEventListener('pointerdown', sendInput)
  canvas.addEventListener('pointermove', sendInput)
  window.addEventListener('pointerup', sendInput)

  // PRESENT ON THE VERTICAL BLANK. A frame's commands are held and drawn in
  // the page's own animation frame, so every frame lands on a screen refresh.
  // Batches are applied in order, all of them, because a batch can create
  // objects a later one uses.
  //
  // ONE FRAME PER REFRESH, FROM A SHORT QUEUE. The host keeps a frame or two
  // in hand, so a slow round trip to Python empties the queue instead of
  // showing as a skipped refresh. If the queue ever runs long, it is caught up
  // so latency cannot grow.
  const pending = []
  let scheduled = false
  const abs = () => performance.timeOrigin + performance.now()
  function present() {
    scheduled = false
    if (!pending.length) return
    while (pending.length > 2) applyBatch(pending.shift())
    applyBatch(pending.shift())
    if (pending.length) { scheduled = true; requestAnimationFrame(present) }
  }
  function applyBatch(b) {
    timing = b.at ? { deliver: b.recv - b.at, wait: abs() - b.recv } : null
    apply(b.cmds)
  }

  const observer = new ResizeObserver(size)
  observer.observe(canvas)
  size()

  return {
    /** Queue one frame's commands; drawn on the next refresh. */
    push(cmds, at) {
      if (images && cmds) swapStrings(cmds, images)
      pending.push({ cmds: cmds || [], at, recv: at ? abs() : 0 })
      if (!scheduled) { scheduled = true; requestAnimationFrame(present) }
    },
    get size() { return { width: cssW, height: cssH, pixel_ratio: dpr } },
    /** Frames waiting for a refresh. */
    get waiting() { return pending.length },
    destroy() {
      observer.disconnect()
      window.removeEventListener('keydown', sendInput)
      window.removeEventListener('keyup', sendInput)
      window.removeEventListener('pointerup', sendInput)
      H.clear()
    },
  }
}

// ---------------------------------------------------------------- a single-file page
//
// `pymations build scene.py -o scene.html` writes one HTML file. What a folder
// would hold beside the page comes inside it instead, as JSON in
// <script type="application/json" id="pymations-inline">:
//   {runtime, anim, sources: {path: text}, files: {path: base64},
//    engine: {js, katex, katexCss, opentype, fonts: {name: base64}}}

let inlineData
function inline() {
  if (inlineData === undefined) {
    inlineData = null
    try {
      const el = typeof document !== 'undefined' && document.getElementById('pymations-inline')
      if (el) inlineData = JSON.parse(el.textContent)
    } catch (e) { /* not a single-file page */ }
  }
  return inlineData
}

function fromBase64(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// ---------------------------------------------------------------- the animation engine
//
// engine/anim.js sets window.__cirAnim when it runs, and loads KaTeX,
// opentype.js and the fonts from the folder in window.__cirAnimBase as it
// needs them. Each scene runs the bundle once for an engine of its own, so
// scenes on one page never share a timeline.

const ENGINE_BASE = new URL('engine/', BASE).href

let unpacked = false
/**
 * A single-file page carries the engine's helpers inside it: KaTeX and
 * opentype.js run as page scripts (the engine finds them as globals), KaTeX's
 * stylesheet has its fonts inline, and the engine's requests for font files
 * are answered from the packed copies.
 */
function unpackEngine(eng) {
  if (unpacked) return
  unpacked = true
  const script = (text) => { const s = document.createElement('script'); s.textContent = text; document.head.appendChild(s) }
  if (eng.katexCss) { const st = document.createElement('style'); st.textContent = eng.katexCss; document.head.appendChild(st) }
  if (eng.katex && !window.katex) script(eng.katex)
  if (eng.opentype && !window.opentype) script(eng.opentype)
  const fonts = eng.fonts || {}
  const prefix = ENGINE_BASE + 'fonts/'
  const pageFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input)
    if (url.startsWith(prefix)) {
      const b64 = fonts[decodeURIComponent(url.slice(prefix.length))]
      if (b64 != null) return Promise.resolve(new Response(fromBase64(b64), { headers: { 'Content-Type': 'font/ttf' } }))
    }
    return pageFetch(input, init)
  }
}

let engineText = null
function loadEngineText() {
  if (!engineText) {
    const inl = inline()
    if (inl && inl.engine) {
      unpackEngine(inl.engine)
      engineText = Promise.resolve(inl.engine.js)
    } else {
      engineText = fetch(ENGINE_BASE + 'anim.js').then((r) => {
        if (!r.ok) throw new Error('engine/anim.js was not found beside pymations.js')
        return r.text()
      })
    }
    engineText.catch(() => { engineText = null })
  }
  return engineText
}

/** A new animation engine. */
export async function createEngine() {
  const text = await loadEngineText()
  window.__cirAnimBase = ENGINE_BASE
  window.__cirAnim = null
  // eslint-disable-next-line no-new-func
  new Function(text)()
  const engine = window.__cirAnim
  if (!engine) throw new Error('the animation engine did not start')
  return engine
}

// ---------------------------------------------------------------- transports
//
// A transport runs the Python half somewhere: start(source, info) and
// tick(payload) resolve to the runtime's JSON reply text; stop() ends the run.

/** Python in your own CPython, behind `pymations run` (one worker per scene). */
export function websocketTransport(src) {
  const url = new URL('/_pymations/ws', location.href)
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('src', new URL(src, location.href).pathname)
  const ws = new WebSocket(url)
  let nextId = 1
  const waiting = new Map()
  let closed = null
  const opened = new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('Could not reach the pymations server.'))
  })
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.type === 'reload') { location.reload(); return }
    const w = waiting.get(m.id)
    if (!w) return
    waiting.delete(m.id)
    if (m.error) w.reject(new Error(m.error))
    else w.resolve(m.reply)
  }
  ws.onclose = () => {
    closed = new Error('The pymations server has stopped. Start it again with  pymations run')
    for (const w of waiting.values()) w.reject(closed)
    waiting.clear()
  }
  async function call(msg) {
    await opened
    if (closed) throw closed
    const id = nextId++
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, ...msg }))
    })
  }
  return {
    label: 'your Python',
    start: (_source, info) => call({ op: 'start', info }),
    tick: (payload) => call({ op: 'tick', payload }),
    stop: async () => { try { ws.close() } catch (e) { /* already closed */ } },
    log: (text) => { if (ws.readyState === 1) ws.send(JSON.stringify({ op: 'log', text })) },
  }
}

// The Python that hosts scenes in Pyodide: every scene gets its own copy of
// the runtime (as the module `pyctures`) and of the animation module (as
// `pymations`, and `manim` for pasted scripts), made current for the length
// of each call, so scenes cannot see each other.
const PY_HOST = `
import sys, types
_pymations_scenes = {}
def _pymations_new(sid):
    rt = types.ModuleType('pyctures')
    rt.__file__ = 'pyctures.py'
    exec(compile(__pymations_runtime, 'pyctures.py', 'exec'), rt.__dict__)
    sys.modules['pyctures'] = rt
    an = types.ModuleType('pymations')
    an.__file__ = 'pymations.py'
    exec(compile(__pymations_anim, 'pymations.py', 'exec'), an.__dict__)
    _pymations_scenes[sid] = (rt, an)
def _pymations_call(sid, op, a=None, b=None):
    rt, an = _pymations_scenes[sid]
    sys.modules['pyctures'] = rt
    sys.modules['pymations'] = an
    sys.modules['manim'] = an
    if op == 'start':
        return rt.start(a, b)
    if op == 'tick':
        return rt.tick(a)
    rt.stop()
    _pymations_scenes.pop(sid, None)
    return 'stopped'
`

function pyodideBase() {
  const url = (typeof window !== 'undefined' && window.PYMATIONS_PYODIDE_URL) || PYODIDE_URL
  return new URL(url.replace(/\/?$/, '/'), location.href).href
}

let pythonPromise = null
/** The Python half (the runtime and the module): from a single-file page, or beside this file. */
function loadPython() {
  if (!pythonPromise) {
    const inl = inline()
    const get = (name) => fetch(new URL(name, BASE)).then((r) => {
      if (!r.ok) throw new Error(name + ' was not found beside pymations.js')
      return r.text()
    })
    pythonPromise = inl && inl.runtime
      ? Promise.resolve({ runtime: inl.runtime, anim: inl.anim })
      : Promise.all([get('pyctures.py'), get('pymations.py')]).then(([runtime, anim]) => ({ runtime, anim }))
    pythonPromise.catch(() => { pythonPromise = null })
  }
  return pythonPromise
}

/** The files a scene opens, as [{path, data}], from a single-file page or beside the scene. */
async function readFiles(src, files) {
  const inl = inline()
  const out = []
  for (const f of files) {
    const path = f.split('/').filter((p) => p && p !== '.').join('/')
    let data
    if (inl && inl.files && inl.files[f] != null) {
      data = fromBase64(inl.files[f]).buffer
    } else {
      const res = await fetch(new URL(f, new URL(src, location.href)))
      if (!res.ok) throw new Error(`Could not load ${f} (${res.status})`)
      data = await res.arrayBuffer()
    }
    out.push({ path, data })
  }
  return out
}

/**
 * THE WORKER. Python runs here, off the page's main thread, so a slow frame,
 * Python's garbage collection or a loop that never waits cannot hold up
 * drawing, scrolling or input. It only ever turns a request into a reply
 * (the same JSON the other transports give). This function is the worker's
 * whole code: it is turned into a Blob URL, so a page needs no extra file.
 */
function workerMain() {
  let py = null, booting = null, call = null
  async function boot(m) {
    importScripts(m.pyodide + 'pyodide.js')
    // eslint-disable-next-line no-undef
    py = await loadPyodide({ indexURL: m.pyodide })
    py.globals.set('__pymations_runtime', m.runtime)
    py.globals.set('__pymations_anim', m.anim)
    py.runPython(m.host)
    call = py.globals.get('_pymations_call')
  }
  function writeFiles(files) {
    for (const f of files || []) {
      const parts = f.path.split('/')
      for (let i = 1; i < parts.length; i++) {
        try { py.FS.mkdir(parts.slice(0, i).join('/')) } catch (e) { /* exists */ }
      }
      py.FS.writeFile(f.path, new Uint8Array(f.data))
    }
  }
  self.onmessage = async (ev) => {
    const m = ev.data
    if (m.type === 'boot') { booting = boot(m); booting.catch(() => {}); return }
    let reply = null, error = null
    try {
      try { await booting } catch (e) { throw new Error('Python could not load: ' + ((e && e.message) || e)) }
      if (m.op === 'start') {
        writeFiles(m.files)
        await py.loadPackagesFromImports(m.source)
        py.globals.get('_pymations_new')(m.sid)
        reply = call(m.sid, 'start', m.source, m.info)
      } else if (m.op === 'tick') {
        reply = call(m.sid, 'tick', m.payload)
      } else {
        reply = call(m.sid, 'stop')
      }
    } catch (e) {
      error = String((e && e.message) || e)
    }
    self.postMessage({ id: m.id, reply, error })
  }
}

let pyWorker = null
/**
 * The page's Python worker, started on first use and shared by every scene on
 * the page (one copy of Python). terminate() ends it, for a scene stuck in a
 * loop: every call still waiting is answered with an error marked
 * `restarted`, and the next call starts a fresh worker.
 */
function pythonWorker() {
  if (pyWorker && !pyWorker.dead) return pyWorker
  const url = URL.createObjectURL(new Blob(['(' + workerMain.toString() + ')()'], { type: 'text/javascript' }))
  const w = new Worker(url)
  const waiting = new Map()
  let nextId = 1
  const me = { dead: null }
  const fail = (why) => {
    for (const p of waiting.values()) { const e = new Error(why); e.restarted = true; p.reject(e) }
    waiting.clear()
  }
  w.onmessage = (ev) => {
    const m = ev.data
    const p = waiting.get(m.id)
    if (!p) return
    waiting.delete(m.id)
    if (m.error != null) p.reject(new Error(m.error))
    else p.resolve(m.reply)
  }
  w.onerror = (ev) => {
    ev.preventDefault()
    for (const p of waiting.values()) p.reject(new Error('Python stopped: ' + (ev.message || 'the worker failed')))
    waiting.clear()
  }
  const booted = Promise.all([loadPython(), pyodideBase()]).then(([python, base]) => {
    w.postMessage({ type: 'boot', pyodide: base, runtime: python.runtime, anim: python.anim, host: PY_HOST })
  })
  me.call = async (msg, transfer) => {
    await booted
    if (me.dead) { const e = new Error(me.dead); e.restarted = true; throw e }
    return new Promise((resolve, reject) => {
      const id = nextId++
      waiting.set(id, { resolve, reject })
      w.postMessage({ id, ...msg }, transfer || [])
    })
  }
  me.terminate = (why) => {
    if (me.dead) return
    me.dead = why || 'Python was restarted'
    w.terminate()
    URL.revokeObjectURL(url)
    fail(me.dead)
    if (pyWorker === me) pyWorker = null
  }
  pyWorker = me
  return me
}

let nextSceneId = 1

/**
 * Python in a Web Worker, with Pyodide: what built pages and scenes on a web
 * page use. `files`: extra files to put beside the scene.
 */
export function workerTransport(src, files = []) {
  const sid = nextSceneId++
  let worker = null
  return {
    label: 'Python in a worker',
    async start(source, info) {
      worker = pythonWorker()
      const data = await readFiles(src, files)
      return worker.call({ op: 'start', sid, source, info: JSON.stringify(info), files: data }, data.map((d) => d.data))
    },
    tick(payload) { return worker.call({ op: 'tick', sid, payload: JSON.stringify(payload) }) },
    async stop() {
      if (worker && !worker.dead) { try { await worker.call({ op: 'stop', sid }) } catch (e) { /* not running */ } }
    },
    /** Stop a scene that is stuck in a loop: ends the worker, and Python with it. */
    hardStop() { if (worker) worker.terminate('Python was restarted') },
  }
}

let pyodidePromise = null
/** Pyodide on the page's own thread, loaded once and shared by every scene on it. */
function loadPyodideOnce() {
  if (!pyodidePromise) {
    const base = pyodideBase()
    pyodidePromise = (async () => {
      const [{ loadPyodide }, python] = await Promise.all([import(base + 'pyodide.mjs'), loadPython()])
      const py = await loadPyodide({ indexURL: base })
      py.globals.set('__pymations_runtime', python.runtime)
      py.globals.set('__pymations_anim', python.anim)
      py.runPython(PY_HOST)
      return py
    })()
  }
  return pyodidePromise
}

/**
 * Python on the page's own thread, with Pyodide: for a browser without
 * workers, or `data-pymations-worker="off"`. A slow frame here holds up the
 * page, so the worker is the better choice wherever it is available.
 */
export function pyodideTransport(src, files = []) {
  const sid = nextSceneId++
  let py = null, callPy = null
  return {
    label: 'Python in the page',
    async start(source, info) {
      py = await loadPyodideOnce()
      callPy = py.globals.get('_pymations_call')
      for (const f of await readFiles(src, files)) {
        const parts = f.path.split('/')
        for (let i = 1; i < parts.length; i++) {
          try { py.FS.mkdir(parts.slice(0, i).join('/')) } catch (e) { /* exists */ }
        }
        py.FS.writeFile(f.path, new Uint8Array(f.data))
      }
      await py.loadPackagesFromImports(source)
      py.globals.get('_pymations_new')(sid)
      return callPy(sid, 'start', source, JSON.stringify(info))
    },
    async tick(payload) { return callPy(sid, 'tick', JSON.stringify(payload)) },
    async stop() { if (callPy) { try { callPy(sid, 'stop') } catch (e) { /* not running */ } } },
  }
}

// ---------------------------------------------------------------- the page around a scene

const STYLE = `
.pymations-scene{position:relative;overflow:hidden;color-scheme:dark}
.pymations-scene>canvas{position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:none;-webkit-user-select:none;user-select:none}
.pymations-cover{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:14px system-ui,sans-serif;color:#9aa3b2;pointer-events:none}
.pymations-error{position:absolute;inset:0;overflow:auto;padding:20px;box-sizing:border-box;background:rgba(20,10,14,.94);color:#f3f4f6;font:14px system-ui,sans-serif}
.pymations-error h2{margin:0 0 12px;font-size:17px;color:#ff8a8a}
.pymations-error pre{margin:0 0 14px;padding:12px;background:#0b0b0f;border-radius:6px;overflow:auto;font:12.5px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre}
.pymations-error .bad{background:#5a1d26;display:inline-block;min-width:100%}
.pymations-error button,.pymations-stuck button{font:inherit;background:#2a2f3a;color:#f3f4f6;border:1px solid #3a4150;border-radius:6px;padding:4px 12px;cursor:pointer}
.pymations-output{position:absolute;left:0;right:0;bottom:0;max-height:35%;overflow:auto;margin:0;padding:8px 12px;background:rgba(11,11,15,.88);color:#d1d5db;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap}
.pymations-output .err{color:#ff8a8a}.pymations-output .info{color:#9aa3b2}
.pymations-stuck{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);z-index:3;display:flex;gap:12px;align-items:center;max-width:calc(100% - 32px);box-sizing:border-box;padding:10px 14px;border-radius:8px;background:rgba(20,10,14,.92);color:#f3f4f6;font:13px system-ui,sans-serif}
.pymations-anim{pointer-events:none;z-index:1}
.pymations-cover,.pymations-output{z-index:2}.pymations-error{z-index:4}
.pymations-bar{position:absolute;left:8px;right:8px;bottom:8px;z-index:2;display:flex;align-items:center;gap:10px;padding:4px 10px 4px 4px;border-radius:8px;background:rgba(11,11,15,.8);color:#e5e7eb;font:12px ui-monospace,Menlo,Consolas,monospace;transition:opacity .2s}
.pymations-bar.hide{opacity:0;pointer-events:none}
.pymations-play{flex:none;width:30px;height:30px;padding:7px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
.pymations-play:hover{background:rgba(255,255,255,.12)}
.pymations-play svg{display:block;width:100%;height:100%;fill:currentColor}
.pymations-track{position:relative;flex:1;height:24px;cursor:pointer;touch-action:none}
.pymations-track::before{content:'';position:absolute;left:0;right:0;top:10px;height:4px;border-radius:2px;background:rgba(255,255,255,.22)}
.pymations-fill{position:absolute;left:0;top:10px;height:4px;border-radius:2px;background:#58c4dd}
.pymations-knob{position:absolute;top:6px;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:#fff}
.pymations-ticks i{position:absolute;top:7px;width:2px;height:10px;margin-left:-1px;background:rgba(255,255,255,.65)}
.pymations-time{flex:none;min-width:9.5em;text-align:right;white-space:nowrap}
.pymations-measure{position:absolute;top:6px;left:6px;z-index:2;margin:0;padding:5px 8px;border-radius:6px;background:rgba(0,0,0,.66);color:#e5e7eb;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre;pointer-events:none}
`
let styled = false
function addStyle() {
  if (styled) return
  styled = true
  const s = document.createElement('style')
  s.textContent = STYLE
  document.head.appendChild(s)
}

function measureSwitch(el) {
  if (el && el.hasAttribute('data-pymations-measure') && el.getAttribute('data-pymations-measure') !== '0') return true
  try {
    if (new URLSearchParams(location.search).get('measure') === '1') return true
    return localStorage.getItem(MEASURE_KEY) === '1'
  } catch (e) { return false }
}

let activeScene = null

// ---------------------------------------------------------------- the animation player

const ICON_PLAY = '<svg viewBox="0 0 16 16"><path d="M4 2.5l9.5 5.5L4 13.5z"/></svg>'
const ICON_PAUSE = '<svg viewBox="0 0 16 16"><rect x="3.5" y="2.5" width="3.2" height="11" rx="1"/><rect x="9.3" y="2.5" width="3.2" height="11" rx="1"/></svg>'
const LOOP_HOLD_MS = 1500

function clock(s) {
  s = Math.max(0, s)
  const m = Math.floor(s / 60), r = s - m * 60
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1)
}

/**
 * THE PLAYER: the timeline's clock for one scene. It draws the engine's
 * picture at time t on its own canvas (above the program's), advancing t with
 * the page's refreshes while playing, and keeps the scrubber in step.
 *
 * What is on the timeline plays at once. Work the engine still has queued
 * (fonts, equation outlines) only adds to the END of it, so the clock waits
 * only when it reaches the end while the engine is busy ("Loading…"). At the
 * end it stops, unless Python is still live (a draw() loop may add more) or
 * the scene loops.
 */
class Player {
  constructor(scene, engine) {
    this.scene = scene
    this.engine = engine
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'pymations-anim'
    this.canvas.setAttribute('aria-hidden', 'true')
    scene.el.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')
    this.tick = this.tick.bind(this)
    this.errors = Object.create(null)
    this.reset()
    this.observer = new ResizeObserver(() => { this.drawn = ''; this.draw() })
    this.observer.observe(this.canvas)
    if (scene.opt.controls !== false) this.makeBar()
    this.onKey = (e) => this.key(e)
    window.addEventListener('keydown', this.onKey)
  }

  /** A new run. Python's first command resets the engine itself. */
  reset() {
    cancelAnimationFrame(this.raf)
    Object.assign(this, {
      t: 0, playing: false, started: false, starting: false, waiting: false, last: 0, raf: 0,
      holdUntil: 0, readyVersion: -1, waitingVersion: -1, drawn: '',
    })
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    if (this.bar) this.hideBar()
  }

  get duration() { return +this.engine.duration || 0 }

  /**
   * What Python is told with each frame: the timeline time drawn now and the
   * value trackers' values at it, for updaters that run in Python and for
   * reading a tracker inside a draw() loop.
   */
  timeInfo() {
    const e = this.engine
    let v = {}
    try { v = (e.values_at || e.trackerValues || (() => ({}))).call(e, this.t) || {} } catch (err) { /* between runs */ }
    return { anim_t: this.t, anim_v: v }
  }

  /** Stop the clock (the run was stopped); the picture stays. */
  halt() {
    this.playing = false
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.updateBar()
  }

  destroy() {
    this.halt()
    this.observer.disconnect()
    window.removeEventListener('keydown', this.onKey)
    this.canvas.remove()
    if (this.bar) this.bar.remove()
  }

  engineReady() {
    const v = this.engine.version
    if (this.readyVersion === v) return true
    if (this.waitingVersion !== v) {
      this.waitingVersion = v
      const done = () => { this.readyVersion = v; this.takeErrors(); this.kick() }
      Promise.resolve().then(() => this.engine.ready()).then(done, done)
    }
    return false
  }

  takeErrors() {
    for (const msg of this.engine.takeErrors ? this.engine.takeErrors() : []) this.report(msg)
  }

  report(msg) {
    msg = 'animation: ' + msg
    if (this.errors[msg]) return
    this.errors[msg] = 1
    this.scene.errors.push(msg)
    this.scene.log('err', msg)
  }

  draw() {
    const dpr = window.devicePixelRatio || 1
    const r = this.canvas.getBoundingClientRect()
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h }
    const e = this.engine
    const key = this.t + '|' + e.version + '|' + w + 'x' + h
    if (key === this.drawn) return
    this.drawn = key
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.clearRect(0, 0, w, h)
    if (!e.hasContent) return
    // The engine's background goes behind the program's canvas, which stays
    // transparent until the program draws.
    if (e.background && this.scene.el.style.background !== e.background) this.scene.el.style.background = e.background
    try { e.renderAt(this.ctx, this.t, w, h) } catch (err) { this.report((err && err.message) || String(err)) }
  }

  kick() {
    if (!this.raf && this.started) this.raf = requestAnimationFrame(this.tick)
  }

  tick(now) {
    this.raf = 0
    const scene = this.scene
    if (!scene.visible || document.hidden) return   // scene.resume() starts it again
    const dur = this.duration
    this.waiting = false
    if (this.playing) {
      if (this.holdUntil) {
        if (now >= this.holdUntil) { this.holdUntil = 0; this.t = 0; this.last = now }
      } else {
        if (this.last) this.t += Math.min(0.1, (now - this.last) / 1000)
        this.last = now
        if (this.t >= dur) {
          this.t = dur
          if (!this.engineReady()) this.waiting = true
          else if (scene.r.live) { /* Python may add more: wait at the end */ }
          else if (scene.opt.loop && dur > 0) this.holdUntil = now + LOOP_HOLD_MS
          else { this.playing = false; this.showBar() }
        }
      }
    }
    this.draw()
    this.updateBar()
    if (this.playing) this.kick()
  }

  /** After each batch of commands is applied: the first content starts the clock. */
  afterBatch() {
    this.takeErrors()
    if (!this.started && this.engine.hasContent) {
      this.started = true
      this.playing = this.scene.opt.autoplay !== false
      this.last = 0
      if (!this.playing) this.showBar()
    }
    // Nothing to show yet because the first thing is still being made (a
    // text waiting for its font): start when it is.
    if (!this.started && !this.starting) {
      this.starting = true
      Promise.resolve().then(() => this.engine.ready()).then(() => {
        this.starting = false
        if (!this.started && this.engine.hasContent) this.afterBatch()
        else this.takeErrors()
      }, () => { this.starting = false })
    }
    if (this.playing) this.kick()
    else { this.draw(); this.updateBar() }
  }

  setPlaying(on) {
    if (on && this.t >= this.duration) this.t = 0
    this.playing = on
    this.waiting = false
    this.holdUntil = 0
    this.last = 0
    this.started = this.started || this.engine.hasContent
    this.kick()
    this.updateBar()
  }

  seek(t) {
    this.t = Math.max(0, Math.min(this.duration, t))
    this.last = 0
    this.holdUntil = 0
    this.draw()
    this.updateBar()
  }

  // Space plays and pauses, the arrow keys step 5 seconds: only while this
  // scene has the keyboard and Python is not reading it.
  key(e) {
    if (activeScene !== this.scene || this.scene.r.live || !this.started) return
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); this.setPlaying(!this.playing) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); this.seek(this.t - 5) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); this.seek(this.t + 5) }
    else return
    this.showBar()
  }

  // ---- The scrubber: play/pause, the track with a tick per section, the
  // time. Shown while paused, and on hover or a tap while playing; only for a
  // timeline that has length.
  makeBar() {
    const bar = document.createElement('div')
    bar.className = 'pymations-bar hide'
    bar.innerHTML = '<button type="button" class="pymations-play" aria-label="Play"></button>' +
      '<div class="pymations-track" role="slider" aria-label="Time" tabindex="-1"><div class="pymations-fill"></div>' +
      '<div class="pymations-ticks"></div><div class="pymations-knob"></div></div><span class="pymations-time"></span>'
    this.scene.el.appendChild(bar)
    this.bar = bar
    this.play = bar.querySelector('.pymations-play')
    this.track = bar.querySelector('.pymations-track')
    this.fill = bar.querySelector('.pymations-fill')
    this.knob = bar.querySelector('.pymations-knob')
    this.ticks = bar.querySelector('.pymations-ticks')
    this.time = bar.querySelector('.pymations-time')
    this.icon = ''
    this.ticksKey = ''
    let over = false, dragging = false, wasPlaying = false
    this.barBusy = () => over || dragging
    // The scrubber's own pointer events are not the program's input.
    const swallow = (e) => e.stopPropagation()
    bar.addEventListener('pointerdown', swallow)
    bar.addEventListener('pointerup', swallow)
    bar.addEventListener('pointerenter', () => { over = true })
    bar.addEventListener('pointerleave', () => { over = false })
    this.play.addEventListener('click', (e) => { e.stopPropagation(); this.setPlaying(!this.playing); this.showBar() })
    const seekTo = (x) => {
      const r = this.track.getBoundingClientRect()
      this.seek(r.width ? ((x - r.left) / r.width) * this.duration : 0)
    }
    this.track.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      dragging = true
      wasPlaying = this.playing
      this.playing = false
      try { this.track.setPointerCapture(e.pointerId) } catch (x) { /* not capturable */ }
      seekTo(e.clientX)
    })
    this.track.addEventListener('pointermove', (e) => { if (dragging) seekTo(e.clientX) })
    const end = (e) => {
      if (!dragging) return
      e.stopPropagation()
      dragging = false
      if (wasPlaying && this.t < this.duration) this.setPlaying(true)
      else this.updateBar()
      this.showBar()
    }
    this.track.addEventListener('pointerup', end)
    this.track.addEventListener('pointercancel', end)
    this.scene.el.addEventListener('pointermove', () => this.showBar())
    this.scene.el.addEventListener('pointerdown', () => this.showBar())
  }

  showBar() {
    if (!this.bar || !(this.duration > 0)) return
    // Above the printed output, when the scene shows it.
    const out = this.scene.outEl
    this.bar.style.bottom = (out && out.offsetHeight ? out.offsetHeight + 8 : 8) + 'px'
    this.bar.classList.remove('hide')
    clearTimeout(this.hideTimer)
    const hide = () => {
      if (!this.playing || this.barBusy()) { this.hideTimer = setTimeout(hide, 800); return }
      this.bar.classList.add('hide')
    }
    this.hideTimer = setTimeout(hide, 2500)
  }

  hideBar() {
    clearTimeout(this.hideTimer)
    this.bar.classList.add('hide')
  }

  updateBar() {
    if (!this.bar) return
    const dur = this.duration
    const f = dur > 0 ? Math.min(1, this.t / dur) : 0
    this.fill.style.width = (f * 100) + '%'
    this.knob.style.left = (f * 100) + '%'
    this.track.setAttribute('aria-valuenow', this.t.toFixed(1))
    this.track.setAttribute('aria-valuemax', dur.toFixed(1))
    this.time.textContent = this.waiting ? 'Loading…' : clock(this.t) + ' / ' + clock(dur)
    const icon = this.playing ? 'pause' : 'play'
    if (icon !== this.icon) {
      this.icon = icon
      this.play.innerHTML = this.playing ? ICON_PAUSE : ICON_PLAY
      this.play.setAttribute('aria-label', this.playing ? 'Pause' : 'Play')
    }
    const secs = this.engine.sections || []
    const key = dur + '|' + secs.map((s) => s.name + '@' + s.t).join(',')
    if (key !== this.ticksKey) {
      this.ticksKey = key
      this.ticks.textContent = ''
      for (const s of secs) {
        if (!(dur > 0) || !(s.t > 0) || s.t >= dur) continue
        const i = document.createElement('i')
        i.style.left = (s.t / dur * 100) + '%'
        i.title = s.name
        this.ticks.appendChild(i)
      }
    }
  }
}


/**
 * One scene on the page, in `el`. Options:
 *   src         the scene's .py file (a URL, relative to the page)
 *   transport   from websocketTransport() or pyodideTransport()
 *   fullPage    the scene is the whole page: it has the keyboard from the start
 *   output      'panel' shows printed text over the scene; otherwise the console
 *   background  the colour behind the canvas (an animation's own background wins)
 *   autoStart   false: wait for scene.start()
 *   autoplay    false: an animation waits for its play button
 *   loop        true: an animation starts again after its end
 *   controls    false: no scrubber
 *   makeTransport  a function that makes a fresh transport for each run
 */
export class Scene {
  constructor(el, options) {
    addStyle()
    this.el = el
    this.opt = Object.assign({ output: 'console', background: '#0b0b0f', autoStart: true }, options)
    this.name = decodeURIComponent((this.opt.src || 'scene.py').split('/').pop())
    this.status = 'idle'
    this.errors = []
    this.r = {
      token: 0, live: false, busy: false, busySince: 0, warnedStuck: false, missedRefresh: false,
      sent: 0, shown: 0, clock: 0, period: 1000 / 60, lastRaf: 0, raf: 0,
      events: [], reads: {}, size: { width: 0, height: 0, pixel_ratio: 1 },
      measuring: false, measureSince: 0, lastShown: 0,
      acc: { frames: 0, shown: 0, missed: 0, worst: 0, cmds: 0, ms: {} },
    }
    this.visible = false
    el.classList.add('pymations-scene')
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
    if (!this.opt.fullPage && el.clientHeight === 0) el.style.aspectRatio = el.style.aspectRatio || '16 / 9'
    if (!el.style.background) el.style.background = this.opt.background
    el.pymationsScene = this
    if (this.opt.fullPage) activeScene = this

    // Start only once the scene is on screen, and pause while it is not.
    this.io = new IntersectionObserver((entries) => {
      const seen = entries[entries.length - 1].isIntersecting
      if (seen === this.visible) return
      this.visible = seen
      if (seen && this.status === 'idle' && this.opt.autoStart) this.start()
      else if (seen) this.resume()
    }, { rootMargin: '100px' })
    this.io.observe(el)
    this.onVisibility = () => { if (!document.hidden) this.resume() }
    document.addEventListener('visibilitychange', this.onVisibility)
    this.loop = this.loop.bind(this)
  }

  // -------- output
  log(kind, text, line) {
    if (!text) return
    text = String(text).replace(/\n$/, '')
    if (kind === 'err') console.error(`[${this.name}] ${text}`)
    else if (kind === 'info') console.info(`[${this.name}] ${text}`)
    else console.log(text)
    if (kind !== 'out' && this.transport && this.transport.log) this.transport.log(text)
    if (this.opt.output !== 'panel') return
    if (!this.outEl) {
      this.outEl = document.createElement('pre')
      this.outEl.className = 'pymations-output'
      this.el.appendChild(this.outEl)
    }
    const span = document.createElement('span')
    span.className = kind
    span.textContent = text + '\n'
    this.outEl.appendChild(span)
    while (this.outEl.childNodes.length > 400) this.outEl.removeChild(this.outEl.firstChild)
    this.outEl.scrollTop = this.outEl.scrollHeight
  }

  setStatus(s) {
    this.status = s
    this.el.dataset.pymationsStatus = s
    this.el.dispatchEvent(new CustomEvent('pymations-status', { detail: { status: s } }))
  }

  cover(text) {
    if (!this.coverEl) {
      this.coverEl = document.createElement('div')
      this.coverEl.className = 'pymations-cover'
      this.el.appendChild(this.coverEl)
    }
    this.coverEl.textContent = text || ''
    this.coverEl.style.display = text ? '' : 'none'
  }

  showError(message, line) {
    const box = document.createElement('div')
    box.className = 'pymations-error'
    const h = document.createElement('h2')
    h.textContent = line ? `Error on line ${line} of ${this.name}` : `Error in ${this.name}`
    box.appendChild(h)
    const pre = document.createElement('pre')
    pre.textContent = message
    box.appendChild(pre)
    const lines = (this.source || '').split('\n')
    if (line && lines[line - 1] !== undefined) {
      const code = document.createElement('pre')
      for (let n = Math.max(1, line - 3); n <= Math.min(lines.length, line + 3); n++) {
        const row = document.createElement('span')
        row.textContent = String(n).padStart(4) + '  ' + lines[n - 1]
        if (n === line) row.className = 'bad'
        code.appendChild(row)
        code.appendChild(document.createTextNode('\n'))
      }
      box.appendChild(code)
    }
    const again = document.createElement('button')
    again.textContent = 'Run again'
    again.onclick = () => this.start()
    box.appendChild(again)
    this.errorEl = box
    this.el.appendChild(box)
    this.el.dataset.pymationsError = (line ? `line ${line}: ` : '') + message.split('\n').pop()
  }

  // -------- running
  async start() {
    await this.stop()
    const r = this.r
    const token = ++r.token
    if (!this.transport) this.transport = this.opt.makeTransport ? this.opt.makeTransport() : this.opt.transport
    this.setStatus('starting')
    if (this.errorEl) { this.errorEl.remove(); this.errorEl = null }
    if (this.outEl) this.outEl.textContent = ''
    delete this.el.dataset.pymationsError
    Object.assign(r, { events: [], reads: {}, busy: false, warnedStuck: false, sent: 0, shown: 0, clock: 0, lastRaf: 0 })
    this.cover('Starting Python…')
    try {
      const inl = inline()
      if (this.source == null && inl && inl.sources && inl.sources[this.opt.src] != null) this.source = inl.sources[this.opt.src]
      if (this.source == null) {
        const res = await fetch(this.opt.src, { cache: 'no-store' })
        if (!res.ok) throw new Error(`Could not load ${this.opt.src} (${res.status})`)
        this.source = await res.text()
      }
      const source = this.source
      // The animation engine, only for a file that imports the module. One
      // per scene, kept across runs, so fonts and equations are made once.
      let engine = null
      if (ANIM_IMPORT.test(source)) {
        this.cover('Loading the animation engine…')
        engine = this.engine || (this.engine = await createEngine())
      }
      if (token !== r.token) return
      // A fresh canvas for every run: an empty handle table, and no context
      // left over from the last run (a canvas keeps whichever it made first).
      if (this.canvas) this.canvas.remove()
      this.canvas = document.createElement('canvas')
      this.canvas.tabIndex = 0
      this.canvas.setAttribute('aria-label', this.name)
      this.el.insertBefore(this.canvas, this.el.firstChild)
      this.canvas.addEventListener('pointerdown', () => { activeScene = this })
      this.canvas.addEventListener('focus', () => { activeScene = this })
      if (engine) {
        if (!this.player) this.player = new Player(this, engine)
        this.player.reset()
      }
      this.cover('Starting Python…')
      this.renderer = createRenderer(this.canvas, {
        anim: engine,
        images: imageResolver(this.opt.src, inl && inl.files),
        hooks: {
          onEvent: (e) => { if (r.live) r.events.push(e) },
          onSize: (s) => { r.size = s },
          onApplied: (d) => { this.applied(d); if (this.player) this.player.afterBatch() },
          onReads: (reads) => { if (r.live) Object.assign(r.reads, reads) },
          isActive: () => activeScene === this,
        },
      })
      r.measuring = measureSwitch(this.el)
      this.watch()
      r.acc = { frames: 0, shown: 0, missed: 0, worst: 0, cmds: 0, ms: {} }
      r.lastShown = 0
      r.busy = true
      r.busySince = performance.now()
      this.setStatus('running')
      const info = { ...r.size, measure: r.measuring }
      if (this.player) Object.assign(info, { anim_t: 0, anim_v: {} })
      const text = await this.transport.start(source, info)
      r.busy = false
      if (r.warnedStuck) this.unstuck()
      if (token !== r.token) return
      this.cover('')
      if (this.handleReply(JSON.parse(text), token)) {
        r.live = true
        r.measureSince = performance.now()
        r.raf = requestAnimationFrame(this.loop)
      }
    } catch (error) {
      if (token !== r.token) return
      r.busy = false
      if (error && error.restarted) { this.start(); return }   // another scene restarted Python
      this.cover('')
      const msg = String((error && error.message) || error)
      this.log('err', msg)
      this.showError(msg, 0)
      this.setStatus('error')
    }
  }

  async stop() {
    const r = this.r
    const wasBusy = r.busy
    r.token++
    r.live = false
    cancelAnimationFrame(r.raf)
    this.unwatch()
    if (this.player) this.player.halt()
    if (this.status === 'running' || this.status === 'starting') this.setStatus('stopped')
    if (this.renderer) { this.renderer.destroy(); this.renderer = null }
    if (this.transport) {
      // Python in the middle of a frame cannot be asked to stop: a worker is
      // ended instead (and started afresh on the next run).
      if (wasBusy && this.transport.hardStop) this.transport.hardStop()
      else {
        try {
          await Promise.race([this.transport.stop(), new Promise((res) => setTimeout(res, 1000))])
        } catch (e) { /* best effort */ }
      }
      // A WebSocket transport is one run; make a new one next time.
      if (this.opt.makeTransport) this.transport = null
    }
    r.busy = false
  }

  /** Remove the scene from the page for good. */
  async destroy() {
    await this.stop()
    this.io.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    if (this.canvas) this.canvas.remove()
    if (this.player) { this.player.destroy(); this.player = null }
  }

  // THE WATCHDOG. Python runs off the page's thread, so the page can still
  // notice when a frame (or the file's top level) has not come back for a
  // few seconds, say why, and offer to stop it.
  watch() {
    this.unwatch()
    this.watchdog = setInterval(() => {
      const r = this.r
      if (r.busy && !r.warnedStuck && performance.now() - r.busySince > STUCK_MS) {
        r.warnedStuck = true
        this.log('info', 'Python has not finished a frame for 3 seconds. A loop that never awaits frame() holds it.')
        this.showStuck()
      }
    }, 500)
  }

  unwatch() {
    clearInterval(this.watchdog)
    this.watchdog = 0
    this.unstuck()
  }

  showStuck() {
    if (this.stuckEl) return
    const box = document.createElement('div')
    box.className = 'pymations-stuck'
    const text = document.createElement('span')
    text.textContent = 'Python has not finished a frame for 3 seconds. Is there a loop that never waits?'
    const btn = document.createElement('button')
    btn.textContent = 'Stop'
    btn.onclick = () => this.halt()
    box.appendChild(text)
    box.appendChild(btn)
    this.stuckEl = box
    this.el.appendChild(box)
  }

  unstuck() {
    this.r.warnedStuck = false
    if (this.stuckEl) { this.stuckEl.remove(); this.stuckEl = null }
  }

  /** Stop a scene that is stuck, and say so. */
  async halt() {
    await this.stop()
    const msg = 'Stopped: Python did not finish a frame. A loop that never waits (for example while True: without await frame()) holds it.'
    this.log('err', msg)
    this.showError(msg, 0)
    this.setStatus('error')
  }

  resume() {
    const r = this.r
    if (this.player && this.visible && !document.hidden) this.player.kick()
    if (!r.live || !this.visible || document.hidden) return
    cancelAnimationFrame(r.raf)
    r.clock = 0          // re-anchor: no giant step after a pause
    r.lastRaf = 0
    r.raf = requestAnimationFrame(this.loop)
  }

  applied(d) {
    const r = this.r
    r.shown++
    if (r.measuring) {
      const m = r.acc.ms
      m.draw_in_page = (m.draw_in_page || 0) + (d.ms || 0)
      r.acc.shown++
      r.acc.cmds += d.n || 0
    }
    // A frame left the queue: keep one coming.
    if (r.live && !r.busy) this.requestFrame(performance.now())
    Object.assign(r.reads, d.reads)
    for (const e of d.errors || []) {
      const text = e.line ? `line ${e.line}: ${e.message}` : e.message
      this.errors.push(text)
      this.log('err', text, e.line)
    }
  }

  handleReply(reply, token) {
    const r = this.r
    if (token !== r.token) return false
    if (reply.out) this.log('out', reply.out)
    if (reply.err) this.log('err', reply.err)
    // Always, even an empty frame: the renderer counts frames to pace them.
    r.sent++
    this.renderer.push(reply.cmds || [], r.measuring ? performance.timeOrigin + performance.now() : 0)
    if (reply.error) {
      r.live = false
      this.log('err', reply.error, reply.errorLine || undefined)
      this.showError(reply.error, reply.errorLine || 0)
      this.setStatus('error')
      return false
    }
    if (!reply.running) {
      r.live = false
      this.setStatus('finished')
      return false
    }
    return true
  }

  /** Ask Python for the next frame. At most one is in flight. */
  requestFrame(now) {
    const r = this.r
    if (!r.live || r.busy || document.hidden || !this.visible) return
    // At most two frames in hand: enough to cover an uneven round trip, few
    // enough that input still feels immediate.
    if (r.sent - r.shown >= 2) return
    // THE GAME'S CLOCK ADVANCES ONE REFRESH PER FRAME. Only when Python has
    // truly fallen behind does it jump to real time, so a game never runs in
    // slow motion.
    const period = r.period
    let dt = period / 1000
    if (!r.clock) {
      r.clock = now
    } else {
      r.clock += period
      const behind = now - r.clock
      if (behind > period * 3) {
        dt = Math.min(0.1, (period + behind) / 1000)
        r.clock = now
      } else if (r.clock - now > period * 4) {
        r.clock = now
      }
    }
    r.missedRefresh = false
    const payload = { dt, events: r.events, reads: r.reads, ...r.size, measure: r.measuring }
    if (this.player) Object.assign(payload, this.player.timeInfo())
    r.events = []
    r.reads = {}
    r.busy = true
    r.busySince = now
    const token = r.token
    const t0 = performance.now()
    this.transport.tick(payload).then((text) => {
      if (token !== r.token) return
      r.busy = false
      if (r.warnedStuck) this.unstuck()
      const done = performance.now()
      const parsed = JSON.parse(text)
      if (r.measuring) {
        const m = r.acc.ms
        const python = (parsed.t && parsed.t.python) || 0
        m.round_trip = (m.round_trip || 0) + (done - t0)
        m.bridge = (m.bridge || 0) + Math.max(0, done - t0 - python)
        for (const k in parsed.t || {}) m[k] = (m[k] || 0) + parsed.t[k]
        r.acc.frames++
      }
      if (this.handleReply(parsed, token) && r.missedRefresh) this.requestFrame(done)
    }, (error) => {
      if (token !== r.token) return
      r.busy = false
      r.live = false
      if (error && error.restarted) { this.start(); return }   // another scene restarted Python
      const msg = String((error && error.message) || error)
      this.log('err', msg)
      this.showError(msg, 0)
      this.setStatus('error')
    })
  }

  loop(now) {
    const r = this.r
    if (!r.live) return
    if (!this.visible || document.hidden) { r.raf = 0; return }   // paused; resume() restarts it
    r.raf = requestAnimationFrame(this.loop)
    // The display's refresh period (16.7 ms at 60 Hz, 8.3 at 120), learnt
    // from the animation frames themselves.
    if (r.lastRaf) {
      const delta = now - r.lastRaf
      if (delta > 4 && delta < 40) r.period = r.period * 0.9 + delta * 0.1
    }
    const gap = r.lastRaf ? now - r.lastRaf : 0
    r.lastRaf = now
    if (r.measuring) this.measureTick(now, gap)
    if (r.busy) {
      r.missedRefresh = true
      return
    }
    this.requestFrame(now)
  }

  // MEASURE MODE: add ?measure=1 to the page's address, put
  // data-pymations-measure on the scene's div, or set
  // localStorage['pymations:measure'] = '1'. A box over the scene shows, each
  // second, the frame rate and where the frame time goes; the same summary is
  // logged and kept in window.__pymationsMeasure (and scene.measure).
  //
  // A MISSED REFRESH is a screen refresh that showed no new frame: either an
  // animation frame came with nothing new in the queue, or the page was held
  // so long that whole refreshes went by with no animation frame at all.
  measureTick(now, gap) {
    const r = this.r, a = r.acc
    if (r.shown === r.lastShown) a.missed++
    if (gap > r.period * 1.5) a.missed += Math.round(gap / r.period) - 1
    if (gap > a.worst) a.worst = gap
    r.lastShown = r.shown
    if (now - r.measureSince < 1000) return
    const ms = {}
    for (const k in a.ms) ms[k] = +(a.ms[k] / Math.max(1, k === 'draw_in_page' ? a.shown : a.frames)).toFixed(2)
    const summary = {
      scene: this.name, runtime: (this.transport && this.transport.label) || '',
      fps: Math.round((a.shown * 1000) / (now - r.measureSince)), ms,
      commands: Math.round(a.cmds / Math.max(1, a.shown)), queued: r.sent - r.shown, missedRefreshes: a.missed,
      longestRefresh: +a.worst.toFixed(1),
    }
    this.measure = summary
    window.__pymationsMeasure = summary
    console.info('[pymations measure]', JSON.stringify(summary))
    this.showMeasure(summary)
    r.acc = { frames: 0, shown: 0, missed: 0, worst: 0, cmds: 0, ms: {} }
    r.measureSince = now
  }

  showMeasure(m) {
    if (!this.measureEl) {
      this.measureEl = document.createElement('pre')
      this.measureEl.className = 'pymations-measure'
      this.el.appendChild(this.measureEl)
    }
    const f = (v) => (v == null ? '–' : v.toFixed(1))
    this.measureEl.textContent =
      `${m.fps} fps   missed ${m.missedRefreshes}   longest ${m.longestRefresh.toFixed(0)} ms\n` +
      `python ${f(m.ms.python)} ms   round trip ${f(m.ms.round_trip)} ms\n` +
      `draw ${f(m.ms.draw_in_page)} ms   queued ${m.queued}\n` +
      m.runtime
  }
}

// ---------------------------------------------------------------- embedding

function serverMode() {
  const m = document.querySelector('meta[name="pymations-server"]')
  return !!(m && m.content)
}

/**
 * Show the scene `src` in `el`. Attributes on `el` (all optional):
 *   data-pymations-src         the .py file (required for auto-mount)
 *   data-pymations-files       extra files the scene opens, comma-separated
 *   data-pymations-output      "panel" to show print() over the scene
 *   data-pymations-background  a CSS colour
 *   data-pymations-fullpage    the scene is the whole page
 *   data-pymations-measure     show the measure box (frame rate and timings)
 *   data-pymations-worker      "off" runs Python on the page's own thread
 *   data-pymations-autoplay    "off": an animation waits for its play button
 *   data-pymations-loop        an animation starts again after its end
 *   data-pymations-controls    "off": no scrubber
 */
export function mount(el, options = {}) {
  if (el.pymationsScene) return el.pymationsScene
  const src = options.src || el.dataset.pymationsSrc
  const files = options.files || (el.dataset.pymationsFiles || '').split(',').map((s) => s.trim()).filter(Boolean)
  const server = options.server !== undefined ? options.server : serverMode()
  const worker = options.worker !== undefined ? options.worker
    : el.dataset.pymationsWorker !== 'off' && typeof Worker !== 'undefined'
  const make = () => (server ? websocketTransport(src) : worker ? workerTransport(src, files) : pyodideTransport(src, files))
  const scene = new Scene(el, {
    src,
    fullPage: options.fullPage !== undefined ? options.fullPage : el.hasAttribute('data-pymations-fullpage'),
    output: options.output || el.dataset.pymationsOutput || 'console',
    background: options.background || el.dataset.pymationsBackground || '#0b0b0f',
    autoStart: options.autoStart !== false,
    autoplay: options.autoplay !== undefined ? options.autoplay : el.dataset.pymationsAutoplay !== 'off',
    loop: options.loop !== undefined ? options.loop : el.hasAttribute('data-pymations-loop'),
    controls: options.controls !== undefined ? options.controls : el.dataset.pymationsControls !== 'off',
    makeTransport: make,
  })
  return scene
}

/** Mount every `[data-pymations-src]` element on the page. */
export function mountAll(root = document) {
  return Array.from(root.querySelectorAll('[data-pymations-src]')).map((el) => mount(el))
}

if (typeof document !== 'undefined' && !window.PYMATIONS_NO_AUTO) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountAll())
  else mountAll()
}
