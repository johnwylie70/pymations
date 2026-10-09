# Scenes and Sections

A Pymations program is a Python file that describes a timeline. It can be written two ways, and both can be mixed with [Pyctures](https://github.com/johnwylie70/pyctures) drawing.

## The bare form

No class: make things, then `play()` and `wait()` at the top level of the file.

```python
from pymations import *

title = Text("Shapes")
play(Write(title))
play(title.animate.to_edge(UP))
shapes = VGroup(Circle(), Square(), Triangle()).arrange(RIGHT, buff=1)
play(Create(shapes))
wait()
```

The bare form has these at the top level:

| Call | What it does |
|---|---|
| `play(*animations, run_time=…, rate_func=…, lag_ratio=…)` | Play animations together; the next `play()` starts when the longest one ends |
| `wait(seconds=1)` | Hold still |
| `add(*things)` | Show things at once, with no animation |
| `remove(*things)` | Take things away at once |
| `clear()` | Take everything away |
| `section(name)` | Start a named section (a tick on the scrubber) |
| `config(background=…, frame_height=…)` | Settings, at the top of the file |

Use it for short demos and for trying things out.

## The class form

The way Manim tutorials write a scene: a class with a `construct()` method, and `self.` in front of the scene's methods.

```python
from manim import *

class Shapes(Scene):
    def construct(self):
        title = Text("Shapes")
        self.play(Write(title))
        self.play(title.animate.to_edge(UP))
        shapes = VGroup(Circle(), Square(), Triangle()).arrange(RIGHT, buff=1)
        self.play(Create(shapes))
        self.wait()
```

You do not create the scene or call anything: Pymations finds every `Scene` class the file defines and plays it. `setup()` runs before `construct()`, if you write one. A script that ends with Manim's `Shapes().render()` runs too.

`MovingCameraScene` and `ZoomedScene` are accepted (see [The camera](camera.md)). `ThreeDScene` is accepted and plays in 2D.

## Several scenes in one file

Every `Scene` class in the file plays, in the order they are written, one after another on one timeline. Each one starts empty and is its own section, named after its class, so the scrubber has a tick where each starts.

```python
from pymations import *

class Intro(Scene):
    def construct(self):
        self.play(Write(Text("Part one")))
        self.wait()

class Main(Scene):
    def construct(self):
        self.play(Create(Circle()))
        self.wait()
```

## Sections

`self.next_section("name")` in a scene, or `section("name")` in the bare form, marks a point on the timeline. It shows as a tick on the scrubber, with its name when you point at it.

```python
from pymations import *

section("The question")
play(Write(Text("What is 1 + 2 + … + 100?")))
wait()
section("The answer")
play(FadeIn(MathTex("5050"), shift=DOWN))
wait()
```

## Settings

```python
from pymations import *

config(background="#1e1e2e", frame_height=10)
play(Create(Circle(radius=3)))
```

| Setting | Default | What it is |
|---|---|---|
| `background` (or `background_color`) | black | The colour behind the scene |
| `frame_height` | 8 | How many units tall the picture is |
| `frame_width` | 14.22 (16:9) | How many units wide |

`config.background_color = BLUE_E`, `config["frame_height"]` and Manim's `self.camera.background_color = …` work as well.

## Units

The same as Manim's: the origin is the middle of the picture, `y` goes up, and the picture is 8 units tall and about 14.2 wide (16:9), so `x` runs from about −7.1 to 7.1. The picture is fitted into the window whatever its size and shape, with the background colour filling any space left over: a bigger window draws the same scene larger. Line widths are in the same units, so they stay in proportion too.

`UP`, `DOWN`, `LEFT`, `RIGHT`, `UL`, `UR`, `DL`, `DR`, `ORIGIN`, `IN` and `OUT` are 3D vectors one unit long (`UL` is `UP + LEFT`). Write points as `[x, y, 0]`, `[x, y]` or `RIGHT * 2 + UP`.

## Reading values back

Placing things relative to each other happens in the browser, so your program never needs coordinates for it: `label.next_to(dot, UP)` works however the dot got where it is. When you do want the numbers, `await` them:

```python
from pymations import *

dot = Dot().to_corner(UL)
play(dot.animate.shift(RIGHT * 3))
where = await dot.get_center()
print("The dot is at", where)
play(FadeIn(Text("here", font_size=30).move_to(where + DOWN * 0.5)))
```

Without `await`, `dot.get_center()` is a point the browser works out when it is used. You can do arithmetic with it (`dot.get_center() + UP`) and pass it to anything that takes a point, but not turn it into a number. Reading it with `await` costs a short wait for the browser's answer. In a class, write `async def construct(self):` to use `await`.

Values that can be read: `get_center()`, `get_top()`, `get_bottom()`, `get_left()`, `get_right()`, `get_corner(direction)`, `get_start()`, `get_end()`, `width`, `height`, `get_x()`, `get_y()`, `line.get_length()`, `line.get_angle()`, `axes.c2p(x, y)`, and a tracker's `get_value()`.

## Mixing with Pyctures drawing

A Pymations file can use everything [Pyctures](https://github.com/johnwylie70/pyctures) gives a Python program: `ctx` (the web's 2D canvas), `draw()`, `update(dt)`, `await frame()`, `keys` and `mouse`. Pyctures drawing goes behind the animation.

```python
import math
from pymations import *

def draw():
    ctx.fill_style = "#0b1020"
    ctx.fill_rect(0, 0, width, height)
    ctx.fill_style = "white"
    for i in range(40):
        ctx.fill_rect((i * 97) % width, (i * 53) % height, 2, 2)

play(Create(Circle(radius=2, color=YELLOW)))
wait()
```

`draw()` is called every frame, in pixels. A file with a `draw()` (or a loop) keeps Python running while the scene plays; one without stops Python as soon as the timeline is described. Inside `draw()`, `pymations.time()` is the timeline's time in seconds (`import pymations` to use it).

To put a Pyctures picture inside the scene, as an object that moves, scales and fades like any other, use `PycturesCanvas`:

```python
import math
from pymations import *

def waves(ctx, t):
    ctx.fill_style = "#102030"
    ctx.fill_rect(0, 0, 400, 300)
    ctx.stroke_style = "#58c4dd"
    ctx.line_width = 4
    ctx.begin_path()
    for x in range(0, 401, 8):
        ctx.line_to(x, 150 + 60 * math.sin(x / 40 + t * 3))
    ctx.stroke()

picture = PycturesCanvas(width=4, height=3, draw=waves)
play(FadeIn(picture))
play(picture.animate.shift(LEFT * 3).scale(0.8))
wait(2)
```

`draw(ctx, t)` is called every frame with the timeline time `t`. The canvas is `resolution` (100) pixels per unit, so a 4 × 3 canvas is drawn at 400 × 300.
