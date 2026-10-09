# Changelog

## 0.2.0

The first release.

- Runs Manim Community scripts: `from manim import *` and `Scene` classes, or the short form with `from pymations import *` and no class.
- `pymations run scene.py` plays a scene in your browser with your own Python, and plays it again when you save. Errors show with the line they happened on.
- `pymations build scene.py -o site/` makes a folder, and `-o scene.html` one file, that plays in any browser with nothing installed.
- A scrubber on every scene: pause, replay, and drag to any moment. Every `Scene` class in a file plays in order, each a section with a tick on the scrubber.
- Shapes, text in three built-in fonts or your own font file, equations (drawn with KaTeX), numbers, tables, matrices, code, SVG files and pictures.
- Graphs: axes, plots, areas and Riemann rectangles, number lines and planes, complex and polar planes, bar charts and networks.
- Manim's animations and rate functions, including `Transform`, `TransformMatchingTex`, `.animate`, `ApplyComplexFunction` and `ComplexHomotopy`.
- Updaters, value trackers, `always_redraw` and traced paths, worked out in the browser so the scrubber stays exact.
- 3D: surfaces, solids and polyhedra, lit and shaded, with a camera that orbits and moves.
- Boolean shapes: union, intersection, difference and exclusion.
- Sound: voice-overs, music and sound effects, in step with the scrubber.
- Section transitions, and titles, callouts, cards, badges and highlights for explainers.
- Pyctures drawing behind or inside a scene.
