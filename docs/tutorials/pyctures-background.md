# Tutorial: A Pyctures Background

Pymations files can draw with [Pyctures](https://github.com/johnwylie70/pyctures), which gives Python the web's 2D canvas (`ctx`). This paints a moving background behind an animation. The finished file is [`examples/with_pyctures.py`](../../examples/with_pyctures.py).

## 1. A background that moves

```python
import math, random
from pymations import *

stars = [(random.random(), random.random(), random.uniform(0, math.tau)) for _ in range(150)]
clock = 0.0


def draw():
    global clock
    clock += 1 / 60
    ctx.fill_style = "#0b1020"
    ctx.fill_rect(0, 0, width, height)
    for x, y, phase in stars:
        a = 0.35 + 0.35 * math.sin(clock * 2 + phase)
        ctx.fill_style = f"rgba(255, 255, 255, {a:.2f})"
        ctx.fill_rect(x * width, y * height, 2, 2)
```

`draw()` is called every frame. `ctx` draws in pixels, from the top left; `width` and `height` are the size of the canvas. Because there is a `draw()`, Python keeps running while the scene plays.

## 2. The animation on top

Add the animation below it, in the same file:

```python
from pymations import *

def draw():
    ctx.fill_style = "#0b1020"
    ctx.fill_rect(0, 0, width, height)

ring = Circle(radius=2, color=YELLOW)
label = Text("Pyctures + Pymations", font_size=36).next_to(ring, DOWN)
play(Create(ring), Write(label))
play(Rotate(ring, angle=PI))
play(ring.animate.scale(0.5).set_color(TEAL))
wait()
```

The animation is drawn above whatever `draw()` paints. The two use different units: `ctx` is in pixels, the animation in scene units (8 tall).

## 3. Tie the background to the timeline

`pymations.time()` is the time the scrubber shows, so a background can follow the animation, and dragging the scrubber moves it too:

```python
import math
import pymations
from pymations import *

def draw():
    t = pymations.time()
    ctx.fill_style = f"hsl({(t * 40) % 360}, 40%, 12%)"
    ctx.fill_rect(0, 0, width, height)

play(Create(Square(side_length=3)))
play(Rotate(Square(side_length=3), angle=PI), run_time=3)
wait()
```

## 4. Pyctures inside the scene

To place a Pyctures drawing in the scene as an object that moves and fades, use `PycturesCanvas`; see [Mixing with Pyctures drawing](../scenes-and-sections.md#mixing-with-pyctures-drawing).
