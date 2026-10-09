/**
 * 2D affine matrices for the animation engine, in the canvas's order
 * [a, b, c, d, e, f]: (x, y) → (a·x + c·y + e, b·x + d·y + f).
 *
 * Every shape keeps its outline in its own (local) coordinates plus one of
 * these. Moving, scaling, rotating and flipping only change the matrix, so the
 * outline (and the Path2D built from it) is never rebuilt for them, and an
 * `.animate` move is a blend of two matrices — which is exactly a blend of the
 * points, because the points are linear in the matrix.
 */
import type { Pt } from './geometry-types'

export type Mat = [number, number, number, number, number, number]

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]

/** A ∘ B: apply B, then A. */
export function mul(A: Mat, B: Mat): Mat {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5],
  ]
}

export function apply(m: Mat, p: Pt): Pt {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]
}

export function translate(dx: number, dy: number): Mat {
  return [1, 0, 0, 1, dx, dy]
}

/** Scale by (sx, sy) about point p. */
export function scaleAbout(sx: number, sy: number, p: Pt): Mat {
  return [sx, 0, 0, sy, p[0] - sx * p[0], p[1] - sy * p[1]]
}

/** Rotate by `angle` radians (counter-clockwise, y up) about point p. */
export function rotateAbout(angle: number, p: Pt): Mat {
  const c = Math.cos(angle), s = Math.sin(angle)
  return [c, s, -s, c, p[0] - c * p[0] + s * p[1], p[1] - s * p[0] - c * p[1]]
}

/** Element-wise blend; equal to blending every point the matrices place. */
export function lerpMat(A: Mat, B: Mat, t: number): Mat {
  return [
    A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t,
    A[3] + (B[3] - A[3]) * t, A[4] + (B[4] - A[4]) * t, A[5] + (B[5] - A[5]) * t,
  ]
}

/** How much a matrix scales lengths on average (√|det|), for stroke widths. */
export function matScale(m: Mat): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1e-9
}

export function isIdentity(m: Mat): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0
}
