/**
 * 3D objects (Contract v4), drawn the way Manim CE does: shapes made of flat
 * faces (each face its own part, like Manim's submobjects, so Create staggers
 * over them and Transform pairs them), projected by the 3D camera, sorted by
 * depth and shaded by the light. The faces are built once here; a frame only
 * projects their corners.
 *
 * Manim CE's (Cairo renderer's) geometry and defaults: face order, corner
 * order, resolutions, colours. One deviation: Arrow3D's tip has 2 × 32 faces,
 * not 32 × 32 (the slant faces are coplanar, so it looks the same).
 */
import { BUILDERS, makeAxes, styleFrom, type Builder, type MakeEnv } from './kinds'
import { evalValue, num, resolvePoint3, resolveTarget, withPoint, type Kw } from './args'
import { family, newMob, type Mob, type Style, type World } from './scene'
import { IDENT3, apply3, embed, mul3, proj, rot3, translate3, type V3, type Mat3 } from './math3'
import { NAMED, normColor, WHITE } from './color'
import { TAU } from './geometry'

const BLUE = NAMED.BLUE, BLUE_D = NAMED.BLUE_D, BLUE_E = NAMED.BLUE_E, LIGHT_GREY = NAMED.LIGHT_GREY

/** One face (or 3D line) as its own object, in local 3D coordinates. */
function face(w: World, pts: number[], style: Style, closed = true, shade = true, kind = 'face'): number {
  const id = w.newId()
  w.set(newMob(id, kind, style, [], { p3: pts, closed3: closed, shade3: shade, m3: IDENT3 }))
  return id
}

/** Move a part by a 3D map: its 3D map and, kept in step, its 2D one (the 3D map seen from the front). */
function move3(w: World, id: number, M: Mat3) {
  const m = w.get(id), m3 = mul3(M, m.m3 ?? embed(m.m))
  w.set({ ...m, m3, m: proj(m3) })
}

function group3(env: MakeEnv, id: number, kind: string, props: Kw, children: number[], m3: Mat3 = IDENT3, extra: Partial<Mob> = {}) {
  env.w.set(newMob(id, kind, styleFrom(props), [], { children, m3, m: proj(m3), z: num(props.z_index, 0), ...extra }))
  // Placed where asked, with every part following.
  if (m3 !== IDENT3) for (const c of family(env.w, id)) if (c !== id) move3(env.w, c, m3)
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

/**
 * Manim's Surface style: the checkerboard colours win over fill_color unless
 * checkerboard_colors=False (as in Manim, Sphere(color=RED) stays blue).
 */
function surfaceStyle(p: Kw, d: Partial<SurfaceStyle> & { cb?: unknown } = {}): SurfaceStyle {
  const fill = normColor(p.fill_color ?? p.color ?? d.fill ?? BLUE_D, BLUE_D)
  const cbIn = p.checkerboard_colors !== undefined ? p.checkerboard_colors : 'cb' in d ? d.cb : [BLUE_D, BLUE_E]
  const cb = Array.isArray(cbIn) && cbIn.length ? cbIn.map((c: unknown) => normColor(c, BLUE_D)) : null
  return {
    fill, fills: cb, fo: num(p.fill_opacity, d.fo ?? 1),
    sc: normColor(p.stroke_color ?? d.sc ?? LIGHT_GREY, LIGHT_GREY), sw: num(p.stroke_width, d.sw ?? 0.5),
  }
}

/** Manim's set_color on a solid: every face's fill and stroke. */
function setColor(w: World, id: number, col: string) {
  for (const i of family(w, id)) { const m = w.get(i); if (m.p3) w.set({ ...m, style: { ...m.style, fc: col, sc: col } }) }
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
      const id = face(w, [...a, ...b, ...c, ...d], { sc: st.sc, fc, sw: st.sw, so: 1, fo: st.fo })
      // Its (u, v) index, for set_fill_by_checkerboard.
      w.update(id, { data: { uv: [i, j] } })
      ids.push(id)
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

/** Manim's turn of the z axis onto `dir` (Cylinder/Cone._rotate_to_direction): tilt about y by the polar angle, then about z by the azimuth. */
function alongDir(dir: V3): Mat3 {
  const [x, y, z] = dir
  const r = Math.hypot(x, y, z)
  const theta = r > 0 ? Math.acos(z / r) : 0
  let phi = x === 0 ? (y === 0 ? 0 : Math.PI / 2 + (y < 0 ? Math.PI : 0)) : Math.atan(y / x)
  if (x < 0) phi += Math.PI
  return mul3(rot3([0, 0, 1], phi), rot3([0, 1, 0], theta))
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

function makeSphere(env: MakeEnv, id: number, kind: string, p: Kw, defRes: [number, number] = [24, 12], d: Partial<SurfaceStyle> & { cb?: unknown } = {}) {
  const r = num(p.radius, 1)
  const [nu, nv] = res2(p.resolution, defRes[0], defRes[1])
  const grid = sampleGrid((u, v) => [r * Math.cos(u) * Math.sin(v), r * Math.sin(u) * Math.sin(v), -r * Math.cos(v)],
    range2(p.u_range, [0, TAU]), range2(p.v_range, [0, Math.PI]), nu, nv)
  const c = p.center ?? p.point
  group3(env, id, kind, p, gridFaces(env.w, grid, surfaceStyle(p, d)), c != null ? translate3(...resolvePoint3(env.w, c)) : IDENT3)
}

function makeTorus(env: MakeEnv, id: number, kind: string, p: Kw) {
  const R = num(p.major_radius, 3), r = num(p.minor_radius, 1)
  const [nu, nv] = res2(p.resolution, 24, 24)
  const grid = sampleGrid((u, v) => [(R - r * Math.cos(v)) * Math.cos(u), (R - r * Math.cos(v)) * Math.sin(u), -r * Math.sin(v)],
    range2(p.u_range, [0, TAU]), range2(p.v_range, [0, TAU]), nu, nv)
  group3(env, id, kind, p, gridFaces(env.w, grid, surfaceStyle(p)))
}

/** A filled circle at height z (cylinder ends, cone base): Manim's Circle, stroke 0, facing OUT. */
function disc(w: World, r: number, z: number, fc: string, fo: number): number {
  const n = 48, pts: number[] = []
  for (let k = 0; k < n; k++) pts.push(r * Math.cos((TAU * k) / n), r * Math.sin((TAU * k) / n), z)
  return face(w, pts, { sc: fc, fc, sw: 0, so: 1, fo }, true, true, 'circle')
}

/** Cylinder faces along z from −h/2 to h/2 (u is the height, v the angle, as in Manim), ends added after. */
function cylinderKids(w: World, r: number, h: number, nu: number, nv: number, st: SurfaceStyle, ends: boolean): number[] {
  const grid = sampleGrid((u, v) => [r * Math.cos(v), r * Math.sin(v), u], [-h / 2, h / 2], [0, TAU], nu, nv)
  const kids = gridFaces(w, grid, st)
  if (ends) kids.push(disc(w, r, -h / 2, st.fill, st.fo), disc(w, r, h / 2, st.fill, st.fo))
  return kids
}

function makeCylinder(env: MakeEnv, id: number, kind: string, p: Kw) {
  const r = num(p.radius, 1), h = num(p.height, 2)
  const [nu, nv] = res2(p.resolution, 24, 24)
  const kids = cylinderKids(env.w, r, h, nu, nv, surfaceStyle(p), p.show_ends !== false)
  const dir = p.direction != null ? resolvePoint3(env.w, p.direction) : [0, 0, 1] as V3
  group3(env, id, kind, p, kids, alongDir(dir))
}

/** Cone faces: apex at the origin, base circle at z = −height (Manim's Cone before it is turned to `direction`). */
function coneKids(w: World, r: number, h: number, nu: number, nv: number, st: SurfaceStyle, base: boolean): number[] {
  const th = Math.PI - Math.atan(r / h)
  const grid = sampleGrid((u, v) => [u * Math.sin(th) * Math.cos(v), u * Math.sin(th) * Math.sin(v), u * Math.cos(th)], [0, Math.hypot(r, h)], [0, TAU], nu, nv)
  const kids = gridFaces(w, grid, st)
  if (base) kids.push(disc(w, r, -h, st.fill, st.fo))
  return kids
}

function makeCone(env: MakeEnv, id: number, kind: string, p: Kw) {
  const r = num(p.base_radius, 1), h = num(p.height, 1)
  const [nu, nv] = res2(p.resolution, 32, 32)
  const kids = coneKids(env.w, r, h, nu, nv, surfaceStyle(p, { cb: false }), !!p.show_base)
  const dir = p.direction != null ? resolvePoint3(env.w, p.direction) : [0, 0, 1] as V3
  const n = Math.hypot(...dir) || 1
  group3(env, id, kind, p, kids, alongDir(dir), { data: { start3: [-h * dir[0] / n, -h * dir[1] / n, -h * dir[2] / n], end3: [0, 0, 0] } })
}

/* --------------------------------------------------------------- polyhedra */

function boxFaces(w: World, sx: number, sy: number, sz: number, st: Style): number[] {
  const x = sx / 2, y = sy / 2, z = sz / 2
  // Manim's Cube: IN, OUT, LEFT, RIGHT, UP, DOWN, each a flipped square (so its normal points inward).
  const F: number[][][] = [
    [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]], [[-1, 1, 1], [1, 1, 1], [1, -1, 1], [-1, -1, 1]],
    [[-1, 1, -1], [-1, 1, 1], [-1, -1, 1], [-1, -1, -1]], [[1, 1, 1], [1, 1, -1], [1, -1, -1], [1, -1, 1]],
    [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]], [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]],
  ]
  return F.map(f => face(w, f.flatMap(c => [c[0] * x, c[1] * y, c[2] * z]), st))
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

/** Manim's vertex and face lists for the platonic solids (edge length 1; scaled by edge_length). */
function platonic(kind: string, e: number): { V: V3[]; F: number[][] } {
  if (kind === 'tetrahedron') {
    const u = (e * Math.SQRT2) / 4
    return { V: [[u, u, u], [u, -u, -u], [-u, u, -u], [-u, -u, u]], F: [[0, 1, 2], [3, 0, 2], [0, 1, 3], [3, 1, 2]] }
  }
  if (kind === 'octahedron') {
    const u = (e * Math.SQRT2) / 2
    return {
      V: [[u, 0, 0], [-u, 0, 0], [0, u, 0], [0, -u, 0], [0, 0, u], [0, 0, -u]],
      F: [[2, 4, 1], [0, 4, 2], [4, 3, 0], [1, 3, 4], [3, 5, 0], [1, 5, 3], [2, 5, 1], [0, 5, 2]],
    }
  }
  if (kind === 'icosahedron') {
    const a = (e * (1 + Math.sqrt(5))) / 4, b = e / 2
    return {
      V: [[0, b, a], [0, -b, a], [0, b, -a], [0, -b, -a], [b, a, 0], [b, -a, 0], [-b, a, 0], [-b, -a, 0], [a, 0, b], [a, 0, -b], [-a, 0, b], [-a, 0, -b]],
      F: [[1, 8, 0], [1, 5, 7], [8, 5, 1], [7, 3, 5], [5, 9, 3], [8, 9, 5], [3, 2, 9], [9, 4, 2], [8, 4, 9], [0, 4, 8], [6, 4, 0], [6, 2, 4],
        [11, 2, 6], [3, 11, 2], [0, 6, 10], [10, 1, 0], [10, 7, 1], [11, 7, 3], [10, 11, 7], [10, 11, 6]],
    }
  }
  const a = (e * (1 + Math.sqrt(5))) / 4, b = (e * (3 + Math.sqrt(5))) / 4, c = e / 2
  return {
    V: [[a, a, a], [a, a, -a], [a, -a, a], [a, -a, -a], [-a, a, a], [-a, a, -a], [-a, -a, a], [-a, -a, -a],
      [0, c, b], [0, c, -b], [0, -c, -b], [0, -c, b], [c, b, 0], [-c, b, 0], [c, -b, 0], [-c, -b, 0], [b, 0, c], [-b, 0, c], [b, 0, -c], [-b, 0, -c]],
    F: [[18, 16, 0, 12, 1], [3, 18, 16, 2, 14], [3, 10, 9, 1, 18], [1, 9, 5, 13, 12], [0, 8, 4, 13, 12], [2, 16, 0, 8, 11],
      [4, 17, 6, 11, 8], [17, 19, 5, 13, 4], [19, 7, 15, 6, 17], [6, 15, 14, 2, 11], [19, 5, 9, 10, 7], [7, 10, 3, 14, 15]],
  }
}

/**
 * Manim's Polyhedron: parts [0] the faces (Polygons, BLUE, fill 0.5, stroke 4,
 * then faces_config), [1] the graph: [vertices (Dot3D), edges (hidden lines
 * unless graph_config's edge_config shows them)].
 */
function makePolyhedron(env: MakeEnv, id: number, kind: string, p: Kw, V: V3[], F: number[][]) {
  const w = env.w
  const fcfg: Kw = { ...(p.faces_config || {}) }
  const st: Style = styleFrom({ fill_opacity: 0.5, ...fcfg }, { color: BLUE })
  const faces = F.map(f => face(w, f.flatMap(i => V[i]), st, true, fcfg.shade_in_3d !== false, 'polygon'))
  const fg = w.newId()
  w.set(newMob(fg, 'vgroup', st, [], { children: faces, m3: IDENT3 }))
  const gcfg: Kw = p.graph_config || {}
  const vcfg: Kw = gcfg.vertex_config || {}
  const dots = V.map(v => {
    const d = w.newId()
    makeSphere(env, d, 'dot3d', { radius: num(vcfg.radius, 0.08), resolution: vcfg.resolution ?? [8, 8], center: v })
    setColor(w, d, normColor(vcfg.color ?? vcfg.fill_color ?? WHITE, WHITE))
    return d
  })
  const ecfg: Kw = gcfg.edge_config || {}
  const est: Style = styleFrom({ stroke_opacity: 0, ...ecfg })
  const seen = new Set<string>()
  const edges: number[] = []
  for (const f of F) f.forEach((a, k) => {
    const b = f[(k + 1) % f.length], key = a < b ? a + ',' + b : b + ',' + a
    if (seen.has(key)) return
    seen.add(key)
    edges.push(face(w, [...V[a], ...V[b]], est, false, false, 'line'))
  })
  const vg = w.newId(), eg = w.newId(), gg = w.newId()
  w.set(newMob(vg, 'vgroup', est, [], { children: dots, m3: IDENT3 }))
  w.set(newMob(eg, 'vgroup', est, [], { children: edges, m3: IDENT3 }))
  w.set(newMob(gg, 'graph', est, [], { children: [vg, eg], m3: IDENT3 }))
  group3(env, id, kind, p, [fg, gg], IDENT3, { data: { vertices: V } })
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
    for (const i of family(w, zid)) move3(w, i, M)
    const kids = [...ax.children, zid]
    w.set({ ...ax, children: kids, m3: IDENT3, data: { ...ax.data, axes3: { z0: zr3[0], sz, oz: -(zo - zr3[0]) * sz } } })
  }
  if (r && typeof (r as Promise<void>).then === 'function') return (r as Promise<void>).then(finish)
  finish()
}

/* ------------------------------------------------------------- lines, dots */

/**
 * Manim's Line3D: a thin Cylinder (radius = thickness, resolution (2, n)) from
 * start to end, in the Cylinder's checkerboard unless a colour is given.
 * Arrow3D: the line stops `height` short of the end, where a Cone tip
 * (white by default) points at it.
 */
function makeLine3D(env: MakeEnv, id: number, kind: string, p: Kw, tip: boolean) {
  const w = env.w
  const s = resolvePoint3(w, p.start ?? [-1, 0, 0]), e = resolvePoint3(w, p.end ?? [1, 0, 0])
  const d: V3 = [e[0] - s[0], e[1] - s[1], e[2] - s[2]]
  const L = Math.hypot(...d) || 1e-9
  const u: V3 = [d[0] / L, d[1] / L, d[2] / L]
  const th = num(p.thickness, 0.02)
  const res = p.resolution == null ? [2, 24] : Array.isArray(p.resolution) ? p.resolution : [2, p.resolution]
  const [nu, nv] = res2(res, 2, 24)
  const tipH = tip ? num(p.height, 0.3) : 0
  const bodyL = L - tipH
  // Arrow3D is white unless coloured (as color=, or the fill/stroke colours Python sends).
  const st = surfaceStyle(p, tip ? { cb: false, fill: WHITE, sc: WHITE } : {})
  // The shaft along z, centred, then turned to the direction and moved to its midpoint.
  const shaft = cylinderKids(w, th, bodyL, nu, nv, st, true)
  const mid: V3 = [s[0] + (u[0] * bodyL) / 2, s[1] + (u[1] * bodyL) / 2, s[2] + (u[2] * bodyL) / 2]
  const Ms = mul3(translate3(...mid), alongDir(u))
  for (const k of shaft) move3(w, k, Ms)
  const kids = [...shaft]
  if (tip) {
    // Manim's tip is a 32 × 32 Cone; 2 × 32 faces look the same (its faces along the slant are coplanar).
    const cid = w.newId()
    const cone = coneKids(w, num(p.base_radius, 0.08), tipH, 2, 32, st, false)
    w.set(newMob(cid, 'cone', styleFrom(p), [], { children: cone, m3: IDENT3 }))
    const Mc = mul3(translate3(...e), alongDir(u))
    for (const k of cone) move3(w, k, Mc)
    kids.push(cid)
  }
  group3(env, id, kind, p, kids, IDENT3, { data: { start3: s, end3: e } })
  if (p.color != null) setColor(w, id, normColor(p.color, WHITE))
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
    // Manim's Dot3D: one colour (set_color), white unless given: as color=, or as fill/stroke colours (Python sends those).
    makeSphere(env, id, kind, { ...p, center: p.point ?? p.center, radius: num(p.radius, 0.08), resolution: p.resolution ?? [8, 8] }, [8, 8], { cb: false, fill: WHITE, sc: WHITE })
    if (p.color != null) setColor(env.w, id, normColor(p.color, WHITE))
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
  tetrahedron: (env, id, p, kind) => { const { V, F } = platonic('tetrahedron', num(p.edge_length, 1)); makePolyhedron(env, id, kind, p, V, F) },
  octahedron: (env, id, p, kind) => { const { V, F } = platonic('octahedron', num(p.edge_length, 1)); makePolyhedron(env, id, kind, p, V, F) },
  icosahedron: (env, id, p, kind) => { const { V, F } = platonic('icosahedron', num(p.edge_length, 1)); makePolyhedron(env, id, kind, p, V, F) },
  dodecahedron: (env, id, p, kind) => { const { V, F } = platonic('dodecahedron', num(p.edge_length, 1)); makePolyhedron(env, id, kind, p, V, F) },
  polyhedron: (env, id, p, kind) => {
    const V = ((p.vertex_coords ?? []) as unknown[]).map(v => resolvePoint3(env.w, v))
    const F = Array.isArray(p.faces_list) ? (p.faces_list as number[][]).map(f => f.map(Number)) : hullFaces(V)
    makePolyhedron(env, id, kind, p, V, F)
  },
  three_d_axes: (env, id, p, kind) => makeThreeDAxes(env, id, kind, p),
}
