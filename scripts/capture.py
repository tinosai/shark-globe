#!/usr/bin/env python3
"""
Capture the screenshots and the animated GIF for the README.

Drives a real browser over the DevTools protocol rather than grabbing the
screen — so it needs no Screen Recording permission, renders deterministically,
and can script the exact interactions worth showing.

    python3 server.py &
    python3 scripts/capture.py

Writes docs/*.png and docs/demo.gif
"""

import base64
import io
import json
import math
import os
import subprocess
import tempfile
import time
import urllib.request

import websocket
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
URL = os.environ.get("URL", "http://localhost:8000")
PORT = 9400

W, H = 1280, 900


class Browser:
    def __init__(self):
        self.profile = tempfile.mkdtemp(prefix="oceanshot")
        self.proc = subprocess.Popen(
            [
                CHROME, "--headless=new",
                f"--remote-debugging-port={PORT}",
                f"--user-data-dir={self.profile}",
                "--enable-unsafe-swiftshader",
                "--use-angle=swiftshader",
                "--hide-scrollbars",
                "--force-device-scale-factor=2",  # retina-crisp screenshots
                "--no-first-run", "--no-sandbox", "--remote-allow-origins=*",
                f"--window-size={W},{H}",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        target = None
        for _ in range(60):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
                target = next((t for t in tabs if t["type"] == "page"), None)
                if target:
                    break
            except Exception:
                pass
            time.sleep(0.2)
        if not target:
            raise SystemExit("could not attach to Chrome")

        self.ws = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=40)
        self.n = 0
        self.cmd("Page.enable")
        self.cmd("Runtime.enable")

    def cmd(self, method, **params):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.n:
                return msg.get("result", {})

    def js(self, expr):
        r = self.cmd("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        return r.get("result", {}).get("value")

    def goto(self, url, settle=9):
        self.cmd("Page.navigate", url=url)
        time.sleep(settle)

    def click(self, x, y, settle=6):
        for kind in ("mousePressed", "mouseReleased"):
            self.cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=1)
        time.sleep(settle)

    def shot(self) -> Image.Image:
        data = self.cmd("Page.captureScreenshot", format="png")["data"]
        return Image.open(io.BytesIO(base64.b64decode(data))).convert("RGB")

    def save(self, name):
        img = self.shot()
        # Downscale from the 2x capture: crisp, and not enormous in the README.
        img = img.resize((img.width // 2, img.height // 2), Image.LANCZOS)
        path = os.path.join(OUT, name)
        img.save(path, optimize=True)
        print(f"    {name}  {img.width}x{img.height}  {os.path.getsize(path)/1024:.0f} KB")
        return img

    def close(self):
        self.proc.terminate()


def main():
    os.makedirs(OUT, exist_ok=True)
    b = Browser()
    try:
        print("  stills:")
        b.goto(URL)

        # ── 1. the globe, from orbit
        b.js("globe.setView({longitude: -30, latitude: 20, zoom: 1.2})")
        time.sleep(4)
        b.save("globe.png")

        # ── 2. zoomed to a coast, showing real bathymetry
        b.js("globe.setView({longitude: 151.6, latitude: -33.9, zoom: 5.4})")
        time.sleep(8)
        b.save("bathymetry.png")

        # ── 3. clicked: depth + the animals, off Sydney
        b.click(430, 430, settle=9)
        b.js("sheet.to('half')")
        time.sleep(2)
        day = b.save("clicked.png")

        # ── 4. the same water column at night — the point of the whole app
        b.js("document.querySelector('#phase [data-phase=\\'night\\']').click()")
        time.sleep(3)
        night = b.save("night.png")

        # ── 5. a species page
        b.js("document.querySelector('#phase [data-phase=\\'day\\']').click()")
        time.sleep(1)
        b.js("document.querySelector('#species-list .species').click()")
        time.sleep(6)
        b.save("species.png")

        # ── the GIF: day → night → day, which is the thing worth animating
        print("\n  gif (day ↔ night):")
        b.js("document.getElementById('wiki-back').click()")
        time.sleep(2)

        frames = []
        for phase in ("day", "night"):
            b.js(f"document.querySelector('#phase [data-phase=\\'{phase}\\']').click()")
            # The bars take 900ms to swim. Sample across it.
            for i in range(14):
                time.sleep(0.09)
                img = b.shot()
                img = img.resize((img.width // 3, img.height // 3), Image.LANCZOS)
                frames.append(img)
            for _ in range(6):  # hold, so you can read it
                frames.append(frames[-1])

        gif = os.path.join(OUT, "demo.gif")
        pal = [f.convert("P", palette=Image.ADAPTIVE, colors=128) for f in frames]
        pal[0].save(gif, save_all=True, append_images=pal[1:], duration=90, loop=0, optimize=True)
        print(f"    demo.gif  {len(frames)} frames  {os.path.getsize(gif)/1e6:.1f} MB")

    finally:
        b.close()


if __name__ == "__main__":
    main()
