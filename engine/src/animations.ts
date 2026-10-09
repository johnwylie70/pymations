/**
 * Animations: each spec from play() becomes a Node that can draw itself at any
 * local time (no state carried between frames, so scrubbing is free), plus the
 * changes it makes to the scene when it starts (an introducer adds its object)
 * and when it ends (FadeOut removes, Transform reshapes, .animate applies).
 *
 * Expensive work happens once, when the animation is built: morph pairs are
 * aligned point for point here, so a frame only blends arrays. Moves, scales,
 * turns and fades only change matrices and alpha.
 *
 * Timing and defaults follow Manim CE: run_time 1 and `smooth`; Create has
 * lag_ratio 1 over its parts; Write is linear with lag min(4/n, 0.2) and run
 * time 1 (2 from 15 parts); DrawBorderThenFill runs 2 s on double_smooth;
 * Indicate is there_and_back; groups default to lag 0, LaggedStart to 0.05.
 */
import type { Pt, Subpath } from './geometry-types'
import { IDENTITY, invert, lerpMat, mul, rotateAbout, scaleAbout, translate, type Mat } from './math'
import { alignPaths, bbox, circleSub, lerpPaths, pointAt, polySub, rectCorners, transformPaths } from './geometry'
import { linear, rateByName, smooth, thereAndBack, type RateFn } from './rate'
import {
  addToDisplay, become, boxCenter, CAMERA, centerOf, critical, family, familyBox, familyBox3, hasGeom, is3D, isShown, leaves,
  removeFromDisplay, styleFamily, transformFamily, transformFamily3, World, worldP3, type ImageRef, type Mob, type Snap, type Style,
} from './scene'
import { endPoint, evalClock, evalValue, isMobRef, pointOf3, normArgs, num, resolvePoint, resolvePoint3, resolveTarget, resolveVec, withPoint, type Kw } from './args'
import type { Box } from './geometry'
import { camOf, camPatch, runOp, rotationMat, syncCamTrackers, type CamState, type OpEnv } from './ops'
import { apply3, embed, invert3, IDENT3, lerp3, mul3, proj, rot3, translate3, type V3 } from './math3'
import { reconcile } from './render3d'
import { lerpColor, normColor, PURE_YELLOW, YELLOW } from './color'
import { Frame, lerpStyle, type DrawItem } from './frame'
import { isNumber, setNumberValue } from './kinds'

export interface AnimSpec {
  kind: string
  target?: unknown
  args?: unknown
  run_time?: number
  rate_func?: string
  lag_ratio?: number
  items?: AnimSpec[]
}

type Effect = (w: World) => void

/** A built animation: draws itself at local time t (seconds). */
export interface Node {
  run: number
  /** Adds its object when it starts (so before it starts it must hide it). */
  intro: boolean
  /** Was that object already on screen before the play? Then hiding it early would be wrong. */
  shownBefore: boolean
  frame(t: number, f: Frame): void
  /** Scene changes, at local times. */
  events(): Array<{ t: number; end: boolean; fn: Effect }>
}

export interface BuildCtx {
  w: World
  /** The scene when play() was called (before any introducer added anything). */
  pre: Snap
  env: OpEnv
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

export function subAlpha(alpha: number, i: number, n: number, lag: number): number {
  if (n <= 1 || lag <= 0) return alpha
  const full = (n - 1) * lag + 1
  return clamp01(alpha * full - i * lag)
}

/* ----------------------------------------------------------------- leaves */

interface Leaf {
  run: number
  rate: RateFn
  lag: number
  intro?: boolean
  target?: number
  apply(alpha: number, f: Frame, rate: RateFn, lag: number): void
  begin?: Effect
  /** r1 = the rate at the end (1 normally; 0 for there_and_back, which ends where it started). */
  end?: (w: World, r1: number) => void
}

/** Apply a matrix (as a function of eased alpha) to every drawn part of a target. */
/** A path's point at a proportion of its 3D length (3D curves, and outlines turned in 3D). */
function pathAt3(parts: Mob[]): (x: number) => V3 {
  const pts: V3[] = []
  for (const m of parts) {
    if (m.p3 && m.p3.length) {
      const wp = worldP3(m)
      for (let k = 0; k < wp.length; k += 3) pts.push([wp[k], wp[k + 1], wp[k + 2]])
      if (m.closed3 && wp.length >= 6) pts.push([wp[0], wp[1], wp[2]])
      continue
    }
    const M = m.m3 ?? embed(m.m)
    for (const sp of m.paths) {
      const P = sp.points
      for (let k = 0; k + 3 < P.length; k += 3) for (let s = k === 0 ? 0 : 1; s <= 16; s++) {
        const t = s / 16, u = 1 - t
        const x = u * u * u * P[k][0] + 3 * u * u * t * P[k + 1][0] + 3 * u * t * t * P[k + 2][0] + t * t * t * P[k + 3][0]
        const y = u * u * u * P[k][1] + 3 * u * u * t * P[k + 1][1] + 3 * u * t * t * P[k + 2][1] + t * t * t * P[k + 3][1]
        pts.push(apply3(M, x, y, 0))
      }
    }
  }
  if (!pts.length) return () => [0, 0, 0]
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]))
  const L = cum[cum.length - 1]
  return x => {
    if (L <= 0) return pts[0]
    const d = Math.max(0, Math.min(1, x)) * L
    let lo = 0, hi = cum.length - 1
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid }
    const t = (d - cum[lo]) / ((cum[hi] - cum[lo]) || 1)
    return [0, 1, 2].map(i => pts[lo][i] + (pts[hi][i] - pts[lo][i]) * t) as V3
  }
}

function matrixLeaf(ids: number[], M: (a: number) => Mat, alphaOf?: (a: number) => number): Leaf['apply'] {
  return (alpha, f, rate, lag) => {
    const n = ids.length
    ids.forEach((id, i) => {
      const o = f.get(id)
      if (!o) return
      const a = rate(subAlpha(alpha, i, n, lag))
      o.m = mul(M(a), o.m)
      if (alphaOf) o.alpha *= alphaOf(a)
    })
  }
}

function worldPaths(m: Mob): Subpath[] {
  return m.paths.length ? transformPaths(m.paths, m.m) : []
}

interface MorphPair {
  A: Subpath[]
  B: Subpath[]
  sa: Style
  sb: Style
  z: number
  /** Text drawn with fillText cannot be morphed: cross-fade instead. */
  fadeA?: Mob
  fadeB?: Mob
  /** Transform's path_arc: points travel on arcs of this angle instead of straight. */
  arc?: number
  /** 3D morph (either side lives in 3D): both as equal-length 3D polylines (flat xyz). */
  A3?: number[]
  B3?: number[]
  closed3?: boolean
  shade3?: boolean
}

/** A part in 3D as one polyline: its 3D points, or its outline sampled and mapped (8 points per curve). */
function world3(m: Mob): { pts: number[]; closed: boolean } {
  if (m.p3 && m.p3.length) return { pts: worldP3(m), closed: !!m.closed3 }
  const M = m.m3 ?? embed(m.m)
  const pts: number[] = []
  let closed = false
  for (const sp of m.paths) {
    const P = sp.points
    closed = closed || sp.closed
    if (P.length) pts.push(...apply3(M, P[0][0], P[0][1], 0))
    for (let i = 0; i + 3 < P.length; i += 3) {
      for (let k = 1; k <= 8; k++) {
        const t = k / 8, u = 1 - t
        const x = u * u * u * P[i][0] + 3 * u * u * t * P[i + 1][0] + 3 * u * t * t * P[i + 2][0] + t * t * t * P[i + 3][0]
        const y = u * u * u * P[i][1] + 3 * u * u * t * P[i + 1][1] + 3 * u * t * t * P[i + 2][1] + t * t * t * P[i + 3][1]
        pts.push(...apply3(M, x, y, 0))
      }
    }
  }
  return { pts, closed }
}

/** A polyline resampled to n points evenly along its length. */
function resample3(pts: number[], n: number, closed: boolean, fallback: number[]): number[] {
  if (pts.length < 3) {
    const out: number[] = []
    for (let i = 0; i < n; i++) out.push(fallback[0], fallback[1], fallback[2] ?? 0)
    return out
  }
  const P = closed ? [...pts, pts[0], pts[1], pts[2]] : pts
  const m = P.length / 3
  const cum = [0]
  for (let i = 1; i < m; i++) cum.push(cum[i - 1] + Math.hypot(P[3 * i] - P[3 * i - 3], P[3 * i + 1] - P[3 * i - 2], P[3 * i + 2] - P[3 * i - 1]))
  const L = cum[m - 1] || 1
  const out: number[] = []
  let j = 1
  for (let i = 0; i < n; i++) {
    const d = (L * i) / (closed ? n : Math.max(1, n - 1))
    while (j < m - 1 && cum[j] < d) j++
    const t = (d - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1)
    for (let c = 0; c < 3; c++) out.push(P[3 * (j - 1) + c] + (P[3 * j + c] - P[3 * (j - 1) + c]) * Math.max(0, Math.min(1, t)))
  }
  return out
}

const faded = (st: Style): Style => ({ ...st, so: 0, fo: 0 })

/**
 * Pair up the drawn parts of two objects and align each pair. When one side
 * has fewer parts, its parts are reused for the extra ones as faded copies
 * (Manim's alignment), so a part appears from or melts into its neighbour.
 */
function morphPairs(s: Snap | World, srcIds: number[], t: Snap | World, tgtIds: number[], fallbackSrc: Pt, fallbackTgt: Pt, arc = 0): MorphPair[] {
  const S = srcIds.map(i => s.mobs.get(i)), T = tgtIds.map(i => t.mobs.get(i))
  const n = Math.max(S.length, T.length)
  const out: MorphPair[] = []
  let lastA = -1, lastB = -1
  for (let i = 0; i < n; i++) {
    const ia = S.length ? Math.floor((i * S.length) / n) : -1
    const ib = T.length ? Math.floor((i * T.length) / n) : -1
    const a = ia >= 0 ? S[ia] : null, b = ib >= 0 ? T[ib] : null
    const copyA = ia === lastA, copyB = ib === lastB
    lastA = ia; lastB = ib
    if ((a && (a.text || a.image) && !a.paths.length) || (b && (b.text || b.image) && !b.paths.length)) {
      out.push({ A: [], B: [], sa: a?.style, sb: b?.style, z: (b || a).z, fadeA: a && !copyA ? a : undefined, fadeB: b && !copyB ? b : undefined })
      continue
    }
    const sb = b ? (copyB ? faded(b.style) : b.style) : faded(a.style)
    const sa = a ? (copyA ? faded(a.style) : a.style) : faded(b.style)
    if ((a && (a.p3 || a.m3)) || (b && (b.p3 || b.m3))) {
      // 3D: both sides as polylines with the same number of points, blended point by point.
      const wa = a ? world3(a) : { pts: [], closed: false }, wb = b ? world3(b) : { pts: [], closed: false }
      const nPts = Math.max(wa.pts.length / 3, wb.pts.length / 3, 4)
      const closed = (a ? wa.closed : wb.closed) && (b ? wb.closed : wa.closed)
      const A3 = resample3(wa.pts, nPts, closed, [fallbackSrc[0], fallbackSrc[1], 0])
      const B3 = resample3(wb.pts, nPts, closed, [fallbackTgt[0], fallbackTgt[1], 0])
      out.push({ A: [], B: [], A3, B3, closed3: closed, shade3: !!(a?.shade3 || b?.shade3), sa, sb, z: b ? b.z : a.z })
      continue
    }
    const [A, B] = alignPaths(a ? worldPaths(a) : [], b ? worldPaths(b) : [], fallbackSrc, fallbackTgt)
    out.push({ A, B, sa, sb, z: b ? b.z : a.z, arc })
  }
  return out
}

/** Blend along arcs (Manim's path_arc): each point turns about the centre that carries it to its partner. */
function arcPaths(A: Subpath[], B: Subpath[], t: number, angle: number): Subpath[] {
  if (t <= 0) return A
  if (t >= 1) return B
  const k = 1 / (2 * Math.tan(angle / 2))
  const c = Math.cos(t * angle), sn = Math.sin(t * angle)
  return A.map((sa, i) => ({
    closed: t < 0.5 ? sa.closed : B[i].closed,
    points: sa.points.map((p, j) => {
      const q = B[i].points[j]
      const vx = q[0] - p[0], vy = q[1] - p[1]
      const cx = p[0] + vx / 2 - vy * k, cy = p[1] + vy / 2 + vx * k
      const dx = p[0] - cx, dy = p[1] - cy
      return [cx + c * dx - sn * dy, cy + sn * dx + c * dy] as Pt
    }),
  }))
}

function morphItems(pairs: MorphPair[], alpha: number, rate: RateFn, lag: number, out: DrawItem[] = []): DrawItem[] {
  const n = pairs.length
  pairs.forEach((p, i) => {
    const a = rate(subAlpha(alpha, i, n, lag))
    if (p.fadeA || p.fadeB) {
      if (p.fadeA) out.push(itemOf(p.fadeA, 1 - a))
      if (p.fadeB) out.push(itemOf(p.fadeB, a))
      return
    }
    if (p.A3) {
      const p3 = a <= 0 ? p.A3 : a >= 1 ? p.B3 : p.A3.map((v, k) => v + (p.B3[k] - v) * a)
      out.push({ paths: [], m: IDENTITY, m3: IDENT3, p3, closed3: p.closed3, shade3: p.shade3, style: lerpStyle(p.sa, p.sb, a), alpha: 1, partial: null, z: p.z })
      return
    }
    const paths = p.arc && Math.abs(p.arc) > 1e-6 ? arcPaths(p.A, p.B, a, p.arc) : lerpPaths(p.A, p.B, a)
    out.push({ paths, m: IDENTITY, style: lerpStyle(p.sa, p.sb, a), alpha: 1, partial: null, z: p.z })
  })
  return out
}

function itemOf(m: Mob, alpha: number): DrawItem {
  return {
    paths: m.paths, m: m.m, style: m.style, alpha, partial: null, z: m.z, text: m.text, image: m.image, shadow: m.shadow, evenodd: m.evenodd,
    ...(m.m3 ? { m3: m.m3 } : {}), ...(m.p3 ? { p3: m.p3, closed3: m.closed3 } : {}), ...(m.shade3 ? { shade3: true } : {}), ...(m.fixed ? { fixed: m.fixed } : {}),
  }
}

/** Swap `a` for `b` in the scene list and in any group holding `a` (ReplacementTransform's end: same layer, same slot). */
function replaceInDisplay(w: World, a: number, b: number) {
  for (const m of Array.from(w.mobs.values())) {
    if (m.id !== b && m.children.includes(a)) w.update(m.id, { children: m.children.map(c => (c === a ? b : c)) })
  }
  const i = w.display.indexOf(a)
  if (i >= 0) {
    const next = w.display.filter(x => x !== b)
    next[next.indexOf(a)] = b
    w.setDisplay(next)
  } else {
    removeFromDisplay(w, [a])
    addToDisplay(w, [b])
  }
}

function outlineStyle(s: Style, width: number): Style {
  return { sc: s.sw > 0 ? s.sc : s.fc, fc: s.fc, sw: width, so: 1, fo: 0 }
}

/** DrawBorderThenFill on one part at eased alpha a. */
function dbf(f: Frame, id: number, a: number, width: number) {
  const o = f.get(id)
  if (!o) return
  const mob = f.scene.mobs.get(id)
  if (!mob.paths.length && !(mob.p3 && mob.p3.length)) { o.alpha *= a; return }
  const out = outlineStyle(o.style, width)
  if (a < 0.5) {
    o.partial = [0, a * 2]
    o.style = out
  } else o.style = lerpStyle(out, o.style, a * 2 - 1)
}

function rectAround(w: World, id: number, buff: number, circle: boolean): Subpath[] {
  const b = familyBox(w, id)
  const c = boxCenter(b)
  if (circle) return [circleSub(c, Math.hypot(b[2] - b[0], b[3] - b[1]) / 2 + buff)]
  return transformPaths([polySub(rectCorners(b[2] - b[0] + 2 * buff, b[3] - b[1] + 2 * buff), true)], translate(c[0], c[1]))
}

/** The map that puts box A onto box B (stretching unless keep-aspect). */
function boxMap(A: Box, B: Box, stretch: boolean): Mat {
  let sx = (B[2] - B[0]) / ((A[2] - A[0]) || 1), sy = (B[3] - B[1]) / ((A[3] - A[1]) || 1)
  if ((A[2] - A[0]) < 1e-9) sx = sy
  if ((A[3] - A[1]) < 1e-9) sy = sx
  if (!stretch) sx = sy = Math.min(sx, sy)
  const ca: Pt = [(A[0] + A[2]) / 2, (A[1] + A[3]) / 2], cb: Pt = [(B[0] + B[2]) / 2, (B[1] + B[3]) / 2]
  return mul(translate(cb[0] - ca[0], cb[1] - ca[1]), scaleAbout(sx, sy, ca))
}

/** A point travelling from p to q along an arc of `angle` (straight when 0), at x. */
function arcPoint(p: Pt, q: Pt, x: number, angle: number): Pt {
  if (Math.abs(angle) < 1e-6) return [p[0] + (q[0] - p[0]) * x, p[1] + (q[1] - p[1]) * x]
  const k = 1 / (2 * Math.tan(angle / 2))
  const vx = q[0] - p[0], vy = q[1] - p[1]
  const cx = p[0] + vx / 2 - vy * k, cy = p[1] + vy / 2 + vx * k
  const c = Math.cos(x * angle), s = Math.sin(x * angle)
  const dx = p[0] - cx, dy = p[1] - cy
  return [cx + c * dx - s * dy, cy + s * dx + c * dy]
}

/** ShowPassingFlash: a window of `tw` sliding along the path. */
function flashWindow(a: number, tw: number): [number, number] {
  const upper = a * (1 + tw)
  return [Math.max(0, upper - tw), Math.min(1, upper)]
}

const LEAF_PARAMS: Record<string, string[]> = {
  apply_pointwise_function: ['function'],
  apply_complex_function: ['function'],
  homotopy: ['homotopy'],
  complex_homotopy: ['complex_homotopy'],
  apply_wave: ['direction', 'amplitude'],
  swap: ['*mobjects'],
  cyclic_replace: ['*mobjects'],
  broadcast: ['focal_point'],
  focus_on: ['focus_point'],
  blink: ['time_on', 'time_off', 'blinks', 'hide_at_end'],
  fade_in: ['shift', 'target_position', 'scale'],
  fade_out: ['shift', 'target_position', 'scale'],
  transform: ['target_mobject', 'path_arc'],
  replacement_transform: ['target_mobject', 'path_arc'],
  transform_from_copy: ['target_mobject', 'path_arc'],
  transform_matching_tex: ['target_mobject'],
  transform_matching_shapes: ['target_mobject'],
  fade_transform: ['target_mobject'],
  grow_from_point: ['point'],
  grow_from_edge: ['edge'],
  spin_in_from_nothing: ['angle'],
  indicate: ['scale_factor', 'color'],
  circumscribe: ['shape', 'fade_in', 'fade_out', 'time_width', 'buff', 'color'],
  flash: ['point', 'line_length', 'num_lines', 'flash_radius', 'line_stroke_width', 'color', 'time_width'],
  wiggle: ['scale_value', 'rotation_angle', 'n_wiggles'],
  rotate: ['angle', 'axis', 'about_point', 'about_edge'],
  move_along_path: ['path'],
  animate: ['ops'],
  change_decimal_to_value: ['number'],
  move_camera: ['phi', 'theta', 'gamma', 'zoom', 'focal_distance', 'frame_center'],
  changing_decimal: ['function'],
  show_passing_flash: ['time_width'],
  draw_border_then_fill: ['stroke_width'],
}

export const ANIM_KINDS = [
  'create', 'uncreate', 'write', 'unwrite', 'draw_border_then_fill', 'fade_in', 'fade_out', 'transform',
  'replacement_transform', 'transform_from_copy', 'transform_matching_tex', 'transform_matching_shapes',
  'fade_transform', 'grow_from_center', 'grow_from_point', 'grow_from_edge', 'grow_arrow', 'shrink_to_center',
  'spin_in_from_nothing', 'indicate', 'circumscribe', 'flash', 'wiggle', 'rotate', 'move_along_path', 'animate',
  'show_passing_flash', 'restore', 'change_decimal_to_value', 'apply_pointwise_function', 'apply_complex_function',
  'homotopy', 'complex_homotopy', 'apply_wave', 'show_increasing_subsets', 'show_submobjects_one_by_one',
  'add_text_letter_by_letter', 'remove_text_letter_by_letter', 'swap', 'cyclic_replace', 'fade_transform_pieces',
  'broadcast', 'blink', 'focus_on', 'change_speed', 'changing_decimal', 'move_camera', 'wait', 'group', 'lagged', 'succession',
]

const ANIM_ALIASES: Record<string, string> = {
  _animate: 'animate', _method_animation: 'animate', method_animation: 'animate', move_to_target: 'transform',
  rotating: 'rotate', show_creation: 'create', clockwise_transform: 'transform', counterclockwise_transform: 'transform',
  lagged_start: 'lagged', animation_group: 'group',
}

/** "FadeIn", ".animate", "fade_in" → this file's name. */
export function animName(kind: string): string {
  const snake = String(kind || '').replace(/^\./, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z])([A-Z][a-z])/g, '$1_$2').toLowerCase()
  return ANIM_ALIASES[snake] || snake
}

/** Leaves that only act on an object the scene may not have yet: Manim adds it when the play starts. */
const NO_TOUCH = new Set(['wait', 'flash', 'transform_from_copy', 'broadcast', 'focus_on', 'swap', 'cyclic_replace', 'fade_transform', 'fade_transform_pieces'])

function buildLeaf(spec: AnimSpec, ctx: BuildCtx): Leaf {
  const leaf = buildLeafInner(spec, ctx)
  const kind = animName(spec.kind)
  if (!leaf.begin && !NO_TOUCH.has(kind) && spec.target != null && spec.target !== 0) {
    const id = resolveTarget(ctx.w, spec.target)
    leaf.begin = v => { if (!isShown(v, id)) addToDisplay(v, [id]) }
  }
  return leaf
}

function buildLeafInner(spec: AnimSpec, ctx: BuildCtx): Leaf {
  const w = ctx.w
  const kind = animName(spec.kind)
  const a: Kw = normArgs(spec.args, LEAF_PARAMS[kind] || [])
  if (a.to != null && a.target_mobject == null) a.target_mobject = a.to
  const tgt = (): number => resolveTarget(w, spec.target)
  const L = (base: Partial<Leaf> & Pick<Leaf, 'apply'>): Leaf => ({ run: 1, rate: smooth, lag: 0, ...base })

  switch (kind) {
    case 'wait':
      return L({ run: num(a.duration ?? spec.run_time, 1), apply: () => {} })

    case 'fade_in':
    case 'fade_out': {
      const id = tgt(), ids = leaves(w, id), c = centerOf(w, id)
      const sh = a.shift != null ? resolvePoint(w, a.shift) : [0, 0]
      const k = num(a.scale, 1)
      if (kind === 'fade_in') {
        let S: Mat = mul(scaleAbout(k, k, [c[0] - sh[0], c[1] - sh[1]]), translate(-sh[0], -sh[1]))
        if (a.target_position != null) {
          const tp = isMobRef(a.target_position) ? centerOf(w, resolveTarget(w, a.target_position)) : resolvePoint(w, a.target_position)
          S = translate(tp[0] - c[0], tp[1] - c[1])
        }
        return L({ intro: true, target: id, apply: matrixLeaf(ids, x => lerpMat(S, IDENTITY, x), x => x), begin: v => addToDisplay(v, [id]) })
      }
      const E: Mat = mul(scaleAbout(k, k, [c[0] + sh[0], c[1] + sh[1]]), translate(sh[0], sh[1]))
      return L({ apply: matrixLeaf(ids, x => lerpMat(IDENTITY, E, x), x => 1 - x), end: v => removeFromDisplay(v, [id]) })
    }

    case 'create':
    case 'uncreate':
    case 'show_passing_flash': {
      const id = tgt(), ids = leaves(w, id)
      const tw = num(a.time_width, 0.1)
      const window = kind === 'create' ? (x: number): [number, number] => [0, x]
        : kind === 'uncreate' ? (x: number): [number, number] => [0, 1 - x]
        : (x: number) => flashWindow(x, tw)
      const apply: Leaf['apply'] = (alpha, f, rate, lag) => {
        ids.forEach((pid, i) => {
          const o = f.get(pid)
          if (!o) return
          const x = rate(subAlpha(alpha, i, ids.length, lag))
          const mob = f.scene.mobs.get(pid)
          if (!mob.paths.length && !(mob.p3 && mob.p3.length)) { o.alpha *= kind === 'create' ? x : 1 - x; return }
          o.partial = window(x)
        })
      }
      if (kind === 'create') return L({ lag: 1, intro: true, target: id, apply, begin: v => addToDisplay(v, [id]) })
      if (kind === 'uncreate') return L({ lag: 1, apply, end: v => removeFromDisplay(v, [id]) })
      return L({ apply, intro: true, target: id, begin: v => addToDisplay(v, [id]), end: v => removeFromDisplay(v, [id]) })
    }

    case 'write':
    case 'unwrite':
    case 'draw_border_then_fill': {
      const id = tgt(), ids = leaves(w, id), n = ids.length
      const width = num(a.stroke_width, 2)
      if (kind === 'draw_border_then_fill') {
        return L({
          run: 2, rate: rateByName('double_smooth'), intro: true, target: id,
          apply: (alpha, f, rate, lag) => ids.forEach((pid, i) => dbf(f, pid, rate(subAlpha(alpha, i, n, lag)), width)),
          begin: v => addToDisplay(v, [id]),
        })
      }
      // n is Manim's count of parts with points. Text drawn with fillText (no
      // font yet, or none) is one part here but counts its visible characters,
      // so the timeline is the same before and after fonts arrive.
      let parts = 0
      for (const pid of ids) {
        const t = w.get(pid).text
        parts += t ? Math.max(1, Array.from(t.str).filter(c => c.trim()).length) : 1
      }
      const run = parts < 15 ? 1 : 2
      const lag = Math.min(4 / Math.max(1, parts), 0.2)
      // reverse: the last part goes first (Unwrite's default, Write's option).
      const order = (i: number) => ((kind === 'write' ? !!a.reverse : a.reverse !== false) ? n - 1 - i : i)
      if (kind === 'write') {
        return L({
          run, rate: linear, lag, intro: true, target: id,
          apply: (alpha, f, rate, lg) => ids.forEach((pid, i) => dbf(f, pid, rate(subAlpha(alpha, order(i), n, lg)), width)),
          begin: v => addToDisplay(v, [id]),
        })
      }
      return L({
        run, rate: linear, lag,
        apply: (alpha, f, rate, lg) => ids.forEach((pid, i) => dbf(f, pid, 1 - rate(subAlpha(alpha, order(i), n, lg)), width)),
        end: v => removeFromDisplay(v, [id]),
      })
    }

    case 'transform':
    case 'replacement_transform':
    case 'transform_from_copy':
    case 'transform_matching_shapes':
    case 'transform_matching_tex': {
      const src = tgt()
      const dst = resolveTarget(w, a.target_mobject)
      const cs = centerOf(w, src), cd = centerOf(w, dst)
      if (kind === 'transform_matching_tex' || kind === 'transform_matching_shapes') {
        const m = kind === 'transform_matching_tex' ? matchTex(w, src, dst, cs, cd) : matchShapes(w, src, dst, cs, cd)
        if (m) {
          return L({
            apply: (alpha, f, rate) => {
              const o = f.get(src)
              if (!o) return
              const x = rate(alpha)
              const items = morphItems(m.pairs, alpha, rate, 0)
              for (const id of m.out) items.push(itemOf(f.scene.mobs.get(id) || w.get(id), 1 - x))
              for (const id of m.in) items.push(itemOf(w.get(id), x))
              o.replace = items
              const ob = f.get(dst)
              if (ob && dst !== src) ob.hidden = true
            },
            end: v => replaceInDisplay(v, src, dst),
          })
        }
      }
      const pairs = morphPairs(w, leaves(w, src), w, leaves(w, dst), cd, cs, num(a.path_arc, 0))
      const anchor = kind === 'transform_from_copy' ? dst : src
      const srcParts = family(w, src).filter(i => i !== src)
      const apply: Leaf['apply'] = (alpha, f, rate, lag) => {
        const o = f.get(anchor)
        if (!o) return
        o.replace = morphItems(pairs, alpha, rate, lag)
        // Parts of the source that are on screen by themselves (Create(group[0]))
        // are drawn by the morph too: hide their own copies.
        if (kind !== 'transform_from_copy') for (const i of srcParts) { const p = f.get(i); if (p) p.hidden = true }
        if (kind !== 'transform_from_copy' && dst !== src) {
          const ob = f.get(dst)
          if (ob) ob.hidden = true
        }
      }
      if (kind === 'transform') return L({ apply, end: v => become(v, src, dst) })
      if (kind === 'transform_from_copy') return L({ apply, intro: true, target: dst, begin: v => addToDisplay(v, [dst]) })
      return L({ apply, end: v => replaceInDisplay(v, src, dst) })
    }

    case 'grow_from_center':
    case 'grow_from_point':
    case 'grow_from_edge':
    case 'grow_arrow':
    case 'spin_in_from_nothing':
    case 'shrink_to_center': {
      const id = tgt(), ids = leaves(w, id)
      let p: Pt = centerOf(w, id)
      if (kind === 'grow_from_point') p = isMobRef(a.point) ? centerOf(w, resolveTarget(w, a.point)) : resolvePoint(w, a.point ?? [0, 0])
      if (kind === 'grow_from_edge') p = critical(familyBox(w, id), resolveVec(w, a.edge, [0, -1]))
      if (kind === 'grow_arrow') p = endPoint(w, id, 'start')
      const Z: Mat = [0, 0, 0, 0, p[0], p[1]]
      if (kind === 'shrink_to_center') {
        // Not a remover in Manim: it ends as a zero-size object, still in the scene.
        return L({ apply: matrixLeaf(ids, x => lerpMat(IDENTITY, Z, x)), end: v => transformFamily(v, id, Z) })
      }
      const ang = kind === 'spin_in_from_nothing' ? num(a.angle, Math.PI / 2) : 0
      const M = (x: number) => (ang ? mul(rotateAbout(-(1 - x) * ang, p), scaleAbout(x, x, p)) : lerpMat(Z, IDENTITY, x))
      const grow = matrixLeaf(ids, M)
      // An arrow's stroke grows with it (Manim scales arrow strokes with the arrow).
      const apply: Leaf['apply'] = kind !== 'grow_arrow' ? grow : (alpha, f, rate, lag) => {
        grow(alpha, f, rate, lag)
        ids.forEach((pid, i) => {
          const o = f.get(pid)
          if (o) o.style = { ...o.style, sw: o.style.sw * rate(subAlpha(alpha, i, ids.length, lag)) }
        })
      }
      return L({ intro: true, target: id, apply, begin: v => addToDisplay(v, [id]) })
    }

    case 'restore': {
      // Transform back to the copy save_state() kept.
      const id = tgt()
      const saved = w.get(id).data?.saved
      if (saved == null || !w.has(saved)) throw new Error('Restore needs save_state() first')
      const pairs = morphPairs(w, leaves(w, id), w, leaves(w, saved), centerOf(w, saved), centerOf(w, id), num(a.path_arc, 0))
      const keep = w.get(id).data
      return L({
        apply: (alpha, f, rate, lag) => { const o = f.get(id); if (o) o.replace = morphItems(pairs, alpha, rate, lag) },
        end: v => { become(v, id, saved); v.update(id, { data: { ...(v.get(id).data || {}), saved: keep.saved } }) },
      })
    }

    case 'indicate': {
      const id = tgt(), ids = leaves(w, id), c = centerOf(w, id)
      const k = num(a.scale_factor, 1.2)
      const col = normColor(a.color ?? PURE_YELLOW, PURE_YELLOW)
      return L({
        rate: thereAndBack,
        apply: (alpha, f, rate, lag) => ids.forEach((pid, i) => {
          const o = f.get(pid)
          if (!o) return
          const x = rate(subAlpha(alpha, i, ids.length, lag))
          o.m = mul(scaleAbout(1 + (k - 1) * x, 1 + (k - 1) * x, c), o.m)
          o.style = lerpStyle(o.style, { ...o.style, sc: col, fc: col }, x)
        }),
      })
    }

    case 'circumscribe': {
      const id = tgt()
      const paths = rectAround(w, id, num(a.buff, 0.1), String(a.shape || '').toLowerCase() === 'circle')
      const col = normColor(a.color ?? YELLOW, YELLOW)
      const tw = num(a.time_width, 0.3)
      const style: Style = { sc: col, fc: col, sw: num(a.stroke_width, 4), so: 1, fo: 0 }
      // A Succession (linear) around a ShowPassingFlash that eases with smooth.
      return L({
        rate: linear,
        apply: (alpha, f, rate) => {
          const x = smooth(rate(alpha))
          let partial: [number, number]
          let op = 1
          if (a.fade_out) { partial = [0, Math.min(1, x * 2)]; op = x < 0.5 ? 1 : 2 - 2 * x }
          else if (a.fade_in) { partial = [0, 1]; op = x < 0.5 ? 2 * x : 2 - 2 * x }
          else partial = flashWindow(x, tw)
          f.extras.push({ paths, m: IDENTITY, style, alpha: op, partial, z: 1e6 })
        },
      })
    }

    case 'flash': {
      const where = spec.target != null ? spec.target : a.point
      const c = isMobRef(where) ? centerOf(w, resolveTarget(w, where)) : resolvePoint(w, where ?? [0, 0])
      const nLines = Math.max(1, Math.round(num(a.num_lines, 12)))
      const r0 = num(a.flash_radius, 0.1) + 0.2, len = num(a.line_length, 0.2)
      const col = normColor(a.color ?? YELLOW, YELLOW)
      const tw = num(a.time_width, 1)
      const style: Style = { sc: col, fc: col, sw: num(a.line_stroke_width, 3), so: 1, fo: 0 }
      const lines: Subpath[] = []
      for (let i = 0; i < nLines; i++) {
        const t = (2 * Math.PI * i) / nLines, dx = Math.cos(t), dy = Math.sin(t)
        lines.push(polySub([[c[0] + dx * r0, c[1] + dy * r0], [c[0] + dx * (r0 + len), c[1] + dy * (r0 + len)]], false))
      }
      // A group (linear) of ShowPassingFlash lines, each easing with smooth.
      return L({
        rate: linear,
        apply: (alpha, f, rate) => {
          const win = flashWindow(smooth(rate(alpha)), tw)
          for (const l of lines) f.extras.push({ paths: [l], m: IDENTITY, style, alpha: 1, partial: win, z: 1e6 })
        },
      })
    }

    case 'wiggle': {
      const id = tgt(), ids = leaves(w, id), c = centerOf(w, id)
      const s = num(a.scale_value, 1.1), ang = num(a.rotation_angle, 0.01 * 2 * Math.PI), nw = num(a.n_wiggles, 6)
      return L({
        run: 2,
        apply: matrixLeaf(ids, x => {
          const k = 1 + (s - 1) * thereAndBack(x)
          return mul(rotateAbout(thereAndBack(x) * Math.sin(nw * Math.PI * x) * ang, c), scaleAbout(k, k, c))
        }),
      })
    }

    case 'rotate': {
      const id = tgt(), ids = leaves(w, id)
      const angle = num(a.angle, Math.PI)
      const ax = Array.isArray(a.axis) ? a.axis.map(Number) : [0, 0, 1]
      if (!(Math.abs(ax[0]) < 1e-12 && Math.abs(ax[1]) < 1e-12) || is3D(w, id)) {
        // A turn in 3D: each part's 3D map turns about the axis through the centre (or about_point).
        const b3 = familyBox3(w, id)
        const about3: V3 = a.about_point != null ? resolvePoint3(w, a.about_point) : [(b3[0] + b3[3]) / 2, (b3[1] + b3[4]) / 2, (b3[2] + b3[5]) / 2]
        const axis3 = ax as V3
        return L({
          apply: (alpha, f, rate, lag) => ids.forEach((pid, i) => {
            const o = f.get(pid)
            if (!o) return
            const R = rot3(axis3, angle * rate(subAlpha(alpha, i, ids.length, lag)), about3)
            o.m3 = mul3(R, reconcile(o.m, o.m3 ?? f.scene.mobs.get(pid).m3) ?? embed(o.m))
            o.m = proj(o.m3)
          }),
          end: v => transformFamily3(v, id, rot3(axis3, angle, about3)),
        })
      }
      const about: Pt = a.about_point != null ? resolvePoint(w, a.about_point)
        : a.about_edge != null ? critical(familyBox(w, id), resolveVec(w, a.about_edge, [0, 0])) : centerOf(w, id)
      return L({
        apply: matrixLeaf(ids, x => rotationMat(angle * x, a.axis, about)),
        end: v => transformFamily(v, id, rotationMat(angle, a.axis, about)),
      })
    }

    case 'move_along_path': {
      const id = tgt(), ids = leaves(w, id), c = centerOf(w, id)
      const pathId = resolveTarget(w, a.path)
      const pathParts = leaves(w, pathId).map(i => w.get(i))
      if (is3D(w, id) || pathParts.some(m => m.p3 || m.m3)) {
        // In 3D: the object's 3D centre follows the path's 3D points (Manim: move_to(point_from_proportion)).
        const c3 = pointOf3(w, id, 'center'), at3 = pathAt3(pathParts)
        const T = (x: number) => { const p = at3(x); return translate3(p[0] - c3[0], p[1] - c3[1], p[2] - c3[2]) }
        return L({
          apply: (alpha, f, rate) => {
            const M = T(rate(alpha))
            for (const pid of ids) {
              const o = f.get(pid)
              if (!o) continue
              o.m3 = mul3(M, reconcile(o.m, o.m3 ?? f.scene.mobs.get(pid).m3) ?? embed(o.m))
              o.m = proj(o.m3)
            }
          },
          end: v => transformFamily3(v, id, T(1)),
        })
      }
      const paths: Subpath[] = []
      for (const i of leaves(w, pathId)) paths.push(...worldPaths(w.get(i)))
      const at = (x: number): Mat => { const p = pointAt(paths, x); return translate(p[0] - c[0], p[1] - c[1]) }
      return L({ apply: matrixLeaf(ids, at), end: v => transformFamily(v, id, at(1)) })
    }

    case 'apply_pointwise_function':
    case 'apply_complex_function':
    case 'homotopy':
    case 'complex_homotopy':
    case 'apply_wave': {
      // Every point of the object is moved: by a traced function of ["p"]
      // (and ["alpha"] for a homotopy), or by a travelling bump (ApplyWave).
      const id = tgt(), ids = leaves(w, id)
      const fn = a.function ?? a.func ?? a.homotopy
      const src = ids.map(i => ({ id: i, mob: w.get(i), paths: worldPaths(w.get(i)) }))
      const complex = kind === 'apply_complex_function' || kind === 'complex_homotopy'
      const homotopy = kind === 'homotopy' || kind === 'complex_homotopy'
      const mapPt = (p: Pt, alpha: number): Pt => {
        evalClock.alpha = alpha
        evalClock.homotopy = homotopy
        const v = withPoint(p, () => evalValue(w, fn))
        evalClock.homotopy = false
        if (complex && typeof v !== 'number') return [v[0], v[1]]
        return typeof v === 'number' ? [v, 0] : [v[0], v[1]]
      }
      const mapPaths = (paths: Subpath[], f: (p: Pt) => Pt) => paths.map(sp => ({ closed: sp.closed, points: sp.points.map(f) }))
      if (kind === 'apply_wave') {
        const b = familyBox(w, id)
        const dir = resolveVec(w, a.direction, [0, 1])
        const amp = num(a.amplitude, 0.2), tw = num(a.time_width, 1), ripples = Math.max(1, num(a.ripples, 1))
        const width = b[2] - b[0] || 1
        const wave = (u: number, x: number) => {
          const r = (u - (x * (1 + tw) - tw)) / tw
          if (r <= 0 || r >= 1) return 0
          return ripples === 1 ? thereAndBack(r) : Math.sin(ripples * Math.PI * r) * thereAndBack(r)
        }
        return L({
          run: 2,
          apply: (alpha, f, rate) => {
            const x = rate(alpha)
            for (const s0 of src) {
              const o = f.get(s0.id)
              if (!o) continue
              const paths = mapPaths(s0.paths, p => { const d = amp * wave((p[0] - b[0]) / width, x); return [p[0] + dir[0] * d, p[1] + dir[1] * d] })
              o.replace = [{ paths, m: IDENTITY, style: o.style, alpha: o.alpha, partial: null, z: s0.mob.z }]
            }
          },
        })
      }
      if (fn == null) throw new Error(`${spec.kind} needs a function the preview can trace`)
      if (ids.some(i => { const m = w.get(i); return !!(m.p3 || m.m3) })) {
        // In 3D: every part as 3D points, mapped through the function (["var","p"] is a 3-vector).
        const map3 = (pts: number[], alpha: number) => {
          evalClock.alpha = alpha
          evalClock.homotopy = homotopy
          const out: number[] = []
          for (let k = 0; k < pts.length; k += 3) {
            const v = withPoint([pts[k], pts[k + 1], pts[k + 2]], () => evalValue(w, fn))
            if (typeof v === 'number') out.push(v, 0, 0)
            else out.push(v[0] || 0, v[1] || 0, complex ? pts[k + 2] : v[2] || 0)
          }
          evalClock.homotopy = false
          return out
        }
        const parts = ids.map(i => ({ id: i, mob: w.get(i), ...world3(w.get(i)) }))
        const ends3 = homotopy ? null : parts.map(q => map3(q.pts, 1))
        const item = (q: typeof parts[number], pts: number[], o: { style: Style; alpha: number }): DrawItem =>
          ({ paths: [], m: IDENTITY, m3: IDENT3, p3: pts, closed3: q.closed, shade3: q.mob.shade3, style: o.style, alpha: o.alpha, partial: null, z: q.mob.z })
        return L({
          run: 3,
          apply: (alpha, f, rate) => {
            const x = rate(alpha)
            parts.forEach((q, k) => {
              const o = f.get(q.id)
              if (!o) return
              const pts = homotopy ? map3(q.pts, x) : q.pts.map((v, j) => v + (ends3[k][j] - v) * x)
              o.replace = [item(q, pts, o)]
            })
          },
          end: v => parts.forEach((q, k) => {
            if (!v.has(q.id)) return
            v.update(q.id, { paths: [], p3: homotopy ? map3(q.pts, 1) : ends3[k], closed3: q.closed, m3: IDENT3, m: IDENTITY })
          }),
        })
      }
      // ApplyPointwiseFunction blends straight from the start to the mapped points (built once).
      const ends = homotopy ? null : src.map(s0 => mapPaths(s0.paths, p => mapPt(p, 1)))
      return L({
        run: 3,
        apply: (alpha, f, rate) => {
          const x = rate(alpha)
          src.forEach((s0, k) => {
            const o = f.get(s0.id)
            if (!o) return
            const paths = homotopy ? mapPaths(s0.paths, p => mapPt(p, x)) : lerpPaths(s0.paths, ends[k], x)
            o.replace = [{ paths, m: IDENTITY, style: o.style, alpha: o.alpha, partial: null, z: s0.mob.z }]
          })
        },
        end: v => src.forEach((s0, k) => {
          if (!v.has(s0.id)) return
          const paths = homotopy ? mapPaths(s0.paths, p => mapPt(p, 1)) : ends[k]
          v.update(s0.id, { paths, m: IDENTITY })
        }),
      })
    }

    case 'show_increasing_subsets':
    case 'show_submobjects_one_by_one':
    case 'add_text_letter_by_letter':
    case 'remove_text_letter_by_letter': {
      const id = tgt()
      const parts = kind.endsWith('letter_by_letter') ? leaves(w, id) : w.get(id).children
      const n = parts.length
      const fams = parts.map(p => family(w, p))
      const removing = kind === 'remove_text_letter_by_letter'
      const run = kind.endsWith('letter_by_letter') ? Math.max(0.06, num(a.time_per_char, 0.1) * n) : 1
      const apply: Leaf['apply'] = (alpha, f, rate) => {
        const v = rate(alpha) * n
        // AddTextLetterByLetter rounds up (ceil), ShowIncreasingSubsets down, unless int_func says otherwise.
        const up = a.int_func ? a.int_func === 'ceil' : kind.endsWith('letter_by_letter')
        let shown = up ? Math.ceil(v - 1e-9) : Math.floor(v + 1e-9)
        if (removing) shown = n - shown
        fams.forEach((fam, i) => {
          const hide = kind === 'show_submobjects_one_by_one' ? i !== Math.min(n - 1, shown) : i >= shown
          if (!hide) return
          for (const m of fam) { const o = f.get(m); if (o) o.hidden = true }
        })
      }
      if (removing) return L({ run, rate: linear, apply, end: v => removeFromDisplay(v, [id]) })
      return L({ run, rate: kind.endsWith('letter_by_letter') ? linear : smooth, intro: true, target: id, apply, begin: v => addToDisplay(v, [id]) })
    }

    case 'swap':
    case 'cyclic_replace': {
      const list: number[] = [...(spec.target != null ? [tgt()] : []), ...((a.mobjects || []) as unknown[]).map(m => resolveTarget(w, m))]
      const angle = num(a.path_arc, Math.PI / 2)
      const centers = list.map(i => centerOf(w, i))
      const moves = list.map((id, i) => {
        const p = centers[i], q = centers[(i + 1) % list.length]
        return { id, ids: leaves(w, id), at: (x: number): Mat => { const r = arcPoint(p, q, x, angle); return translate(r[0] - p[0], r[1] - p[1]) } }
      })
      return L({
        apply: (alpha, f, rate, lag) => { for (const mv of moves) matrixLeaf(mv.ids, mv.at)(alpha, f, rate, lag) },
        end: v => { for (const mv of moves) transformFamily(v, mv.id, mv.at(1)) },
      })
    }

    case 'fade_transform':
    case 'fade_transform_pieces': {
      const src = tgt(), dst = resolveTarget(w, a.target_mobject)
      const stretch = a.stretch !== false
      const pairs: Array<[number, number]> = kind === 'fade_transform_pieces' && w.get(src).children.length === w.get(dst).children.length && w.get(src).children.length
        ? w.get(src).children.map((c, i) => [c, w.get(dst).children[i]])
        : [[src, dst]]
      const legs = pairs.map(([s0, d0]) => {
        const A = familyBox(w, s0), B = familyBox(w, d0)
        return { s: leaves(w, s0), d: leaves(w, d0), toB: boxMap(A, B, stretch), toA: boxMap(B, A, stretch) }
      })
      return L({
        apply: (alpha, f, rate) => {
          const x = rate(alpha)
          for (const g of legs) {
            for (const i of g.s) { const o = f.get(i); if (o) { o.m = mul(lerpMat(IDENTITY, g.toB, x), o.m); o.alpha *= 1 - x } }
            for (const i of g.d) { const o = f.get(i); if (o) { o.m = mul(lerpMat(g.toA, IDENTITY, x), o.m); o.alpha *= x } }
          }
        },
        begin: v => addToDisplay(v, [dst]),
        end: v => removeFromDisplay(v, [src]),
      })
    }

    case 'broadcast': {
      const id = tgt(), ids = leaves(w, id), c = centerOf(w, id)
      const focal = a.focal_point != null ? resolvePoint(w, a.focal_point) : c
      const n = Math.max(1, Math.round(num(a.n_mobs, 5)))
      const b = familyBox(w, id)
      const k0 = num(a.initial_width, 0) / ((b[2] - b[0]) || 1)
      const op0 = num(a.initial_opacity, 1), op1 = num(a.final_opacity, 0)
      const mobs = ids.map(i => w.get(i))
      return L({
        run: 3, lag: num(spec.lag_ratio ?? a.lag_ratio, 0.2),
        apply: (alpha, f, rate, lag) => {
          for (let j = 0; j < n; j++) {
            const x = rate(subAlpha(alpha, j, n, lag))
            if (x <= 0 || x >= 1) continue
            const k = k0 + (1 - k0) * x
            const M = mul(scaleAbout(k, k, focal), translate(focal[0] - c[0], focal[1] - c[1]))
            for (const m of mobs) f.extras.push({ paths: m.paths, m: mul(M, m.m), style: m.style, alpha: op0 + (op1 - op0) * x, partial: null, z: m.z, text: m.text })
          }
        },
      })
    }

    case 'blink': {
      // Manim: visible for time_on, then (hidden time_off, visible time_on) × blinks; hide_at_end drops the last show.
      const id = tgt(), ids = leaves(w, id)
      const on = num(a.time_on, 0.5), off = num(a.time_off, 0.5), blinks = Math.max(1, Math.round(num(a.blinks, 1)))
      const hideEnd = !!a.hide_at_end
      const run = on + blinks * (off + on) - (hideEnd ? on : 0)
      return L({
        run, rate: linear,
        apply: (alpha, f) => {
          const t = alpha * run
          const hidden = alpha >= 1 ? hideEnd : t >= on && (t - on) % (off + on) < off
          if (hidden) for (const i of ids) { const o = f.get(i); if (o) o.alpha = 0 }
        },
        end: hideEnd ? v => styleFamily(v, id, s => ({ ...s, fo: 0, so: 0 })) : undefined,
      })
    }

    case 'focus_on': {
      const where = spec.target != null ? spec.target : a.focus_point
      const p = isMobRef(where) ? centerOf(w, resolveTarget(w, where)) : resolvePoint(w, where ?? [0, 0])
      const col = normColor(a.color ?? '#888888', '#888888')
      const op = num(a.opacity, 0.2)
      const R = Math.hypot(ctx.env.fw, ctx.env.fh)
      return L({
        run: 2,
        apply: (alpha, f, rate) => {
          const x = rate(alpha)
          const r = Math.max(1e-3, R * (1 - x))
          f.extras.push({ paths: [circleSub(p, r)], m: IDENTITY, style: { sc: col, fc: col, sw: 0, so: 0, fo: op * x }, alpha: 1, partial: null, z: 1e6 })
        },
      })
    }

    case 'animate':
      return buildAnimate(spec, a, ctx)

    case 'move_camera': {
      // ThreeDScene.move_camera: the camera's settings blend on the timeline (straight, like Manim's).
      const c0 = camOf(w)
      const c1 = { ...c0, ...camPatch(w, a), three_d: true }
      return L({
        apply: (alpha, f, rate) => {
          const o = f.get(CAMERA)
          if (!o) return
          const x = rate(alpha)
          o.cam = lerpCam(o.cam ?? c0, c1, x)
        },
        end: v => { const m = v.get(CAMERA); v.update(CAMERA, { data: { ...(m.data || {}), cam: c1 } }); syncCamTrackers(v) },
      })
    }

    case 'change_decimal_to_value':
      return buildAnimate(spec, { ops: [['set_value', [a.number ?? a.value ?? a.target_number]]] }, ctx)

    case 'changing_decimal': {
      // The shown value is a traced function of the animation's progress (["var","alpha"]).
      const id = tgt()
      const fn = a.function ?? a.number_update_func
      const base = new World(new Map(w.mobs), w.display.slice(), w.ids)
      const at = (x: number) => { evalClock.alpha = x; return Number(evalValue(w, fn)) }
      return L({
        apply: (alpha, f, rate) => {
          const o = f.get(id)
          if (!o) return
          const tmp = base.fork()
          setNumberValue(tmp, id, at(rate(alpha)))
          o.replace = leaves(tmp, id).map(i => itemOf(tmp.get(i), o.alpha))
        },
        end: v => setNumberValue(v, id, at(1)),
      })
    }
  }
  throw new Error(`the animation layer cannot play "${kind}" yet`)
}

/** TransformMatchingTex: parts with the same TeX morph into each other; the rest fade. */
function matchTex(w: World, src: number, dst: number, cs: Pt, cd: Pt) {
  const A = w.get(src).children.filter(i => typeof w.get(i).data?.tex === 'string')
  const B = w.get(dst).children.filter(i => typeof w.get(i).data?.tex === 'string')
  if (!A.length || !B.length) return null
  const used = new Set<number>()
  const pairs: MorphPair[] = []
  const inn: number[] = []
  for (const b of B) {
    const tb = w.get(b).data.tex.trim()
    const match = A.find(x => !used.has(x) && w.get(x).data.tex.trim() === tb)
    if (match != null) {
      used.add(match)
      pairs.push(...morphPairs(w, leaves(w, match), w, leaves(w, b), cd, cs))
    } else inn.push(...leaves(w, b))
  }
  const out: number[] = []
  for (const x of A) if (!used.has(x)) out.push(...leaves(w, x))
  return { pairs, in: inn, out }
}

/** A picture's corners, border, crop and box, blended (an .animate of set_corner_radius / crop / set_border). */
function lerpImage(a: ImageRef, b: ImageRef, t: number): ImageRef {
  const L = (x: number, y: number) => x + (y - x) * t
  const ca = a.crop || [0, 0, 1, 1], cb = b.crop || [0, 0, 1, 1]
  const ba = a.border, bb = b.border
  const border = ba || bb
    ? { color: lerpColor(ba?.color ?? bb.color, bb?.color ?? ba.color, t), width: L(ba?.width ?? 0, bb?.width ?? 0) }
    : undefined
  return {
    ...b, w: L(a.w, b.w), h: L(a.h, b.h), radius: L(a.radius || 0, b.radius || 0), border,
    crop: (a.crop || b.crop) ? [L(ca[0], cb[0]), L(ca[1], cb[1]), L(ca[2], cb[2]), L(ca[3], cb[3])] : undefined,
  }
}

/** Camera settings blended (move_camera). */
export function lerpCam(a: CamState, b: CamState, t: number): CamState {
  const L = (x: number, y: number) => x + (y - x) * t
  return {
    three_d: a.three_d || b.three_d, phi: L(a.phi, b.phi), theta: L(a.theta, b.theta), gamma: L(a.gamma, b.gamma),
    zoom: L(a.zoom, b.zoom), focal: L(a.focal, b.focal), center: [L(a.center[0], b.center[0]), L(a.center[1], b.center[1]), L(a.center[2], b.center[2])],
  }
}

/** A part's shape, whatever its place and size: points relative to its box, in units of its height. */
function shapeKey(w: World, id: number): string {
  const paths = worldPaths(w.get(id))
  const b = bbox(paths)
  if (!b) return ''
  const k = (b[3] - b[1]) || (b[2] - b[0]) || 1
  return paths.map(sp => sp.points.map(p => `${Math.round(((p[0] - b[0]) / k) * 100)},${Math.round(((p[1] - b[1]) / k) * 100)}`).join(';')).join('|')
}

/** TransformMatchingShapes: parts with the same shape morph into each other; the rest fade. */
function matchShapes(w: World, src: number, dst: number, cs: Pt, cd: Pt) {
  const A = leaves(w, src), B = leaves(w, dst)
  if (!A.length || !B.length) return null
  const keyA = new Map(A.map(i => [i, shapeKey(w, i)]))
  const used = new Set<number>()
  const pairs: MorphPair[] = []
  const inn: number[] = []
  for (const b of B) {
    const kb = shapeKey(w, b)
    const match = A.find(x => !used.has(x) && keyA.get(x) === kb)
    if (match != null) { used.add(match); pairs.push(...morphPairs(w, [match], w, [b], cd, cs)) } else inn.push(b)
  }
  const out = A.filter(x => !used.has(x))
  return { pairs, in: inn, out }
}

/**
 * `.animate`: run the ops on a copy to get the end state, then blend. A part
 * whose outline did not change blends its matrix and style (no path rebuild);
 * one that did (become, a new shape) morphs.
 */
function buildAnimate(spec: AnimSpec, a: Kw, ctx: BuildCtx): Leaf {
  const w = ctx.w
  const id = resolveTarget(w, spec.target)
  const end = w.fork()
  // ops: [name, args, target?] or {name, args, target?} (target: a part or another object).
  const ops: unknown[] = Array.isArray(a.ops) ? a.ops : []
  const extra: number[] = []
  for (const op of ops) {
    if (Array.isArray(op) && op[2] == null) runOp(end, id, String(op[0]), op[1], ctx.env)
    else if (op && typeof op === 'object') {
      const o = (Array.isArray(op) ? { name: op[0], args: op[1], target: op[2] } : op) as { name: string; args?: unknown; target?: unknown }
      const t = o.target != null ? resolveTarget(end, o.target) : id
      if (t !== id && !family(w, id).includes(t)) extra.push(t)
      runOp(end, t, String(o.name), o.args, ctx.env)
    }
  }
  if (extra.length) {
    // Objects outside the target's family animate as their own .animate.
    return combineLeaves([buildAnimateOn(w, end, id), ...Array.from(new Set(extra)).map(t => buildAnimateOn(w, end, t))])
  }
  return buildAnimateOn(w, end, id)
}

function combineLeaves(list: Leaf[]): Leaf {
  return {
    run: 1, rate: smooth, lag: 0,
    apply: (alpha, f, rate, lag) => { for (const l of list) l.apply(alpha, f, rate, lag) },
    end: (v, r1) => { for (const l of list) l.end?.(v, r1) },
  }
}

function buildAnimateOn(w: World, end: World, id: number): Leaf {
  const famA = family(w, id), famB = family(end, id)
  const same = famA.length === famB.length && famA.every((x, i) => x === famB[i])
  const endMobs = famB.map(i => end.get(i))
  // The state the animation ends in: the target, unless the rate does not end at 1 (there_and_back ends
  // where it started; running past 1 overshoots).
  const finish = (v: World, r1 = 1) => {
    if (Math.abs(r1 - 1) < 1e-9) { for (const m of endMobs) v.set(m); return }
    if (Math.abs(r1) < 1e-9) return
    for (const m of endMobs) {
      if (!v.has(m.id) || !w.has(m.id)) { v.set(m); continue }
      const s0 = w.get(m.id)
      const vs = s0.data?.value, ve = m.data?.value
      v.set({
        ...m, m: lerpMat(s0.m, m.m, r1), style: lerpStyle(s0.style, m.style, r1),
        ...(s0.image && m.image && s0.image !== m.image ? { image: lerpImage(s0.image, m.image, r1) } : {}),
        data: typeof vs === 'number' && typeof ve === 'number' ? { ...m.data, value: vs + (ve - vs) * r1 } : m.data,
      })
    }
  }
  // A number whose value changes: show the value counting (digits from the glyph cache each frame).
  const sm = w.get(id), em = end.get(id)
  if (isNumber(sm) && sm.data.value !== em.data.value) {
    const v0 = Number(sm.data.value), v1 = Number(em.data.value)
    const base = new World(new Map(w.mobs), w.display.slice(), w.ids)
    return {
      run: 1, rate: smooth, lag: 0,
      apply: (alpha, f, rate) => {
        const o = f.get(id)
        if (!o) return
        const x = rate(alpha)
        const tmp = base.fork()
        setNumberValue(tmp, id, v0 + (v1 - v0) * x)
        o.replace = leaves(tmp, id).map(i => itemOf(tmp.get(i), o.alpha))
      },
      end: finish,
    }
  }
  if (!same) {
    const pairs = morphPairs(w, leaves(w, id), end, leaves(end, id), centerOf(end, id), centerOf(w, id))
    return {
      run: 1, rate: smooth, lag: 0,
      apply: (alpha, f, rate, lag) => { const o = f.get(id); if (o) o.replace = morphItems(pairs, alpha, rate, lag) },
      end: finish,
    }
  }
  type Part = { id: number; s: Mob; e: Mob; inv: Mat; pairs?: MorphPair[] }
  const parts: Part[] = []
  for (const i of famA) {
    const s = w.get(i), e = end.get(i)
    if (s === e) continue
    const p: Part = { id: i, s, e, inv: invert(s.m) }
    if (hasGeom(s) && (s.paths !== e.paths || s.text !== e.text || (!!s.image !== !!e.image))) p.pairs = morphPairs(w, [i], end, [i], centerOf(end, i), centerOf(w, i))
    parts.push(p)
  }
  return {
    run: 1, rate: smooth, lag: 0,
    apply: (alpha, f, rate, lag) => {
      parts.forEach((p, k) => {
        const o = f.get(p.id)
        if (!o) return
        const x = rate(subAlpha(alpha, k, parts.length, lag))
        if (p.pairs) { o.replace = morphItems(p.pairs, x, linear, 0); return }
        if (p.s.m3 || p.e.m3) {
          // A 3D object: its 3D maps blend (straight, like Manim's point blend), the front view follows.
          const s3 = p.s.m3 ?? embed(p.s.m), e3 = p.e.m3 ?? embed(p.e.m)
          if (s3 !== e3) {
            o.m3 = mul3(mul3(lerp3(s3, e3, x), invert3(s3)), reconcile(o.m, o.m3 ?? s3) ?? s3)
            o.m = proj(o.m3)
          }
        } else if (p.s.m !== p.e.m) o.m = mul(mul(lerpMat(p.s.m, p.e.m, x), p.inv), o.m)
        if (p.s.style !== p.e.style) o.style = lerpStyle(o.style, p.e.style, x)
        if (p.s.image && p.e.image && p.s.image !== p.e.image) o.image = lerpImage(p.s.image, p.e.image, x)
        const v0 = p.s.data?.value, v1 = p.e.data?.value
        if (typeof v0 === 'number' && typeof v1 === 'number' && v0 !== v1) o.value = v0 + (v1 - v0) * x
      })
    },
    end: finish,
  }
}

/* -------------------------------------------------------------- composites */

function leafNode(leaf: Leaf, spec: AnimSpec, ctx: BuildCtx): Node {
  const run = spec.run_time != null ? Math.max(0, Number(spec.run_time)) : leaf.run
  const rate = spec.rate_func != null ? rateByName(spec.rate_func, leaf.rate) : leaf.rate
  const lag = spec.lag_ratio != null ? Number(spec.lag_ratio) : leaf.lag
  const shownBefore = leaf.target != null && isShown(ctx.pre, leaf.target)
  return {
    run,
    intro: !!leaf.intro,
    shownBefore,
    frame: (t, f) => leaf.apply(run > 0 ? clamp01(t / run) : 1, f, rate, lag),
    events: () => {
      const ev = []
      if (leaf.begin) ev.push({ t: 0, end: false, fn: leaf.begin })
      if (leaf.end) { const r1 = rate(1); ev.push({ t: run, end: true, fn: (v: World) => leaf.end(v, r1) }) }
      return ev
    },
  }
}

/**
 * AnimationGroup / LaggedStart / Succession: child i starts lag_ratio of the
 * way through child i−1 (Succession is lag 1). A given run_time rescales the
 * whole group; its rate_func (linear by default) warps the group's clock.
 */
function groupNode(children: Node[], lag: number, runTime: number | null, rate: RateFn): Node {
  const starts: number[] = []
  let cur = 0, natural = 0
  for (const c of children) {
    starts.push(cur)
    natural = Math.max(natural, cur + c.run)
    cur += lag * c.run
  }
  const run = runTime != null ? runTime : natural
  const k = natural > 0 ? run / natural : 1
  return {
    run,
    intro: children.some(c => c.intro),
    shownBefore: children.every(c => c.shownBefore),
    frame: (t, f) => {
      let tt = Math.max(0, Math.min(run, t))
      if (rate !== linear && run > 0) tt = run * rate(tt / run)
      const local = k > 0 ? tt / k : tt
      children.forEach((c, i) => {
        const lt = local - starts[i]
        if (lt < 0 && !(c.intro && !c.shownBefore)) return
        c.frame(lt, f)
      })
    },
    events: () => {
      const ev = []
      children.forEach((c, i) => {
        for (const e of c.events()) ev.push({ t: (starts[i] + e.t) * k, end: e.end, fn: e.fn })
      })
      return ev
    },
  }
}

/** Build a spec (leaf or composite) against the working scene. */
export function build(spec: AnimSpec, ctx: BuildCtx): Node {
  const kind = animName(spec.kind)
  if (kind === 'group' || kind === 'lagged' || kind === 'succession') {
    const items = spec.items || []
    const lag = spec.lag_ratio != null ? Number(spec.lag_ratio) : kind === 'lagged' ? 0.05 : kind === 'succession' ? 1 : 0
    const rate = spec.rate_func != null ? rateByName(spec.rate_func, linear) : linear
    let children: Node[]
    if (kind === 'succession') {
      // Each step starts from where the one before left the scene.
      const sub: BuildCtx = { ...ctx, w: ctx.w.fork() }
      children = items.map(it => {
        const n = build(it, sub)
        const ev = n.events().sort((x, y) => x.t - y.t || Number(y.end) - Number(x.end))
        for (const e of ev) e.fn(sub.w)
        return n
      })
    } else children = items.map(it => build(it, ctx))
    return groupNode(children, lag, spec.run_time != null ? Number(spec.run_time) : null, rate)
  }
  if (kind === 'change_speed') return changeSpeed(spec, ctx)
  return leafNode(buildLeaf(spec, ctx), spec, ctx)
}

/**
 * ChangeSpeed(anim, speedinfo={fraction: speed}): speeds blend linearly
 * between the given points of the animation's own time; the real time is the
 * integral of 1/speed, tabulated once.
 */
function changeSpeed(spec: AnimSpec, ctx: BuildCtx): Node {
  const a = normArgs(spec.args, ['speedinfo'])
  const inner = build((spec.items || [])[0] || (spec as any).anim || a.anim || { kind: 'wait', run_time: 0 }, ctx)
  const info = Object.entries((a.speedinfo || {}) as Record<string, number>).map(([k, v]) => [Number(k), Math.max(1e-3, Number(v))] as [number, number]).sort((x, y) => x[0] - y[0])
  // Speed 1 at the start unless given, held after the last point; it changes
  // linearly in REAL time between points (Manim's), so a piece of the
  // animation's own time Δu takes Δu / (mean speed).
  if (!info.length || info[0][0] > 0) info.unshift([0, 1])
  if (info[info.length - 1][0] < 1) info.push([1, info[info.length - 1][1]])
  const pieces = info.slice(0, -1).map(([u0, s0], i) => {
    const [u1, s1] = info[i + 1]
    return { u0, u1, s0, s1, T: (((u1 - u0) * inner.run) / ((s0 + s1) / 2)) }
  })
  const run = pieces.reduce((s, p) => s + p.T, 0)
  return {
    run,
    intro: inner.intro,
    shownBefore: inner.shownBefore,
    frame: (t, f) => {
      let tt = Math.max(0, Math.min(run, t))
      for (const p of pieces) {
        if (tt <= p.T || p === pieces[pieces.length - 1]) {
          const tau = Math.min(tt, p.T)
          const du = p.s0 * tau + ((p.s1 - p.s0) * tau * tau) / (2 * (p.T || 1))
          inner.frame(p.u0 * inner.run + du, f)
          return
        }
        tt -= p.T
      }
    },
    events: () => inner.events().map(e => ({ ...e, t: e.t <= 0 ? 0 : e.t >= inner.run ? run : e.t })),
  }
}

/** play(anims, opts): opts run_time / rate_func / lag_ratio apply to every animation, as Manim's play kwargs do. */
export function buildPlay(specs: AnimSpec[], opts: Kw, ctx: BuildCtx): Node {
  const items = specs.map(s => {
    const o: AnimSpec = { ...s }
    if (opts.run_time != null) o.run_time = Number(opts.run_time)
    if (opts.rate_func != null) o.rate_func = opts.rate_func
    const k = animName(o.kind)
    if (opts.lag_ratio != null && k !== 'group' && k !== 'lagged' && k !== 'succession') o.lag_ratio = Number(opts.lag_ratio)
    return build(o, ctx)
  })
  return groupNode(items, 0, null, linear)
}

/** Scene changes of a node in time order (ends before starts at the same moment). */
export function orderedEvents(n: Node) {
  return n.events().sort((x, y) => x.t - y.t || Number(y.end) - Number(x.end))
}

export { Frame }
