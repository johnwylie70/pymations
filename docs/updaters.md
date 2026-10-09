# Updaters

An updater keeps one thing in step with another while the scene plays: a label that follows a dot, a line between two moving points, a number that shows a value.

## Following something

```python
from pymations import *

dot = Dot(LEFT * 4, color=YELLOW)
label = Text("me", font_size=30)
label.add_updater(lambda m: m.next_to(dot, UP))
add(dot, label)
play(dot.animate.shift(RIGHT * 8), run_time=3)
wait()
```

`add_updater(f)` calls `f(m)` on every frame. `remove_updater(f)` and `clear_updaters()` stop it, and `suspend_updating()` and `resume_updating()` pause it.

## Value trackers

A `ValueTracker` holds a number that animations can change. Things built from it follow it:

```python
from pymations import *

x = ValueTracker(0)
dot = Dot(color=YELLOW)
dot.add_updater(lambda m: m.move_to(RIGHT * x.get_value()))
number = always_redraw(lambda: DecimalNumber(x.get_value()).next_to(dot, UP))
add(dot, number)
play(x.animate.set_value(4), run_time=2)
play(x.animate.set_value(-4), run_time=3)
wait()
```

- `x.animate.set_value(v)` and `x.animate.increment_value(d)` change it over time; `x.set_value(v)` and `x += 1` change it at once.
- `always_redraw(lambda: ...)` makes the thing again from the function every frame: a `Line` between two points, a `DecimalNumber` of a value, an area under a curve up to `x`.
- `always(m.next_to, other, UP)` and `f_always(m.set_x, lambda: x.get_value())` are short ways to write the same.
- `always_shift(m, RIGHT, rate=0.5)` and `always_rotate(m, rate=PI)` keep moving or turning.

A function that takes `dt` as well, `lambda m, dt: m.rotate(dt)`, is told the time step, for things that move at a steady rate.

## Traced paths

```python
from pymations import *

dot = Dot(RIGHT * 2, color=YELLOW)
path = TracedPath(dot.get_center, stroke_color=YELLOW, stroke_width=4)
add(path, dot)
play(Rotate(dot, angle=TAU, about_point=ORIGIN), run_time=4, rate_func=linear)
wait()
```

`TracedPath(dot.get_center)` draws the path a point leaves behind; `dissipating_time=1` makes the path fade after a second.

## How updaters run

When you call `add_updater` or `always_redraw`, Pymations calls your function once with stand-ins for the values that change (tracker values, positions, the time), and records what it does as formulas. The browser works those formulas out every frame. So Python is idle while the scene plays, the scrubber can jump to any moment, and the result is the same every time.

Most updaters are of this kind: arithmetic with `+ - * /` and `**`, `np.sin`, `np.cos`, `np.exp`, `np.sqrt` and the other numpy maths functions, positions (`get_center()`, `get_top()`, `axes.c2p(...)`), tracker values, and making shapes from them.

A function that cannot be followed this way, for example one with an `if` on a value, or one that uses `math.sin` on a moving value, still works: it runs in Python, every frame, while the scene plays. Pymations prints a note naming the updater's line when it does this. Such a scene keeps Python busy, and dragging the scrubber back resets what the updater did. Writing `np.sin` instead of `math.sin`, or `np.where`-style maths instead of an `if`, usually lets it run in the browser instead.

## The time

`pymations.time()` is the timeline's time in seconds. In an updater it is a formula like the others, so `dot.add_updater(lambda m: m.move_to([np.cos(pymations.time()), np.sin(pymations.time()), 0]))` circles for the whole scene. Inside a Pyctures `draw()` it is the time the scrubber shows. Write `import pymations` to use it: it is not one of the names `from pymations import *` gives, so it never hides Python's own `time` module.
