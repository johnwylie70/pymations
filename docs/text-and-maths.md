# Text and Maths

## Text

```python
from pymations import *

title = Text("Hello", font_size=72, color=YELLOW)
note = Text("in Liberation Sans", font_size=30, slant=ITALIC).next_to(title, DOWN)
play(Write(title))
play(FadeIn(note, shift=UP))
wait()
```

- `font_size` is 48 by default, the same as Manim's.
- `weight=BOLD` and `slant=ITALIC` choose the bold and italic faces.
- `t2c={"word": RED}` colours parts of the text.
- Each letter is its own part (`title[0]` is "H"), so `Write` draws letters in turn.
- Text is drawn with Liberation Sans, a font that comes with Pymations, so it looks the same on every computer. `font=` is accepted and has no effect.

Also: `MarkupText("<b>bold</b> and <i>italic</i>")` (bold, italic and colour spans), `Paragraph("line one", "line two")`, `BulletedList("one", "two")`, `Title("A title")` (with a line under it), and `Code(code_string=..., language="python")` (code with line numbers and colours).

## Maths

`MathTex` draws an equation written in LaTeX. Pymations draws it with [KaTeX](https://katex.org), in the browser, so nothing needs installing.

```python
from pymations import *

eq = MathTex(r"e^{i\pi} + 1 = 0", font_size=72)
play(Write(eq))
wait()
```

Write equations as raw strings (`r"..."`), so backslashes stay as they are. `Tex` is for text with maths in it, between `$` signs: `Tex(r"The area is $\pi r^2$")`.

### Parts

An equation given as several strings has a part for each, which you can colour, move and match:

```python
from pymations import *

eq = MathTex("a^2", "+", "b^2", "=", "c^2")
eq[0].set_color(BLUE)
eq[2].set_color(GREEN)
eq[4].set_color(YELLOW)
play(Write(eq))
wait()
```

- Double braces mark parts inside one string: `MathTex("{{ a }} + {{ b }} = {{ c }}")`.
- `substrings_to_isolate=["x"]` makes every `x` its own part.
- `set_color_by_tex("x", RED)`, or `tex_to_color_map={"x": RED}`, colours every part containing `x`.
- `get_part_by_tex("=")` finds a part.

`TransformMatchingTex(a, b)` moves parts with the same TeX to their new places and fades the rest, which is how step-by-step algebra is usually shown: see [the equation tutorial](tutorials/equation-steps.md).

### What KaTeX draws

KaTeX covers most of the maths LaTeX people write: fractions, roots, sums, integrals, matrices, Greek letters, accents, `\text{}`, `\color{}`, `\begin{aligned}` and the AMS symbols. It does not run LaTeX packages or custom preambles (`TexTemplate`). Sizes match Manim's to within a few per cent, because KaTeX's fonts are close to, but not the same as, LaTeX's Computer Modern.

## Numbers

`DecimalNumber(3.14159, num_decimal_places=2)` shows a number, and `Integer(42)` a whole one. They can change while the scene plays:

```python
from pymations import *

n = DecimalNumber(0, num_decimal_places=1, font_size=96)
add(n)
play(ChangeDecimalToValue(n, 100), run_time=3)
wait()
```

To make a number follow something, see [Updaters](updaters.md). `Variable(0, "x")` shows `x = 0` with its own tracker (`var.tracker`).

## Tables and matrices

```python
from pymations import *

m = Matrix([[1, 2], [3, 4]])
t = Table([["1", "2"], ["3", "4"]], col_labels=[Text("a"), Text("b")]).scale(0.6)
add(VGroup(m, t).arrange(RIGHT, buff=1))
```

`Matrix`, `IntegerMatrix`, `DecimalMatrix` and `MobjectMatrix` have brackets; `Table`, `MathTable`, `IntegerTable` and `DecimalTable` have lines between cells.
