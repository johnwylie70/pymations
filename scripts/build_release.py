"""Build the release files for PyPI, with the README's pictures pointing at GitHub.

    .venv/bin/python scripts/build_release.py            # -> dist/v<version>/

The README shows its pictures by relative paths (docs/images/...), so they work
in a checkout, in an editor's preview and on GitHub. PyPI shows the README as
the project description but cannot resolve those paths, so this builds from a
copy of the project whose README points them at the files on GitHub
(raw.githubusercontent.com/<account>/pymations/<ref>/...). The README in the
repository is never changed.

The pictures appear on PyPI once the repository is public with them on <ref>.
Options: --ref v0.2.0 (default: main), --repo account/pymations (default: the
Source URL in pyproject.toml).
"""
import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP = {".git", ".venv", "dist", "build", "site", ".pytest_cache", "node_modules", "__pycache__", "npm"}

# Relative image paths in Markdown ![..](path) and HTML <img src="path">.
IMAGE = re.compile(r'(!\[[^\]]*\]\(|<img\s[^>]*?src=")(?![a-z][a-z0-9+.-]*:|/|#)([^)"\s]+)')


def absolute_images(text, base):
    return IMAGE.sub(lambda m: m.group(1) + base + m.group(2).lstrip("./"), text)


def main():
    pyproject = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    version = re.search(r'^version = "([^"]+)"', pyproject, re.M).group(1)
    source = re.search(r'^Source = "https://github.com/([^"]+)"', pyproject, re.M).group(1)
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--ref", default="main", help="the branch or tag the pictures are read from (default: main)")
    parser.add_argument("--repo", default=source, help="account/repository on GitHub (default: %s)" % source)
    args = parser.parse_args()
    base = "https://raw.githubusercontent.com/%s/%s/" % (args.repo, args.ref)
    out = ROOT / "dist" / ("v" + version)
    with tempfile.TemporaryDirectory(prefix="pymations-release-") as tmp:
        copy = Path(tmp) / "pymations"
        shutil.copytree(ROOT, copy, ignore=lambda d, names: [n for n in names if n in SKIP or n.endswith(".egg-info")])
        readme = copy / "README.md"
        readme.write_text(absolute_images(readme.read_text(encoding="utf-8"), base), encoding="utf-8")
        subprocess.run([sys.executable, "-m", "build", "--outdir", str(out), str(copy)], check=True)
    print("Built %s (README pictures from %s)" % (out.relative_to(ROOT), base))


if __name__ == "__main__":
    main()
