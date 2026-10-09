/**
 * Lazy loading of KaTeX, its stylesheet, opentype.js and KaTeX's font files,
 * all from one folder (the preview bundle, or node_modules in the test
 * harness). Each is fetched once per page; parsed fonts are kept for the
 * session, so a re-run only outlines strings it has not seen.
 */

/* Just the parts of KaTeX and opentype.js we call; both arrive as globals from <script>. */
export interface KatexLike {
  render(tex: string, el: HTMLElement, opts: Record<string, unknown>): void
}
export interface OtPathCommand {
  type: 'M' | 'L' | 'Q' | 'C' | 'Z'
  x?: number
  y?: number
  x1?: number
  y1?: number
  x2?: number
  y2?: number
}
export interface OtGlyph {
  index: number
  getPath(x: number, y: number, fontSize: number): { commands: OtPathCommand[] }
}
export interface OtFont {
  unitsPerEm: number
  charToGlyph(ch: string): OtGlyph
}
interface OpentypeLike {
  parse(buf: ArrayBuffer): OtFont
}

let base = ''
let baseSet = false

/** Overrides the folder (otherwise globalThis.__cirAnimBase, set by the engine). `base` is the folder URL holding katex.min.js, katex.min.css, opentype.min.js and fonts/. */
export function configureTex(opts: { base: string }): void {
  base = opts.base.endsWith('/') ? opts.base : opts.base + '/'
  baseSet = true
}

function baseUrl(): string {
  if (baseSet) return base
  // The engine publishes the bundle folder here before its first TeX call.
  const g = (globalThis as { __cirAnimBase?: string }).__cirAnimBase
  if (g) return g.endsWith('/') ? g : g + '/'
  // Not configured: fall back to wherever the page loaded KaTeX's stylesheet from.
  const link = document.querySelector<HTMLLinkElement>('link[href*="katex"][rel="stylesheet"]')
  if (link) return link.href.replace(/[^/]*$/, '')
  return ''
}

const scripts = new Map<string, Promise<void>>()

/* Loads a script once. A tag for the same file added by someone else (the engine loads opentype.js for text) is waited on, not duplicated. */
function loadScript(url: string, ready: () => boolean): Promise<void> {
  let p = scripts.get(url)
  if (!p) {
    const file = url.slice(url.lastIndexOf('/') + 1)
    const existing = Array.from(document.scripts).find((s) => s.src && s.src.split('?')[0].endsWith('/' + file))
    p = new Promise<void>((resolve, reject) => {
      if (existing) {
        if (ready()) return resolve()
        existing.addEventListener('load', () => resolve())
        existing.addEventListener('error', () => reject(new Error(`Could not load ${existing.src}`)))
        return
      }
      const s = document.createElement('script')
      s.src = url
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error(`Could not load ${url}`))
      document.head.appendChild(s)
    })
    scripts.set(url, p)
    p.catch(() => scripts.delete(url))
  }
  return p
}

/* True when some stylesheet already styles `.katex` (the app page, or our own link). */
function katexCssPresent(): boolean {
  const probe = document.createElement('span')
  probe.className = 'katex'
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  document.body.appendChild(probe)
  const fam = getComputedStyle(probe).fontFamily
  probe.remove()
  return /KaTeX_Main/.test(fam)
}

let cssPromise: Promise<void> | null = null

function ensureCss(): Promise<void> {
  if (!cssPromise) {
    cssPromise = katexCssPresent()
      ? Promise.resolve()
      : new Promise<void>((resolve, reject) => {
          const l = document.createElement('link')
          l.rel = 'stylesheet'
          l.href = baseUrl() + 'katex.min.css'
          l.onload = () => resolve()
          l.onerror = () => reject(new Error(`Could not load ${l.href}`))
          document.head.appendChild(l)
        })
    cssPromise.catch(() => (cssPromise = null))
  }
  return cssPromise
}

type Win = Window & { katex?: KatexLike; opentype?: OpentypeLike }

export async function ensureKatex(): Promise<KatexLike> {
  const w = window as Win
  await Promise.all([
    ensureCss(),
    w.katex ? null : loadScript(baseUrl() + 'katex.min.js', () => !!w.katex),
    w.opentype ? null : loadScript(baseUrl() + 'opentype.min.js', () => !!w.opentype),
  ])
  if (!w.katex) throw new Error('KaTeX did not load')
  return w.katex
}

/* KaTeX's font files: family → the styles it ships. */
const FILES: Record<string, string[]> = {
  KaTeX_AMS: ['Regular'],
  KaTeX_Caligraphic: ['Regular', 'Bold'],
  KaTeX_Fraktur: ['Regular', 'Bold'],
  KaTeX_Main: ['Regular', 'Bold', 'Italic', 'BoldItalic'],
  KaTeX_Math: ['Italic', 'BoldItalic'],
  KaTeX_SansSerif: ['Regular', 'Bold', 'Italic'],
  KaTeX_Script: ['Regular'],
  KaTeX_Size1: ['Regular'],
  KaTeX_Size2: ['Regular'],
  KaTeX_Size3: ['Regular'],
  KaTeX_Size4: ['Regular'],
  KaTeX_Typewriter: ['Regular'],
}

/** The .ttf file name for a computed family/weight/style, nearest style KaTeX ships. Null for non-KaTeX fonts. */
export function fontFileFor(family: string, bold: boolean, italic: boolean): string | null {
  const styles = FILES[family]
  if (!styles) return null
  const want = bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular'
  const order = [want, bold ? 'Bold' : italic ? 'Italic' : 'Regular', 'Regular', ...styles]
  const style = order.find((s) => styles.includes(s))!
  return `${family}-${style}.ttf`
}

const fonts = new Map<string, Promise<OtFont>>()

export function loadFont(file: string): Promise<OtFont> {
  let p = fonts.get(file)
  if (!p) {
    p = (async () => {
      await ensureKatex()
      const ot = (window as Win).opentype
      if (!ot) throw new Error('opentype.js did not load')
      const res = await fetch(baseUrl() + 'fonts/' + file)
      if (!res.ok) throw new Error(`Could not load font ${file} (${res.status})`)
      return ot.parse(await res.arrayBuffer())
    })()
    fonts.set(file, p)
    p.catch(() => fonts.delete(file))
  }
  return p
}
