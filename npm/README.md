# pymations (browser)

The browser half of [Pymations](https://github.com/johnwylie70/pymations) ([try it in your browser](https://www.circuitry.dev/pymations)): maths animations written in Python, on any web page. It runs Manim Community scripts. Python runs in the visitor's browser with [Pyodide](https://pyodide.org), loaded from its official CDN.

```html
<div data-pymations-src="scene.py"></div>
<script type="module" src="https://cdn.jsdelivr.net/npm/pymations@0.1.0/pymations.js"></script>
```

`scene.py` is an ordinary Pymations scene:

```python
from pymations import *

square = Square(color=YELLOW)
play(Create(square))
play(Transform(square, Circle(color=BLUE, fill_opacity=0.5)))
wait()
```

The animation fills its `<div>` (16:9 if the div has no height), starts when it scrolls into view, and has a scrubber to pause and replay it. `from manim import *` works too. See [Building pages](https://github.com/johnwylie70/pymations/blob/main/docs/building-pages.md) for every setting.

To write and test scenes on your own computer, install the Python package: `pip install pymations`, then `pymations run scene.py`.

Includes KaTeX (MIT), opentype.js (MIT) and Liberation Sans (SIL OFL 1.1). Pymations is an independent project, not affiliated with Manim. Author: John Wylie. MIT licence.
