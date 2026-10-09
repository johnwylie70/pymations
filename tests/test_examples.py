"""Every example runs in your own Python without an error, and describes an animation."""
import pytest

from conftest import EXAMPLES, engine_calls, run_scene

# Reference scenes synced from Circuitry before the module has what they use.
# They are expected to fail (and reported if they pass) until the next sync.
PENDING = set()

SCENES = sorted(p.name for p in EXAMPLES.glob("*.py"))


@pytest.mark.parametrize("name", [pytest.param(n, marks=pytest.mark.xfail(reason="needs a newer module"))
                                  if n in PENDING else n for n in SCENES])
def test_example_runs(name):
    replies = run_scene((EXAMPLES / name).read_text(encoding="utf-8"), ticks=3)
    for r in replies:
        assert r["error"] is None, "%s line %s: %s" % (name, r["errorLine"], r["error"])
    calls = engine_calls(replies)
    assert "make" in calls and ("play" in calls or "add" in calls), calls[:10]


def test_examples_say_how_to_run_them():
    for name in SCENES:
        head = (EXAMPLES / name).read_text(encoding="utf-8").splitlines()[:3]
        assert any("pymations run " + name in line for line in head), name
