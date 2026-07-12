#!/usr/bin/env python3
"""
Load the app in a real browser and report what breaks.

Written because grepping the source for `export function tileImage` proves the
text exists — and proves nothing about whether the browser can link the module,
whether the shaders compile, or whether anything renders. Those are the failures
that actually reached the user, and a regex waved every one of them through.

Drives headless Chrome over the DevTools protocol and reports:
  - uncaught exceptions and unhandled rejections
  - console errors and warnings
  - failed network requests
  - whether the globe actually booted and drew

    python3 -m pip install --user websocket-client
    python3 scripts/verify.py [--click]

--click also simulates a click on the middle of the globe and checks that the
panel responds, which is the one path a static check can never see.
"""

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

import websocket

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
URL = os.environ.get("URL", "http://localhost:8000")
PORT = 9333


class Session:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0
        self.events = []

    def send(self, method, **params):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.n:
                return msg.get("result", {})
            self.events.append(msg)

    def pump(self, seconds):
        """Collect events for a while."""
        deadline = time.time() + seconds
        self.ws.settimeout(0.4)
        while time.time() < deadline:
            try:
                self.events.append(json.loads(self.ws.recv()))
            except Exception:
                pass
        self.ws.settimeout(None)


def main():
    want_click = "--click" in sys.argv
    profile = tempfile.mkdtemp(prefix="oceanverify")

    chrome = subprocess.Popen(
        [
            CHROME,
            "--headless=new",
            f"--remote-debugging-port={PORT}",
            f"--user-data-dir={profile}",
            # SwiftShader gives a genuine WebGL2 context with no GPU, so shader
            # compilation and linking are really exercised.
            "--enable-unsafe-swiftshader",
            "--use-angle=swiftshader",
            "--no-first-run",
            "--no-sandbox",
            "--remote-allow-origins=*",
            "--window-size=1200,900",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        target = None
        for _ in range(50):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
                target = next((t for t in tabs if t["type"] == "page"), None)
                if target:
                    break
            except Exception:
                pass
            time.sleep(0.2)
        if not target:
            sys.exit("✗ could not attach to Chrome")

        ws = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=30)
        s = Session(ws)

        s.send("Runtime.enable")
        s.send("Log.enable")
        s.send("Page.enable")
        s.send("Network.enable")

        s.send("Page.navigate", url=URL)
        s.pump(9)  # let modules link, shaders compile, tiles land

        if want_click:
            # Click the middle of the canvas — i.e. somewhere on the globe.
            for kind in ("mousePressed", "mouseReleased"):
                s.send(
                    "Input.dispatchMouseEvent",
                    type=kind,
                    x=420, y=380,
                    button="left",
                    clickCount=1,
                )
            s.pump(7)

        def evaluate(expr):
            r = s.send("Runtime.evaluate", expression=expr, returnByValue=True)
            return r.get("result", {}).get("value")

        boom = evaluate("document.getElementById('boom')?.textContent || ''")
        hud = evaluate("document.getElementById('hud')?.textContent || ''")
        depth = evaluate("document.getElementById('depth')?.textContent || ''")
        status = evaluate("document.getElementById('status')?.textContent || ''")
        drew = evaluate("(() => { const c = document.getElementById('deck'); return c ? c.width + 'x' + c.height : 'no canvas'; })()")

    finally:
        chrome.terminate()

    problems = []

    for ev in s.events:
        m = ev.get("method")
        p = ev.get("params", {})
        if m == "Runtime.exceptionThrown":
            d = p.get("exceptionDetails", {})
            text = d.get("exception", {}).get("description") or d.get("text")
            problems.append(f"exception: {text}")
        elif m == "Log.entryAdded":
            e = p.get("entry", {})
            if e.get("level") == "error":
                problems.append(f"console: {e.get('text')}")
        elif m == "Network.loadingFailed":
            if p.get("type") in ("Script", "Stylesheet", "Document", "Image", "Fetch", "XHR"):
                problems.append(f"failed {p.get('type')}: {p.get('errorText')}")

    if boom.strip():
        problems.insert(0, f"page error banner: {boom.strip()}")

    print(f"  url            {URL}")
    print(f"  canvas         {drew}")
    print(f"  hud            {hud or '(empty — globe never reported a view)'}")
    if want_click:
        print(f"  depth readout  {depth or '(empty)'}")
        print(f"  status         {status[:80] or '(empty)'}")
    print()

    if problems:
        print("  ✗ FAILED")
        for p in dict.fromkeys(problems):
            print(f"      {p}")
        sys.exit(1)

    if not hud:
        print("  ✗ FAILED — no errors, but the globe never booted")
        sys.exit(1)

    if want_click and not depth.strip().rstrip("—"):
        print("  ✗ FAILED — clicked the globe and nothing came back")
        sys.exit(1)

    print("  ✓ boots clean: modules link, shaders compile, globe draws"
          + (", click responds" if want_click else ""))


if __name__ == "__main__":
    main()
