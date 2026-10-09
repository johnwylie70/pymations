# Tutorial: Bringing a Manim Script Across

A script written for Manim Community, from a tutorial, a course or an AI assistant, usually runs as it is. This shows how to try one, and what to do when something differs.

## 1. Run it

Take any Manim script, for example:

```python
from manim import *

class Squares(Scene):
    def construct(self):
        squares = VGroup(*[Square(side_length=1, fill_opacity=0.6) for _ in range(5)])
        squares.arrange(RIGHT, buff=0.3).set_color_by_gradient(BLUE, GREEN)
        self.play(LaggedStart(*[DrawBorderThenFill(s) for s in squares], lag_ratio=0.2))
        self.play(squares.animate.arrange(DOWN, buff=0.2).scale(0.7))
        self.play(Indicate(squares[2]))
        self.wait()
```

Save it as `squares.py` and run:

```bash
pymations run squares.py
```

There is nothing to change: `from manim import *` gives Pymations' module inside `pymations run` and built pages. Instead of `manim -pql squares.py Squares`, `pymations run` plays every `Scene` in the file, and plays it again each time you save.

## 2. If it stops with an error

The page shows the error and the line. The usual ones:

- **"…is worked out in the preview, so Python does not have its numbers yet."** The script turned a position or size into a Python number (`if dot.get_x() > 0`, `float(...)`). Read it with `await` instead, and make `construct` an `async def`:

```python
from manim import *

class Where(Scene):
    async def construct(self):
        dot = Dot().shift(RIGHT * 2)
        self.add(dot)
        x = (await dot.get_center())[0]
        self.play(Write(Text("right" if x > 0 else "left").to_edge(UP)))
```

- **"…has no …() in the preview yet."** That method is not in Pymations yet. [Differences from Manim](../differences-from-manim.md) lists what is missing; please open an issue for anything else.
- **A LaTeX error.** KaTeX draws the equations and does not run LaTeX packages. Most maths works; rewrite the parts that need a package.

## 3. If it looks different

- **3D scenes play flat**, seen from the front.
- **Text uses one font,** Liberation Sans, whatever `font=` says.
- **A note in the output that an updater runs in Python** means it could not be turned into a formula for the browser. It still works; dragging the scrubber back resets what it did. Using `np.sin` rather than `math.sin` usually fixes it.

## 4. Keep it running in both

The class form runs in both Manim and Pymations. To use features only Pymations has (the bare form, Pyctures drawing), keep a copy for each, or keep the shared part in a module both import.

## 5. Share it

```bash
pymations build squares.py -o squares.html
```

The page plays the scene in any browser, with nothing to install, and has a scrubber to pause and replay it.
