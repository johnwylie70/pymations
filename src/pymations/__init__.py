"""Pymations: maths animations in Python, drawn in your web browser.

Runs Manim Community scripts: ``from pymations import *`` is the main form,
and in the pages Pymations serves and builds, ``from manim import *`` gives
the same module, so pasted scripts run as they are.

Python only DESCRIBES the scene. ``Circle()``, ``next_to()``, ``play()`` each
record one command for the browser engine (``web/engine/anim.js``), which owns
geometry, placement, the timeline and drawing. ``play()`` appends to the
timeline and returns at once.

The module is two files, both copied from Circuitry, where Pymations is built
(``circuitry/scripts/sync-pymations-lib.mjs``):

  ``_runtime.py``  the Pyctures runtime it sits on: records commands, runs
                   frames, reports errors with line numbers. Loaded as the
                   module ``pyctures``, because that is where ``_anim.py``
                   finds it.
  ``_anim.py``     Pymations itself, run here in this package's namespace.

``pymations run`` and ``pymations build`` load them the same way, so a scene
behaves the same in your own Python and in the browser.
"""
import os as _os
import sys as _sys
import types as _types

__version__ = "0.1.0"

_HERE = _os.path.dirname(_os.path.abspath(__file__))


def _source(name):
    with open(_os.path.join(_HERE, name), encoding="utf-8") as f:
        return f.read()


def _runtime():
    """The Pyctures runtime, as the module ``pyctures``: the one already
    loaded when it has the hooks Pymations needs, else the copy in this
    package."""
    rt = _sys.modules.get("pyctures")
    if rt is not None and hasattr(rt, "_after_top_level") and hasattr(rt, "_hidden_vars"):
        return rt
    rt = _types.ModuleType("pyctures")
    rt.__file__ = _os.path.join(_HERE, "_runtime.py")
    exec(compile(_source("_runtime.py"), rt.__file__, "exec"), rt.__dict__)
    _sys.modules["pyctures"] = rt
    return rt


_rt_module = _runtime()
exec(compile(_source("_anim.py"), _os.path.join(_HERE, "_anim.py"), "exec"), globals())


# The script that imported this, noted now: Python clears __main__ before exit.
_MAIN = _sys.modules.get("__main__")
_MAIN_FILE = getattr(_MAIN, "__file__", None)
_MAIN_VARS = getattr(_MAIN, "__dict__", {})


def _hint():
    """`python scene.py` describes an animation but has nowhere to show it."""
    if _os.environ.get("PYMATIONS_HOSTED") or not _MAIN_FILE:
        return
    st = getattr(getattr(_rt_module, "S", None), "anim", None)
    used = bool(st and st.reset_sent)
    if not used:
        scene = globals().get("Scene")
        used = any(isinstance(v, type) and scene is not None and issubclass(v, scene) and v is not scene
                   and getattr(v, "__module__", None) == "__main__" for v in list(_MAIN_VARS.values()))
    path = _MAIN_FILE
    if used:
        _sys.stderr.write("This script describes an animation. Play it in your browser with:\n"
                          "  pymations run %s\n" % _os.path.relpath(path))


import atexit as _atexit  # noqa: E402

_atexit.register(_hint)
