/**
 * One drawn moment: the scene snapshot a segment started from, plus what the
 * running animations change about it (per-object overrides, objects drawn as
 * morphs instead, and extra strokes such as Flash lines).
 *
 * Built fresh for each drawn frame; it costs a few small objects per animated
 * object and nothing for the rest of the scene.
 */
import type { Subpath } from './geometry-types'
import { lerpColor } from './color'
import type { Mat } from './math'
import type { Mat3 } from './math3'
import type { CamState } from './ops'
import type { ImageRef, Shadow, Snap, Style, TextRun } from './scene'

export interface DrawItem {
  paths: Subpath[]
  m: Mat
  style: Style
  alpha: number
  partial: [number, number] | null
  z: number
  text?: TextRun
  image?: ImageRef
  shadow?: Shadow
  evenodd?: boolean
  /** 3D (Contract v4): the item's 3D map, its 3D points (flat xyz), and how the 3D camera treats it. */
  m3?: Mat3
  p3?: number[]
  closed3?: boolean
  shade3?: boolean
  fixed?: 'frame' | 'orientation'
}

export interface Over {
  m: Mat
  alpha: number
  style: Style
  partial: [number, number] | null
  /** A ValueTracker's (or DecimalNumber's) value mid-animation. */
  value?: number
  /** A picture's corners, border or crop mid-animation. */
  image?: ImageRef
  /** A 3D object's map mid-animation (its 2D m is kept as this one's front view). */
  m3?: Mat3
  /** The 3D camera's settings mid-move (object 0). */
  cam?: CamState
  /** Draw these instead of the object and everything under it (morphs). */
  replace?: DrawItem[]
  hidden?: boolean
}

export class Frame {
  over = new Map<number, Over>()
  extras: DrawItem[] = []

  constructor(public scene: Snap) {}

  /** The override record for an object, starting from how the snapshot has it; null if it is not in the snapshot. */
  get(id: number): Over | null {
    let o = this.over.get(id)
    if (o) return o
    const mob = this.scene.mobs.get(id)
    if (!mob) return null
    o = { m: mob.m, alpha: 1, style: mob.style, partial: null, ...(mob.m3 ? { m3: mob.m3 } : {}) }
    this.over.set(id, o)
    return o
  }
}

export function lerpStyle(a: Style, b: Style, t: number): Style {
  if (t <= 0) return a
  if (t >= 1) return b
  return {
    sc: lerpColor(a.sc, b.sc, t),
    fc: lerpColor(a.fc, b.fc, t),
    sw: a.sw + (b.sw - a.sw) * t,
    so: a.so + (b.so - a.so) * t,
    fo: a.fo + (b.fo - a.fo) * t,
  }
}
