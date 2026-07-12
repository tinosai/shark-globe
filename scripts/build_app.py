#!/usr/bin/env python3
"""
Package Shark Globe into a standalone SharkGlobe.app.

Standalone means standalone: PyInstaller bundles the Python interpreter, so the
app runs on a Mac with no Python, no pip, and no terminal. Everything the globe
needs — the HTML, the shaders, the basemap, the species catalogue — is packed
inside the bundle.

    python3 -m pip install --user pyinstaller
    python3 scripts/build_app.py

Output: dist/SharkGlobe.app
"""

import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
APP = os.path.join(DIST, "SharkGlobe.app")

# The site itself. These get unpacked to sys._MEIPASS at run time, which is what
# server.py uses as ROOT when frozen.
ASSETS = ["index.html", "css", "src", "data"]


def check():
    missing = [a for a in ASSETS if not os.path.exists(os.path.join(ROOT, a))]
    if missing:
        sys.exit(f"missing: {missing}")

    basemap = os.path.join(ROOT, "data", "basemap.png")
    species = os.path.join(ROOT, "data", "species.json")
    if not os.path.exists(basemap):
        sys.exit("data/basemap.png missing — run: python3 scripts/build_basemap.py")
    if not os.path.exists(species):
        sys.exit("data/species.json missing — run: python3 scripts/build_species.py")


def main():
    check()
    shutil.rmtree(DIST, ignore_errors=True)
    shutil.rmtree(os.path.join(ROOT, "build"), ignore_errors=True)

    add_data = []
    for a in ASSETS:
        src = os.path.join(ROOT, a)
        # PyInstaller wants src:dest_dir. '.' puts a file at the bundle root;
        # a directory keeps its own name.
        add_data += ["--add-data", f"{src}:{a if os.path.isdir(src) else '.'}"]

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--name", "SharkGlobe",
        "--windowed",                 # a .app bundle, no terminal window
        "--noconfirm",
        "--clean",
        "--osx-bundle-identifier", "com.sharkglobe.app",
        *add_data,
        # PyInstaller's static analysis can't see these — AppKit is reached
        # through pyobjc's lazy loading, and server is imported by name.
        "--hidden-import", "AppKit",
        "--hidden-import", "Foundation",
        "--hidden-import", "objc",
        "--hidden-import", "server",
        "--paths", ROOT,
        os.path.join(ROOT, "app.py"),
    ]

    print("  building… (a minute or two)")
    subprocess.run(cmd, check=True, cwd=ROOT)

    if not os.path.isdir(APP):
        sys.exit("build finished but no .app appeared")

    # It lives in the menu bar, not the Dock. Say so in the Info.plist, or macOS
    # bounces a Dock icon for an app that has no window.
    plist = os.path.join(APP, "Contents", "Info.plist")
    subprocess.run(
        ["/usr/libexec/PlistBuddy", "-c", "Add :LSUIElement bool true", plist],
        check=False, capture_output=True,
    )

    size = subprocess.run(
        ["du", "-sh", APP], capture_output=True, text=True
    ).stdout.split()[0]

    print(f"\n  ✓ {APP}  ({size})")
    print("\n  It is not code-signed, so the first launch needs:")
    print("      right-click → Open → Open")
    print("  (or: xattr -dr com.apple.quarantine SharkGlobe.app)")


if __name__ == "__main__":
    main()
