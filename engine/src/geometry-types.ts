/**
 * Shared geometry for the animation engine (`pyctures.anim`), in SCENE UNITS:
 * y up, origin at the centre of the frame, frame height 8 (Manim's units).
 *
 * A subpath is a run of cubic Bézier segments: `points` is
 * [anchor0, handle, handle, anchor1, handle, handle, anchor2, ...], so its
 * length is 1 + 3n for n segments. Every shape, glyph and TeX rule is stored
 * this way, which is what lets any two be morphed into each other.
 */
export type Pt = [number, number]

export interface Subpath {
  points: Pt[]
  closed: boolean
}

/** One TeX string to outline. `parts` are MathTex's separate arguments (joined for layout). */
export interface TexInput {
  tex: string
  mode: 'math' | 'text'
  parts: string[]
  /** Manim's font_size (48 is the default). */
  fontSize: number
}

/** The outlines, centred on the origin: part → glyph → subpaths. */
export interface TexOutline {
  parts: Subpath[][][]
  width: number
  height: number
}
