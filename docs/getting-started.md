# Getting Started

Pymations makes maths animations in Python: shapes, equations, graphs and text that draw themselves, move, and turn into each other. It runs scripts written for [Manim Community](https://www.manim.community), so `from manim import *` works too. Pymations is an independent project, not affiliated with Manim.

## Install

```bash
pip install pymations
```

Pymations needs Python 3.9 or newer and a web browser. It installs nothing else: no LaTeX, no ffmpeg. Equations are drawn with KaTeX, in the browser.

## Your first scene

Save this as `hello.py`:

```python
from pymations import *

square = Square(color=YELLOW)
circle = Circle(color=BLUE, fill_opacity=0.5)

play(Create(square))
play(Transform(square, circle))
play(square.animate.shift(RIGHT * 2).scale(0.5))
wait()
```

Then run it:

```bash
pymations run hello.py
```

Your browser opens and the scene plays.

- `Square()` and `Circle()` make shapes. Nothing is shown until it is played or added.
- `play()` adds animations to the timeline. Each `play()` starts when the one before it ends.
- `square.animate` turns any change into an animation: here a move and a shrink, played together.
- `wait()` holds still for a second (`wait(3)` for three).

## `pymations run`: see it as you write it

- A small web server starts on your computer (at `http://localhost:8770/`, or the next free port) and your browser opens on the scene.
- **Your program runs in your own Python**, the one Pymations is installed in. Any library you have installed works: numpy, your own modules. The browser only draws.
- **Save the file and the scene runs again.** Keep the browser beside your editor and save to see each change.
- Anything your program prints appears at the bottom of the page and in the terminal.
- When something goes wrong, the page shows the error with the line it happened on, and the lines around it. Fix it and save.
- Give it a folder (`pymations run examples`) for a list of the scenes in it.
- Press `Ctrl+C` in the terminal to stop.

Options: `--port 9000` picks the port, `--no-browser` does not open one, `--host 0.0.0.0` lets other devices on your network open it.

## The scrubber

Move the mouse over a playing scene (or tap it) and the scrubber shows: play and pause, the time, and the timeline with a tick where each section starts. Drag along it to see any moment. While the scene has the keyboard, Space plays and pauses and the arrow keys step five seconds.

## How it works

Your program only describes the scene. `Circle()`, `next_to()` and `play()` each send one short instruction to the page, and `play()` returns at once: the whole timeline is described in a moment, then the browser plays it. The browser works out where everything goes, draws each moment, and handles the time. So a scene is light to run, playback is smooth, and dragging the scrubber is instant.

A value only the browser knows, such as where a shape ended up, has to be read back with `await`. See [Reading values back](scenes-and-sections.md#reading-values-back). It is rarely needed, because placing things relative to each other (`next_to`, `arrange`, `to_edge`) happens in the browser.

## `pymations build`: share it

```bash
pymations build hello.py -o site/
```

writes a folder that plays the scene in any browser, with Python running in the visitor's browser ([Pyodide](https://pyodide.org)). Or make one file you can email or open from disk:

```bash
pymations build hello.py -o hello.html
```

See [Building pages](building-pages.md).

## Running a script with plain `python`

`python hello.py` runs your program, but there is nowhere to show the animation, so Pymations says to use `pymations run hello.py`. A script that says `from manim import *` only finds that name inside `pymations run` and built pages: Pymations never installs a module called `manim`, so a real Manim install is never hidden.

## Next

- [Scenes and sections](scenes-and-sections.md)
- [Shapes](shapes.md), [Text and maths](text-and-maths.md), [Graphs](graphs.md)
- [Animations](animations.md)
