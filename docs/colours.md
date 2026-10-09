# Colours

Colours are Manim's: the same names and the same shades.

```python
from pymations import *

names = [RED, ORANGE, YELLOW, GREEN, TEAL, BLUE, PURPLE, PINK]
dots = VGroup(*[Dot(radius=0.4, color=c) for c in names]).arrange(RIGHT)
add(dots)
```

## Names

- **Main colours:** `WHITE`, `BLACK`, `GRAY` (`GREY`), `RED`, `ORANGE`, `YELLOW`, `GREEN`, `TEAL`, `BLUE`, `PURPLE`, `PINK`, `GOLD`, `MAROON`.
- **Shades:** most have five, from light to dark: `BLUE_A`, `BLUE_B`, `BLUE_C` (the same as `BLUE`), `BLUE_D`, `BLUE_E`. The same for `TEAL`, `GREEN`, `YELLOW`, `GOLD`, `RED`, `MAROON`, `PURPLE` and `GRAY`.
- **Pure colours:** `PURE_RED`, `PURE_GREEN`, `PURE_BLUE`, `PURE_YELLOW`, `PURE_CYAN`, `PURE_MAGENTA`.
- **Others:** `LIGHT_GRAY`, `DARK_GRAY`, `LIGHT_PINK`, `LIGHT_BROWN`, `DARK_BROWN`, `DARK_BLUE`, `GRAY_BROWN`, and the `LOGO_` colours.

`BLUE` is `"#58C4DD"`, `RED` is `"#FC6255"`, `YELLOW` is `"#F7D96F"` and `GREEN` is `"#83C167"`, the same as Manim's.

## Your own

Any `"#RRGGBB"` string works (`color="#ff8800"`), and so does a list of red, green and blue from 0 to 1 (`[1, 0.5, 0]`). A name is read as Manim's colour first (`"gold"` is `GOLD`); another web colour name (`"steelblue"`) is drawn as it is, but changes to and from it jump rather than blend. `ManimColor("#ff8800")` is accepted for scripts that use it.

## Mixing

- `interpolate_color(RED, BLUE, 0.5)`: halfway between two colours.
- `color_gradient([RED, YELLOW, GREEN], 5)`: five colours from one to the next.
- `average_color(RED, BLUE)`, `rgb_to_color([1, 0.5, 0])`, `color_to_rgb(BLUE)`.
- `group.set_color_by_gradient(RED, YELLOW)`: colour the parts of a group from one to the other.

## The background

`config(background="#1e1e2e")` at the top of the file, or `self.camera.background_color = …` in a scene. Black is the default, the same as Manim's.
