"""The ``pymations`` command."""
import argparse
import sys

from . import __version__


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="pymations",
        description="Maths animations in Python, drawn in your web browser. Runs Manim Community scripts.")
    parser.add_argument("--version", action="version", version="pymations " + __version__)
    sub = parser.add_subparsers(dest="command")

    run = sub.add_parser("run", help="play a scene in your browser, running in this Python",
                         description="Play a scene in your browser. Python runs here, in this "
                                     "computer's Python, so any library you have installed works. "
                                     "Saving the file runs it again.")
    run.add_argument("path", help="a .py scene, or a folder of scenes and web pages")
    run.add_argument("--port", type=int, default=None, help="port to listen on (default 8770, or the next free one)")
    run.add_argument("--host", default="127.0.0.1", help="address to listen on (default 127.0.0.1)")
    run.add_argument("--no-browser", action="store_true", help="do not open a browser")

    build = sub.add_parser("build", help="write a static folder, or one .html file, that plays the scene in any browser",
                           description="Write a static folder that plays the scene entirely in the "
                                       "browser, with Pyodide. Put it on any static host. Give an "
                                       "output ending in .html for one self-contained file.")
    build.add_argument("path", help="a .py scene, or a folder (for example a web page with scenes in it)")
    build.add_argument("-o", "--out", default="site", help="output folder (default: site), or a .html file for one self-contained file")
    build.add_argument("--add", action="append", default=[], metavar="FILE",
                       help="a file or folder the scene opens or imports (repeatable)")
    build.add_argument("--title", default=None, help="the page title")

    args = parser.parse_args(argv)
    if args.command == "run":
        from .server import run as serve
        serve(args.path, host=args.host, port=args.port, open_browser=not args.no_browser)
    elif args.command == "build":
        from .build import build as make
        make(args.path, args.out, add=args.add, title=args.title)
    else:
        parser.print_help()
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
