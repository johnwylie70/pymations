/**
 * The scene model: mobjects by id, each an IMMUTABLE record (local outline +
 * matrix + style + children), held in a World.
 *
 * WHY IMMUTABLE RECORDS AND COPY-ON-WRITE: the timeline keeps the scene as it
 * stood before every play() so any moment can be drawn without replaying from
 * zero (scrubbing). A snapshot is just the current map; the next change copies
 * the map (pointers only) and replaces the one record it touches. Outlines are
 * shared by every snapshot that has them, so a hundred plays of a moving
 * equation keep one copy of its glyphs.
 *
 * Ids: Python's objects are positive ints; parts the engine makes itself
 * (glyphs, a MathTex's parts, axis ticks, copies' children) get negative ids;
 * 0 is the camera frame.
 */
import type { Pt, Subpath } from './geometry-types'
import { apply, IDENTITY, mul, type Mat } from './math'
import { bbox, unionBox, type Box } from './geometry'

/** Stroke/fill style. Widths are Manim's numbers (4 = 0.04 scene units). */
export interface Style {
  sc: string
  sw: number
  so: number
  fc: string
  fo: number
}

/** A fallback text run (drawn with fillText) when glyph outlines are not available. */
export interface TextRun {
  str: string
  /** Font size in scene units (1 em). */
  em: number
  weight: string
  slant: string
  /** Local box, centred on the origin. */
  w: number
  h: number
  /** 'mono' for Code; otherwise the sans text font. */
  family?: string
  /** Left-aligned run (Code tokens): drawn from x = -w/2 rather than centred. */
  left?: boolean
}

export interface ImageRef {
  src: CanvasImageSource | null
  w: number
  h: number
  /** Rounded corners (scene units). */
  radius?: number
  /** A stroke around the picture's (rounded) box; width in Manim units (×0.01). */
  border?: { color: string; width: number }
  /** The part of the picture shown, as fractions [x0, y0, x1, y1], origin bottom-left. */
  crop?: [number, number, number, number]
  /** Its size before any crop, for crop() to work from. */
  fullW?: number
  fullH?: number
  /** Redrawn by Python every frame (a PycturesCanvas): never downscaled or cached. */
  live?: boolean
}

/** A drop shadow (scene units): blur radius, offset, colour and opacity. */
export interface Shadow {
  blur: number
  dx: number
  dy: number
  color: string
  opacity: number
}

export interface Mob {
  id: number
  kind: string
  paths: Subpath[]
  m: Mat
  children: number[]
  style: Style
  z: number
  text?: TextRun
  /** A picture (PycturesCanvas, ImageMobject) drawn into a w × h local box centred on the origin. */
  image?: ImageRef
  shadow?: Shadow
  /** Fill with the even-odd rule (an SVG's fill-rule="evenodd"). */
  evenodd?: boolean
  /** Per-kind facts in LOCAL coordinates (line ends, axis mapping, TeX strings). */
  data?: Record<string, any>
}

export interface Snap {
  mobs: Map<number, Mob>
  display: number[]
}

export const CAMERA = 0

export class World {
  mobs: Map<number, Mob>
  display: number[]
  private shared = false
  ids: { n: number }

  constructor(mobs?: Map<number, Mob>, display?: number[], ids?: { n: number }) {
    this.mobs = mobs || new Map()
    this.display = display || []
    this.ids = ids || { n: -1 }
  }

  /** The scene as it is now; later changes do not touch it. */
  snapshot(): Snap {
    this.shared = true
    return { mobs: this.mobs, display: this.display }
  }

  /** A working copy (for building a play's animations); shares records. */
  fork(): World {
    this.shared = true
    const w = new World(this.mobs, this.display, this.ids)
    w.shared = true
    return w
  }

  private own() {
    if (!this.shared) return
    this.mobs = new Map(this.mobs)
    this.display = this.display.slice()
    this.shared = false
  }

  has(id: number): boolean {
    return this.mobs.has(id)
  }

  get(id: number): Mob {
    const m = this.mobs.get(id)
    if (!m) throw new Error(id === CAMERA ? 'no camera frame' : `that object does not exist (#${id})`)
    return m
  }

  set(mob: Mob) {
    this.own()
    this.mobs.set(mob.id, mob)
  }

  update(id: number, patch: Partial<Mob>) {
    this.set({ ...this.get(id), ...patch })
  }

  setDisplay(ids: number[]) {
    this.own()
    this.display = ids
  }

  newId(): number {
    return this.ids.n--
  }
}

export function hasGeom(m: Mob): boolean {
  return m.paths.length > 0 || !!m.text || !!m.image
}

/** The object and everything under it, parents first, each once. */
export function family(s: Snap | World, id: number, out: number[] = [], seen?: Set<number>): number[] {
  const mob = s.mobs.get(id)
  if (!mob) return out
  seen = seen || new Set()
  if (seen.has(id)) return out
  seen.add(id)
  out.push(id)
  for (const c of mob.children) family(s, c, out, seen)
  return out
}

/** Family members that draw something, in drawing order. */
export function leaves(s: Snap | World, id: number): number[] {
  return family(s, id).filter(i => hasGeom(s.mobs.get(i)))
}

export function mobBox(m: Mob, mat: Mat = m.m): Box | null {
  let b = m.paths.length ? bbox(m.paths, mat) : null
  const rect = m.text || m.image
  if (rect) {
    const { w, h } = rect
    b = unionBox(b, bbox([{ points: [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], closed: true }], mat))
  }
  return b
}

/** World-space box of a whole family; a family with nothing in it is its matrix's origin. */
export function familyBox(s: Snap | World, id: number): Box {
  let b: Box | null = null
  for (const i of family(s, id)) b = unionBox(b, mobBox(s.mobs.get(i)))
  if (!b) {
    const mob = s.mobs.get(id)
    const o = mob ? apply(mob.m, [0, 0]) : [0, 0]
    return [o[0], o[1], o[0], o[1]]
  }
  return b
}

export function boxCenter(b: Box): Pt {
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
}

/** Manim's get_critical_point: per axis, max for +, min for −, centre for 0. */
export function critical(b: Box, dir: Pt): Pt {
  const pick = (lo: number, hi: number, d: number) => (d > 1e-9 ? hi : d < -1e-9 ? lo : (lo + hi) / 2)
  return [pick(b[0], b[2], dir[0]), pick(b[1], b[3], dir[1])]
}

export function centerOf(s: Snap | World, id: number): Pt {
  return boxCenter(familyBox(s, id))
}

/** Pre-multiply every family member's matrix by M (a move, scale or turn). */
export function transformFamily(w: World, id: number, M: Mat) {
  for (const i of family(w, id)) {
    const mob = w.get(i)
    w.set({ ...mob, m: mul(M, mob.m) })
  }
}

export function styleFamily(w: World, id: number, fn: (s: Style, m: Mob) => Style) {
  for (const i of family(w, id)) {
    const mob = w.get(i)
    w.set({ ...mob, style: fn(mob.style, mob) })
  }
}

/** A deep copy of `src`'s family; the top gets `topId` (or a new internal id). */
export function copyFamily(w: World, src: number, topId?: number): number {
  const mob = w.get(src)
  const id = topId ?? w.newId()
  const children = mob.children.map(c => copyFamily(w, c))
  w.set({ ...mob, id, children, data: mob.data ? { ...mob.data } : undefined })
  return id
}

/** `id` takes `src`'s whole look and structure (Manim's become / end of Transform). */
/**
 * `id` takes `src`'s whole look and structure (Manim's become / end of a
 * Transform). Where the two have the same number of parts, the parts keep
 * their own ids and become their counterparts in turn — Manim changes the
 * same objects in place, so a part shown on its own (Create(group[0])) or
 * held by Python (group[0]) stays that part.
 */
export function become(w: World, id: number, src: number) {
  if (id === src) return
  const s = w.get(src)
  const mine = w.has(id) ? w.get(id).children : []
  const children = mine.length && mine.length === s.children.length
    ? mine.map((c, i) => { become(w, c, s.children[i]); return c })
    : s.children.map(c => copyFamily(w, c))
  w.set({ ...s, id, children, data: s.data ? { ...s.data } : undefined })
}

/** Scene.add: each target moves to the front (end of the list). */
export function addToDisplay(w: World, ids: number[]) {
  const set = new Set(ids)
  const next = w.display.filter(i => !set.has(i))
  for (const i of ids) if (i !== CAMERA && !next.includes(i)) next.push(i)
  w.setDisplay(next)
}

/**
 * Scene.remove. Removing a part of something on screen (eq[0], group[1])
 * splits that parent into its remaining parts, the way Manim restructures its
 * list, so the part really disappears.
 */
export function removeFromDisplay(w: World, ids: number[]) {
  let display = w.display.slice()
  for (const id of ids) {
    const next: number[] = []
    for (const top of display) {
      if (top === id) continue
      next.push(...splitWithout(w, top, id))
    }
    display = next
  }
  w.setDisplay(display)
}

function splitWithout(w: World, top: number, id: number): number[] {
  if (top === id) return []
  if (!family(w, top).includes(id)) return [top]
  const out: number[] = []
  for (const c of w.get(top).children) out.push(...splitWithout(w, c, id))
  return out
}

/** Is `id` drawn — on screen itself or inside something on screen? */
export function isShown(s: Snap | World, id: number): boolean {
  for (const top of s.display) if (top === id || family(s, top).includes(id)) return true
  return false
}

export function newMob(id: number, kind: string, style: Style, paths: Subpath[] = [], extra?: Partial<Mob>): Mob {
  return { id, kind, paths, m: IDENTITY, children: [], style, z: 0, ...extra }
}
