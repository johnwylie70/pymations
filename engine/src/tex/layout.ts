/**
 * KaTeX's HTML → outlines, in page px (y down). KaTeX lays the maths out as
 * positioned spans; we render it off screen, then read back where the browser
 * put every glyph, rule and SVG piece, and outline each one:
 *  - glyphs: the character's box (a DOM Range) gives x; a zero-size
 *    inline-block dropped in beside the text gives the exact baseline (its
 *    bottom edge sits on it), so we never guess the browser's ascent metric.
 *    The outline comes from the same KaTeX .ttf via opentype.js.
 *  - rules (fraction bars, overlines, \hline, \boxed): an element's solid
 *    borders, as rectangles. Widths are read from KaTeX's em values, not the
 *    computed px, because browsers round border widths to whole pixels.
 *  - inline SVG (roots, stretchy arrows and braces, wide accents): path data
 *    through the viewBox map, clipped to the overflow:hidden boxes KaTeX uses
 *    to cut long paths to length.
 * Glyphs are emitted in reading order: vlist rows top to bottom (numerator,
 * bar, denominator) and matrices row by row.
 */
import type { Pt, Subpath } from '../geometry-types'
import {
  PathBuilder,
  boundsOf,
  clipSubpathsToRect,
  rectSubpath,
  transformSubpaths,
  viewBoxAffine,
  type Affine,
  type Rect,
} from './geom'
import { parsePathData } from './svg-path'
import { fontFileFor, loadFont, type KatexLike, type OtFont } from './loader'

export interface RawItem {
  part: number
  subpaths: Subpath[]
}

export interface RawLayout {
  items: RawItem[]
  /** KaTeX's em in px (the .katex element's font size). */
  emPx: number
}

interface GlyphJob {
  file: string
  ch: string
  x: number
  baseline: number
  px: number
}

type Rec = { part: number; subpaths?: Subpath[]; glyph?: GlyphJob }

let host: HTMLDivElement | null = null

function getHost(): HTMLDivElement {
  if (host && host.isConnected) return host
  host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText =
    'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;z-index:-1;' +
    'white-space:nowrap;width:max-content;font-size:100px;line-height:normal;' +
    'font-variant-ligatures:none;font-feature-settings:"liga" 0,"clig" 0;'
  document.body.appendChild(host)
  return host
}

const SKIP_CHAR = /[\s​‌‍⁠﻿]/

function partClass(el: Element): number | null {
  for (const c of Array.from(el.classList)) {
    const m = /^cir-p(\d+)$/.exec(c)
    if (m) return +m[1]
  }
  return null
}

/** Length in px of an inline em value like "0.04em" at `fontPx`, else null. */
function emLength(v: string, fontPx: number): number | null {
  const m = /^(-?[\d.]+)em$/.exec(v.trim())
  return m ? parseFloat(m[1]) * fontPx : null
}

function intersect(a: Rect, b: Rect): Rect {
  return { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) }
}

const toRect = (r: DOMRect): Rect => ({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom })

class Walker {
  readonly out: Rec[] = []
  /** Text node → its baseline marker, inserted before measuring. */
  private markers = new Map<Text, HTMLSpanElement>()

  constructor(private root: HTMLElement) {}

  run(): Rec[] {
    // Drop every baseline marker in one go, so the browser lays out once.
    const tw = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT)
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const t = n as Text
      if (!t.data || !Array.from(t.data).some((c) => !SKIP_CHAR.test(c))) continue
      const m = document.createElement('span')
      m.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;margin:0;padding:0;border:0'
      t.parentNode!.insertBefore(m, t)
      this.markers.set(t, m)
    }
    this.walk(this.root, 0, this.out)
    for (const m of this.markers.values()) m.remove()
    return this.out
  }

  private walk(el: Element, part: number, out: Rec[]): void {
    if (el.classList.contains('katex-mathml')) return
    const p = partClass(el)
    if (p !== null) part = p
    if (el instanceof SVGSVGElement) {
      this.svg(el, part, out)
      return
    }
    if (el.tagName === 'SPAN' && this.markersHas(el)) return
    this.borders(el as HTMLElement, part, out)
    if (el.classList.contains('mtable')) {
      this.table(el, part, out)
      return
    }
    const kids = el.classList.contains('vlist') ? rowsTopDown(el) : Array.from(el.childNodes)
    for (const k of kids) this.visit(k, part, out)
  }

  private visit(k: Node, part: number, out: Rec[]): void {
    if (k.nodeType === Node.TEXT_NODE) this.text(k as Text, part, out)
    else if (k.nodeType === Node.ELEMENT_NODE) this.walk(k as Element, part, out)
  }

  private markerSet: Set<Element> | null = null
  private markersHas(el: Element): boolean {
    if (!this.markerSet) this.markerSet = new Set(this.markers.values())
    return this.markerSet.has(el)
  }

  /* Matrices and arrays: KaTeX builds columns of rows; TeX order is rows of columns. */
  private table(el: Element, part: number, out: Rec[]): void {
    const cols: Rec[][][] = []
    const rest: Rec[] = []
    for (const c of Array.from(el.children)) {
      const vlist = /col-align/.test(c.className) ? c.querySelector('.vlist') : null
      if (!vlist) {
        this.walk(c, part, rest)
        continue
      }
      this.borders(c as HTMLElement, part, rest)
      cols.push(rowsTopDown(vlist).map((row) => {
        const recs: Rec[] = []
        this.visit(row, part, recs)
        return recs
      }))
    }
    const nRows = Math.max(0, ...cols.map((c) => c.length))
    for (let r = 0; r < nRows; r++) for (const col of cols) if (col[r]) out.push(...col[r])
    out.push(...rest)
  }

  private text(node: Text, part: number, out: Rec[]): void {
    const marker = this.markers.get(node)
    if (!marker) return
    const parent = node.parentElement!
    const cs = getComputedStyle(parent)
    const family = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '')
    const weight = cs.fontWeight === 'bold' ? 700 : parseInt(cs.fontWeight, 10) || 400
    const file = fontFileFor(family, weight >= 600, cs.fontStyle !== 'normal') ?? 'KaTeX_Main-Regular.ttf'
    const px = parseFloat(cs.fontSize)
    const baseline = marker.getBoundingClientRect().bottom
    const range = document.createRange()
    let off = 0
    for (const ch of Array.from(node.data)) {
      if (!SKIP_CHAR.test(ch)) {
        range.setStart(node, off)
        range.setEnd(node, off + ch.length)
        const r = range.getClientRects()[0] ?? range.getBoundingClientRect()
        out.push({ part, glyph: { file, ch, x: r.left, baseline, px } })
      }
      off += ch.length
    }
  }

  private borders(el: HTMLElement, part: number, out: Rec[]): void {
    const cs = getComputedStyle(el)
    const sides = ['Top', 'Right', 'Bottom', 'Left'] as const
    const widths: Partial<Record<(typeof sides)[number], number>> = {}
    let any = false
    for (const s of sides) {
      const style = cs.getPropertyValue(`border-${s.toLowerCase()}-style`)
      if (style === 'none' || style === 'hidden') continue
      const computed = parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) || 0
      if (computed <= 0) continue
      const fontPx = parseFloat(cs.fontSize)
      widths[s] = emLength(el.style.getPropertyValue(`border-${s.toLowerCase()}-width`), fontPx) ?? computed
      any = true
    }
    if (!any) return
    const r = toRect(el.getBoundingClientRect())
    if (el.classList.contains('rule')) {
      // \rule is a box drawn as two borders; the box itself is the ink.
      out.push({ part, subpaths: [rectSubpath(r)] })
      return
    }
    const subs: Subpath[] = []
    if (widths.Top) subs.push(rectSubpath({ ...r, y1: r.y0 + widths.Top }))
    if (widths.Bottom) subs.push(rectSubpath({ ...r, y0: r.y1 - widths.Bottom }))
    if (widths.Left) subs.push(rectSubpath({ ...r, x1: r.x0 + widths.Left }))
    if (widths.Right) subs.push(rectSubpath({ ...r, x0: r.x1 - widths.Right }))
    for (const s of subs) out.push({ part, subpaths: [s] })
  }

  private svg(svg: SVGSVGElement, part: number, out: Rec[]): void {
    const box = svg.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) return
    const vbAttr = svg.getAttribute('viewBox')
    const vb = vbAttr ? (vbAttr.trim().split(/[\s,]+/).map(Number) as [number, number, number, number]) : null
    const local: Affine = vb
      ? viewBoxAffine(vb, box.width, box.height, svg.getAttribute('preserveAspectRatio'))
      : [1, 0, 0, 1, 0, 0]
    const m: Affine = [local[0], local[1], local[2], local[3], local[4] + box.left, local[5] + box.top]

    // The visible window: the svg's own viewport cut by every overflow-clipping ancestor.
    let clip = toRect(box)
    for (let a = svg.parentElement; a && a !== this.root; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') clip = intersect(clip, toRect(a.getBoundingClientRect()))
    }
    if (clip.x1 <= clip.x0 || clip.y1 <= clip.y0) return

    const subs: Subpath[] = []
    for (const p of Array.from(svg.querySelectorAll('path'))) {
      subs.push(...transformSubpaths(parsePathData(p.getAttribute('d') || ''), m))
    }
    for (const l of Array.from(svg.querySelectorAll('line'))) {
      subs.push(...lineSubpaths(l, box, m))
    }
    const b = boundsOf(subs)
    const eps = 0.01
    const needsClip = b && (b.x0 < clip.x0 - eps || b.y0 < clip.y0 - eps || b.x1 > clip.x1 + eps || b.y1 > clip.y1 + eps)
    const kept = needsClip ? clipSubpathsToRect(subs, clip) : subs
    if (kept.length) out.push({ part, subpaths: kept })
  }
}

/* An SVG <line> (KaTeX's \cancel strokes) as a filled quad of its stroke width. */
function lineSubpaths(l: SVGLineElement, box: DOMRect, m: Affine): Subpath[] {
  const len = (attr: string, full: number) => {
    const v = l.getAttribute(attr) || '0'
    return v.endsWith('%') ? (parseFloat(v) / 100) * full : parseFloat(v)
  }
  const fontPx = parseFloat(getComputedStyle(l).fontSize) || 16
  const swAttr = l.getAttribute('stroke-width') || '1'
  const sw = emLength(swAttr, fontPx) ?? parseFloat(swAttr)
  // Percentages are of the viewport; with a viewBox they are already in user units, so map through m.
  const a: Pt = [len('x1', box.width / m[0]), len('y1', box.height / m[3])]
  const b: Pt = [len('x2', box.width / m[0]), len('y2', box.height / m[3])]
  const pa: Pt = [m[0] * a[0] + m[4], m[3] * a[1] + m[5]]
  const pb: Pt = [m[0] * b[0] + m[4], m[3] * b[1] + m[5]]
  const dx = pb[0] - pa[0], dy = pb[1] - pa[1]
  const d = Math.hypot(dx, dy) || 1
  const nx = (-dy / d) * (sw / 2), ny = (dx / d) * (sw / 2)
  const pb2 = new PathBuilder()
  pb2.moveTo([pa[0] + nx, pa[1] + ny])
  pb2.lineTo([pb[0] + nx, pb[1] + ny])
  pb2.lineTo([pb[0] - nx, pb[1] - ny])
  pb2.lineTo([pa[0] - nx, pa[1] - ny])
  pb2.close()
  return pb2.finish()
}

/* A vlist's rows sorted top to bottom (KaTeX lists them bottom up, each with an inline `top` in em). */
function rowsTopDown(vlist: Element): Node[] {
  const rows = Array.from(vlist.children) as HTMLElement[]
  return rows
    .map((r, i) => ({ r, i, top: parseFloat(r.style.top) || 0 }))
    .sort((a, b) => a.top - b.top || a.i - b.i)
    .map((x) => x.r)
}

function glyphSubpaths(font: OtFont, job: GlyphJob): Subpath[] | null {
  const g = font.charToGlyph(job.ch)
  if (!g || g.index === 0) return null
  const b = new PathBuilder()
  for (const c of g.getPath(job.x, job.baseline, job.px).commands) {
    if (c.type === 'M') b.moveTo([c.x!, c.y!])
    else if (c.type === 'L') b.lineTo([c.x!, c.y!])
    else if (c.type === 'Q') b.quadTo([c.x1!, c.y1!], [c.x!, c.y!])
    else if (c.type === 'C') b.cubicTo([c.x1!, c.y1!], [c.x2!, c.y2!], [c.x!, c.y!])
    else if (c.type === 'Z') b.close()
  }
  return b.finish()
}

/* Characters KaTeX's chosen font lacks fall back to these, in order. */
const FALLBACK_FILES = ['KaTeX_Main-Regular.ttf', 'KaTeX_AMS-Regular.ttf', 'KaTeX_Size1-Regular.ttf']

async function fillGlyphs(recs: Rec[]): Promise<void> {
  const files = new Set<string>(FALLBACK_FILES)
  for (const r of recs) if (r.glyph) files.add(r.glyph.file)
  const loaded = new Map<string, OtFont>()
  await Promise.all(
    Array.from(files).map(async (f) => {
      try {
        loaded.set(f, await loadFont(f))
      } catch (e) {
        if (!FALLBACK_FILES.includes(f)) throw e
      }
    }),
  )
  const missing = new Set<string>()
  for (const r of recs) {
    if (!r.glyph) continue
    let subs: Subpath[] | null = null
    for (const f of [r.glyph.file, ...FALLBACK_FILES]) {
      const font = loaded.get(f)
      if (font && (subs = glyphSubpaths(font, r.glyph))) break
    }
    if (!subs) missing.add(r.glyph.ch)
    r.subpaths = subs ?? []
  }
  if (missing.size) console.warn(`[pyctures.anim] TeX: no outline for ${Array.from(missing).join(' ')}`)
}

/* Waits until every KaTeX face the render uses is loaded, so the layout is final before measuring. */
async function waitForFonts(root: HTMLElement): Promise<void> {
  const want = new Set<string>()
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const p = n.parentElement
    if (!p || !(n as Text).data.trim()) continue
    const cs = getComputedStyle(p)
    want.add(`${cs.fontStyle} ${cs.fontWeight} 16px ${cs.fontFamily.split(',')[0].trim()}`)
  }
  await Promise.all(Array.from(want).map((f) => document.fonts.load(f).catch(() => [])))
  await document.fonts.ready
}

export class TexSyntaxError extends Error {}

/**
 * Renders `source` with KaTeX off screen and returns its outlines in px.
 * Throws TexSyntaxError (KaTeX's message) when KaTeX can't parse it.
 */
export async function layoutKatex(katex: KatexLike, source: string, display: boolean): Promise<RawLayout> {
  const box = document.createElement('div')
  getHost().appendChild(box)
  try {
    try {
      katex.render(source, box, {
        displayMode: display,
        output: 'html',
        throwOnError: true,
        strict: false,
        trust: (ctx: { command: string }) => ctx.command === '\\htmlClass',
      })
    } catch (e) {
      throw new TexSyntaxError(e instanceof Error ? e.message : String(e))
    }
    await waitForFonts(box)
    const root = box.querySelector<HTMLElement>('.katex') ?? box
    const emPx = parseFloat(getComputedStyle(root).fontSize)
    const recs = new Walker(root).run()
    await fillGlyphs(recs)
    const items = recs.filter((r) => r.subpaths && r.subpaths.length).map((r) => ({ part: r.part, subpaths: r.subpaths! }))
    return { items, emPx }
  } finally {
    box.remove()
  }
}
