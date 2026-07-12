#!/usr/bin/env python3
"""
Ocean Mapper, as a Mac app.

Runs the server on a free port, opens the globe in your browser, and lives in the
menu bar so there's an obvious way to quit it. That last part is the whole reason
this file exists: a background process with no window and no way to stop it is a
bad citizen on someone else's computer.

The browser does the rendering, deliberately. Safari and Chrome have mature
WebGL2; an embedded webview is one more thing to go wrong for no benefit.

    python3 app.py            # run it
    python3 scripts/build_app.py   # package it into OceanMapper.app
"""

import http.server
import os
import socket
import socketserver
import sys
import threading
import webbrowser

import AppKit
import objc
from Foundation import NSObject

import server


def free_port() -> int:
    """Ask the OS for a port nobody is using. Never hard-code 8000 in an app."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class Delegate(NSObject):
    """Menu bar item: open the globe, or quit."""

    def initWithURL_(self, url):
        self = objc.super(Delegate, self).init()
        self.url = url
        return self

    def applicationDidFinishLaunching_(self, notification):
        bar = AppKit.NSStatusBar.systemStatusBar()
        self.item = bar.statusItemWithLength_(AppKit.NSVariableStatusItemLength)
        self.item.button().setTitle_("🌊")

        menu = AppKit.NSMenu.alloc().init()

        title = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "Ocean Mapper", None, ""
        )
        title.setEnabled_(False)
        menu.addItem_(title)
        menu.addItem_(AppKit.NSMenuItem.separatorItem())

        open_item = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "Open the globe", "openGlobe:", "o"
        )
        open_item.setTarget_(self)
        menu.addItem_(open_item)

        menu.addItem_(AppKit.NSMenuItem.separatorItem())

        quit_item = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "Quit Ocean Mapper", "quit:", "q"
        )
        quit_item.setTarget_(self)
        menu.addItem_(quit_item)

        self.item.setMenu_(menu)
        webbrowser.open(self.url)

    def openGlobe_(self, sender):
        webbrowser.open(self.url)

    def quit_(self, sender):
        AppKit.NSApp().terminate_(self)


def main():
    os.makedirs(server.CACHE, exist_ok=True)
    server.load_catalogue()

    port = free_port()
    url = f"http://127.0.0.1:{port}"

    httpd = Server(("127.0.0.1", port), server.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    print(f"  🌊 Ocean Mapper → {url}")

    app = AppKit.NSApplication.sharedApplication()
    # Accessory, not Regular: it belongs in the menu bar, not the Dock or the
    # app switcher. The globe lives in the browser window.
    app.setActivationPolicy_(AppKit.NSApplicationActivationPolicyAccessory)

    delegate = Delegate.alloc().initWithURL_(url)
    app.setDelegate_(delegate)
    app.run()


if __name__ == "__main__":
    sys.exit(main())
