/**
 * 3D objects (Contract v4), drawn the way Manim CE does: shapes made of flat
 * faces (each face its own part, like Manim's submobjects, so Create staggers
 * over them and Transform pairs them), projected by the 3D camera, sorted by
 * depth and shaded by the light. The faces are built once here; a frame only
 * projects their corners.
 *
 * Manim's defaults (sizes, colours, opacity) except the sphere's resolution:
 * Manim's 101 × 51 faces would be slow to sort on a tablet every frame, so
 * the default is 32 × 16 (a resolution kwarg still wins).
 */
import { BUILDERS, makeAxes, styleFrom, type Builder, type MakeEnv } from './kinds'
import { evalValue, num, resolvePoint3, resolveTarget, withPoint, type Kw } from './args'
import { family, newMob, type Mob, type Style, type World } from './scene'
import { IDENT3, apply3, embed, mul3, rot3, translate3, type V3, type Mat3 } from './math3'
import { NAMED, normColor, WHITE } from './color'
import { TAU } from './geometry'

const BLUE = NAMED.BLUE, BLUE_D = NAMED.BLUE_D, BLUE_E = NAMED.BLUE_E, LIGHT_GREY = NAMED.LIGHT_GREY

/** One face (or 3D line) as its own object, in local 3D coordinates. */
function face(w: World, pts: number[], style: Style, closed = true, shade = true, kind = 'face'): number {
  const id = w.newId()
  w.set(newMob(id, kind, style, [], { p3: pts, closed3: closed, shade3: shade, m3: IDENT3 }))
  return id
}

function group3(env: MakeEnv, id: number, kind: string, props: Kw, children: number[], m3: Mat3 = IDENT3, extra: Partial<Mob> = {}) {
  env.w.set(newMob(id, kind, styleFrom(props), [], { children, m3, z: num(props.z_index, 0), ...extra }))
  // Placed where asked, with every part following.
  if (m3 !== IDENT3) for (const c of family(env.w, id)) if (c !== id) { const m = env.w.get(c); env.w.set({ ...m, m3: mul3(m3, m.m3 ?? embed(m.m)) }) }
}

function res2(v: unknown, du: number, dv: number): [number, number] {
  if (Array.isArray(v)) return [Math.max(1, Math.round(num(v[0], du))), Math.max(1, Math.round(num(v[1], dv)))]
  if (v != null) { const n = Math.max(1, Math.round(num(v, du))); return [n, n] }
  return [du, dv]
}

interface SurfaceStyle {
  fill: string
  fills: string[] | null
  fo: number
  sc: string
  sw: number
}

function surfaceStyle(p: Kw, d: Partial<SurfaceStyle> = {}): SurfaceStyle {
  const fill = normColor(p.fill_color ?? p.color ?? d.fill ?? BLUE_D, BLUE_D)
  const cb = p.checkerboard_colors === false ? null : Array.isArray(p.checkerboard_colors) ? p.checkerboard_colors.map((c: unknown) => normColor(c, BLUE_D))
    : p.fill_color != null || p.color != null ? null : d.fills ?? [BLUE_D, BLUE_E]
  return {
    fill, fills: cb, fo: num(p.fill_opacity, d.fo ?? 1),
    sc: normColor(p.stroke_color ?? d.sc ?? LIGHT_GREY, LIGHT_GREY), sw: num(p.stroke_width, d.sw ?? 0.5),
  }
}

/**
 * A grid of points (nu+1 rows along u, nv+1 along v) → quad faces in the
 * checkerboard colours. Faces whose four corners coincide (a sphere's poles
 * collapse to triangles, that is fine) are kept so the count matches Manim.
 */
function gridFaces(w: World, grid: V3[][], st: SurfaceStyle): number[] {
  const ids: number[] = []
  for (let i = 0; i + 1 < grid.length; i++) {
    for (let j = 0; j + 1 < grid[i].length; j++) {
      const a = grid[i][j], b = grid[i + 1][j], c = grid[i + 1][j + 1], d = grid[i][j + 1]
      const fc = st.fills ? st.fills[(i + j) % st.fills.length] : st.fill
      ids.push(face(w, [...a, ...b, ...c, ...d], { sc: st.sc, fc, sw: st.sw, so: 1, fo: st.fo }))
    }
  }
  return ids
}

function sampleGrid(f: (u: number, v: number) => V3, ur: [number, number], vr: [number, number], nu: number, nv: number): V3[][] {
  const grid: V3[][] = []
  for (let i = 0; i <= nu; i++) {
    const u = ur[0] + ((ur[1] - ur[0]) * i) / nu
    const row: V3[] = []
    for (let j = 0; j <= nv; j++) row.push(f(u, vr[0] + ((vr[1] - vr[0]) * j) / nv))
    grid.push(row)
  }
  return grid
}

function range2(v: unknown, d: [number, number]): [number, number] {
  return Array.isArray(v) ? [num(v[0], d[0]), num(v[1], d[1])] : d
}

/** A map that turns the z axis to `dir` (for cones, cylinders, arrows). */
function alongDir(dir: V3): Mat3 {
  const n = Math.hypot(...dir) || 1
  const d: V3 = [dir[0] / n, dir[1] / n, dir[2] / n]
  const c = d[2]
  if (c > 1 - 1e-12) return IDENT3
  if (c < -1 + 1e-12) return rot3([1, 0, 0], Math.PI)
  return rot3([-d[1], d[0], 0], Math.acos(c))
}

/* ---------------------------------------------------------------- surfaces */

function makeSurface(env: MakeEnv, id: number, kind: string, p: Kw) {
  const w = env.w
  const [nu, nv] = res2(p.resolution, 32, 32)
  let grid: V3[][]
  if (Array.isArray(p.grid)) grid = (p.grid as unknown[][]).map(row => row.map(q => resolvePoint3(w, q)))
  else if (p.func != null) {
    // A traced vector function of ["var","u"], ["var","v"].
    const fn = p.func
    grid = sampleGrid((u, v) => {
      const r = withPoint([u, v], () => evalValue(w, fn))
      return Array.isArray(r) ? [r[0] || 0, r[1] || 0, r[2] || 0] : [Number(r) || 0, 0, 0]
    }, range2(p.u_range, [0, 1]), range2(p.v_range, [0, 1]), nu, nv)
  } else throw new Error('Surface needs its points (grid) or a function the preview can trace (func)')
  // On axes: the grid is in axis coordinates.
  if (p.axes != null) {
    const ax = w.get(resolveTarget(w, p.axes))
    const map = ax.data?.axes, z3 = ax.data?.axes3
    const M = ax.m3 ?? embed(ax.m)
    if (map) grid = grid.map(row => row.map(([x, y, z]) => apply3(M, map.ox + (x - map.x0) * map.sx, map.oy + (y - map.y0) * map.sy, z3 ? z3.oz + (z - z3.z0) * z3.sz : z)))
  }
  group3(env, id, kind, p, gridFaces(w, grid, surfaceStyle(p)))
}

function makeSphere(env: MakeEnv, id: number, kind: string, p: Kw, defRes: [number, number] = [32, 16], d: Partial<SurfaceStyle> = {}) {
  const r = num(p.radius, 1)
  const [nu, nv] = res2(p.resolution, defRes[0], defRes[1])
  const grid = sampleGrid((u, v) => [r * Math.cos(u) * Math.sin(v), r * Math.sin(u) * Math.sin(v), -r * Math.cos(v)],
    range2(p.u_range, [0, TAU]), range2(p.v_range, [0, Math.PI]), nu, nv)
  const c = p.center ?? p.point
  group3(env, id, kind, p, gridFaces(env.w, grid, surfaceStyle(p, d)), c != null ? translate3(...resolvePoint3(env.w, c)) : IDENT3)
}

function makeTorus(env: MakeEnv, id: number, kind: string, p: Kw) {
  const R = num(p.major_radius, 3), r = num(p.minor_radius, 1)
  const [nu, nv] = res2(p.resolution, 32, 16)
  const grid = sampleGrid((u, v) => [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)],
    range2(p.u_range, [0, TAU]), range2(p.v_range, [0, TAU]), nu, nv)
  group3(env, id, kind, p, gridFaces(env.w, grid, surfaceStyle(p)))
}

/** A disc (cylinder ends, cone base) as one flat face. */
function disc(w: World, r: number, z: number, n: number, st: Style, reverse = false): number {
  const pts: number[] = []
  for (let k = 0; k < n; k++) {
    const a = (TAU * (reverse ? n - k : k)) / n
    pts.push(r * Math.cos(a), r * Math.sin(a), z)
  }
  return face(w, pts, st)
}

function makeCylinder(env: MakeEnv, id: number, kind: string, p: Kw) {
  const r = num(p.radius, 1), h = num(p.height, 2)
  const [nu, nv] = res2(p.resolution, 24, 1)
  const st = surfaceStyle(p)
  const grid = sampleGrid((u, v) => [r * Math.cos(u), r * Math.sin(u), v], [0, TAU], [-h / 2, h / 2], nu, nv)
  const kids = gridFaces(env.w, grid, st)
  if (p.show_ends !== false) {
    const es: Style = { sc: st.sc, fc: st.fills ? st.fills[0] : st.fill, sw: st.sw, so: 1, fo: st.fo }
    kids.push(disc(env.w, r, h / 2, nu, es), disc(env.w, r, -h / 2, nu, es, true))
  }
  const dir = p.direction != null ? resolvePoint3(env.w, p.direction) : [0, 0, 1] as V3
  group3(env, id, kind, p, kids, alongDir(dir))
}

function makeCone(env: MakeEnv, id: number, kind: string, p: Kw) {
  const r = num(p.base_radius, 1), h = num(p.height, 1)
  const [nu, nv] = res2(p.resolution, 24, 1)
  const st = surfaceStyle(p)
  // Base on z = 0, apex at z = height (along `direction`).
  const grid = sampleGrid((u, v) => [r * (1 - v) * Math.cos(u), r * (1 - v) * Math.sin(u), h * v], [0, TAU], [0, 1], nu, nv)
  const kids = gridFaces(env.w, grid, st)
  if (p.show_base) kids.push(disc(env.w, r, 0, nu, { sc: st.sc, fc: st.fills ? st.fills[0] : st.fill, sw: st.sw, so: 1, fo: st.fo }, true))
  const dir = p.direction != null ? resolvePoint3(env.w, p.direction) : [0, 0, 1] as V3
  group3(env, id, kind, p, kids, alongDir(dir), { data: { start: [0, 0], end: [0, 0], apex: [0, 0, h] } })
}

/* --------------------------------------------------------------- polyhedra */

function boxFaces(w: World, sx: number, sy: number, sz: number, st: Style): number[] {
  const x = sx / 2, y = sy / 2, z = sz / 2
  const V: V3[] = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]]
  // Manim's Cube order: OUT, IN, UP? We keep outward winding (counter-clockwise from outside).
  const F = [[4, 5, 6, 7], [3, 2, 1, 0], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7]]
  return F.map(f => face(w, f.flatMap(i => V[i]), st))
}

/** Faces of a convex polyhedron from its vertices: every plane through three vertices with all others on one side. */
export function hullFaces(V: V3[]): number[][] {
  const faces: number[][] = []
  const seen = new Set<string>()
  const n = V.length
  const c: V3 = [0, 0, 0]
  for (const v of V) { c[0] += v[0] / n; c[1] += v[1] / n; c[2] += v[2] / n }
  const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    let nrm = cross(sub(V[j], V[i]), sub(V[k], V[i]))
    const len = Math.hypot(...nrm)
    if (len < 1e-9) continue
    nrm = [nrm[0] / len, nrm[1] / len, nrm[2] / len]
    const d0 = dot(nrm, V[i])
    let pos = 0, neg = 0
    const on: number[] = []
    for (let m = 0; m < n; m++) {
      const d = dot(nrm, V[m]) - d0
      if (Math.abs(d) < 1e-6) on.push(m)
      else if (d > 0) pos++
      else neg++
    }
    if (pos && neg) continue
    const key = on.join(',')
    if (seen.has(key)) continue
    seen.add(key)
    // Outward normal; order the face's vertices counter-clockwise seen from outside.
    if (dot(nrm, sub(V[i], c)) < 0) nrm = [-nrm[0], -nrm[1], -nrm[2]]
    const fc: V3 = [0, 0, 0]
    for (const m of on) { fc[0] += V[m][0] / on.length; fc[1] += V[m][1] / on.length; fc[2] += V[m][2] / on.length }
    const u = sub(V[on[0]], fc), uLen = Math.hypot(...u)
    const ex: V3 = [u[0] / uLen, u[1] / uLen, u[2] / uLen], ey = cross(nrm, ex)
    on.sort((a, b) => {
      const pa = sub(V[a], fc), pb = sub(V[b], fc)
      return Math.atan2(dot(pa, ey), dot(pa, ex)) - Math.atan2(dot(pb, ey), dot(pb, ex))
    })
    faces.push(on)
  }
  return faces
}

const PHI = (1 + Math.sqrt(5)) / 2

/** Manim's vertex sets for the platonic solids (unit-ish), scaled to the edge length. */
function platonic(kind: string): { V: V3[]; edge: number } {
  if (kind === 'tetrahedron') return { V: [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]], edge: 2 * Math.SQRT2 }
  if (kind === 'octahedron') return { V: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], edge: Math.SQRT2 }
  if (kind === 'icosahedron') {
    const V: V3[] = []
    for (const a of [-1, 1]) for (const b of [-PHI, PHI]) V.push([0, a, b], [a, b, 0], [b, 0, a])
    return { V, edge: 2 }
  }
  const V: V3[] = []
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) V.push([a, b, c])
  for (const a of [-1, 1]) for (const b of [-1, 1]) V.push([0, a / PHI, b * PHI], [a / PHI, b * PHI, 0], [b * PHI, 0, a / PHI])
  return { V, edge: 2 / PHI }
}

function makePolyhedron(env: MakeEnv, id: number, kind: string, p: Kw, V: V3[], F: number[][]) {
  const fcfg: Kw = p.faces_config || {}
  const st: Style = {
    sc: normColor(fcfg.stroke_color ?? p.stroke_color ?? WHITE, WHITE), fc: normColor(fcfg.fill_color ?? fcfg.color ?? p.fill_color ?? p.color ?? BLUE, BLUE),
    sw: num(fcfg.stroke_width ?? p.stroke_width, 2), so: 1, fo: num(fcfg.fill_opacity ?? p.fill_opacity, 0.5),
  }
  const kids = F.map(f => face(env.w, f.flatMap(i => V[i]), st))
  group3(env, id, kind, p, kids, IDENT3, { data: { vertices: V } })
}

/* ---------------------------------------------------------------- 3D axes */

function makeThreeDAxes(env: MakeEnv, id: number, kind: string, p: Kw): void | Promise<void> {
  const xr = Array.isArray(p.x_range) ? p.x_range : [-6, 6, 1]
  const yr = Array.isArray(p.y_range) ? p.y_range : [-5, 5, 1]
  const zr = (Array.isArray(p.z_range) ? p.z_range : [-4, 4, 1]).map(Number)
  const xl = num(p.x_length, env.fh + 2.5), yl = num(p.y_length, env.fh + 2.5), zl = num(p.z_length, env.fh - 1.5)
  const r = makeAxes(env, id, kind, { ...p, x_range: xr, y_range: yr, x_length: xl, y_length: yl, tips: p.tips ?? true })
  const finish = () => {
    const w = env.w
    const zid = w.newId()
    const zcfg = { ...(p.axis_config || {}), ...(p.z_axis_config || {}) }
    const step = zr[2] ?? 1
    // The z axis is a number line turned from x into z, meeting the others at the origin.
    const zr3: [number, number, number] = [zr[0], zr[1], step]
    const zo = zr3[0] > 0 ? zr3[0] : zr3[1] < 0 ? zr3[1] : 0
    BUILDERS.number_line(env, zid, { x_range: zr3, length: zl, include_tip: zcfg.include_tip ?? (p.tips ?? true), include_numbers: false, color: zcfg.color, stroke_width: zcfg.stroke_width }, 'number_line')
    const sz = zl / ((zr3[1] - zr3[0]) || 1)
    const along = -zl / 2 + (zo - zr3[0]) * sz
    const ax = w.get(id), map = ax.data.axes
    const xo = xr[0] > 0 ? xr[0] : xr[1] < 0 ? xr[1] : 0, yo = yr[0] > 0 ? yr[0] : yr[1] < 0 ? yr[1] : 0
    const cx = map.ox + (xo - map.x0) * map.sx, cy = map.oy + (yo - map.y0) * map.sy
    const M = mul3(translate3(cx, cy, 0), mul3(rot3([0, 1, 0], -Math.PI / 2), translate3(-along, 0, 0)))
    for (const i of family(w, zid)) { const m = w.get(i); w.set({ ...m, m3: mul3(M, m.m3 ?? embed(m.m)) }) }
    const kids = [...ax.children, zid]
    w.set({ ...ax, children: kids, m3: IDENT3, data: { ...ax.data, axes3: { z0: zr3[0], sz, oz: -(zo - zr3[0]) * sz } } })
  }
  if (r && typeof (r as Promise<void>).then === 'function') return (r as Promise<void>).then(finish)
  finish()
}

/* ------------------------------------------------------------- lines, dots */

function makeLine3D(env: MakeEnv, id: number, kind: string, p: Kw, tip: boolean) {
  const w = env.w
  const s = resolvePoint3(w, p.start ?? [-1, 0, 0]), e = resolvePoint3(w, p.end ?? [1, 0, 0])
  const d: V3 = [e[0] - s[0], e[1] - s[1], e[2] - s[2]]
  const L = Math.hypot(...d) || 1e-9
  const th = num(p.thickness, 0.02)
  const col = normColor(p.color ?? WHITE, WHITE)
  const st: Style = { sc: col, fc: col, sw: 0, so: 1, fo: 1 }
  const n = Math.max(3, Math.round(num(p.resolution, 8)))
  const tipH = tip ? Math.min(num(p.height, 0.3), L * 0.5) : 0
  const bodyL = L - tipH
  const kids: number[] = []
  // The shaft: a thin cylinder from 0 to bodyL along z.
  for (let k = 0; k < n; k++) {
    const a0 = (TAU * k) / n, a1 = (TAU * (k + 1)) / n
    kids.push(face(w, [th * Math.cos(a0), th * Math.sin(a0), 0, th * Math.cos(a1), th * Math.sin(a1), 0, th * Math.cos(a1), th * Math.sin(a1), bodyL, th * Math.cos(a0), th * Math.sin(a0), bodyL], st))
  }
  if (tip) {
    const br = num(p.base_radius, 0.08)
    for (let k = 0; k < n * 2; k++) {
      const a0 = (TAU * k) / (2 * n), a1 = (TAU * (k + 1)) / (2 * n)
      kids.push(face(w, [br * Math.cos(a0), br * Math.sin(a0), bodyL, br * Math.cos(a1), br * Math.sin(a1), bodyL, 0, 0, L], st))
    }
  }
  const M = mul3(translate3(...s), alongDir(d))
  group3(env, id, kind, p, kids, M, { data: { start3: s, end3: e } })
}

/** Points with any z ≠ 0 → a 3D polyline (a ParametricFunction in space); otherwise null. */
export function curve3(pts: Array<[number, number, number]>): number[] | null {
  if (!pts.some(q => Math.abs(q[2]) > 1e-12)) return null
  return pts.flat()
}

export const KINDS_3D: Record<string, Builder> = {
  surface: (env, id, p, kind) => makeSurface(env, id, kind, p),
  sphere: (env, id, p, kind) => makeSphere(env, id, kind, p),
  dot3d: (env, id, p, kind) => {
    const col = normColor(p.color ?? WHITE, WHITE)
    makeSphere(env, id, kind, { ...p, radius: num(p.radius, 0.08), resolution: p.resolution ?? [8, 8], fill_color: col, checkerboard_colors: false, stroke_width: 0 })
  },
  torus: (env, id, p, kind) => makeTorus(env, id, kind, p),
  cylinder: (env, id, p, kind) => makeCylinder(env, id, kind, p),
  cone: (env, id, p, kind) => makeCone(env, id, kind, p),
  cube: (env, id, p, kind) => {
    const s = num(p.side_length, 2)
    const st: Style = { ...styleFrom({ fill_opacity: 0.75, ...p }, { color: BLUE, sw: 0 }) }
    group3(env, id, kind, p, boxFaces(env.w, s, s, s, st))
  },
  prism: (env, id, p, kind) => {
    const d = Array.isArray(p.dimensions) ? p.dimensions.map(Number) : [3, 2, 1]
    const st: Style = { ...styleFrom({ fill_opacity: 0.75, ...p }, { color: BLUE, sw: 0 }) }
    group3(env, id, kind, p, boxFaces(env.w, d[0], d[1], d[2], st))
  },
  line3d: (env, id, p, kind) => makeLine3D(env, id, kind, p, false),
  arrow3d: (env, id, p, kind) => makeLine3D(env, id, kind, p, true),
  tetrahedron: (env, id, p, kind) => { const { V, edge } = platonic('tetrahedron'); const k = num(p.edge_length, 1) / edge; const S = V.map(v => v.map(x => x * k) as V3); makePolyhedron(env, id, kind, p, S, hullFaces(S)) },
  octahedron: (env, id, p, kind) => { const { V, edge } = platonic('octahedron'); const k = num(p.edge_length, 1) / edge; const S = V.map(v => v.map(x => x * k) as V3); makePolyhedron(env, id, kind, p, S, hullFaces(S)) },
  icosahedron: (env, id, p, kind) => { const { V, edge } = platonic('icosahedron'); const k = num(p.edge_length, 1) / edge; const S = V.map(v => v.map(x => x * k) as V3); makePolyhedron(env, id, kind, p, S, hullFaces(S)) },
  dodecahedron: (env, id, p, kind) => { const { V, edge } = platonic('dodecahedron'); const k = num(p.edge_length, 1) / edge; const S = V.map(v => v.map(x => x * k) as V3); makePolyhedron(env, id, kind, p, S, hullFaces(S)) },
  polyhedron: (env, id, p, kind) => {
    const V = ((p.vertex_coords ?? []) as unknown[]).map(v => resolvePoint3(env.w, v))
    const F = Array.isArray(p.faces_list) ? (p.faces_list as number[][]).map(f => f.map(Number)) : hullFaces(V)
    makePolyhedron(env, id, kind, p, V, F)
  },
  three_d_axes: (env, id, p, kind) => makeThreeDAxes(env, id, kind, p),
}
