# Layout

Place things relative to each other and to the edges of the picture. The browser works the positions out, so your program never needs to know a shape's size.

```python
from pymations import *

title = Text("Layout").to_edge(UP)
boxes = VGroup(*[Square(side_length=1) for _ in range(4)]).arrange(RIGHT, buff=0.3)
label = Text("four squares", font_size=30).next_to(boxes, DOWN)
corner = Dot(color=YELLOW).to_corner(DR)
add(title, boxes, label, corner)
```

| Method | What it does |
|---|---|
| `next_to(other, direction=RIGHT, buff=0.25, aligned_edge=ORIGIN)` | Beside something (or a point), a gap of `buff` between them |
| `move_to(point_or_thing, aligned_edge=ORIGIN)` | Centre on a point, or on another thing's centre |
| `shift(vector)` | Move by an amount: `shift(UP * 2 + LEFT)` |
| `to_edge(UP, buff=0.5)`, `to_corner(UL, buff=0.5)` | Against an edge or a corner of the picture |
| `align_to(other, LEFT)` | Line up one edge with another thing's |
| `center()` | Back to the middle |
| `arrange(RIGHT, buff=0.25, aligned_edge=ORIGIN)` | A group in a row or column, re-centred where it was |
| `arrange_in_grid(rows, cols, buff=0.25)` | A group in a grid, filling rows first |
| `set_x(x)`, `set_y(y)` | Move to an `x` or `y` |
| `scale(k, about_point=…)` | Grow or shrink (line widths stay the same) |
| `rotate(angle, about_point=…)` | Turn, counter-clockwise, in radians (`45 * DEGREES` for degrees) |
| `flip(UP)`, `stretch(k, dim)` | Mirror; stretch along x (`dim=0`) or y (`dim=1`) |
| `scale_to_fit_width(w)`, `scale_to_fit_height(h)`, `set(width=w)` | A given size, keeping the shape |
| `stretch_to_fit_width(w)`, `stretch_to_fit_height(h)` | A given size, changing the shape |
| `match_width(other)`, `match_height(other)` | The same size as something else |
| `become(other)` | Take another thing's shape, look and place |

Every one of these can be played: `play(title.animate.to_edge(UP))`.

The gaps have names, the same as Manim's: `SMALL_BUFF` (0.1), `MED_SMALL_BUFF` (0.25), `MED_LARGE_BUFF` (0.5) and `LARGE_BUFF` (1).

Directions: `UP`, `DOWN`, `LEFT`, `RIGHT`, and the corners `UL`, `UR`, `DL`, `DR` (`UL` is `UP + LEFT`, so `next_to(x, UR)` leaves the gap both ways).

Things that are positions in the browser: `get_center()`, `get_top()`, `get_bottom()`, `get_left()`, `get_right()`, `get_corner(UL)`, `get_start()`, `get_end()`. You can pass them anywhere a point is wanted and do arithmetic with them; see [Reading values back](scenes-and-sections.md#reading-values-back) to get their numbers.
