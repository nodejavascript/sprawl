#!/usr/bin/env python3
"""Draw SPRAWL's icon set from the site's own mark.

    python3 tools/make_icons.py

The mark is five upright bars under a bright horizon line — the city, in the
site's own colours (violet #a855f7, cyan #22d3ee, orange #f97316). It is the same
drawing as site/favicon.svg and the SVG in the page header, so part 15c compares
one drawing with itself.

Writes, into site/:
    favicon-192.png       192x192  (declared FIRST — the largest square Google reads)
    favicon-180.png       180x180  (declared second — the Apple/legacy size)
    favicon-32.png         32x32
    favicon.ico           16/32/48
    apple-touch-icon.png  180x180 OPAQUE (iOS paints transparency black)
"""
from PIL import Image, ImageDraw
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"

BG = (10, 6, 20)
VIOLET = (168, 85, 247)
CYAN = (34, 211, 238)
ORANGE = (249, 115, 22)
LINE = (229, 231, 255)

# the bars, in the favicon's own 64-unit viewBox: x, y, height, colour
BARS = [
    (10, 26, 28, CYAN),
    (19, 16, 38, VIOLET),
    (28, 34, 20, CYAN),
    (37, 22, 32, VIOLET),
    (46, 30, 24, ORANGE),
]


def draw(size: int, opaque: bool = False) -> Image.Image:
    scale = size / 64
    img = Image.new("RGBA", (size, size), BG + (255,) if opaque else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    radius = max(2, int(12 * scale))
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=0 if opaque else radius, fill=BG + (255,))

    # bars — at least one pixel, so the mark survives at 16px
    for x, y, h, colour in BARS:
        x0, y0 = round(x * scale), round(y * scale)
        x1, y1 = round((x + 5) * scale) - (1 if size <= 32 else 0), round((y + h) * scale)
        d.rectangle((x0, y0, max(x0, x1), y1), fill=colour + (255,))

    # the horizon line
    d.rounded_rectangle(
        (round(10 * scale), round(9 * scale), round(51 * scale), round(13 * scale)),
        radius=max(1, int(2 * scale)),
        fill=LINE + (255,),
    )
    return img


def main() -> None:
    draw(192).save(SITE / "favicon-192.png")   # the one Google takes: largest square, >48
    draw(180).save(SITE / "favicon-180.png")
    draw(32).save(SITE / "favicon-32.png")
    draw(192).save(SITE / "icon-192.png")
    draw(512).save(SITE / "icon-512.png")
    draw(180, opaque=True).convert("RGB").save(SITE / "apple-touch-icon.png")  # no alpha channel

    # the .ico carries 16, 32 and 48
    draw(64).save(SITE / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("wrote favicon-180.png, favicon-32.png, favicon.ico, apple-touch-icon.png")


if __name__ == "__main__":
    main()
