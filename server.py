#!/usr/bin/env python3
"""
Shark Globe — static files, a terrain-tile proxy, and the species join.

Why proxy the terrain tiles: they're served without CORS headers, so a browser
can *draw* them but cannot read their pixels back out of a canvas (it gets
tainted and getImageData throws) — and reading the pixels is the whole point,
since that's where depth and the land mask come from. Routing them through this
origin sidesteps it. Everything is cached to disk on first fetch, so the app
works offline after a warm run.

Why do the species join here: the catalogue is ~44k species / ~10 MB. A hexagon
contains a few hundred of them. Joining server-side means the browser downloads
a few hundred records instead of the whole catalogue.

    python3 server.py          # http://localhost:8000
"""

import hashlib
import http.server
import json
import os
import re
import socketserver
import sys
import urllib.error
import urllib.parse
import urllib.request

PORT = int(os.environ.get("PORT", 8000))

# Where our files live, and where we're allowed to write.
#
# Inside a packaged .app these are NOT the same place: the bundle is read-only
# and code-signed, so the tile cache has to go to the user's Caches directory.
# Writing into the bundle would fail — or worse, break the signature.
if getattr(sys, "frozen", False):
    ROOT = sys._MEIPASS  # PyInstaller unpacks the bundled files here
    CACHE = os.path.expanduser("~/Library/Caches/SharkGlobe")
else:
    ROOT = os.path.dirname(os.path.abspath(__file__))
    CACHE = os.path.join(ROOT, ".cache")

# Terrarium terrain-RGB tiles: elevation is packed into the pixel colour as
# (R * 256 + G + B / 256) - 32768, in metres. Negative values are bathymetry,
# which is the entire point — one source gives us both the land mask and depth.
TERRAIN_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

# No satellite imagery, and no photographic basemap.
#
# Both are gone. The imagery carried no information the app actually uses — depth
# does — and mercator tiles wrapped onto a sphere band badly. The globe is a
# textured sphere (data/basemap.png, baked from this same elevation data) with
# terrain tiles streamed over the region you're looking at. Nothing to misproject.

OBIS_API = "https://api.obis.org/v3/"

# Selachii (sharks — not rays) + Cetacea (whales, dolphins, porpoises).
TAXA = "368408,2688"

UA = "shark-globe/0.1 (educational; contact: local)"
TIMEOUT = 30

def build_stamp() -> int:
    """Newest mtime across our own source. Any edit changes every module URL."""
    newest = 0
    for base, _dirs, files in os.walk(os.path.join(ROOT, "src")):
        for f in files:
            if f.endswith(".js"):
                newest = max(newest, int(os.path.getmtime(os.path.join(base, f))))
    for f in ("index.html", os.path.join("css", "style.css")):
        p = os.path.join(ROOT, f)
        if os.path.exists(p):
            newest = max(newest, int(os.path.getmtime(p)))
    return newest


SPECIES_JSON = os.path.join(ROOT, "data", "species.json")

# The catalogue is ~44k species / ~10 MB. It lives here, in the server, and never
# goes to the browser. A hexagon holds a few hundred species at most, so we do
# the join here and ship only what was actually found — the alternative is a
# 10 MB download before the user can click anything.
CATALOGUE = {}


def load_catalogue():
    global CATALOGUE
    if not os.path.exists(SPECIES_JSON):
        print("  ⚠ data/species.json missing — run: python3 scripts/build_species.py")
        return
    with open(SPECIES_JSON) as fh:
        CATALOGUE = {row["sci"]: row for row in json.load(fh)}
    print(f"  catalogue: {len(CATALOGUE):,} species with depth ranges")


def cache_path(key: str, ext: str) -> str:
    h = hashlib.sha1(key.encode()).hexdigest()
    return os.path.join(CACHE, f"{h}{ext}")


def fetch(url: str, key: str, ext: str) -> bytes:
    """Fetch a URL, memoising the response body on disk forever."""
    path = cache_path(key, ext)
    if os.path.exists(path):
        with open(path, "rb") as fh:
            return fh.read()

    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        body = resp.read()

    os.makedirs(CACHE, exist_ok=True)
    tmp = path + ".part"
    with open(tmp, "wb") as fh:
        fh.write(body)
    os.replace(tmp, path)  # atomic, so a killed process can't leave a torn tile
    return body


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        # The default logger screams about every tile. Only surface real problems.
        if not str(args[0] if args else "").startswith(("GET /api/tile", "GET /src", "GET /css")):
            sys.stderr.write("  %s\n" % (fmt % args))

    def _send(self, body: bytes, ctype: str, cache: bool = True):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if cache:
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.end_headers()
        self.wfile.write(body)

    def _fail(self, code: int, msg: str):
        body = msg.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        route = parsed.path

        if route.startswith("/api/tile/"):
            return self.serve_tile(route)
        if route == "/api/life":
            return self.serve_life(parsed.query)
        if route in ("/", "/index.html") or route.endswith((".js", ".css")):
            return self.serve_source(route)

        return super().do_GET()

    def serve_source(self, route: str):
        """
        Serve our own source, stamped so a stale copy cannot exist.

        Cache-Control was not enough. Browsers fall back to HEURISTIC caching when
        given no policy, and Safari will happily keep an ES module and never
        revalidate it. That produced two SyntaxErrors for exports that were
        sitting right there in the file — the browser had linked a stale module
        against a fresh one. The code was correct and the app was broken, which is
        the worst kind of bug to chase.

        So every module URL carries ?v=<build>, where build is the newest mtime
        across our source. Touch any file and every URL changes with it, which
        makes a stale module not merely unlikely but unreachable: it is a
        different URL. The rewrite below stamps the import specifiers on the way
        out, so the whole graph is versioned, not just the entry point.
        """
        if route in ("/", "/index.html"):
            path = os.path.join(ROOT, "index.html")
        else:
            path = os.path.normpath(os.path.join(ROOT, route.lstrip("/")))

        if not path.startswith(ROOT) or not os.path.isfile(path):
            return self._fail(404, "not found")

        with open(path, "r") as fh:
            body = fh.read()

        stamp = build_stamp()

        if path.endswith((".js", ".html")):
            # Relative specifiers only. Bare ones ('h3-js') go through the import
            # map and must be left alone.
            body = re.sub(
                r"""(\bfrom\s+|\bimport\s*\(\s*)(['"])(\.{1,2}/[^'"]+?\.js)\2""",
                lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}?v={stamp}{m.group(2)}",
                body,
            )

        if path.endswith(".html"):
            body = body.replace('src="/src/main.js"', f'src="/src/main.js?v={stamp}"')
            body = body.replace('href="/css/style.css"', f'href="/css/style.css?v={stamp}"')

        ctype = {".js": "text/javascript", ".css": "text/css", ".html": "text/html"}[
            os.path.splitext(path)[1]
        ]

        raw = body.encode()
        self.send_response(200)
        self.send_header("Content-Type", f"{ctype}; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.end_headers()
        self.wfile.write(raw)

    def serve_life(self, query):
        """
        Everything living in one hexagon.

        OBIS answers "what has been recorded inside this polygon"; the catalogue
        answers "how deep does it live and what does it do at night". Joined here
        so the browser gets ~100 enriched records instead of a 10 MB catalogue.
        """
        params = urllib.parse.parse_qs(query)
        wkt = (params.get("geometry") or [""])[0]
        if not wkt:
            return self._fail(400, "geometry (WKT) required")

        # Sharks and whales, asked for by name.
        #
        # Selachii is the shark clade — sharks only, no rays or skates (that would
        # be Elasmobranchii, and it would bring 543 of them). Cetacea is whales,
        # dolphins and porpoises. OBIS takes both in one comma-separated query,
        # which keeps this to a single round trip.
        #
        # Filtering here rather than in the browser matters: an unfiltered
        # checklist over a coastal cell returns 1,300 taxa, of which we would
        # throw away 1,250.
        taxon = (params.get("taxonid") or [TAXA])[0]
        url = f"{OBIS_API}checklist?geometry={urllib.parse.quote(wkt)}&size=2000&taxonid={taxon}"

        try:
            body = json.loads(fetch(url, url, ".json"))
        except urllib.error.HTTPError as e:
            return self._fail(e.code, f"obis {e.code}")
        except Exception as e:
            return self._fail(502, f"obis error: {e}")

        known, unknown = [], []
        for r in body.get("results", []):
            if r.get("taxonRank") != "Species" or not r.get("scientificName"):
                continue
            name = r["scientificName"]
            records = r.get("records") or 0
            trait = CATALOGUE.get(name)
            if trait:
                known.append({**trait, "records": records, "aphia": r.get("taxonID")})
            else:
                unknown.append({"sci": name, "records": records, "aphia": r.get("taxonID")})

        known.sort(key=lambda s: -s["records"])
        unknown.sort(key=lambda s: -s["records"])

        payload = json.dumps({
            "known": known,
            "unknown": unknown,
            "total": len(known) + len(unknown),
        }).encode()
        self._send(payload, "application/json")

    def serve_tile(self, route: str):
        # /api/tile/{z}/{x}/{y}.png
        parts = route[len("/api/tile/"):].replace(".png", "").split("/")
        if len(parts) != 3:
            return self._fail(400, "expected /api/tile/{z}/{x}/{y}.png")
        try:
            z, x, y = (int(p) for p in parts)
        except ValueError:
            return self._fail(400, "z/x/y must be integers")

        # Reject out-of-range tiles up front; upstream answers 403 for these and
        # we would otherwise cache the error page as if it were a tile.
        span = 1 << z
        if not (0 <= z <= 15 and 0 <= x < span and 0 <= y < span):
            return self._fail(404, "tile out of range")

        url = TERRAIN_URL.format(z=z, x=x, y=y)
        try:
            body = fetch(url, url, ".png")
        except urllib.error.HTTPError as e:
            return self._fail(e.code, f"upstream {e.code}")
        except Exception as e:
            return self._fail(502, f"upstream error: {e}")
        self._send(body, "image/png")


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def lan_address() -> str:
    """This machine's address on the local network, so a phone can reach it."""
    import socket

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))  # no packets sent; just picks the outbound iface
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return ""


if __name__ == "__main__":
    os.makedirs(CACHE, exist_ok=True)
    load_catalogue()
    with Server(("", PORT), Handler) as httpd:
        print(f"\n  \033[36m🦈 Shark Globe\033[0m")
        print(f"     this mac  \033[4mhttp://localhost:{PORT}\033[0m")
        lan = lan_address()
        if lan:
            print(f"     phone     \033[4mhttp://{lan}:{PORT}\033[0m  (same wifi)")
        print(f"     cache     {CACHE}\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  bye 🦈\n")
