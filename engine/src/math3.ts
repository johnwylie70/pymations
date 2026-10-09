/**
 * 3D affine maps for the animation engine's 3D objects and rotations
 * (Contract v4): [a, b, c, d, e, f, g, h, i, tx, ty, tz], row-major, so
 * x' = a·x + b·y + c·z + tx, and likewise for y' and z'.
 *
 * An object that has never left the screen plane keeps only its 2D matrix
 * (the fast path). The first 3D change (a turn about a horizontal axis, a move
 * in z) gives it one of these; its 2D matrix is then this one's view from the
 * front (z dropped), which is what all the 2D placement code keeps using.
 */
import type { Mat } from './math'

export type Mat3 = [number, number, number, number, number, number, number, number, number, number, number, number]
export type V3 = [number, number, number]

export const IDENT3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]

export function mul3(A: Mat3, B: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i, tx, ty, tz] = A
  const [A2, B2, C2, D2, E2, F2, G2, H2, I2, X2, Y2, Z2] = B
  return [
    a * A2 + b * D2 + c * G2, a * B2 + b * E2 + c * H2, a * C2 + b * F2 + c * I2,
    d * A2 + e * D2 + f * G2, d * B2 + e * E2 + f * H2, d * C2 + e * F2 + f * I2,
    g * A2 + h * D2 + i * G2, g * B2 + h * E2 + i * H2, g * C2 + h * F2 + i * I2,
    a * X2 + b * Y2 + c * Z2 + tx, d * X2 + e * Y2 + f * Z2 + ty, g * X2 + h * Y2 + i * Z2 + tz,
  ]
}

export function apply3(m: Mat3, x: number, y: number, z: number): V3 {
  return [m[0] * x + m[1] * y + m[2] * z + m[9], m[3] * x + m[4] * y + m[5] * z + m[10], m[6] * x + m[7] * y + m[8] * z + m[11]]
}

/** A 2D matrix as a 3D one (z untouched). */
export function embed(m: Mat): Mat3 {
  return [m[0], m[2], 0, m[1], m[3], 0, 0, 0, 1, m[4], m[5], 0]
}

/** The 2D part seen from the front (z dropped). */
export function proj(m: Mat3): Mat {
  return [m[0], m[3], m[1], m[4], m[9], m[10]]
}

/** Does this map leave z alone (so a 2D-only object can stay 2D)? */
export function isFlat(m: Mat3): boolean {
  return m[2] === 0 && m[5] === 0 && m[6] === 0 && m[7] === 0 && m[8] === 1 && m[11] === 0
}

export function translate3(dx: number, dy: number, dz: number): Mat3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1, dx, dy, dz]
}

export function scale3(sx: number, sy: number, sz: number, p: V3): Mat3 {
  return [sx, 0, 0, 0, sy, 0, 0, 0, sz, p[0] - sx * p[0], p[1] - sy * p[1], p[2] - sz * p[2]]
}

/** Rotation by `angle` about the axis through `p` (Rodrigues). */
export function rot3(axis: V3, angle: number, p: V3 = [0, 0, 0]): Mat3 {
  let [x, y, z] = axis
  const n = Math.hypot(x, y, z) || 1
  x /= n; y /= n; z /= n
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c
  const R: Mat3 = [
    c + x * x * t, x * y * t - z * s, x * z * t + y * s,
    y * x * t + z * s, c + y * y * t, y * z * t - x * s,
    z * x * t - y * s, z * y * t + x * s, c + z * z * t,
    0, 0, 0,
  ]
  return mul3(translate3(p[0], p[1], p[2]), mul3(R, translate3(-p[0], -p[1], -p[2])))
}

export function lerp3(A: Mat3, B: Mat3, t: number): Mat3 {
  return A.map((v, i) => v + (B[i] - v) * t) as Mat3
}

export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i, tx, ty, tz] = m
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C || 1e-12
  const r: Mat3 = [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
    0, 0, 0,
  ]
  r[9] = -(r[0] * tx + r[1] * ty + r[2] * tz)
  r[10] = -(r[3] * tx + r[4] * ty + r[5] * tz)
  r[11] = -(r[6] * tx + r[7] * ty + r[8] * tz)
  return r
}

/** How much a map scales lengths on average (for stroke widths). */
export function scale3Of(m: Mat3): number {
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
  return Math.cbrt(Math.abs(det)) || 1e-9
}
