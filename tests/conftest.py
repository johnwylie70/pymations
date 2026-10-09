import asyncio
import base64
import functools
import http.server
import json
import os
import socket
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

# The module notes at exit when a script describes an animation outside a
# page; the tests run scenes in-process, so they say they are a host.
os.environ["PYMATIONS_HOSTED"] = "1"

ROOT = Path(__file__).resolve().parent.parent
EXAMPLES = ROOT / "examples"
SHOTS = ROOT / "tests" / "screenshots"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for_port(port, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.05)
    raise TimeoutError("nothing listening on %d" % port)


class RunProcess:
    """`pymations run <target> --no-browser` as a real subprocess."""

    def __init__(self, target):
        self.port = free_port()
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "pymations", "run", str(target), "--no-browser", "--port", str(self.port)],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        wait_for_port(self.port)
        self.url = "http://localhost:%d/" % self.port

    def stop(self):
        self.proc.terminate()
        try:
            out, _ = self.proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            out, _ = self.proc.communicate()
        return out


@pytest.fixture
def pymations_run():
    started = []

    def start(target):
        p = RunProcess(target)
        started.append(p)
        return p
    yield start
    for p in started:
        if p.proc.poll() is None:
            p.stop()


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


@pytest.fixture
def static_server():
    """Serve a folder the way any static host would."""
    servers = []

    def serve(folder):
        port = free_port()
        handler = functools.partial(_Quiet, directory=str(folder))
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        servers.append(httpd)
        return "http://localhost:%d/" % port
    yield serve
    for s in servers:
        s.shutdown()


class WSClient:
    """Just enough of a WebSocket client to talk to `pymations run`."""

    def __init__(self, port, src, origin=None):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        req = ("GET /_pymations/ws?src=%s HTTP/1.1\r\nHost: localhost:%d\r\nUpgrade: websocket\r\n"
               "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n" % (src, port, key))
        if origin:
            req += "Origin: %s\r\n" % origin
        self.sock.sendall((req + "\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(1)
            if not chunk:
                break
            head += chunk
        self.status = int(head.split(b" ")[1]) if head else 0

    def send(self, obj):
        data = json.dumps(obj).encode()
        mask = os.urandom(4)
        n = len(data)
        if n < 126:
            head = struct.pack("!BB", 0x81, 0x80 | n)
        elif n < 65536:
            head = struct.pack("!BBH", 0x81, 0x80 | 126, n)
        else:
            head = struct.pack("!BBQ", 0x81, 0x80 | 127, n)
        body = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        self.sock.sendall(head + mask + body)

    def _read(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("closed")
            buf += chunk
        return buf

    def recv(self):
        b0, b1 = self._read(2)
        n = b1 & 0x7F
        if n == 126:
            n = struct.unpack("!H", self._read(2))[0]
        elif n == 127:
            n = struct.unpack("!Q", self._read(8))[0]
        return json.loads(self._read(n).decode())

    def close(self):
        self.sock.close()


def run_scene(source, ticks=0):
    """Run a scene's source in this process, the way the worker does: the
    runtime's start(), then `ticks` frames. Returns the replies (dicts)."""
    import pymations
    runtime = sys.modules["pyctures"]
    sys.modules["manim"] = pymations
    try:
        replies = [json.loads(runtime.start(source, json.dumps({"width": 640, "height": 360, "pixel_ratio": 1})))]
        for _ in range(ticks):
            replies.append(json.loads(runtime.tick(json.dumps({"dt": 1 / 60, "events": [], "reads": {}}))))
        runtime.stop()
    finally:
        sys.modules.pop("manim", None)
    return replies


def engine_calls(replies):
    """The animation engine methods the replies call, in order (handle 6)."""
    return [c[4] for r in replies for c in r["cmds"] if c[0] == "call" and c[3] == 6]
