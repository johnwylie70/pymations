"""The module in your own Python: both forms, the manim name, the note at exit."""
import importlib.util
import json
import os
import subprocess
import sys

from conftest import ROOT, engine_calls, run_scene

BARE = """from pymations import *
c = Circle()
play(Create(c))
wait()
"""

CLASS = """from manim import *

class One(Scene):
    def construct(self):
        self.play(FadeIn(Square()))

class Two(Scene):
    def construct(self):
        self.play(Write(Text("two")))
"""


def test_star_import_gives_the_manim_names():
    import pymations
    for name in ("Scene", "Circle", "MathTex", "Axes", "Create", "Transform", "LaggedStart",
                 "UP", "RIGHT", "PI", "BLUE", "smooth", "config", "np"):
        assert name in pymations.__all__, name
    assert pymations.__version__


def test_bare_form_records_the_timeline():
    calls = engine_calls(run_scene(BARE))
    assert calls[0] == "reset"
    assert calls.count("make") == 1 and calls.count("play") == 1 and calls.count("wait") == 1


def test_class_form_plays_every_scene_in_order_as_sections():
    replies = run_scene(CLASS)
    assert replies[0]["error"] is None
    sections = [c[5][0] for r in replies for c in r["cmds"] if c[0] == "call" and c[3] == 6 and c[4] == "section"]
    assert sections == ["One", "Two"]


def test_errors_carry_the_line():
    reply = run_scene("from pymations import *\n\nplay(Create(Circle()))\nplay(Create(undefined_name))\n")[0]
    assert reply["errorLine"] == 4 and "NameError" in reply["error"]


def test_no_top_level_manim_is_installed():
    # `manim` exists only inside pages and the run worker; the package never
    # shadows a real Manim install.
    top = (ROOT / "src").iterdir()
    assert sorted(p.name for p in top if not p.name.endswith(".egg-info")) == ["pymations"]
    spec = importlib.util.find_spec("manim")
    assert spec is None or "pymations" not in str(spec.origin)


def test_the_synced_files_are_there():
    pkg = ROOT / "src" / "pymations"
    synced = json.loads((pkg / "_synced.json").read_text())
    assert synced["runtime_version"] and synced["module_version"]
    assert (pkg / "_runtime.py").read_text().startswith("# GENERATED")
    assert (pkg / "_anim.py").read_text().startswith("# GENERATED")
    for f in ("anim.js", "katex.min.js", "katex.min.css", "opentype.min.js",
              "fonts/LiberationSans-Regular.ttf", "fonts/KaTeX_Main-Regular.ttf", "fonts/KaTeX_Main-Regular.woff2"):
        assert (pkg / "web" / "engine" / f).is_file(), f


def test_running_the_script_directly_says_how_to_play_it(tmp_path):
    scene = tmp_path / "scene.py"
    scene.write_text(BARE)
    env = dict(os.environ)
    env.pop("PYMATIONS_HOSTED", None)
    env["PYTHONPATH"] = str(ROOT / "src")
    r = subprocess.run([sys.executable, str(scene)], capture_output=True, text=True, env=env, cwd=tmp_path)
    assert r.returncode == 0, r.stderr
    assert "pymations run scene.py" in r.stderr
