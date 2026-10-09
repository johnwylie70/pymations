# Titles, Callouts and Cards

Pieces for explainer videos and presentations. These are Pymations additions, not part of Manim, so a script using them runs only in Pymations.

```python
from pymations import *

box = Square(color=BLUE, fill_opacity=0.3)
play(Create(box))
callout = Callout(box, "Look here", side=UR)
play(FadeIn(callout))
play(FadeIn(LowerThird("Ada Lovelace", "Mathematician")))
wait()
```

| Object | What it is |
|---|---|
| `Card(width=4, height=2.5, fill="#222222", radius=0.25, shadow=True)` | A filled panel with rounded corners and a soft shadow |
| `Callout(target, "text", side=UR, distance=1.6)` | A label in a box with an arrow to something |
| `LowerThird("Name", "Role")` | A name strip for the bottom left |
| `Badge("NEW")` | A pill-shaped label |
| `Highlight(thing, style="box")` | A box, or a soft glow (`style="glow"`), around something |
| `Spotlight(thing, opacity=0.75)` | Dims everything except one thing |
| `EndCard(logo=None, title="", url=None)` | A closing card: a logo, a title and a web address, centred |

Each one moves, fades and animates like any other object.
