# Tutorial: An Equation, Step by Step

Solve `2x + 3 = 11` on screen, one step at a time, with each part moving to its new place. The finished file is [`examples/equation_steps.py`](../../examples/equation_steps.py).

## 1. Write the first line

Save this as `steps.py` and run `pymations run steps.py`:

```python
from pymations import *

first = MathTex("2x", "+", "3", "=", "11").scale(1.5)
play(Write(first))
wait()
```

`MathTex` draws LaTeX. Giving it the equation as several strings makes each string a **part**: `first[0]` is `2x`, `first[4]` is `11`. Parts are what lets the next step match them up.

## 2. Move to the next step

```python
from pymations import *

first = MathTex("2x", "+", "3", "=", "11").scale(1.5)
second = MathTex("2x", "=", "11", "-", "3").scale(1.5)
play(Write(first))
wait(0.5)
play(TransformMatchingTex(first, second))
wait()
```

`TransformMatchingTex` moves each part to the part with the same TeX in the new equation: `2x`, `=`, `11` and `3` slide across, and `+` fades out while `-` fades in. Save, and the browser plays it again.

## 3. All the steps

A list of steps and a loop:

```python
from pymations import *

steps = [
    MathTex("2x", "+", "3", "=", "11"),
    MathTex("2x", "=", "11", "-", "3"),
    MathTex("2x", "=", "8"),
    MathTex("x", "=", "4"),
]
for step in steps:
    step.scale(1.5)

title = Text("Solve for x", font_size=40).to_edge(UP)
play(FadeIn(title))
play(Write(steps[0]))
wait(0.5)
for before, after in zip(steps, steps[1:]):
    play(TransformMatchingTex(before, after))
    wait(0.5)
play(Circumscribe(steps[-1], color=YELLOW))
wait()
```

`Circumscribe` draws a box round the answer and takes it away again.

## 4. Colour the unknown

Colour every `x` before anything is played:

```python
from pymations import *

eq = MathTex("2x", "+", "3", "=", "11", substrings_to_isolate=["x"]).scale(1.5)
eq.set_color_by_tex("x", YELLOW)
play(Write(eq))
wait()
```

`substrings_to_isolate` makes every `x` a part of its own, so `set_color_by_tex` can colour just that.

## 5. Share it

```bash
pymations build steps.py -o steps.html
```

`steps.html` plays in any browser, and opens straight from your disk.
