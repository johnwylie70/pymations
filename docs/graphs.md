# Graphs

## Axes and plots

```python
from pymations import *

axes = Axes(x_range=[-3, 3, 1], y_range=[-1, 9, 2], x_length=8, y_length=5)
labels = axes.get_axis_labels(x_label="x", y_label="y")
curve = axes.plot(lambda x: x ** 2, color=YELLOW)
label = axes.get_graph_label(curve, "x^2", x_val=2)
play(Create(axes), Write(labels))
play(Create(curve), FadeIn(label))
wait()
```

- `x_range` and `y_range` are `[start, end, step]`; the step is the gap between ticks.
- `x_length` and `y_length` are the size in units. The default axes are 12 × 6, the same as Manim's.
- `axes.plot(f)` draws `y = f(x)`. Your function runs in Python when the scene is described, so it can be anything: numpy, `math`, an `if`.
- `axes.c2p(x, y)` (or `coords_to_point`) is the point on screen for a graph point: `Dot(axes.c2p(2, 4))`.
- `axes.input_to_graph_point(x, curve)` is the point on a plotted curve.
- `axis_config={"color": GREEN}`, `x_axis_config`, `y_axis_config` and `tips=False` style the axes. `axes.add_coordinates()` numbers them.

`axes.plot_parametric_curve(lambda t: [x(t), y(t), 0], t_range=[0, TAU])` plots a curve given by a parameter. `ParametricFunction` and `FunctionGraph` do the same without axes, in scene units.

## Areas, slopes and lines to a point

```python
from pymations import *

axes = Axes(x_range=[0, 4, 1], y_range=[0, 10, 2], x_length=7, y_length=5)
curve = axes.plot(lambda x: 0.5 * x ** 2 + 1, color=BLUE)
area = axes.get_area(curve, x_range=[1, 3], opacity=0.4)
rects = axes.get_riemann_rectangles(curve, x_range=[1, 3], dx=0.25)
play(Create(axes), Create(curve))
play(Create(rects))
play(ReplacementTransform(rects, area))
wait()
```

- `axes.get_area(curve, x_range, bounded_graph=other)`: the area under a curve, or between two.
- `axes.get_riemann_rectangles(curve, x_range, dx)`: rectangles under a curve.
- `axes.get_secant_slope_group(x, curve, dx)`: the rise-over-run triangle between two points of a curve.
- `axes.get_vertical_line(point)`, `axes.get_T_label(x, curve)`: a line down to the axis, and a marked point on it.

## Number lines and planes

```python
from pymations import *

plane = NumberPlane()
line = NumberLine(x_range=[-5, 5, 1], include_numbers=True).to_edge(DOWN)
play(Create(plane))
play(Create(line))
wait()
```

- `NumberLine(x_range, length, include_numbers, include_tip)`; `line.n2p(2)` (or `number_to_point`) is the point for a number.
- `NumberPlane()` covers the whole picture with a grid. `background_line_style={"stroke_opacity": 0.4}` dims its lines.
- `ComplexPlane()` and `PolarPlane()` are planes for complex numbers and polar coordinates.
- `ThreeDAxes()` is accepted and drawn flat.

## Charts and networks

```python
from pymations import *

chart = BarChart([3, 5, 2, 6], bar_names=["A", "B", "C", "D"], y_range=[0, 8, 2])
play(Create(chart))
wait()
```

`Graph(vertices, edges, layout="circular")` draws a network of dots and lines; layouts are `"circular"`, `"spring"` (the same each time), `"tree"`, or a dict of positions. `DiGraph` has arrows.
