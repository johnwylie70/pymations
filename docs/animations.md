# Animations

`play()` plays animations together. Each takes `run_time=` (seconds) and `rate_func=` (how it speeds up and slows down), or give them to `play()` to set them for all:

```python
from pymations import *

s = Square()
play(Create(s), run_time=2)
play(s.animate.rotate(PI / 4), rate_func=there_and_back)
wait()
```

The defaults are Manim's: one second, with `smooth` easing, except where the table says otherwise.

## Bringing things in and out

| Animation | What it does |
|---|---|
| `Create(m)`, `Uncreate(m)` | Draw the outline along its path, then fill (or the reverse) |
| `Write(m)`, `Unwrite(m)` | Write text and equations stroke by stroke; one second, two for long ones |
| `DrawBorderThenFill(m)` | Outline first, then the fill (two seconds) |
| `FadeIn(m, shift=UP, scale=0.5)`, `FadeOut(m, shift=DOWN)` | Fade, optionally moving or growing as it goes |
| `GrowFromCenter(m)`, `GrowFromPoint(m, point)`, `GrowFromEdge(m, edge)`, `GrowArrow(arrow)` | Grow from nothing |
| `SpinInFromNothing(m)`, `ShrinkToCenter(m)` | Spin in, shrink away |
| `AddTextLetterByLetter(text)`, `RemoveTextLetterByLetter(text)` | Type and untype |
| `ShowIncreasingSubsets(group)`, `ShowSubmobjectsOneByOne(group)` | The parts of a group in turn |

## Changing things

Put `.animate` before any change to play it:

```python
from pymations import *

c = Circle()
add(c)
play(c.animate.shift(RIGHT * 2).set_color(YELLOW).scale(0.5))
play(c.animate(run_time=2).move_to(ORIGIN))
wait()
```

The changes in one `.animate` chain play together, as one smooth change from the old look to the new. Like Manim, `.animate.rotate(PI)` moves each point straight to its end (a half turn shrinks through the middle); use `Rotate` when you want it to turn.

| Animation | What it does |
|---|---|
| `Transform(a, b)` | `a` takes `b`'s shape, colour and place (`a` stays the one on screen) |
| `ReplacementTransform(a, b)` | The same, then `b` replaces `a` |
| `TransformFromCopy(a, b)` | A copy of `a` becomes `b`; `a` stays |
| `TransformMatchingTex(a, b)` | Equation parts with the same TeX move; the rest fade |
| `TransformMatchingShapes(a, b)` | Matching shapes move; the rest fade |
| `FadeTransform(a, b)`, `FadeTransformPieces(a, b)` | Cross-fade from one to the other |
| `MoveToTarget(m)` | After `m.generate_target()` and changes to `m.target` |
| `Restore(m)` | Back to `m.save_state()` |
| `Rotate(m, angle=PI)`, `Rotating(m, radians=TAU, run_time=5)` | Turn about the centre (or `about_point=`) |
| `MoveAlongPath(m, path)` | Move along a line or curve |
| `ApplyMethod(m.shift, UP)`, `ApplyFunction(f, m)` | Play a method, or a function that returns the changed thing |
| `ApplyMatrix(matrix, m)`, `ApplyPointwiseFunction(f, m)`, `Homotopy(h, m)` | Move every point (the function must be maths the browser can follow: `+ - * /`, `np.sin`, `np.cos` …) |
| `ApplyComplexFunction(f, m)`, `ComplexHomotopy(h, m)` | Move every point as a complex number `z`: `lambda z: z ** 2`, `np.exp(z)` (use `np.` functions, not `cmath.`). `ComplexHomotopy` runs 3 seconds |
| `Swap(a, b)`, `CyclicReplace(a, b, c)` | Swap places along arcs |
| `ChangeDecimalToValue(number, value)`, `ChangingDecimal(number, f)` | Count a number to a value |

`Transform(a, b, path_arc=PI)` moves along an arc instead of a straight line.

## Pointing things out

| Animation | What it does |
|---|---|
| `Indicate(m)` | Grows and turns yellow for a moment |
| `Circumscribe(m)` | A box drawn round it, then gone |
| `Flash(point)` | Lines bursting out from a point |
| `Wiggle(m)` | Wobbles (two seconds) |
| `FocusOn(point)` | A spotlight closing in |
| `ShowPassingFlash(m)` | A short stretch of the outline lit up, travelling along it |
| `ApplyWave(m)`, `Blink(m)`, `Broadcast(m)` | A wave through it, a blink, rings spreading out |

## Groups of animations

```python
from pymations import *

dots = VGroup(*[Dot() for _ in range(8)]).arrange(RIGHT)
play(LaggedStart(*[GrowFromCenter(d) for d in dots], lag_ratio=0.15))
play(Succession(dots.animate.shift(UP), dots.animate.set_color(RED)))
play(AnimationGroup(*[d.animate.shift(DOWN * (i % 2)) for i, d in enumerate(dots)]))
wait()
```

- `AnimationGroup(*anims, lag_ratio=0)`: together.
- `Succession(*anims)`: one after another.
- `LaggedStart(*anims, lag_ratio=0.05)`: each starts when the one before is `lag_ratio` of the way through.
- `LaggedStartMap(FadeIn, group)`: the same animation for every part of a group.
- `play(..., lag_ratio=0.1)` staggers the parts of each animation.

## Rate functions

`rate_func=` decides how an animation moves through its time. `smooth` (the default) starts and ends gently; `linear` is even. Also: `rush_into`, `rush_from`, `slow_into`, `double_smooth`, `there_and_back`, `there_and_back_with_pause`, `running_start`, `wiggle`, `lingering`, `exponential_decay`, `smoothstep`, and every `ease_in_*`, `ease_out_*` and `ease_in_out_*` of `sine`, `quad`, `cubic`, `quart`, `quint`, `expo`, `circ`, `back`, `elastic` and `bounce`. `rate_functions.smooth` works too.
