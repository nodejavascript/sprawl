#!/usr/bin/env python3
"""Check that the page SCROLLS, and that the ship still owns its keys while a run is live.

    python3 tools/serve.py 4355 &
    <the workspace venv>/bin/python3 tools/check-scroll.py

WHY THIS EXISTS. The engine cancels the wheel and the page's own keys across the whole document by
default (`inputPreventDefault` in LittleJS). The page is three screens tall, so that left it with no
way to scroll at all: measured in Chrome on 21 October 2026, every wheel event arrived with
`defaultPrevented` true and `scrollY` never left 0. No on-page rule could catch that — the HTML was
perfect — so the check has to read BEHAVIOUR, in a browser, and this file is that check.

It drives the Chrome already listening on 127.0.0.1:9222 (`~/.cdp.py` uses the same door) and closes
the tab it opened. Playwright is needed, and this repo does not ship it: the workspace venv at
~/Documents/git/gitlab.com/datavisionstudios/docker-compose-master/.venv is the interpreter that has it,
which is why `npm run check:scroll` passes `python3` and this file explains itself when it is missing.

Exit 0 = the page scrolls and the flight keys are held during play. 1 = a check failed. 2 = it could
not run (no browser, no Playwright) — which is NEVER a pass.
"""

from __future__ import annotations

import sys

URL = "http://127.0.0.1:4355/"
CDP = "http://127.0.0.1:9222"

try:
    from playwright.sync_api import sync_playwright
except ModuleNotFoundError:
    print("  CANNOT RUN — no Playwright on this interpreter.")
    print("  Use the workspace venv that has it:")
    print("    /home/geooogle/Documents/git/gitlab.com/datavisionstudios/docker-compose-master"
          "/.venv/bin/python3 tools/check-scroll.py")
    raise SystemExit(2)

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print("  %s  %s%s" % ("ok  " if ok else "FAIL", name, (" — " + detail) if detail and not ok else ""))
    if not ok:
        failures.append(name)


def probe() -> int:
    import time

    with sync_playwright() as p:
        try:
            browser = p.chromium.connect_over_cdp(CDP)
        except Exception as exc:  # noqa: BLE001 - a browser that is not there is exit 2, not a fail
            print("  CANNOT RUN — nothing answering on %s: %s" % (CDP, exc))
            return 2
        page = browser.contexts[0].new_page()
        try:
            page.goto(URL, wait_until="domcontentloaded", timeout=30000)
            time.sleep(1.5)

            room = page.evaluate("() => document.documentElement.scrollHeight - innerHeight")
            check("the page is taller than the window, so there is something to scroll", room > 400,
                  "%s px of scroll" % room)

            # A wheel listener added AFTER the engine's own sees defaultPrevented already set, which
            # is exactly the fault: the engine cancelled the wheel and the page never moved.
            page.evaluate("""() => {
                window.__wheel = [];
                window.__keys = [];
                window.addEventListener('wheel', e => window.__wheel.push(e.defaultPrevented), {passive: true});
                window.addEventListener('keydown', e => window.__keys.push([e.code, e.defaultPrevented]), {passive: true});
            }""")
            page.mouse.move(300, 300)
            page.mouse.wheel(0, 900)
            time.sleep(0.8)
            wheel = page.evaluate("() => ({prevented: window.__wheel, y: scrollY})")
            check("the mouse wheel is not cancelled by the page", wheel["prevented"] == [False],
                  "defaultPrevented %s" % wheel["prevented"])
            check("the wheel actually moved the page", wheel["y"] > 400, "scrollY %s" % wheel["y"])

            page.evaluate("() => { window.__keys.length = 0; }")
            page.click("#playBtn")
            time.sleep(1.5)
            playing = page.inner_text("#status").startswith("Flying")
            check("a run is live, so the reachable state is the one being tested", playing,
                  page.inner_text("#status"))
            page.keyboard.press("ArrowDown")
            page.keyboard.press("Space")
            time.sleep(0.4)
            keys = page.evaluate("() => window.__keys")
            check(
                "while flying, the keys the ship uses are held back from the page",
                bool(keys) and all(prevented for _, prevented in keys),
                " %s" % keys,
            )
        finally:
            page.close()
    return 0


if __name__ == "__main__":
    code = probe()
    print()
    if code == 2:
        raise SystemExit(2)
    if failures:
        print("  %d check(s) FAILED: %s" % (len(failures), "; ".join(failures)))
        raise SystemExit(1)
    print("  SCROLL OK — the page scrolls, and the ship keeps its keys while a run is live")
    raise SystemExit(0)
