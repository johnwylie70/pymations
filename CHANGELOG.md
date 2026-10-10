# Changelog

## 0.2.0

The first release.

- Runs Manim Community scripts: `from manim import *` and `Scene` classes, or the short form with `from pymations import *` and no class.
- `pymations run scene.py` plays a scene in your browser with your own Python, and plays it again when you save. Errors show with the line they happened on.
- `pymations build scene.py -o site/` makes a folder, and `-o scene.html` one file, that plays in any browser with nothing installed.
- A scrubber on every scene: pause, replay, and drag to any moment. Every `Scene` class in a file plays in order, each a section with a tick on the scrubber.
- Shapes, equations (drawn with KaTeX), numbers, tables, matrices, code, SVG files and pictures.
- Fonts: `sans`, `serif` and `mono` come with Pymations, so text looks the same on every computer; other font names are drawn with the nearest of the three, and a font file beside your scene is used as it is.
- Graphs: axes, plots, areas and Riemann rectangles, number lines and planes, complex and polar planes, bar charts and networks.
- Manim's animations and rate functions, including `Transform`, `TransformMatchingTex` and `.animate`.
- Complex maps: `ApplyComplexFunction` and `ComplexHomotopy` move every point as a complex number.
- Updaters, value trackers, `always_redraw` and traced paths, worked out in the browser so the scrubber stays exact.
- 3D: `ThreeDScene` with 3D axes, surfaces, spheres, cubes, prisms, cones, cylinders, tori and polyhedra, lit and shaded, and a camera that turns, moves and orbits. Titles can stay flat on the screen.
- Boolean shapes: union, intersection, difference and exclusion.
- Sound: voice-overs, music and sound effects, in step with the scrubber; a section can last as long as its voice-over.
- For product explainers: `Card`, `Callout`, `LowerThird`, `Badge`, `Highlight`, `Spotlight` and `EndCard`, pictures with rounded corners, borders, shadows and crops, and transitions between sections.
- Built pages include the pictures, sounds and font files a scene names.
- A note appears when fonts, equations or pictures are slow to load, instead of the scene seeming stuck.
- Pyctures drawing behind or inside a scene.
