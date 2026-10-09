/**
 * Boolean shapes (Manim CE's Union, Intersection, Difference, Exclusion):
 * the objects' outlines are flattened to polygons, combined with
 * polygon-clipping (MIT, bundled; its notice ships beside anim.js), and the
 * result becomes ordinary subpaths, holes included, so it fills, morphs and
 * animates like any shape.
 */
import polygonClipping from 'polygon-clipping'
import type { Pair, Polygon, MultiPolygon } from 'polygon-clipping'
import type { Pt, Subpath } from './geometry-types'
import { polySub, transformPaths } from './geometry'
import { leaves, type World } from './scene'

/** Points along a cubic subpath, a few per curve (enough for a smooth-looking result). */
function flatten(sp: Subpath, perCurve = 12): Pair[] {
  const P = sp.points
  const out: Pair[] = []
  if (!P.length) return out
  out.push([P[0][0], P[0][1]])
  for (let i = 0; i + 3 < P.length; i += 3) {
    const [p0, p1, p2, p3] = [P[i], P[i + 1], P[i + 2], P[i + 3]]
    // A straight piece (handles on the chord) needs only its end.
    const straight = Math.abs((p1[0] - p0[0]) * (p3[1] - p0[1]) - (p1[1] - p0[1]) * (p3[0] - p0[0])) < 1e-12 &&
      Math.abs((p2[0] - p0[0]) * (p3[1] - p0[1]) - (p2[1] - p0[1]) * (p3[0] - p0[0])) < 1e-12
    const n = straight ? 1 : perCurve
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t
      out.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ])
    }
  }
  // Rings are closed implicitly; drop a repeated last point.
  const a = out[0], b = out[out.length - 1]
  if (out.length > 1 && Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12) out.pop()
  return out
}

function area(r: Pair[]): number {
  let s = 0
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

function inside(p: Pair, r: Pair[]): boolean {
  let c = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j]
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c
  }
  return c
}

/**
 * One object's filled region as polygons. A ring inside a larger ring of the
 * other winding is a hole (an annulus, a glyph's counter); others are
 * separate regions.
 */
export function regionOf(w: World, id: number): MultiPolygon {
  const rings: Pair[][] = []
  for (const i of leaves(w, id)) {
    const m = w.get(i)
    for (const sp of transformPaths(m.paths, m.m)) {
      const r = flatten(sp)
      if (r.length >= 3 && Math.abs(area(r)) > 1e-12) rings.push(r)
    }
  }
  rings.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))
  const polys: Array<{ outer: Pair[]; holes: Pair[][] }> = []
  for (const r of rings) {
    const host = polys.find(p => Math.sign(area(p.outer)) !== Math.sign(area(r)) && inside(r[0], p.outer) && !p.holes.some(h => inside(r[0], h)))
    if (host) host.holes.push(r)
    else polys.push({ outer: r, holes: [] })
  }
  return polys.map(p => [p.outer, ...p.holes] as Polygon)
}

export type BoolOp = 'union' | 'intersection' | 'difference' | 'exclusion'

/** The combined region, as closed straight-segment subpaths (outer rings and holes). */
export function booleanPaths(op: BoolOp, regions: MultiPolygon[]): Subpath[] {
  const geoms = regions.filter(r => r.length)
  if (!geoms.length) return []
  let res: MultiPolygon
  if (geoms.length === 1) res = op === 'intersection' || op === 'union' ? geoms[0] : geoms[0]
  else if (op === 'union') res = polygonClipping.union(geoms[0], ...geoms.slice(1))
  else if (op === 'intersection') res = polygonClipping.intersection(geoms[0], ...geoms.slice(1))
  else if (op === 'difference') res = polygonClipping.difference(geoms[0], ...geoms.slice(1))
  else res = polygonClipping.xor(geoms[0], ...geoms.slice(1))
  const out: Subpath[] = []
  for (const poly of res) {
    poly.forEach((ring, k) => {
      // polygon-clipping closes rings by repeating the first point.
      let pts: Pt[] = ring.map(p => [p[0], p[1]] as Pt)
      if (pts.length > 1) {
        const a = pts[0], b = pts[pts.length - 1]
        if (a[0] === b[0] && a[1] === b[1]) pts = pts.slice(0, -1)
      }
      // Outer rings counter-clockwise, holes clockwise: the nonzero fill keeps holes open.
      const ccw = area(pts as Pair[]) > 0
      if ((k === 0) !== ccw) pts.reverse()
      out.push(polySub(pts, true))
    })
  }
  return out
}
