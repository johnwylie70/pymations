"""Scenes in a real (headless) Chromium: `pymations run`, and `pymations build` with Pyodide.

Needs Playwright:  pip install playwright && playwright install chromium
(Playwright's own Chromium, not an installed Chrome.) Screenshots land in
tests/screenshots/. The build tests load Pyodide from its CDN and are skipped
when it cannot be reached.
"""
import time
import urllib.request

import pytest

from conftest import EXAMPLES, SHOTS
from test_examples import PENDING
from pymations import build as build_mod

playwright = pytest.importorskip("playwright.sync_api")

SCENES = sorted(p.name for p in EXAMPLES.glob("*.py") if p.name not in PENDING)

# How many pixels of a 160x90 copy of the animation layer are drawn on (it is transparent elsewhere).
INKED = """(el) => {
  const c = el.querySelector('canvas.pymations-anim'); if (!c) return 0
  const t = document.createElement('canvas'); t.width = 160; t.height = 90
  const g = t.getContext('2d'); g.drawImage(c, 0, 0, 160, 90)
  const d = g.getImageData(0, 0, 160, 90).data
  let n = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++
  return n
}"""

STATE = """(el) => {
  const s = el.pymationsScene, p = s && s.player
  return s ? { status: s.status, t: p ? p.t : null, duration: p ? p.duration : null, playing: p ? p.playing : null,
               sections: p ? p.engine.sections.length : 0, errors: s.errors.slice() } : null
}"""

PICTURE = "(el) => el.querySelector('canvas.pymations-anim').toDataURL()"


def cdn_reachable():
    try:
        urllib.request.urlopen("https://cdn.jsdelivr.net/pyodide/v0.29.4/full/pyodide.mjs", timeout=5)
        return True
    except Exception:
        return False


needs_cdn = pytest.mark.skipif(not cdn_reachable(), reason="Pyodide's CDN cannot be reached")


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


class Watched:
    """A page, with its console errors collected."""

    def __init__(self, browser, url, size=(960, 540)):
        self.page = browser.new_page(viewport={"width": size[0], "height": size[1]})
        self.errors = []
        self.page.on("console", lambda m: self.errors.append(m.text) if m.type == "error" else None)
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.goto(url)
        self.scene = self.page.wait_for_selector("[data-pymations-src]")

    def state(self):
        return self.scene.evaluate(STATE)

    def wait_playing(self, at_least=1.0, timeout=90):
        """Until the timeline has played `at_least` seconds (or reached its end)."""
        end = time.time() + timeout
        st = None
        while time.time() < end:
            st = self.state()
            if st and st["status"] == "error":
                break
            if st and st["duration"] and st["t"] is not None and st["t"] >= min(at_least, st["duration"]):
                return st
            self.page.wait_for_timeout(250)
        raise AssertionError("the animation did not play: %s %s" % (st, self.scene.get_attribute("data-pymations-error")))

    def check(self, shot, min_pixels=30, at_least=2.0):
        st = self.wait_playing(at_least)
        err = self.scene.get_attribute("data-pymations-error")
        assert err is None, err
        assert st["status"] in ("running", "finished"), st
        assert not st["errors"], st["errors"]
        assert not self.errors, self.errors
        inked = self.scene.evaluate(INKED)
        assert inked >= min_pixels, "the animation looks blank (%d pixels drawn)" % inked
        SHOTS.mkdir(exist_ok=True)
        self.page.screenshot(path=str(SHOTS / shot))
        return st


@pytest.mark.parametrize("scene", SCENES)
def test_run_each_example(browser, pymations_run, scene):
    p = pymations_run(EXAMPLES / scene)
    w = Watched(browser, p.url)
    w.check("run-" + scene.replace(".py", ".png"))
    w.page.close()


def test_run_scrubber_seeks_and_pauses(browser, pymations_run):
    p = pymations_run(EXAMPLES / "moving_around.py")
    w = Watched(browser, p.url)
    st = w.wait_playing(0.5)
    w.page.mouse.move(480, 270)                     # the scrubber shows on hover
    w.page.click(".pymations-play")                 # pause
    assert w.state()["playing"] is False
    track = w.page.query_selector(".pymations-track").bounding_box()
    y = track["y"] + track["height"] / 2
    w.page.mouse.click(track["x"] + track["width"] * 0.1, y)
    first = w.scene.evaluate(PICTURE)
    t1 = w.state()["t"]
    w.page.mouse.click(track["x"] + track["width"] * 0.9, y)
    t2 = w.state()["t"]
    assert abs(t1 - st["duration"] * 0.1) < 0.3 and abs(t2 - st["duration"] * 0.9) < 0.3, (t1, t2)
    assert w.scene.evaluate(PICTURE) != first
    w.page.wait_for_timeout(500)
    assert w.state()["t"] == t2                     # still paused
    w.page.screenshot(path=str(SHOTS / "run-scrubber.png"))
    w.page.close()


def test_run_plays_every_scene_of_a_file_as_sections(browser, pymations_run):
    p = pymations_run(EXAMPLES / "two_scenes.py")
    w = Watched(browser, p.url)
    st = w.wait_playing(0.5)
    assert st["sections"] == 2 and st["duration"] > 5
    w.page.mouse.move(480, 270)
    assert len(w.page.query_selector_all(".pymations-ticks i")) == 1   # the second scene's start
    w.page.close()


def test_run_shows_errors_with_the_line(browser, pymations_run, tmp_path):
    scene = tmp_path / "broken.py"
    scene.write_text("from manim import *\n\nplay(Create(Circle()))\nplay(Create(undefined_name))\n")
    p = pymations_run(scene)
    w = Watched(browser, p.url)
    w.page.wait_for_selector(".pymations-error", timeout=30000)
    assert "Error on line 4 of broken.py" in w.page.inner_text(".pymations-error h2")
    w.page.close()


@needs_cdn
def test_built_folder_plays_with_pyodide(browser, static_server, tmp_path):
    out = tmp_path / "site"
    build_mod.build(EXAMPLES / "sin_cos_plot.py", out, say=lambda *a: None)
    w = Watched(browser, static_server(out))
    w.check("build-sin_cos_plot.png")
    w.page.close()


@needs_cdn
def test_single_file_plays_a_reference_scene_from_disk(browser, tmp_path):
    # Equations (KaTeX outlines) and text (Liberation Sans) come from inside the file.
    out = tmp_path / "pythagoras.html"
    build_mod.build(EXAMPLES / "pythagoras.py", out, say=lambda *a: None)
    w = Watched(browser, out.as_uri())
    w.check("single-pythagoras.png", at_least=4.0)
    w.page.close()
