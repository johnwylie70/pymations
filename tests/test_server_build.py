"""`pymations run` (HTTP + WebSocket + worker) and `pymations build`, without a browser."""
import json
import re
import socket
import subprocess
import sys
import time
import urllib.request

from conftest import EXAMPLES, ROOT, WSClient
from pymations import build as build_mod
from pymations import pages

PKG = ROOT / "src" / "pymations"


def get(url):
    with urllib.request.urlopen(url, timeout=10) as r:
        return r.status, r.read().decode("utf-8", "replace")


def get_bytes(url):
    with urllib.request.urlopen(url, timeout=10) as r:
        return r.read()


def raw_get(port, path):
    with socket.create_connection(("127.0.0.1", port), timeout=5) as s:
        s.sendall(("GET %s HTTP/1.1\r\nHost: localhost\r\n\r\n" % path).encode())
        data = b""
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            data += chunk
    return int(data.split(b" ")[1])


def test_run_serves_the_scene_page_and_assets(pymations_run):
    p = pymations_run(EXAMPLES / "hello.py")
    status, page = get(p.url)
    assert status == 200
    assert 'data-pymations-src="hello.py"' in page
    assert 'name="pymations-server"' in page
    assert get(p.url + "pymations/pymations.js")[0] == 200
    assert get(p.url + "pymations/pymations.py")[1] == (PKG / "_anim.py").read_text()
    assert get(p.url + "pymations/pyctures.py")[1] == (PKG / "_runtime.py").read_text()
    assert get(p.url + "pymations/engine/anim.js")[0] == 200
    assert get_bytes(p.url + "pymations/engine/fonts/LiberationSans-Regular.ttf")[:4] == b"\x00\x01\x00\x00"
    assert get(p.url + "hello.py")[1].startswith("# Hello")
    # nothing outside the scene's folder
    assert raw_get(p.port, "/../pyproject.toml") == 404
    assert raw_get(p.port, "/%2e%2e/pyproject.toml") == 404


def test_run_a_folder_lists_scenes(pymations_run):
    p = pymations_run(EXAMPLES)
    status, page = get(p.url)
    assert "hello.py" in page and "pythagoras.py" in page
    status, page = get(p.url + "?scene=sin_cos_plot.py")
    assert 'data-pymations-src="sin_cos_plot.py"' in page


def test_websocket_runs_a_scene_in_a_python_process(pymations_run):
    p = pymations_run(EXAMPLES / "moving_around.py")
    ws = WSClient(p.port, "/moving_around.py")
    assert ws.status == 101
    ws.send({"id": 1, "op": "start", "info": {"width": 640, "height": 360, "pixel_ratio": 1}})
    m = ws.recv()
    assert m["id"] == 1
    reply = json.loads(m["reply"])
    assert reply["error"] is None
    calls = [c[4] for c in reply["cmds"] if c[0] == "call" and c[3] == 6]
    assert calls[0] == "reset" and "section" in calls and calls.count("play") == 5
    ws.close()


def test_websocket_reports_errors_with_line_numbers(pymations_run, tmp_path):
    scene = tmp_path / "broken.py"
    scene.write_text("from manim import *\n\nplay(Create(Circle()))\nplay(Create(undefined_name))\n")
    p = pymations_run(scene)
    ws = WSClient(p.port, "/broken.py")
    ws.send({"id": 1, "op": "start", "info": {"width": 100, "height": 100}})
    reply = json.loads(ws.recv()["reply"])
    assert reply["errorLine"] == 4
    assert "NameError" in reply["error"]
    ws.close()
    out = p.stop()
    assert "broken.py, line 4" in out and "NameError" in out   # also in the terminal


def test_websocket_refuses_other_sites_and_other_files(pymations_run):
    p = pymations_run(EXAMPLES / "hello.py")
    assert WSClient(p.port, "/hello.py", origin="https://example.com").status == 403
    assert WSClient(p.port, "/../pyproject.toml").status == 404
    assert WSClient(p.port, "/hello.py", origin=p.url.rstrip("/")).status == 101


def test_your_own_modules_import_and_files_open(pymations_run, tmp_path):
    (tmp_path / "helper.py").write_text("SIZE = 7\n")
    (tmp_path / "data.txt").write_text("hello")
    (tmp_path / "scene.py").write_text("import helper\nfrom pymations import *\nprint(helper.SIZE, open('data.txt').read())\n")
    p = pymations_run(tmp_path / "scene.py")
    ws = WSClient(p.port, "/scene.py")
    ws.send({"id": 1, "op": "start", "info": {}})
    reply = json.loads(ws.recv()["reply"])
    assert reply["out"] == "7 hello\n"
    ws.close()


def test_saving_the_file_reloads_open_pages(pymations_run, tmp_path):
    scene = tmp_path / "scene.py"
    scene.write_text("from pymations import *\nplay(Create(Circle()))\n")
    p = pymations_run(scene)
    ws = WSClient(p.port, "/scene.py")
    ws.send({"id": 1, "op": "start", "info": {}})
    ws.recv()
    time.sleep(0.5)
    scene.write_text("from pymations import *\nplay(Create(Square()))\n")
    ws.sock.settimeout(5)
    assert ws.recv() == {"type": "reload"}
    ws.close()


# ---------------------------------------------------------------- build

def test_build_a_scene_is_relative_and_self_contained(tmp_path):
    out = tmp_path / "site"
    build_mod.build(EXAMPLES / "sin_cos_plot.py", out, say=lambda *a: None)
    index = (out / "index.html").read_text()
    assert 'data-pymations-src="sin_cos_plot.py"' in index
    assert 'src="pymations/pymations.js"' in index
    assert "localhost" not in index and 'src="/' not in index and "pymations-server" not in index
    for published in pages.ASSETS:
        assert (out / "pymations" / published).is_file(), published
    assert (out / "pymations/pymations.py").read_text() == (PKG / "_anim.py").read_text()
    assert (out / "pymations/engine/fonts/KaTeX_Main-Regular.ttf").is_file()
    assert "Liberation Sans" in (out / "pymations/NOTICE.txt").read_text()
    assert (out / "sin_cos_plot.py").is_file()
    # the browser half asks only for relative paths
    js = (out / "pymations/pymations.js").read_text()
    assert "new URL('engine/', BASE)" in js and "'/pymations" not in js


def test_build_one_file_holds_the_engine_and_the_module(tmp_path):
    out = tmp_path / "pythagoras.html"
    build_mod.build(EXAMPLES / "pythagoras.py", out, say=lambda *a: None)
    page = out.read_text()
    data = json.loads(re.search(r'<script type="application/json" id="pymations-inline">(.*?)</script>', page, re.S)
                      .group(1))
    assert data["anim"] == (PKG / "_anim.py").read_text()
    assert data["runtime"] == (PKG / "_runtime.py").read_text()
    assert data["sources"]["pythagoras.py"] == (EXAMPLES / "pythagoras.py").read_text()
    engine = data["engine"]
    assert engine["js"] == (PKG / "web/engine/anim.js").read_text()
    assert engine["katex"] and engine["opentype"]
    assert "LiberationSans-Regular.ttf" in engine["fonts"] and "KaTeX_Main-Regular.ttf" in engine["fonts"]
    assert "url(fonts/" not in engine["katexCss"] and "data:font/woff2;base64," in engine["katexCss"]
    assert "Pymations, the browser half" in page          # pymations.js, inline
    markup = page.split('<script type="application/json"')[0]
    assert '<meta name="pymations-server"' not in markup and not re.search(r"<script[^>]*\bsrc=", markup)


def test_build_one_file_without_animation_leaves_the_engine_out(tmp_path):
    scene = tmp_path / "plain.py"
    scene.write_text("def draw():\n    ctx.fill_rect(0, 0, 10, 10)\n")
    out = tmp_path / "plain.html"
    build_mod.build(scene, out, say=lambda *a: None)
    page = out.read_text()
    assert '"engine"' not in page and len(page) < 400_000


def test_build_a_folder_of_scenes_makes_a_page_for_each(tmp_path):
    src = tmp_path / "scenes"
    src.mkdir()
    (src / "one.py").write_text("from pymations import *\nplay(Create(Circle()))\n")
    (src / "two.py").write_text("from manim import *\nplay(Create(Square()))\n")
    out = tmp_path / "site"
    build_mod.build(src, out, say=lambda *a: None)
    assert 'href="one.html"' in (out / "index.html").read_text()
    assert 'data-pymations-src="two.py"' in (out / "two.html").read_text()
    assert (out / "pymations/engine/anim.js").is_file()


def test_cli_build(tmp_path):
    out = tmp_path / "site"
    r = subprocess.run([sys.executable, "-m", "pymations", "build", str(EXAMPLES / "hello.py"), "-o", str(out)],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert (out / "hello.py").is_file() and (out / "index.html").is_file()
    single = tmp_path / "hello.html"
    r = subprocess.run([sys.executable, "-m", "pymations", "build", str(EXAMPLES / "hello.py"), "-o", str(single)],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert "with the animation engine" in r.stdout and single.stat().st_size > 1_000_000


def test_versions_agree():
    import pymations
    py = re.search(r'^version = "([^"]+)"', (ROOT / "pyproject.toml").read_text(), re.M).group(1)
    npm = json.loads((ROOT / "npm/package.json").read_text())["version"]
    assert py == pymations.__version__ == npm


def test_release_readme_points_pictures_at_github():
    import importlib.util
    spec = importlib.util.spec_from_file_location("build_release", ROOT / "scripts" / "build_release.py")
    rel = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rel)
    base = "https://raw.githubusercontent.com/someone/pymations/main/"
    text = (ROOT / "README.md").read_text()
    out = rel.absolute_images(text, base)
    pictures = re.findall(r'<img\s[^>]*?src="([^"]+)"|!\[[^\]]*\]\(([^)\s]+)\)', text)
    local = [a or b for a, b in pictures if not (a or b).startswith("http")]
    assert local, "the README has pictures by relative path"
    for path in local:
        assert (ROOT / path).is_file(), path                 # they show in a checkout and on GitHub
        assert base + path in out                            # and on PyPI
    assert '<div data-pymations-src="hello.py">' in out      # code examples are left alone
