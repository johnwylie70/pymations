# Differences from Manim

Pymations runs scripts written for [Manim Community](https://www.manim.community). It is an independent project, not affiliated with Manim, and its own implementation: none of Manim's code is used. Its defaults, placement, rate functions and timings were checked against values measured from Manim Community 0.22 running for real, and the reference scenes in [`examples/`](../examples) are unchanged Manim scripts.

Most 2D scenes run as they are. These are the differences, so you know before you hit one.

## How a scene is made

- **It plays live, in a browser.** There is no `manim -pql scene.py`, no `manim.cfg`, no quality flags, no media folder and no cache. `pymations run` plays the scene; `pymations build` makes a page. Command-line settings in a script (`config.quality`, `config.pixel_width`) are accepted and have no effect.
- **No video files yet.** See [Recording a video](building-pages.md#recording-a-video).
- **Several scenes in a file all play,** one after another, instead of being chosen on the command line.

## Values live in the browser

Python describes the scene and the browser works out the geometry. So a position or size is not a number in Python until you read it with `await`:

```python
p = dot.get_center()          # a point the browser works out: fine to pass on, or add to
label.next_to(dot, UP)        # fine: placed in the browser
x = (await dot.get_center())[0]   # the number, read back
```

You can still do arithmetic with it, index it (`dot.get_center()[0]`) and pass it to anything that takes a number or a point. Turning it into a Python number without `await` (`if dot.get_x() > 0:`, `float(line.get_length())`, `round(...)`) stops with a message saying to `await` it. In a class, `construct` must be `async def` to use `await`. See [Reading values back](scenes-and-sections.md#reading-values-back).

For the same reason, a shape's points are not available in Python: `mobject.points`, `get_points()` and changing points by hand are not supported (`point_from_proportion()` works, as a point the browser works out). Make shapes from points with `set_points_as_corners` and `set_points_smoothly`, and move every point with `ApplyPointwiseFunction` or `ApplyMatrix`.

## Updaters

Updaters are recorded as formulas the browser works out every frame, so scrubbing is exact. One that cannot be recorded (an `if` on a moving value, `math.sin` of a moving value) runs in Python every frame instead, with a note saying so; dragging the scrubber back resets what it did. See [Updaters](updaters.md).

## Text and maths

- **Equations are drawn with KaTeX, not LaTeX.** No LaTeX install is needed, and most maths works, but LaTeX packages, `TexTemplate` and custom preambles do not. Sizes are within a few per cent of Manim's, because KaTeX's fonts differ slightly from Computer Modern.
- **One text font.** `Text` uses Liberation Sans, which comes with Pymations, so it looks the same everywhere. `font=` is accepted and ignored. Text sizes are close to Manim's, which depend on the font your system gives it.
- `MarkupText` understands bold, italic and colour spans, not all of Pango's markup.
- `Code` colours code with a small built-in palette; `formatter_style` has no effect.

## Not available

- **3D.** `ThreeDScene`, `ThreeDAxes`, `set_camera_orientation` and `move_camera` are accepted and play flat, seen from the front. 3D shapes (surfaces, spheres, cubes, prisms) are not available.
- **Sound.** `add_sound` prints a note and plays nothing.
- **Interaction.** `interactive_embed()` and `embed()` do nothing.
- **Waiting on a condition.** `wait_until(condition)` and `wait(stop_condition=…)` wait for the full time and do not check the condition.
- **Boolean shapes** (`Union`, `Intersection`, `Difference`, `Exclusion`), `ApplyComplexFunction`, `PhaseFlow`, logarithmic axes, and `ImageMobject` from a numpy array (a file name or web address works).
- `override_animate` and custom `Animation` subclasses that change points in `interpolate_mobject`: the browser draws animations, so Python code that runs per frame of an animation is not called.

## Small differences

- Random numbers come from your Python, so a script using `random` is different each run, the same as in Manim.
- The picture is fitted into the browser window; its shape stays 16:9 (or your `frame_width` and `frame_height`).
- Errors name the line in your file, and appear on the page and in the terminal.

Found a script that runs differently and is not listed here? Please [open an issue](https://github.com/johnwylie70/pymations/issues) with the script.
