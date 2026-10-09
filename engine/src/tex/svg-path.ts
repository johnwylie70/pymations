/**
 * SVG path data (`d`) → cubic subpaths. KaTeX draws roots, stretchy arrows,
 * braces and wide accents as inline SVG; this turns those into the same
 * cubic form as glyph outlines. Handles every command, absolute and
 * relative (M L H V C S Q T A Z), with implicit repeats.
 */
import type { Pt, Subpath } from '../geometry-types'
import { PathBuilder, arcToCubics } from './geom'

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }

function tokenize(d: string): (string | number)[] {
  const out: (string | number)[] = []
  const re = /([MLHVCSQTAZmlhvcsqtaz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(d))) out.push(m[1] ? m[1] : parseFloat(m[2]))
  return out
}

export function parsePathData(d: string): Subpath[] {
  const toks = tokenize(d)
  const b = new PathBuilder()
  let i = 0
  let cmd = ''
  // Previous control point, for S and T reflection.
  let lastC: Pt | null = null
  let lastQ: Pt | null = null
  const num = () => toks[i++] as number

  while (i < toks.length) {
    const t = toks[i]
    if (typeof t === 'string') {
      cmd = t
      i++
      if (cmd === 'Z' || cmd === 'z') {
        b.close()
        lastC = lastQ = null
        continue
      }
    } else if (!cmd) {
      i++
      continue
    }
    const upper = cmd.toUpperCase()
    const rel = cmd !== upper
    const need = ARGS[upper]
    if (need === undefined || i + need > toks.length || toks.slice(i, i + need).some((x) => typeof x !== 'number')) break
    const p0 = b.current
    const pt = (x: number, y: number): Pt => (rel ? [p0[0] + x, p0[1] + y] : [x, y])
    let nextC: Pt | null = null
    let nextQ: Pt | null = null
    switch (upper) {
      case 'M': {
        const p = pt(num(), num())
        b.moveTo(p)
        // Extra pairs after M are implicit L (l for m).
        cmd = rel ? 'l' : 'L'
        break
      }
      case 'L':
        b.lineTo(pt(num(), num()))
        break
      case 'H': {
        const x = num()
        b.lineTo([rel ? p0[0] + x : x, p0[1]])
        break
      }
      case 'V': {
        const y = num()
        b.lineTo([p0[0], rel ? p0[1] + y : y])
        break
      }
      case 'C': {
        const c1 = pt(num(), num()), c2 = pt(num(), num()), p = pt(num(), num())
        b.cubicTo(c1, c2, p)
        nextC = c2
        break
      }
      case 'S': {
        const c1: Pt = lastC ? [2 * p0[0] - lastC[0], 2 * p0[1] - lastC[1]] : p0
        const c2 = pt(num(), num()), p = pt(num(), num())
        b.cubicTo(c1, c2, p)
        nextC = c2
        break
      }
      case 'Q': {
        const c = pt(num(), num()), p = pt(num(), num())
        b.quadTo(c, p)
        nextQ = c
        break
      }
      case 'T': {
        const c: Pt = lastQ ? [2 * p0[0] - lastQ[0], 2 * p0[1] - lastQ[1]] : p0
        const p = pt(num(), num())
        b.quadTo(c, p)
        nextQ = c
        break
      }
      case 'A': {
        const rx = num(), ry = num(), rot = num(), large = num(), sweep = num()
        const p = pt(num(), num())
        const pts = arcToCubics(p0, rx, ry, rot, large !== 0, sweep !== 0, p)
        for (let k = 0; k < pts.length; k += 3) b.cubicTo(pts[k], pts[k + 1], pts[k + 2])
        break
      }
    }
    lastC = nextC
    lastQ = nextQ
  }
  return b.finish()
}
