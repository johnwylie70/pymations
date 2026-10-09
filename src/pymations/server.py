"""``pymations run``: a small local web server for scenes.

Standard library only: an asyncio HTTP server with just enough WebSocket
(RFC 6455) for one job. The page asks for a frame over the WebSocket; the
server passes the request to that page's own Python process
(``pymations._worker``) and sends the reply back. When a .py file in the folder
is saved, every open page reloads and runs again.

Listens on 127.0.0.1 only, and refuses WebSocket connections from other sites.
"""
import asyncio
import base64
import hashlib
import json
import mimetypes
import os
import struct
import sys
import socket
import webbrowser
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from . import pages

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_MESSAGE = 64 * 1024 * 1024
TYPES = {".js": "text/javascript", ".mjs": "text/javascript", ".py": "text/plain",
         ".html": "text/html", ".css": "text/css", ".json": "application/json",
         ".svg": "image/svg+xml", ".wasm": "application/wasm"}


def content_type(path):
    ext = Path(path).suffix.lower()
    t = TYPES.get(ext) or mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    if t.startswith("text/") or t in ("application/json",):
        t += "; charset=utf-8"
    return t


class WebSocket:
    """The server end of one WebSocket connection."""

    def __init__(self, reader, writer):
        self.reader = reader
        self.writer = writer
        self.closed = False

    async def recv(self):
        """The next text message, or None once the connection has closed."""
        parts = []
        size = 0
        while True:
            try:
                head = await self.reader.readexactly(2)
            except (asyncio.IncompleteReadError, ConnectionError):
                self.closed = True
                return None
            fin = head[0] & 0x80
            opcode = head[0] & 0x0F
            masked = head[1] & 0x80
            n = head[1] & 0x7F
            if n == 126:
                n = struct.unpack("!H", await self.reader.readexactly(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", await self.reader.readexactly(8))[0]
            if size + n > MAX_MESSAGE:
                await self.close(1009)
                return None
            mask = await self.reader.readexactly(4) if masked else None
            data = await self.reader.readexactly(n) if n else b""
            if mask:
                data = _unmask(data, mask)
            if opcode == 0x8:
                await self.close()
                return None
            if opcode == 0x9:
                await self._send(0xA, data)
                continue
            if opcode == 0xA:
                continue
            parts.append(data)
            size += n
            if fin:
                return b"".join(parts).decode("utf-8")

    async def send(self, text):
        await self._send(0x1, text.encode("utf-8"))

    async def _send(self, opcode, data):
        if self.closed:
            return
        n = len(data)
        if n < 126:
            head = struct.pack("!BB", 0x80 | opcode, n)
        elif n < 65536:
            head = struct.pack("!BBH", 0x80 | opcode, 126, n)
        else:
            head = struct.pack("!BBQ", 0x80 | opcode, 127, n)
        try:
            self.writer.write(head + data)
            await self.writer.drain()
        except ConnectionError:
            self.closed = True

    async def close(self, code=1000):
        if not self.closed:
            await self._send(0x8, struct.pack("!H", code))
            self.closed = True
        try:
            self.writer.close()
        except Exception:
            pass


def _unmask(data, mask):
    n = len(data)
    key = (mask * (n // 4 + 1))[:n]
    return (int.from_bytes(data, "big") ^ int.from_bytes(key, "big")).to_bytes(n, "big")


class Worker:
    """One page's Python process."""

    def __init__(self, path):
        self.path = path
        self.proc = None
        self.lock = asyncio.Lock()

    async def start(self):
        env = dict(os.environ)
        env["PYTHONUNBUFFERED"] = "1"
        # Tells the module it is being shown (no "run it with" note at exit).
        env["PYMATIONS_HOSTED"] = "1"
        # The package that is running this server, importable by the worker
        # even when it is not installed (running from a checkout).
        here = str(Path(__file__).resolve().parent.parent)
        env["PYTHONPATH"] = here + os.pathsep + env.get("PYTHONPATH", "") if env.get("PYTHONPATH") else here
        self.proc = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "pymations._worker", str(self.path),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            # Not the scene's folder: a scene named like a standard module
            # (random.py, typing.py) must not replace it while Python starts.
            # The worker moves into the scene's folder once it is running.
            cwd=here, env=env, limit=MAX_MESSAGE)

    async def call(self, msg):
        async with self.lock:
            if self.proc is None:
                await self.start()
            if self.proc.returncode is not None:
                raise RuntimeError("Python stopped. Look in the terminal for why, then save the file to run it again.")
            self.proc.stdin.write((json.dumps(msg) + "\n").encode("utf-8"))
            await self.proc.stdin.drain()
            line = await self.proc.stdout.readline()
            if not line:
                raise RuntimeError("Python stopped. Look in the terminal for why, then save the file to run it again.")
            return line.decode("utf-8").rstrip("\n")

    def kill(self):
        p = self.proc
        if p is not None and p.returncode is None:
            try:
                p.kill()
            except ProcessLookupError:
                pass


class Server:
    def __init__(self, target, host="127.0.0.1", port=8770, open_browser=True, port_given=False, quiet=False):
        target = Path(target).resolve()
        if target.is_dir():
            self.root, self.entry = target, None
        else:
            self.root, self.entry = target.parent, target.name
        self.host = host
        self.port = port
        self.port_given = port_given
        self.open_browser = open_browser
        self.quiet = quiet
        self.pages = set()     # (WebSocket, Worker) for every open page
        self.server = None

    def say(self, text):
        if not self.quiet:
            print(text, file=sys.stderr, flush=True)

    # ------------------------------------------------------------ http

    async def handle(self, reader, writer):
        try:
            request = await reader.readuntil(b"\r\n\r\n")
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, ConnectionError):
            writer.close()
            return
        lines = request.decode("latin-1").split("\r\n")
        try:
            method, target, _ = lines[0].split(" ", 2)
        except ValueError:
            writer.close()
            return
        headers = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        url = urlsplit(target)
        path = unquote(url.path)
        query = parse_qs(url.query)
        try:
            if path == "/_pymations/ws" and headers.get("upgrade", "").lower() == "websocket":
                await self.websocket(reader, writer, headers, query)
                return
            if method not in ("GET", "HEAD"):
                await self.respond(writer, 405, b"Method not allowed", "text/plain")
                return
            status, body, ctype = self.route(path, query)
            await self.respond(writer, status, body, ctype, head=(method == "HEAD"))
        except ConnectionError:
            pass
        finally:
            if not writer.is_closing():
                writer.close()

    async def respond(self, writer, status, body, ctype, head=False):
        reason = {200: "OK", 400: "Bad Request", 403: "Forbidden", 404: "Not Found",
                  405: "Method Not Allowed"}.get(status, "OK")
        hdr = ("HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %d\r\n"
               "Cache-Control: no-store\r\nConnection: close\r\n\r\n" % (status, reason, ctype, len(body)))
        writer.write(hdr.encode("latin-1") + (b"" if head else body))
        await writer.drain()

    def route(self, path, query):
        """(status, body, content type) for a GET."""
        scene = (query.get("scene") or [None])[0]
        if path == "/" and (scene or (self.entry and not (self.root / "index.html").exists())):
            scene = scene or self.entry
            if not self.inside(self.root / scene) or not (self.root / scene).is_file():
                return 404, b"No such scene", "text/plain"
            page = pages.scene_page(scene, scene, "/pymations/pymations.js", server=True, output="panel")
            return 200, page.encode("utf-8"), "text/html; charset=utf-8"
        if path.startswith("/_pymations/"):
            path = "/pymations/" + path[len("/_pymations/"):]
        file = (self.root / path.lstrip("/")).resolve()
        if path.endswith("/") or file.is_dir():
            index = file / "index.html"
            if index.is_file():
                file = index
            elif file == self.root:
                scenes = sorted(p.relative_to(self.root).as_posix() for p in pages.walk(self.root) if p.suffix == ".py")
                page = pages.scene_list_page(self.root.name, [("/?scene=" + s, s) for s in scenes])
                return 200, page.encode("utf-8"), "text/html; charset=utf-8"
        if self.inside(file) and file.is_file():
            body = file.read_bytes()
            if file.suffix.lower() in (".html", ".htm"):
                body = pages.inject_server_meta(body.decode("utf-8")).encode("utf-8")
            return 200, body, content_type(file)
        # The browser half, from the package, wherever a page asks for it:
        # /pymations/pymations.js, /sub/pymations/engine/anim.js ...
        parts = path.split("/pymations/", 1)
        if len(parts) == 2 and parts[1] in pages.ASSETS:
            asset = pages.ASSETS[parts[1]]
            return 200, asset.read_bytes(), content_type(parts[1])
        return 404, b"Not found", "text/plain"

    def inside(self, path):
        try:
            Path(path).resolve().relative_to(self.root)
            return True
        except ValueError:
            return False

    # ------------------------------------------------------------ websocket

    async def websocket(self, reader, writer, headers, query):
        origin = headers.get("origin")
        if origin and urlsplit(origin).netloc != headers.get("host"):
            await self.respond(writer, 403, b"Forbidden", "text/plain")
            writer.close()
            return
        src = (query.get("src") or [""])[0]
        path = (self.root / unquote(src).lstrip("/")).resolve()
        if not src or not self.inside(path) or not path.is_file():
            await self.respond(writer, 404, b"No such scene", "text/plain")
            writer.close()
            return
        key = headers.get("sec-websocket-key", "")
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        writer.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
                      "Connection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n" % accept).encode())
        await writer.drain()
        ws = WebSocket(reader, writer)
        worker = Worker(path)
        entry = (ws, worker)
        self.pages.add(entry)
        name = path.relative_to(self.root).as_posix()
        try:
            while True:
                text = await ws.recv()
                if text is None:
                    break
                msg = json.loads(text)
                op = msg.get("op")
                if op == "log":
                    self.say("%s: %s" % (name, msg.get("text", "")))
                    continue
                if op == "start":
                    self.say("Running %s" % name)
                    out = {"op": "start", "source": path.read_text(encoding="utf-8"), "info": msg.get("info")}
                elif op == "tick":
                    out = {"op": "tick", "payload": msg.get("payload")}
                else:
                    continue
                try:
                    reply = await worker.call(out)
                    await ws.send('{"id": %d, "reply": %s}' % (int(msg["id"]), json.dumps(reply)))
                except Exception as e:  # the worker is gone: say so on the page
                    await ws.send(json.dumps({"id": msg.get("id"), "error": str(e)}))
        finally:
            self.pages.discard(entry)
            worker.kill()
            await ws.close()

    # ------------------------------------------------------------ watching

    def snapshot(self):
        stamps = {}
        for p in pages.walk(self.root):
            if p.suffix in (".py", ".html", ".htm", ".css", ".js"):
                try:
                    stamps[p] = p.stat().st_mtime_ns
                except OSError:
                    pass
            if len(stamps) > 2000:
                break
        return stamps

    async def watch(self):
        """Re-run every open page when a file is saved."""
        before = self.snapshot()
        while True:
            await asyncio.sleep(0.3)
            now = self.snapshot()
            if now != before:
                changed = [p for p in set(now) | set(before) if now.get(p) != before.get(p)]
                before = now
                self.say("Saved %s: running again" % ", ".join(sorted(p.name for p in changed)))
                for ws, worker in list(self.pages):
                    worker.kill()
                    try:
                        await ws.send('{"type": "reload"}')
                    except Exception:
                        pass

    # ------------------------------------------------------------ main

    async def serve(self, ready=None):
        last_error = None
        for attempt in range(1 if self.port_given else 20):
            try:
                self.server = await asyncio.start_server(self.handle, self.host, self.port + attempt,
                                                         limit=1024 * 1024)
                self.port += attempt
                break
            except OSError as e:
                last_error = e
        else:
            raise SystemExit("pymations: could not listen on port %d (%s). Try --port." % (self.port, last_error))
        url = "http://%s:%d/" % ("localhost" if self.host in ("127.0.0.1", "localhost") else self.host, self.port)
        lan = None
        if self.host in ("0.0.0.0", "::", ""):
            # Listening on every address: show the ones a browser can open,
            # this computer's own and the one other devices on the network use.
            url = "http://localhost:%d/" % self.port
            lan = _lan_address()
        self.url = url
        what = self.entry or (self.root.name + "/")
        where = url + ("  (other devices: http://%s:%d/)" % (lan, self.port) if lan else "")
        self.say("Pymations is showing %s at %s\nSave the file to run it again. Press Ctrl+C to stop." % (what, where))
        if ready is not None:
            ready(url)
        if self.open_browser:
            webbrowser.open(url)
        watcher = asyncio.ensure_future(self.watch())
        try:
            async with self.server:
                await self.server.serve_forever()
        finally:
            watcher.cancel()
            for _, worker in list(self.pages):
                worker.kill()


def run(target, host="127.0.0.1", port=None, open_browser=True):
    server = Server(target, host=host, port=port or 8770, open_browser=open_browser, port_given=port is not None)
    try:
        asyncio.run(server.serve())
    except KeyboardInterrupt:
        print("\nStopped.", file=sys.stderr)


def _lan_address():
    """This computer's address on the local network, or None. Sends nothing."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("10.255.255.255", 1))
            address = sock.getsockname()[0]
        return None if address.startswith("127.") else address
    except OSError:
        return None
