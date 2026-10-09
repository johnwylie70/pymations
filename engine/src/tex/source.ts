/**
 * The pure half of the TeX outliner: building KaTeX's input from a MathTex/Tex
 * call, the cache keys, and the px → scene-unit scale. No DOM, so it is unit
 * tested on its own.
 */
import type { TexInput } from '../geometry-types'

/**
 * Scene units per KaTeX em. 0.498 at font_size 48 is fitted to real Manim
 * MathTex/Tex sizes (fixtures/manim-golden.json): every height matches to
 * 0.2%, widths to within 5% (KaTeX's spacing differs slightly from TeX's).
 */
export const UNITS_PER_EM_AT_48 = 0.498

export function sceneUnitsPerEm(fontSize: number): number {
  return (fontSize / 48) * UNITS_PER_EM_AT_48
}

/** The parts to lay out; a bare `tex` with no parts is one part. */
export function partsOf(input: TexInput): string[] {
  return input.parts && input.parts.length ? input.parts : [input.tex]
}

/** The layout key: everything that changes the outlines' shape (font size only scales them). */
export function layoutKey(input: TexInput): string {
  return `${input.mode}\u0002${partsOf(input).join('\u0001')}`
}

/** The full key: layout key plus the size. */
export function outlineKey(input: TexInput): string {
  return `${layoutKey(input)}\u0002${input.fontSize}`
}

/**
 * Tex's text mode (LaTeX text with $...$ maths) → KaTeX maths-mode input:
 * text runs become \text{...}, maths runs pass through. `$$...$$`, `\(...\)`
 * and `\[...\]` are maths too. An escaped `\$` stays a dollar sign in the text.
 */
export function textToKatex(src: string): string {
  const out: string[] = []
  let text = ''
  const flushText = () => {
    if (text) out.push(`\\text{${text}}`)
    text = ''
  }
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\' && i + 1 < src.length) {
      const nx = src[i + 1]
      if (nx === '(' || nx === '[') {
        const close = nx === '(' ? '\\)' : '\\]'
        const end = src.indexOf(close, i + 2)
        if (end >= 0) {
          flushText()
          out.push(`{${src.slice(i + 2, end)}}`)
          i = end + 2
          continue
        }
      }
      // Any other control sequence (\$, \textbf, \\) is copied as is.
      text += ch + nx
      i += 2
      continue
    }
    if (ch === '$') {
      const dbl = src[i + 1] === '$'
      const open = dbl ? 2 : 1
      const end = findClosingDollar(src, i + open, dbl)
      if (end >= 0) {
        flushText()
        out.push(`{${src.slice(i + open, end)}}`)
        i = end + open
        continue
      }
    }
    text += ch
    i++
  }
  flushText()
  return out.join('')
}

function findClosingDollar(src: string, from: number, dbl: boolean): number {
  for (let i = from; i < src.length; i++) {
    if (src[i] === '\\') {
      i++
      continue
    }
    if (src[i] === '$' && (!dbl || src[i + 1] === '$')) return i
  }
  return -1
}

/**
 * True when a part is complete TeX on its own: balanced braces, \left/\right
 * and \begin/\end. Only then can it be wrapped in \htmlClass; a split like
 * MathTex("\\frac{a}{", "b}") would still parse when wrapped, but as a
 * different formula, so it must be laid out unwrapped instead.
 */
export function isSelfContained(part: string): boolean {
  let depth = 0
  for (let i = 0; i < part.length; i++) {
    const ch = part[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}' && --depth < 0) return false
  }
  if (depth !== 0) return false
  const count = (re: RegExp) => (part.match(re) || []).length
  return count(/\\left(?![a-zA-Z])/g) === count(/\\right(?![a-zA-Z])/g) && count(/\\begin\s*\{/g) === count(/\\end\s*\{/g)
}

/** Whether every part can be wrapped for grouping (more than one part, all self-contained). */
export function canGroupParts(input: TexInput): boolean {
  const parts = partsOf(input)
  return parts.length > 1 && parts.every(isSelfContained)
}

/** KaTeX input for the whole call, each part wrapped so its glyphs can be found again. */
export function buildKatexSource(input: TexInput, wrap: boolean): string {
  const parts = partsOf(input).map((p) => (input.mode === 'text' ? textToKatex(p) : p))
  if (!wrap) return parts.join(' ')
  return parts.map((p, i) => `\\htmlClass{cir-p${i}}{${p}}`).join(' ')
}
