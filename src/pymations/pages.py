"""The HTML pages ``pymations run`` serves and ``pymations build`` writes."""
import base64
import html
import json
import os
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
WEB = HERE / "web"
ENGINE = WEB / "engine"
RUNTIME = HERE / "_runtime.py"
ANIM = HERE / "_anim.py"


def _engine_files():
    if not ENGINE.is_dir():
        return {}
    return {("engine/" + p.relative_to(ENGINE).as_posix()): p
            for p in sorted(ENGINE.rglob("*")) if p.is_file() and not p.name.startswith(".")}


# Published path inside the ``pymations/`` asset folder -> file in the package.
ASSETS = {
    "pymations.js": WEB / "pymations.js",
    "pyctures.py": RUNTIME,
    "pymations.py": ANIM,
    **_engine_files(),
}

NOTICE = """Pymations (MIT licence, John Wylie): pymations.js, pyctures.py, pymations.py, engine/anim.js.
Pyctures runtime (MIT licence, John Wylie): pyctures.py.
KaTeX (MIT licence, Khan Academy and other contributors): engine/katex.min.js, engine/katex.min.css.
KaTeX fonts (SIL Open Font License 1.1, Design Science and Khan Academy): engine/fonts/KaTeX_*; see engine/fonts/LICENSE_KATEX_FONTS.txt.
opentype.js (MIT licence, Frederik De Bleser): engine/opentype.min.js.
polygon-clipping (MIT licence, Mike Fogel): bundled in engine/anim.js; see engine/LICENSE-polygon-clipping.txt.
Liberation Sans (SIL Open Font License 1.1): engine/fonts/LiberationSans-*.ttf; see engine/fonts/LICENSE_LIBERATION.txt.
Pyodide (Mozilla Public License 2.0) is not included: it is loaded from its official CDN, https://cdn.jsdelivr.net/pyodide/.
Full texts: https://github.com/johnwylie70/pymations/blob/main/THIRD-PARTY-NOTICES
"""

# A file that uses the animation module (the browser half, ANIM_IMPORT, makes the same test).
_ANIM_IMPORT = re.compile(r"^[ \t]*(?:from|import)[ \t]+(?:pymations|manim)\b", re.M)


def uses_anim(source):
    """Whether a scene uses the animation module (and so needs the engine)."""
    return _ANIM_IMPORT.search(source) is not None


def scene_page(title, src, script, server=False, output="console", files=(), loop=False):
    """A page that is one scene, filling the window."""
    attrs = ' data-pymations-src="%s" data-pymations-fullpage' % html.escape(src)
    if output == "panel":
        attrs += ' data-pymations-output="panel"'
    if files:
        attrs += ' data-pymations-files="%s"' % html.escape(",".join(files))
    if loop:
        attrs += " data-pymations-loop"
    meta = '<meta name="pymations-server" content="ws">\n' if server else ""
    return """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
{meta}<title>{title}</title>
<style>
html,body{{margin:0;height:100%;overflow:hidden;background:#000}}
#scene{{position:fixed;inset:0}}
</style>
</head>
<body>
<div id="scene"{attrs}></div>
<script type="module" src="{script}"></script>
</body>
</html>
""".format(meta=meta, title=html.escape(title), attrs=attrs, script=html.escape(script))


def _json_for_html(value):
    """JSON that is safe inside a <script> element."""
    return (json.dumps(value, ensure_ascii=False).replace("<", "\\u003c")
            .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))


def _script_for_html(js):
    """JavaScript source that is safe inside a <script> element."""
    return js.replace("</script", "<\\/script").replace("<!--", "<\\!--")


def _b64(path):
    return base64.b64encode(Path(path).read_bytes()).decode("ascii")


def packed_engine():
    """The engine, its helpers and its fonts, for a single-file page.

    KaTeX's stylesheet gets its .woff2 fonts inline (the browser uses them to
    lay equations out); the .ttf files the engine outlines glyphs from are
    packed by name and handed to it when it asks for them."""
    css = (ENGINE / "katex.min.css").read_text(encoding="utf-8")

    def font_face(m):
        block = m.group(0)
        woff2 = re.search(r"url\(fonts/([^)]+\.woff2)\)", block)
        if not woff2 or not (ENGINE / "fonts" / woff2.group(1)).is_file():
            return block
        src = 'src:url(data:font/woff2;base64,%s) format("woff2")' % _b64(ENGINE / "fonts" / woff2.group(1))
        return re.sub(r"src:[^;}]+", lambda _: src, block, count=1)

    css = re.sub(r"@font-face\{[^}]*\}", font_face, css)
    return {
        "js": (ENGINE / "anim.js").read_text(encoding="utf-8"),
        "katex": (ENGINE / "katex.min.js").read_text(encoding="utf-8"),
        "katexCss": css,
        "opentype": (ENGINE / "opentype.min.js").read_text(encoding="utf-8"),
        "fonts": {p.name: _b64(p) for p in sorted((ENGINE / "fonts").glob("*.ttf"))},
    }


def single_page(title, name, source, files=None, loop=False):
    """One self-contained HTML file: the scene, the Python half, the browser
    half (whose worker it carries inside), and the animation engine with its
    fonts when the scene uses it. Python itself (Pyodide) still loads from its
    CDN.

    ``files``: {path: bytes} the scene opens or imports, and the images it
    loads by a relative path.
    """
    files = files or {}
    anim = uses_anim(source)
    data = {
        "runtime": RUNTIME.read_text(encoding="utf-8"),
        "anim": ANIM.read_text(encoding="utf-8"),
        "sources": {name: source},
        "files": {k: base64.b64encode(v).decode("ascii") for k, v in files.items()},
    }
    if anim:
        data["engine"] = packed_engine()
    attrs = ' data-pymations-src="%s" data-pymations-fullpage' % html.escape(name)
    if files:
        attrs += ' data-pymations-files="%s"' % html.escape(",".join(files))
    if loop:
        attrs += " data-pymations-loop"
    licence = ("<!-- Made with Pymations (MIT). Includes KaTeX (MIT) and its fonts (SIL OFL 1.1), opentype.js (MIT) and Liberation Sans "
               "(SIL OFL 1.1). Loads Pyodide (MPL 2.0) from its CDN. -->\n" if anim else
               "<!-- Made with Pymations (MIT). Loads Pyodide (MPL 2.0) from its CDN. -->\n")
    return """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
{licence}<style>
html,body{{margin:0;height:100%;overflow:hidden;background:#000}}
#scene{{position:fixed;inset:0}}
</style>
</head>
<body>
<div id="scene"{attrs}></div>
<script type="application/json" id="pymations-inline">{data}</script>
<script type="module">
{script}
</script>
</body>
</html>
""".format(title=html.escape(title), licence=licence, attrs=attrs, data=_json_for_html(data),
           script=_script_for_html((WEB / "pymations.js").read_text(encoding="utf-8")))


# A relative path to a picture, a sound or a font file: no scheme, not absolute, a known
# extension. The browser half (pymations.js, IMAGE_PATH) makes the same test.
IMAGE_PATH = re.compile(r"^(?![a-z][a-z0-9+.-]*:|/)(?:\./)?[^\s\"'<>?#]+\."
                        r"(png|jpe?g|gif|webp|svg|bmp|avif|mp3|wav|ogg|m4a|aac|flac|ttf|otf|woff2?)$", re.I)
_LITERAL = re.compile(r"""(['"])((?:\\.|(?!\1)[^\\\n])*)\1""")


def is_relative_image_path(s):
    return len(s) < 300 and IMAGE_PATH.match(s) is not None


def image_paths_in_source(source):
    """Relative image paths named by string literals in a scene, as written
    (``"./a.png"`` stays ``./a.png``). Paths built at run time cannot be seen."""
    found = []
    for m in _LITERAL.finditer(source):
        if is_relative_image_path(m.group(2)) and m.group(2) not in found:
            found.append(m.group(2))
    return found


def packed_key(path):
    """The key an image is packed under: as written, without a leading ``./``."""
    return re.sub(r"^(\./)+", "", path)


def scene_list_page(title, scenes):
    """A plain list of the scenes in a folder: (link, name) pairs."""
    items = "\n".join('<li><a href="%s">%s</a></li>' % (html.escape(link), html.escape(name))
                      for link, name in scenes)
    return """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
body{{font:16px/1.6 system-ui,sans-serif;margin:0;padding:24px 16px;background:#0b0b0f;color:#e5e7eb}}
main{{max-width:640px;margin:0 auto}} a{{color:#58c4dd}}
</style>
</head>
<body><main>
<h1>{title}</h1>
<ul>
{items}
</ul>
</main></body>
</html>
""".format(title=html.escape(title), items=items or "<li>No .py files here.</li>")


def inject_server_meta(text):
    """Mark a page served by ``pymations run`` so its scenes use your Python."""
    tag = '<meta name="pymations-server" content="ws">'
    low = text.lower()
    i = low.find("<head>")
    if i >= 0:
        return text[:i + 6] + "\n" + tag + text[i + 6:]
    return tag + "\n" + text


SKIP_DIRS = {".git", ".venv", "venv", "env", "node_modules", "__pycache__", ".mypy_cache",
             ".pytest_cache", ".idea", ".vscode"}


def walk(root):
    """Every file under root, skipping hidden folders and environments."""
    for folder, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for f in files:
            if not f.startswith("."):
                yield Path(folder) / f
