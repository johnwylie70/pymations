# The animation engine

The browser half of Pymations' drawing: TypeScript; it bundles one library, polygon-clipping (MIT), for Boolean shapes. Python only describes a scene; this engine owns geometry, placement, the timeline and drawing. It runs on the page's main thread and draws onto a 2D canvas.

`src/` is copied from Circuitry, where Pymations is built (`circuitry/scripts/sync-pymations-lib.mjs`), together with the built bundle in `src/pymations/web/engine/`. Change the engine there, then sync. To rebuild the bundle here instead:

```bash
cd engine
npm install
npm run build        # writes ../src/pymations/web/engine/
```

## What is where

| File | What it does |
|---|---|
| `entry.ts` | The bundle's entry: sets `window.__cirAnim` (handle 6 in Python) |
| `engine.ts` | Commands in order, the timeline, `renderAt(ctx, t, width, height)` |
| `kinds.ts`, `geometry.ts` | Every shape as Bézier paths |
| `ops.ts`, `args.ts` | Placement and changes (`next_to`, `arrange`, `scale`…) and the point expressions Python sends |
| `animations.ts`, `rate.ts` | Animations and rate functions |
| `render.ts`, `frame.ts` | Drawing a moment of the timeline |
| `text.ts` | Text to outlines with opentype.js and Liberation Sans |
| `tex/` | KaTeX to glyph outlines, for MathTex and Tex |
| `boolean.ts` | Boolean shapes (union, intersection, difference, exclusion), with polygon-clipping (MIT, bundled) |
| `color.ts`, `math.ts`, `scene.ts` | Colours, matrices, the scene's objects |

## The commands

Python calls the engine through the Pyctures runtime's pipelined calls, with plain JSON arguments:

- `reset(cfg)`, `config(cfg)`: `frame_height` (8), `frame_width`, `background`.
- `make(id, kind, props)`, `copy(newId, src)`, `op(target, name, args)`: objects, and instant changes at the end of the timeline.
- `add([targets])`, `remove([targets])`, `clear()`.
- `play([anims], opts)`, `wait(seconds)`, `section(name)`: the timeline.
- `value(target, what, args)`: a value Python reads back with `await`.

Targets are an object id, `{"id": n, "path": [i, ...]}` for a part (`eq[1]`), or `0` for the camera frame. Units are the same as Manim's: y up, the origin in the middle, the frame 8 units high.

The page reads `ready()`, `duration`, `sections`, `background`, `version`, `hasContent`, and calls `renderAt(ctx, t, pxWidth, pxHeight)` to draw time `t`.
