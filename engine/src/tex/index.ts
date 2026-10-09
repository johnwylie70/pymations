/**
 * TeX → outlines for `pyctures.anim` (MathTex and Tex). KaTeX lays the maths
 * out off screen; layout.ts reads every glyph, rule and SVG piece back as
 * cubic outlines; this file groups them by part, converts px to scene units
 * (y up, centred on the origin) and caches the result.
 *
 * Caching: the layout (in em, centred) is keyed by mode + parts, since the
 * font size only scales it; the scaled outline is keyed by that plus the
 * size. Both caches hold promises, so concurrent identical requests share one
 * render. A failed render is dropped from the cache so a fix can retry.
 * Callers must treat the returned outline as read-only (it is shared).
 *
 * Self-contained (no app imports) so it can move into the MIT library.
 */
import type { Pt, Subpath, TexInput, TexOutline } from '../geometry-types'
import { boundsOf } from './geom'
import { ensureKatex } from './loader'
import { TexSyntaxError, layoutKatex, type RawLayout } from './layout'
import { buildKatexSource, canGroupParts, layoutKey, outlineKey, partsOf, sceneUnitsPerEm } from './source'

export { configureTex } from './loader'

/** A layout in em units, y up, centred: what every font size scales from. */
interface EmLayout {
  parts: Subpath[][][]
  width: number
  height: number
}

const layouts = new Map<string, Promise<EmLayout>>()
const outlines = new Map<string, Promise<TexOutline>>()

export function texToOutlines(input: TexInput): Promise<TexOutline> {
  const key = outlineKey(input)
  let p = outlines.get(key)
  if (!p) {
    p = emLayout(input).then((l) => scaleLayout(l, sceneUnitsPerEm(input.fontSize)))
    outlines.set(key, p)
    p.catch(() => outlines.delete(key))
  }
  return p
}

function emLayout(input: TexInput): Promise<EmLayout> {
  const key = layoutKey(input)
  let p = layouts.get(key)
  if (!p) {
    p = buildEmLayout(input)
    layouts.set(key, p)
    p.catch(() => layouts.delete(key))
  }
  return p
}

async function buildEmLayout(input: TexInput): Promise<EmLayout> {
  const katex = await ensureKatex()
  const n = partsOf(input).length
  const display = input.mode === 'math'
  let raw: RawLayout
  const grouped = canGroupParts(input)
  try {
    raw = await layoutKatex(katex, buildKatexSource(input, grouped), display)
  } catch (e) {
    if (!(e instanceof TexSyntaxError)) throw e
    if (!grouped) throw texError(input, e)
    // Wrapping can still fail where the joined string is fine (a part that
    // only makes sense beside its neighbours); lay it out as one part.
    try {
      raw = await layoutKatex(katex, buildKatexSource(input, false), display)
    } catch (e2) {
      throw texError(input, e2)
    }
  }
  return toEm(raw, n)
}

/* KaTeX's message, minus its prefix and the combining underline it draws under the bad token. */
function texError(input: TexInput, e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e)
  const what = input.mode === 'text' ? 'Tex' : 'MathTex'
  return new Error(`${what} could not read "${partsOf(input).join(' ')}": ${msg.replace(/^KaTeX parse error: /, '').replace(/\u0332/g, '')}`)
}

/** px (y down) → em (y up), centred on the ink's bounding box, grouped as part → glyph. */
function toEm(raw: RawLayout, nParts: number): EmLayout {
  const parts: Subpath[][][] = Array.from({ length: nParts }, () => [])
  const all = raw.items.flatMap((it) => it.subpaths)
  const b = boundsOf(all)
  if (!b) return { parts, width: 0, height: 0 }
  const cx = (b.x0 + b.x1) / 2
  const cy = (b.y0 + b.y1) / 2
  const k = 1 / raw.emPx
  const map = (p: Pt): Pt => [(p[0] - cx) * k, -(p[1] - cy) * k]
  for (const it of raw.items) {
    const idx = Math.min(Math.max(it.part, 0), nParts - 1)
    parts[idx].push(it.subpaths.map((s) => ({ closed: s.closed, points: s.points.map(map) })))
  }
  return { parts, width: (b.x1 - b.x0) * k, height: (b.y1 - b.y0) * k }
}

/** Scales an em layout to scene units (exported for tests). */
export function scaleLayout(l: EmLayout, unitsPerEm: number): TexOutline {
  const s = unitsPerEm
  return {
    parts: l.parts.map((glyphs) =>
      glyphs.map((subs) => subs.map((sp) => ({ closed: sp.closed, points: sp.points.map(([x, y]) => [x * s, y * s] as Pt) }))),
    ),
    width: l.width * s,
    height: l.height * s,
  }
}
