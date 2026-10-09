"""Every scene in the README and the docs runs without an error."""
import re

import pytest

from conftest import ROOT, engine_calls, run_scene

BLOCK = re.compile(r"```python\n(.*?)```", re.S)


def scenes():
    for md in [ROOT / "README.md"] + sorted((ROOT / "docs").rglob("*.md")):
        for i, m in enumerate(BLOCK.finditer(md.read_text(encoding="utf-8"))):
            code = m.group(1)
            if re.search(r"^from (pymations|manim) import \*", code, re.M):
                yield pytest.param(code, id="%s-%d" % (md.relative_to(ROOT).as_posix(), i + 1))


@pytest.mark.parametrize("code", list(scenes()))
def test_doc_scene_runs(code):
    replies = run_scene(code, ticks=3)
    for r in replies:
        assert r["error"] is None, "line %s: %s" % (r["errorLine"], r["error"])
    assert "make" in engine_calls(replies) or any(r["cmds"] for r in replies)   # an animation, or a drawing
