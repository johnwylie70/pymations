# Shapes

Every shape is made with its Manim name and Manim's defaults: the same size, colour and starting point, so a scene looks the same.

```python
from pymations import *

row = VGroup(
    Circle(),
    Square(),
    Triangle(),
    RegularPolygon(6),
    Star(),
).arrange(RIGHT, buff=0.5)
play(LaggedStart(*[Create(s) for s in row], lag_ratio=0.2))
wait()
```

## Style

Every shape takes these, and has a method for each:

| Keyword | Method | What it is |
|---|---|---|
| `color` | `set_color(c)` | Outline and fill colour together |
| `stroke_color`, `stroke_width`, `stroke_opacity` | `set_stroke(color, width, opacity)` | The outline. Width 4 is the default |
| `fill_color`, `fill_opacity` | `set_fill(color, opacity)` | The inside. Shapes start unfilled (opacity 0) |
| `opacity` | `set_opacity(o)` | Both at once |
| | `set_z_index(z)` | Draw order: higher is in front |

```python
from pymations import *

c = Circle(color=BLUE, fill_opacity=0.5)
s = Square(stroke_width=8).set_fill(YELLOW, 0.3)
add(VGroup(c, s).arrange(RIGHT))
```

Line widths are in scene units (width 4 is 0.04 units), and scaling a shape does not change its line width, the same as in Manim.

## The shapes

| Shape | Made with | Default |
|---|---|---|
| `Circle(radius=1)` | | red outline |
| `Ellipse(width=2, height=1)` | | red outline |
| `Dot(point=ORIGIN, radius=0.08)`, `SmallDot()` | | filled white |
| `AnnotationDot()`, `LabeledDot(label)` | a dot with a ring, a dot with text in it | |
| `Square(side_length=2)` | | white |
| `Rectangle(width=4, height=2)`, `RoundedRectangle(corner_radius=0.5)` | | white |
| `Triangle()`, `RegularPolygon(n=6)`, `Polygon(*points)`, `Star(n=5)` | | blue |
| `Arc(radius=1, start_angle=0, angle=PI/2)`, `ArcBetweenPoints(a, b, angle)` | | white |
| `Sector(radius, angle)`, `Annulus(inner_radius, outer_radius)`, `AnnularSector(...)` | | filled white |
| `Line(start, end, buff=0)`, `DashedLine(start, end)` | | white |
| `Arrow(start, end, buff=0.25)`, `DoubleArrow(...)`, `Vector(direction)` | | white |
| `CurvedArrow(a, b)`, `CurvedDoubleArrow(a, b)` | | white |
| `Angle(line1, line2, radius)`, `RightAngle(line1, line2)` | the angle between two lines | white |
| `Elbow()`, `Cross(thing)`, `Underline(thing)` | | |
| `CubicBezier(a, handle_a, handle_b, b)` | one curve | |
| `TangentLine(curve, alpha, length=1)` | the tangent at a fraction of the way along a curve | |
| `DashedVMobject(shape, num_dashes=15)` | any shape, dashed | |
| `SurroundingRectangle(thing, buff=0.1)` | a box around something | yellow |
| `BackgroundRectangle(thing)` | a dark box behind something | black, 75% |
| `Brace(thing, direction=DOWN)` | a curly brace beside something | filled white |
| `SVGMobject("file.svg")` | the shapes in an SVG file | |
| `ImageMobject("picture.png")` | a picture (file name or web address) | |

Make a shape from your own points with `VMobject().set_points_as_corners(points)` (straight lines) or `set_points_smoothly(points)` (a smooth curve through them).

## Arrows

Arrows stop 0.25 short of each end (`buff=0`, or a `Vector`, to touch). A short arrow gets a smaller tip, the same as Manim's.

```python
from pymations import *

a = Dot(LEFT * 3)
b = Dot(RIGHT * 3)
arrow = Arrow(a.get_center(), b.get_center(), color=YELLOW)
play(FadeIn(a, b))
play(GrowArrow(arrow))
wait()
```

## Groups

`VGroup(a, b, c)` holds shapes together: moving, colouring or animating the group does it to all of them. `group[0]` is the first one, `group.add(d)` adds another, and `len(group)` counts them. `Group` does the same for things that are not shapes, such as pictures.

```python
from pymations import *

dots = VGroup(*[Dot() for _ in range(5)]).arrange(RIGHT)
play(Create(dots))
play(dots[2].animate.set_color(RED).scale(2))
wait()
```

## Copies

`shape.copy()` makes an independent copy. `save_state()` and `restore()` remember and return to a look: `play(Restore(shape))` animates back to it.

## Pictures and SVG files

`ImageMobject("photo.png")` and `SVGMobject("icon.svg")` read the file beside your scene. A built page needs the file too: pictures named in your code are copied in automatically; for an SVG file, add it with `pymations build scene.py --add icon.svg`.
