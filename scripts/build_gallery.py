"""Build the online gallery: every example, playing, with its code beside it.

    .venv/bin/python scripts/build_gallery.py            # -> site/gallery/
    .venv/bin/python scripts/build_gallery.py --shots    # also take the card pictures (needs Playwright)
    .venv/bin/python scripts/build_gallery.py --gif      # also record docs/images/gallery.gif (needs ffmpeg)
    .venv/bin/python scripts/build_gallery.py --readme   # also take the README's pictures of its examples

The pages are plain HTML with scenes put in inline (data-pymations-src), so the
gallery is itself built with `pymations build`, the way any website would be.
"""
import argparse
import re
import functools
import html
import http.server
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
import pymations  # noqa: E402
from pymations.build import build, scene_images  # noqa: E402

EXAMPLES = ROOT / "examples"
REPO = "https://github.com/johnwylie70/pymations"
STUDIO = "https://www.circuitry.dev"
PAGE = "https://www.circuitry.dev/pymations"
MANIM = "https://www.manim.community"
SITE = "https://johnwylie70.github.io/pymations/"

# (file, title, what it is, where it comes from). Shown in this order. The
# Manim Community scripts run unchanged.
SCENES = [
    ("pythagoras.py", "Pythagoras", "The theorem shown by rearranging four right triangles in a square.", "manim"),
    ("derivative.py", "What is a derivative?", "A secant line closing in on the tangent.", "manim"),
    ("unit_circle_sine.py", "Sine from the unit circle", "A point going round the circle draws the sine wave.", "manim"),
    ("completing_the_square.py", "Completing the square", "The algebra, step by step, beside the picture.", "manim"),
    ("euler_identity.py", "Euler's identity", "e to the i pi, one step at a time.", "manim"),
    ("sum_pairing.py", "1 + 2 + ... + n", "Gauss's pairing trick for the sum of the first n numbers.", "manim"),
    ("tangent_slider.py", "Sliding a tangent line", "A tangent line slides along a curve, its slope shown as it goes.", "manim"),
    ("riemann_sum.py", "Riemann sums", "Rectangles under a curve, getting thinner, closing in on the area.", "manim"),
    ("cycloid.py", "A cycloid", "A point on a rolling wheel traces its path.", "manim"),
    ("matrix_transform.py", "Moving the plane", "The grid and the basis vectors moved together by a shear and a quarter turn.", "manim"),
    ("sin_cos_plot.py", "Sine and cosine", "Two curves on one set of axes, with labels.", "manim"),
    ("grid_camera.py", "Moving the camera", "The camera frame zooms and moves over a grid.", "manim"),
    ("moving_frame_box.py", "A moving box", "A box that moves from one part of an equation to another.", "manim"),
    ("brace_annotation.py", "Braces", "A brace and its label under a line.", "manim"),
    ("point_on_shapes.py", "Points on shapes", "Dots placed on a circle, a square and a line.", "manim"),
    ("moving_around.py", "Moving around", "One square moved, recoloured, scaled and turned.", "manim"),
    ("equation_steps.py", "Equation steps", "Solving 2x + 3 = 11, with matching parts moving into place.", ""),
    ("two_scenes.py", "Two scenes", "Every Scene class in a file plays, in order.", ""),
    ("with_pyctures.py", "With Pyctures", "A background drawn with ctx every frame, the animation on top.", ""),
    ("hello.py", "Hello", "The first scene: a square turned into a circle.", ""),
]

# The scenes the README's animated picture shows, a few seconds each.
GIF_SCENES = ["pythagoras.py", "unit_circle_sine.py", "derivative.py", "euler_identity.py"]

# How far into each animation (ms) its card picture is taken; the rest at 6 s.
THUMB_AT = {"pythagoras.py": 20000, "derivative.py": 16000, "unit_circle_sine.py": 14000,
            "completing_the_square.py": 20000, "euler_identity.py": 14000, "sum_pairing.py": 16000,
            "grid_camera.py": 5000, "equation_steps.py": 8000, "tangent_slider.py": 12000, "riemann_sum.py": 12000,
            "cycloid.py": 10000, "matrix_transform.py": 10000}

STYLE = """
:root { --bg: #0d1117; --panel: #161b22; --line: #30363d; --text: #e6edf3; --dim: #9198a1; --accent: #58c4dd; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 system-ui, -apple-system, sans-serif; }
a { color: var(--accent); }
header, main, footer { max-width: 1120px; margin: 0 auto; padding: 0 16px; }
header { padding-top: 40px; }
h1 { font-size: clamp(32px, 6vw, 52px); line-height: 1.1; margin: 0 0 12px; letter-spacing: -0.02em; }
h1 small { display: block; font-size: 0.45em; color: var(--dim); font-weight: 500; letter-spacing: 0; margin-top: 8px; }
.lead { font-size: 18px; color: var(--dim); max-width: 720px; margin: 0 0 24px; }
.actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 40px; }
.install { font: 15px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--panel); border: 1px solid var(--line);
           border-radius: 8px; padding: 10px 14px; display: inline-flex; gap: 12px; align-items: center; }
.install button { background: none; border: 1px solid var(--line); color: var(--dim); border-radius: 6px; padding: 2px 8px; cursor: pointer; font: inherit; font-size: 13px; }
.btn { display: inline-block; padding: 10px 16px; border-radius: 8px; border: 1px solid var(--line); color: var(--text);
       text-decoration: none; background: var(--panel); font-weight: 600; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #062a33; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; text-decoration: none; color: var(--text);
        transition: transform .15s, border-color .15s; }
.card:hover { transform: translateY(-2px); border-color: var(--accent); }
.card img, .card .noimg { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: #000; }
.card div { padding: 12px 14px 14px; }
.card h3 { margin: 0 0 4px; font-size: 17px; }
.card p { margin: 0; color: var(--dim); font-size: 14px; }
.tag { font-size: 12px; color: var(--dim); border: 1px solid var(--line); border-radius: 99px; padding: 0 8px; margin-left: 6px; font-weight: 500; vertical-align: 2px; }
footer { color: var(--dim); font-size: 14px; padding-top: 48px; padding-bottom: 48px; }
.scene { width: 100%; aspect-ratio: 16 / 9; max-height: 75vh; border-radius: 12px; overflow: hidden; background: #000; border: 1px solid var(--line); }
.crumbs { padding-top: 24px; font-size: 14px; }
.scene-head h1 { font-size: clamp(26px, 5vw, 38px); margin: 8px 0 4px; }
.scene-head p { margin: 0 0 16px; color: var(--dim); }
.cols { display: grid; grid-template-columns: 1fr; gap: 24px; margin-top: 24px; }
@media (min-width: 900px) { .cols { grid-template-columns: 2fr 1fr; } }
pre { margin: 0; background: var(--panel) !important; border: 1px solid var(--line); border-radius: 12px; padding: 16px !important;
      overflow-x: auto; font-size: 14px; line-height: 1.5; }
.cols > div { min-width: 0; }
pre code.hljs { padding: 0; background: none; }
.side h2 { font-size: 16px; margin: 0 0 8px; }
.side pre { font-size: 13px; padding: 10px 12px !important; margin-bottom: 16px; }
.side p { color: var(--dim); font-size: 14px; }
"""

HIGHLIGHT = ('<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">\n'
             '<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>\n'
             '<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/python.min.js"></script>\n'
             '<script>hljs.highlightAll()</script>')

COPY = """<script>
document.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
  navigator.clipboard.writeText(b.dataset.copy).then(() => { b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1200) })
})
</script>"""


def head(title, description):
    return ("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n"
            "<title>%s</title>\n<meta name=\"description\" content=\"%s\">\n"
            "<meta property=\"og:title\" content=\"%s\">\n<meta property=\"og:description\" content=\"%s\">\n"
            "<meta property=\"og:image\" content=\"%sthumbs/pythagoras.jpg\">\n"
            "<style>%s</style>\n</head>\n<body>\n"
            % (html.escape(title), html.escape(description), html.escape(title), html.escape(description), SITE, STYLE))


def first_comment_block(source):
    return [l for l in source.splitlines() if l.startswith("#")]


def index_page():
    cards = []
    for name, title, what, origin in SCENES:
        stem = Path(name).stem
        tag = '<span class="tag">Manim script</span>' if origin == "manim" else ""
        cards.append('<a class="card" href="%s.html"><img src="thumbs/%s.jpg" alt="%s" loading="lazy" '
                     'onerror="this.outerHTML=\'<span class=noimg></span>\'">'
                     '<div><h3>%s%s</h3><p>%s</p></div></a>'
                     % (stem, stem, html.escape(title), html.escape(title), tag, html.escape(what)))
    return (head("Pymations: maths animations in Python, in your browser",
                 "Maths explainer animations written in Python, playing live in your browser. Runs Manim Community scripts. Click any one to see its code.")
            + '<header>\n<h1>Pymations<small>Maths animations in Python, drawn in your web browser</small></h1>\n'
            '<p class="lead">Every animation below is a short Python program, playing live in your browser with its code beside it. '
            'Pymations runs <a href="%s">Manim Community</a> scripts: the ones marked "Manim script" are unchanged. '
            'Pymations is an independent project, not affiliated with Manim.</p>\n'
            '<div class="actions"><span class="install">pip install pymations<button data-copy="pip install pymations">Copy</button></span>'
            '<a class="btn primary" href="%s">Star on GitHub</a><a class="btn" href="%s/tree/main/docs">Docs</a>'
            '<a class="btn" href="%s">Edit and run one</a></div>\n</header>\n'
            '<main><div class="grid">\n%s\n</div></main>\n' % (MANIM, REPO, REPO, PAGE, "\n".join(cards))
            + footer() + COPY + "\n</body>\n</html>\n")


def scene_page(name, title, what, origin):
    stem = Path(name).stem
    source = (EXAMPLES / name).read_text(encoding="utf-8")
    note = (' This is a <a href="%s">Manim Community</a> script, unchanged.' % MANIM) if origin == "manim" else ""
    return (head("%s · Pymations" % title, "%s Written in Python with Pymations, playing live in your browser." % what)
            + '<main>\n<div class="crumbs"><a href="index.html">← All animations</a></div>\n'
            '<div class="scene-head"><h1>%s</h1><p>%s%s</p></div>\n'
            '<div class="scene" data-pymations-src="%s" data-pymations-loop></div>\n'
            '<div class="cols"><div><pre><code class="language-python">%s</code></pre></div>\n'
            '<div class="side"><h2>Run it yourself</h2>\n<pre>pip install pymations\npymations run %s</pre>\n'
            '<h2>Put it on your website</h2>\n<pre>pymations build %s -o site/</pre>\n'
            '<p>Python runs in the visitor\'s browser, so any static host works. '
            '<a href="%s/blob/main/docs/building-pages.md">How</a> · <a href="%s/blob/main/examples/%s">This file on GitHub</a></p>\n'
            '<p>Hover over the animation for the scrubber: pause, replay, or drag to any moment.</p>\n'
            '</div></div>\n</main>\n'
            % (html.escape(title), html.escape(what), note, name, html.escape(source),
               name, name, REPO, REPO, name)
            + footer() + HIGHLIGHT + '\n<script type="module" src="pymations/pymations.js"></script>\n</body>\n</html>\n')


def footer():
    return ('<footer>Pymations %s · MIT licence · <a href="%s">GitHub</a> · <a href="https://pypi.org/project/pymations/">PyPI</a> · '
            '<a href="https://www.npmjs.com/package/pymations">npm</a><br>'
            'Pymations is an independent project, not affiliated with Manim. It is also built into '
            '<a href="%s">Circuitry Studio</a>, where these scripts run in a code editor with a live preview beside the code: '
            '<a href="%s">circuitry.dev/pymations</a>.</footer>\n' % (pymations.__version__, REPO, STUDIO, PAGE))


def stage(folder):
    for name, title, what, origin in SCENES:
        shutil.copyfile(EXAMPLES / name, folder / name)
        for key, image in scene_images(EXAMPLES / name, (EXAMPLES / name).read_text(encoding="utf-8")):
            (folder / key).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(image, folder / key)
        (folder / (Path(name).stem + ".html")).write_text(scene_page(name, title, what, origin), encoding="utf-8")
    (folder / "index.html").write_text(index_page(), encoding="utf-8")


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class Serve:
    """The built gallery on a local port, for the screenshots."""

    def __init__(self, folder):
        handler = functools.partial(Quiet, directory=str(folder))
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.url = "http://127.0.0.1:%d/" % self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()


def open_scene(browser, url, size):
    page = browser.new_page(viewport={"width": size[0], "height": size[1]}, device_scale_factor=1)
    page.goto(url)
    page.wait_for_selector('[data-pymations-status="running"], [data-pymations-status="finished"]', timeout=120000)
    return page, page.locator(".scene")


def shots(out):
    from playwright.sync_api import sync_playwright
    thumbs = out / "thumbs"
    thumbs.mkdir(exist_ok=True)
    server = Serve(out)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            for name, *_ in SCENES:
                stem = Path(name).stem
                page, scene = open_scene(b, server.url + stem + ".html", (1280, 900))
                page.wait_for_timeout(THUMB_AT.get(name, 6000))
                scene.screenshot(path=str(thumbs / (stem + ".jpg")), type="jpeg", quality=82)
                page.close()
                print("  thumbs/%s.jpg" % stem)
            b.close()
    finally:
        server.close()


def gif(out, target, seconds=3.0, fps=15):
    from playwright.sync_api import sync_playwright
    frames = Path(tempfile.mkdtemp(prefix="pymations-gif-"))
    server = Serve(out)
    n = 0
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            for name in GIF_SCENES:
                page, scene = open_scene(b, server.url + Path(name).stem + ".html", (1100, 900))
                page.wait_for_timeout(THUMB_AT.get(name, 6000) - 1500)
                for _ in range(int(seconds * fps)):
                    scene.screenshot(path=str(frames / ("f%05d.png" % n)))
                    n += 1
                    page.wait_for_timeout(1000 / fps)
                page.close()
            b.close()
    finally:
        server.close()
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", str(frames / "f%05d.png"),
                    "-vf", "scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
                    "-loop", "0", str(target)], check=True)
    shutil.rmtree(frames)
    print("Recorded %s (%d KB)" % (target.relative_to(ROOT), target.stat().st_size // 1024))


# The README's pictures: strips of moments from a scene, side by side.
#   (file, scene, [(section or None, seconds into it, or from the end when negative)], shared crop)
# A shared crop cuts every frame to one box round everything drawn in any of
# them, so the frames line up; otherwise each is cut to its own content and
# scaled to the same height.
STRIPS = [
    ("readme-hello", "hello", [(None, 1.0), (None, 1.5), (None, 2.0), (None, 4.0)], True),
    ("readme-follow", "follow", [(None, 1.7), (None, 2.5), (None, 4.0)], True),
    ("readme-pythagoras", EXAMPLES / "pythagoras.py", [("Conclusion", -0.05), (None, -0.01)], False),
]

# Pixels wide at most: twice the width the README shows them at, for sharp screens.
STRIP_WIDTH = 2400

STRIP_JS = """async ([moments, shared, gap, pad, maxWidth]) => {
  const el = document.querySelector('[data-pymations-src]')
  const p = el.pymationsScene.player, e = p.engine
  await e.ready()
  p.setPlaying(false)
  const at = ([name, s]) => {
    if (name === null) return s < 0 ? p.duration + s : s
    const i = e.sections.findIndex((x) => x.name === name)
    return s < 0 ? e.sections[i].t + s : e.sections[i].t + s
  }
  const frames = []
  for (const m of moments) {
    p.seek(at(m)); await e.ready(); p.drawn = ''; p.seek(at(m))
    const c = document.createElement('canvas'); c.width = p.canvas.width; c.height = p.canvas.height
    c.getContext('2d').drawImage(p.canvas, 0, 0)
    frames.push(c)
  }
  const box = (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
    return [x0, y0, x1, y1]
  }
  let boxes = frames.map(box)
  if (shared) { const u = boxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]); boxes = boxes.map(() => u) }
  boxes = boxes.map(([x0, y0, x1, y1]) => [x0 - pad, y0 - pad, x1 - x0 + 1 + 2 * pad, y1 - y0 + 1 + 2 * pad])
  const h = Math.max(...boxes.map((b) => b[3]))
  const widths = boxes.map((b) => b[2] * h / b[3])
  const out = document.createElement('canvas')
  out.width = Math.round(widths.reduce((a, b) => a + b, 0) + gap * (frames.length - 1)); out.height = h
  const g = out.getContext('2d')
  g.fillStyle = '#000'; g.fillRect(0, 0, out.width, out.height)
  let x = 0
  frames.forEach((f, i) => {
    const [bx, by, bw, bh] = boxes[i]
    if (i) { g.fillStyle = '#30363d'; g.fillRect(Math.round(x - gap / 2) - 1, h * 0.12, 2, h * 0.76) }
    g.drawImage(f, bx, by, bw, bh, x, 0, widths[i], h)
    x += widths[i] + gap
  })
  if (out.width <= maxWidth) return out.toDataURL('image/jpeg', 0.88)
  const small = document.createElement('canvas')
  small.width = maxWidth; small.height = Math.round(out.height * maxWidth / out.width)
  const sg = small.getContext('2d'); sg.imageSmoothingQuality = 'high'
  sg.drawImage(out, 0, 0, small.width, small.height)
  return small.toDataURL('image/jpeg', 0.88)
}"""


def readme_scene(name):
    """The source of a README example, by the ```python block's first line after the heading."""
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    heading = {"hello": "## A first scene", "follow": "## Things that follow each other"}[name]
    return re.search(re.escape(heading) + r".*?```python\n(.*?)```", readme, re.S).group(1)


def readme_stills():
    """The README's pictures: a strip of moments from each of its examples."""
    import base64
    from playwright.sync_api import sync_playwright
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for name, scene, _, _ in STRIPS:
            if isinstance(scene, str):
                (tmp / (scene + ".py")).write_text(readme_scene(scene), encoding="utf-8")
                scene = tmp / (scene + ".py")
            build(scene, tmp / "site" / name, say=lambda *a: None)
        server = Serve(tmp / "site")
        try:
            with sync_playwright() as p:
                b = p.chromium.launch()
                for name, _, moments, shared in STRIPS:
                    page = b.new_page(viewport={"width": 1280, "height": 720}, device_scale_factor=2)
                    page.goto(server.url + name + "/index.html")
                    page.wait_for_selector('[data-pymations-status="finished"]', timeout=120000)
                    page.wait_for_function("() => { const s = document.querySelector('[data-pymations-src]').pymationsScene; "
                                           "return s.player && s.player.duration > 0 }", timeout=60000)
                    url = page.evaluate(STRIP_JS, [[list(m) for m in moments], shared, 48, 40, STRIP_WIDTH])
                    target = ROOT / "docs" / "images" / (name + ".jpg")
                    target.write_bytes(base64.b64decode(url.split(",", 1)[1]))
                    page.close()
                    print("  %s" % target.relative_to(ROOT))
                b.close()
        finally:
            server.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-o", "--out", default=str(ROOT / "site" / "gallery"))
    parser.add_argument("--shots", action="store_true", help="take the card pictures")
    parser.add_argument("--gif", action="store_true", help="record docs/images/gallery.gif")
    parser.add_argument("--readme", action="store_true", help="make the README's pictures (strips of moments from its examples)")
    args = parser.parse_args()
    out = Path(args.out).resolve()
    if out.exists():
        keep = out / "thumbs"
        saved = Path(tempfile.mkdtemp()) / "thumbs" if keep.exists() else None
        if saved:
            shutil.copytree(keep, saved)
        shutil.rmtree(out)
    else:
        saved = None
    with tempfile.TemporaryDirectory() as tmp:
        stage(Path(tmp))
        build(Path(tmp), out, title="Pymations", say=lambda *a: None)
    if saved:
        shutil.copytree(saved, out / "thumbs")
    (out / ".nojekyll").write_text("")   # GitHub Pages: serve the files as they are
    print("Built %s" % out)
    if args.shots:
        shots(out)
    if args.gif:
        gif(out, ROOT / "docs" / "images" / "gallery.gif")
    if args.readme:
        readme_stills()


if __name__ == "__main__":
    main()
