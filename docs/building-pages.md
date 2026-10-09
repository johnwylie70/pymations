# Building Pages

`pymations build` turns a scene into web pages that play it in any browser, with nothing installed. Python runs in the visitor's browser with [Pyodide](https://pyodide.org), loaded from its official CDN, in a background thread, so the page stays smooth.

## A folder

```bash
pymations build hello.py -o site/
```

`site/` holds:

| File | What it is |
|---|---|
| `index.html` | The page: the scene fills the window |
| `hello.py` | Your scene |
| `pymations/` | The browser half (`pymations.js`), the Python half (`pymations.py`, `pyctures.py`), and the animation engine with KaTeX and its fonts (`engine/`) |

Every path is relative, so the folder works on any static host (GitHub Pages, Netlify, your own server) and inside an existing site. To try it on your computer:

```bash
python -m http.server --directory site
```

(Opening `index.html` straight from disk does not work for a folder, because browsers do not let a page read files beside it. A single file does work from disk.)

## One file

```bash
pymations build hello.py -o hello.html
```

`hello.html` holds everything: the scene, the Python half, the browser half, the engine, KaTeX, and the fonts (about 2.5 MB). Email it, put it on any website, or open it from your disk. Only Python itself is loaded from Pyodide's CDN, so it needs an internet connection the first time.

A scene that does not use the animation module (a plain Pyctures drawing) leaves the engine out and is much smaller.

## Files your scene uses

- Pictures, sounds and font files named in your code by a relative path (`ImageMobject("photo.png")`, `add_sound("voice.mp3")`, `font="Brand.ttf"`) are found and included: copied into the folder, or packed into the one file.
- Anything else the scene opens or imports (an SVG file, data, your own module) is added with `--add`, which can be given more than once and takes folders:

```bash
pymations build scene.py --add icon.svg --add data/ -o site/
```

Other options: `--title "My scene"` sets the page title.

## A folder of scenes, or a page with scenes in it

`pymations build scenes/ -o site/` builds every `.py` file in the folder, a page for each and an `index.html` that lists them. If the folder has its own `index.html`, it is copied as it is, with everything else in the folder, and the `pymations/` folder is added beside it.

## Putting scenes on your own page

```html
<div data-pymations-src="hello.py"></div>
<div data-pymations-src="pythagoras.py" data-pymations-loop style="height: 420px"></div>
<script type="module" src="pymations/pymations.js"></script>
```

Each `<div>` becomes a scene. It fills its box (16:9 when the box has no height of its own), starts when it scrolls into view, and pauses when it is out of view or the tab is hidden. All the scenes on a page share one copy of Python.

| Attribute | What it does |
|---|---|
| `data-pymations-src` | The scene's `.py` file, relative to the page |
| `data-pymations-loop` | Start again after the end |
| `data-pymations-autoplay="off"` | Wait for the play button |
| `data-pymations-controls="off"` | No scrubber |
| `data-pymations-files` | Files the scene opens, comma-separated (what `--add` sets) |
| `data-pymations-output="panel"` | Show what the program prints over the scene |
| `data-pymations-background` | The colour behind the scene before it draws |
| `data-pymations-worker="off"` | Run Python on the page's own thread (only for browsers without workers) |

`pymations run` serves the page too, with your own Python: `pymations run my-page/`.

### From a CDN

Once published on npm, the browser half can be loaded without copying files:

```html
<div data-pymations-src="hello.py"></div>
<script type="module" src="https://cdn.jsdelivr.net/npm/pymations@0.1.0/pymations.js"></script>
```

### From JavaScript

```js
import { mount } from './pymations/pymations.js'
const el = document.querySelector('#here')
const scene = mount(el, { src: 'hello.py', loop: true })
el.addEventListener('pymations-status', (e) => {
  if (e.detail.status === 'finished' && scene.player) scene.player.seek(2.5)   // the moment 2.5 s in
})
```

`mount(el, options)` takes the attributes above as options (`src`, `loop`, `autoplay`, `controls`, `output`, `background`). The element gets a `pymations-status` event as the scene goes through `starting`, `running`, `finished` (Python is done; the animation may still be playing), `error` and `stopped`. Once the scene has started, `scene.player` has `setPlaying(true or false)`, `seek(seconds)`, `t` and `duration`.

Set `window.PYMATIONS_NO_AUTO = true` before loading the script to stop it mounting `data-pymations-src` elements by itself. `window.PYMATIONS_PYODIDE_URL` points it at another copy of Pyodide.

## Measuring

For a scene with a Python loop (a `draw()` function, or Python-run updaters), add `?measure=1` to the page's address to see the frame rate, and where each frame's time goes, over the scene. An animation on its own needs no Python while it plays.

## Recording a video

Pymations plays scenes live in the browser; it does not write video files yet. To make one now, record the browser window with a screen recorder: build or run the scene, make the window the size you want, and use `data-pymations-controls="off"` (or keep the pointer still, so the scrubber stays hidden). A scene always plays the same way, so a take can be repeated.
