/**
 * Text → glyph outlines with opentype.js and the bundled Liberation Sans
 * (SIL OFL 1.1), so Text can be written stroke by stroke and morphed like any
 * shape. opentype.min.js and the font files sit beside anim.js in the bundle
 * folder and load on first use; parsed fonts and outlined strings are cached
 * for the session, so re-running a file outlines only new strings.
 *
 * If the library or a font cannot load (offline, a test in Node), callers get
 * null and fall back to drawing the text with fillText: it still shows, moves
 * and fades, but cannot be drawn stroke by stroke.
 */
import type { Pt, Subpath } from './geometry-types'

/** The few opentype.js members used here. */
interface OtGlyph {
  advanceWidth: number
  path: { commands: Array<{ type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }> }
}
interface OtFont {
  unitsPerEm: number
  charToGlyph(c: string): OtGlyph
  getKerningValue(a: OtGlyph, b: OtGlyph): number
}

export interface GlyphShape {
  char: string
  paths: Subpath[]
}

export interface CharGlyph {
  paths: Subpath[]
  advance: number
  /** Ink box [x0, y0, x1, y1] relative to the pen, or null for a space. */
  box: [number, number, number, number] | null
}

export interface TextOutline {
  glyphs: GlyphShape[]
  width: number
  height: number
}

/**
 * The built-in fonts, all open licence and in the bundle's fonts/ folder:
 * sans = Liberation Sans (SIL OFL), serif = KaTeX Main (SIL OFL, a Computer
 * Modern design), mono = KaTeX Typewriter (SIL OFL; one weight).
 */
const FILES: Record<string, string> = {
  'normal|normal': 'LiberationSans-Regular.ttf',
  'bold|normal': 'LiberationSans-Bold.ttf',
  'normal|italic': 'LiberationSans-Italic.ttf',
  'bold|italic': 'LiberationSans-BoldItalic.ttf',
  'serif:normal|normal': 'KaTeX_Main-Regular.ttf',
  'serif:bold|normal': 'KaTeX_Main-Bold.ttf',
  'serif:normal|italic': 'KaTeX_Main-Italic.ttf',
  'serif:bold|italic': 'KaTeX_Main-BoldItalic.ttf',
  'mono:normal|normal': 'KaTeX_Typewriter-Regular.ttf',
  'mono:bold|normal': 'KaTeX_Typewriter-Regular.ttf',
  'mono:normal|italic': 'KaTeX_Typewriter-Regular.ttf',
  'mono:bold|italic': 'KaTeX_Typewriter-Regular.ttf',
}

/** A font file the script named (a URL after the host resolved it): its own key, whatever the weight. */
export function isFontFile(font: unknown): boolean {
  const f = String(font || '')
  return /\.(ttf|otf|woff2?)(\?|#|$)/i.test(f) || /^(blob:|data:|https?:)/.test(f)
}

/** A font family name → one of the built-ins (system fonts cannot be outlined here). */
export function familyOf(font: unknown): 'sans' | 'serif' | 'mono' {
  const f = String(font || '').toLowerCase()
  if (/mono|courier|consol|menlo|typewriter|code/.test(f)) return 'mono'
  if (/serif/.test(f) && !/sans/.test(f)) return 'serif'
  if (/times|georgia|garamond|roman|palatino|baskerville|cambria|book/.test(f)) return 'serif'
  return 'sans'
}

export function fontKey(weight: unknown, slant: unknown, font?: unknown): string {
  if (font && isFontFile(font)) return 'url:' + String(font)
  const w = String(weight || 'normal').toLowerCase()
  const s = String(slant || 'normal').toLowerCase()
  const bold = w === 'bold' || w === 'heavy' || w === 'ultrabold' || w === 'semibold' || Number(w) >= 600
  const italic = s === 'italic' || s === 'oblique'
  const fam = font ? familyOf(font) : 'sans'
  return `${fam === 'sans' ? '' : fam + ':'}${bold ? 'bold' : 'normal'}|${italic ? 'italic' : 'normal'}`
}

/** The CSS family for the fillText fallback of a font key. */
export function cssFamily(key: string): string {
  if (key.startsWith('url:')) return `"${fontFaceName(key)}", "Liberation Sans", Arial, sans-serif`
  if (key.startsWith('mono:')) return 'Menlo, Consolas, "Liberation Mono", monospace'
  if (key.startsWith('serif:')) return '"KaTeX_Main", "Times New Roman", serif'
  return '"Liberation Sans", Arial, sans-serif'
}

function fontFaceName(key: string): string {
  let h = 0
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0
  return 'pymations-font-' + (h >>> 0).toString(36)
}

let opentypePromise: Promise<any> | null = null

/** Load a classic script once (checks the global first, so two loaders never double up). */
export function loadScriptOnce(url: string, globalName: string): Promise<any> {
  const g = globalThis as any
  if (g[globalName]) return Promise.resolve(g[globalName])
  if (typeof document === 'undefined') return Promise.reject(new Error('no document to load ' + url))
  return new Promise((resolve, reject) => {
    // The TeX outliner loads the same file; wait on its tag rather than add another.
    const file = url.slice(url.lastIndexOf('/') + 1)
    const existing = Array.from(document.scripts).find(s => s.src && s.src.split('?')[0].endsWith('/' + file)) || null
    const el = existing || document.createElement('script')
    const done = () => (g[globalName] ? resolve(g[globalName]) : reject(new Error(globalName + ' did not load')))
    el.addEventListener('load', done)
    el.addEventListener('error', () => reject(new Error('could not load ' + url)))
    if (!existing) {
      el.src = url
      el.async = true
      el.dataset.cirSrc = url
      document.head.appendChild(el)
    }
  })
}

export class TextOutliner {
  private fonts = new Map<string, OtFont | null>()
  private loading = new Map<string, Promise<OtFont | null>>()
  private cache = new Map<string, TextOutline | null>()

  constructor(private base: string | null) {}

  /** The font if it has finished loading; undefined while it has not been tried. */
  font(key: string): OtFont | null | undefined {
    return this.fonts.get(key)
  }

  load(key: string): Promise<OtFont | null> {
    if (this.fonts.has(key)) return Promise.resolve(this.fonts.get(key))
    let p = this.loading.get(key)
    if (p) return p
    p = this.fetchFont(key).then(
      f => { this.fonts.set(key, f); return f },
      () => { this.fonts.set(key, null); return null },
    )
    this.loading.set(key, p)
    return p
  }

  private async fetchFont(key: string): Promise<OtFont | null> {
    if (!this.base || typeof fetch === 'undefined') return null
    if (!opentypePromise) opentypePromise = loadScriptOnce(this.base + 'opentype.min.js', 'opentype')
    const ot = await opentypePromise
    const url = key.startsWith('url:') ? key.slice(4) : this.base + 'fonts/' + FILES[key]
    const res = await fetch(url)
    if (!res.ok) throw new Error('font ' + res.status)
    const buf = await res.arrayBuffer()
    // A font file of the script's own: also a FontFace, so the fillText fallback uses it too.
    if (key.startsWith('url:') && typeof FontFace !== 'undefined' && typeof document !== 'undefined') {
      try {
        const face = new FontFace(fontFaceName(key), buf.slice(0))
        await face.load()
        ;(document as any).fonts.add(face)
      } catch { /* outlines still work */ }
    }
    return ot.parse(buf) as OtFont
  }

  private chars = new Map<string, CharGlyph | null>()

  /**
   * One character, outlined once per (font, size) and kept: its paths sit at
   * the pen origin (baseline y = 0), so a number that changes every frame is
   * laid out by placing cached glyphs, never by outlining again — and the
   * renderer's Path2D cache, keyed by these arrays, is reused too.
   */
  glyph(ch: string, em: number, key: string): CharGlyph | null {
    const ck = `${key}|${em}|${ch}`
    let g = this.chars.get(ck)
    if (g !== undefined) return g
    const font = this.fonts.get(key)
    if (!font) return null
    const k = em / font.unitsPerEm
    const og = font.charToGlyph(ch)
    const paths = ch.trim() ? commandsToPaths(og.path.commands, k, 0, 0) : []
    let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity
    for (const s of paths) for (const p of s.points) {
      y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0])
    }
    g = { paths, advance: og.advanceWidth * k, box: paths.length ? [x0, y0, x1, y1] : null }
    if (this.chars.size > 4000) this.chars.clear()
    this.chars.set(ck, g)
    return g
  }

  /**
   * Outline a string at `em` scene units per em: one entry per visible
   * character (spaces are skipped, like Manim's Text), lines stacked, the
   * whole block centred on the origin. Null if the font is not available.
   */
  /** letterSpacing: extra space after each character, in scene units. */
  outline(str: string, em: number, key: string, lineSpacing = 1.2, letterSpacing = 0): TextOutline | null {
    const ck = `${key}|${em}|${lineSpacing}|${letterSpacing}|${str}`
    if (this.cache.has(ck)) return this.cache.get(ck)
    const font = this.fonts.get(key)
    if (!font) return null
    const k = em / font.unitsPerEm
    const glyphs: GlyphShape[] = []
    const lines = str.split('\n')
    let maxW = 0
    lines.forEach((line, li) => {
      let x = 0
      const y = -li * lineSpacing * em
      let prev: OtGlyph | null = null
      for (const ch of Array.from(line)) {
        const g = font.charToGlyph(ch)
        if (prev) x += font.getKerningValue(prev, g) * k
        if (ch.trim()) glyphs.push({ char: ch, paths: commandsToPaths(g.path.commands, k, x, y) })
        x += g.advanceWidth * k + letterSpacing
        prev = g
      }
      maxW = Math.max(maxW, x)
    })
    // Centre on the ink, as Manim does.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const g of glyphs) for (const s of g.paths) for (const p of s.points) {
      if (p[0] < x0) x0 = p[0]
      if (p[0] > x1) x1 = p[0]
      if (p[1] < y0) y0 = p[1]
      if (p[1] > y1) y1 = p[1]
    }
    if (x0 === Infinity) { x0 = 0; x1 = maxW; y0 = 0; y1 = 0 }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
    for (const g of glyphs) {
      g.paths = g.paths.map(s => ({ points: s.points.map(p => [p[0] - cx, p[1] - cy] as Pt), closed: s.closed }))
    }
    const out = { glyphs, width: x1 - x0, height: y1 - y0 }
    if (this.cache.size > 500) this.cache.clear()
    this.cache.set(ck, out)
    return out
  }
}

/** opentype commands (font units, y up) → cubic subpaths in scene units. */
export function commandsToPaths(cmds: OtGlyph['path']['commands'], k: number, ox: number, oy: number): Subpath[] {
  const out: Subpath[] = []
  let cur: Pt[] | null = null
  const P = (x: number, y: number): Pt => [ox + x * k, oy + y * k]
  const last = () => cur[cur.length - 1]
  const line = (b: Pt) => {
    const a = last()
    cur.push([a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3], [a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3], b)
  }
  const flush = (closed: boolean) => {
    if (cur && cur.length > 1) out.push({ points: cur, closed })
    cur = null
  }
  for (const c of cmds) {
    switch (c.type) {
      case 'M': flush(false); cur = [P(c.x, c.y)]; break
      case 'L': if (cur) line(P(c.x, c.y)); break
      case 'Q': {
        if (!cur) break
        const a = last(), q = P(c.x1, c.y1), b = P(c.x, c.y)
        cur.push([a[0] + (2 / 3) * (q[0] - a[0]), a[1] + (2 / 3) * (q[1] - a[1])], [b[0] + (2 / 3) * (q[0] - b[0]), b[1] + (2 / 3) * (q[1] - b[1])], b)
        break
      }
      case 'C': if (cur) cur.push(P(c.x1, c.y1), P(c.x2, c.y2), P(c.x, c.y)); break
      case 'Z': {
        if (!cur) break
        const a = cur[0], b = last()
        if (Math.abs(a[0] - b[0]) > 1e-9 || Math.abs(a[1] - b[1]) > 1e-9) line([a[0], a[1]])
        flush(true)
        break
      }
    }
  }
  flush(false)
  return out
}
