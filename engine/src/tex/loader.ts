/**
 * Lazy loading of KaTeX, its stylesheet, opentype.js and KaTeX's font files,
 * all from one folder (the preview bundle, or node_modules in the test
 * harness). Each is fetched once per page; parsed fonts are kept for the
 * session, so a re-run only outlines strings it has not seen.
 */
import { NET_TIMEOUT_MS, fetchBuffer, loadScriptOnce, versioned } from '../text'


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
  const link = typeof document !== 'undefined' ? document.querySelector<HTMLLinkElement>('link[href*="katex"][rel="stylesheet"]') : null
  if (link) return link.href.replace(/[^/]*$/, '')
  return ''
}

/** A file in the bundle folder, with the host's cache-busting version (text.ts `versioned`, shared with the engine). */
export function assetUrl(path: string): string {
  return versioned(baseUrl() + path)
}

/*
 * Scripts and fonts go through the engine's loaders (text.ts): both fail with
 * a real error after NET_TIMEOUT_MS instead of waiting forever on a hung
 * request, and loadScriptOnce waits on a tag the engine already added rather
 * than adding a second. The maps below keep one load per file; a failure is
 * dropped so the next TeX call tries again.
 */
const scripts = new Map<string, Promise<unknown>>()

function loadScript(path: string, globalName: string): Promise<unknown> {
  let p = scripts.get(path)
  if (!p) {
    p = loadScriptOnce(assetUrl(path), globalName)
    scripts.set(path, p)
    p.catch(() => scripts.delete(path))
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
          const timer = setTimeout(
            () => reject(new Error(`${l.href} did not load within ${NET_TIMEOUT_MS / 1000} s`)),
            NET_TIMEOUT_MS,
          )
          l.rel = 'stylesheet'
          l.href = assetUrl('katex.min.css')
          l.onload = () => {
            clearTimeout(timer)
            resolve()
          }
          l.onerror = () => {
            clearTimeout(timer)
            reject(new Error(`Could not load ${l.href}`))
          }
          document.head.appendChild(l)
        })
    cssPromise.catch(() => (cssPromise = null))
  }
  return cssPromise
}

type Globals = typeof globalThis & { katex?: KatexLike; opentype?: OpentypeLike }

export async function ensureKatex(): Promise<KatexLike> {
  const g = globalThis as Globals
  await Promise.all([ensureCss(), g.katex ? null : loadScript('katex.min.js', 'katex'), ensureOpentype()])
  if (!g.katex) throw new Error('KaTeX did not load')
  return g.katex
}

async function ensureOpentype(): Promise<OpentypeLike> {
  const g = globalThis as Globals
  if (!g.opentype) await loadScript('opentype.min.js', 'opentype')
  if (!g.opentype) throw new Error('opentype.js did not load')
  return g.opentype
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
      const [ot, buf] = await Promise.all([ensureOpentype(), fetchBuffer(assetUrl('fonts/' + file))])
      return ot.parse(buf)
    })()
    fonts.set(file, p)
    p.catch(() => fonts.delete(file))
  }
  return p
}
