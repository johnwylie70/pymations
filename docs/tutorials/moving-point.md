# Tutorial: A Graph with a Moving Point

A curve, a point that slides along it, and a label that always shows where the point is. It uses a value tracker and updaters.

## 1. Axes and a curve

```python
from pymations import *

axes = Axes(x_range=[-3, 3, 1], y_range=[-1, 9, 2], x_length=8, y_length=5)
curve = axes.plot(lambda x: x ** 2, color=BLUE)
play(Create(axes))
play(Create(curve))
wait()
```

`axes.plot` runs your function in Python and draws the result in the axes' units.

## 2. A value to move

A `ValueTracker` holds a number that an animation can change. The point is placed from it with an updater:

```python
from pymations import *

axes = Axes(x_range=[-3, 3, 1], y_range=[-1, 9, 2], x_length=8, y_length=5)
curve = axes.plot(lambda x: x ** 2, color=BLUE)
x = ValueTracker(-2)

dot = Dot(color=YELLOW)
dot.add_updater(lambda m: m.move_to(axes.c2p(x.get_value(), x.get_value() ** 2)))

add(axes, curve, dot)
play(x.animate.set_value(2), run_time=3)
play(x.animate.set_value(0), run_time=2)
wait()
```

`axes.c2p(x, y)` turns a graph point into a point on screen. The updater is worked out by the browser every frame, so dragging the scrubber puts the dot exactly where it should be at that moment.

## 3. A label that follows

```python
from pymations import *

axes = Axes(x_range=[-3, 3, 1], y_range=[-1, 9, 2], x_length=8, y_length=5)
curve = axes.plot(lambda x: x ** 2, color=BLUE)
x = ValueTracker(-2)

dot = always_redraw(lambda: Dot(axes.c2p(x.get_value(), x.get_value() ** 2), color=YELLOW))
value = always_redraw(lambda: DecimalNumber(x.get_value() ** 2, num_decimal_places=2).next_to(dot, UR))
drop = always_redraw(lambda: DashedLine(axes.c2p(x.get_value(), 0), dot.get_center(), color=GRAY))

play(Create(axes), Create(curve))
add(drop, dot, value)
play(x.animate.set_value(2), run_time=3)
play(x.animate.set_value(0), run_time=2)
wait()
```

`always_redraw` makes its shape again every frame: the dot at the tracker's value, the number showing `x²`, and a dashed line down to the axis.

## 4. Slow down at the end

Any animation takes a `rate_func`. Try `rate_func=there_and_back` on the first `play()` to go out and come back in one animation, or `rate_func=ease_out_bounce` to land with a bounce.
