#!/usr/bin/env python3
"""Generate the Turnover corridor band (Deco Noir restyle, AD-028).

One tile of the repeatable hallway strip: wainscot + trim + patterned carpet.
32x146, fully opaque, tiles horizontally with period 32 (edges match by
construction: the only asymmetric element, the panel seam, sits at x=0).

Screen mapping (current 832x576 frame): band top = y350 (chair rail),
band bottom = y495 (carpet edge); the slate wall above is a flat fill.

Output:
  apps/client/public/art/rooms/corridor-band.png
  /tmp/opencode/corridor-tiled-mock.png  (full-width tiled corridor read)

Run from repo root: python3 scripts/art/generate-corridor-band.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

W, H = 32, 146

WALL = (51, 80, 90, 255)           # slate teal wall field
WAINSCOT = (36, 51, 59, 255)       # dark slate wainscot
WAINSCOT_SHADE = (26, 38, 45, 255)
CARPET = (92, 36, 48, 255)         # deep burgundy
CARPET_DARK = (66, 24, 34, 255)
BRASS = (201, 161, 59, 255)
NIGHT = (15, 27, 33, 255)          # ink teal night


def rect(px: Image.Image, x0: int, y0: int, x1: int, y1: int, color) -> None:
    for y in range(max(0, y0), min(px.height, y1 + 1)):
        for x in range(max(0, x0), min(px.width, x1 + 1)):
            px.putpixel((x, y), color)


def build_band() -> Image.Image:
    px = Image.new("RGBA", (W, H), WAINSCOT)
    # chair rail
    rect(px, 0, 0, 31, 1, WAINSCOT_SHADE)
    rect(px, 0, 2, 31, 2, WALL)
    # wainscot panel: seam at x=0, quiet field
    rect(px, 0, 3, 0, 73, WAINSCOT_SHADE)
    rect(px, 0, 74, 31, 75, WAINSCOT_SHADE)      # base shadow
    # brass shoe trim
    rect(px, 0, 76, 31, 77, BRASS)
    # carpet field with diamond motif (period 32 by construction)
    rect(px, 0, 78, 31, 143, CARPET)
    cx, cy = 16, 110
    for d in range(4):                       # diamond outline
        rect(px, cx - d, cy - 4 + d, cx + d, cy - 4 + d, CARPET_DARK)
        rect(px, cx - d, cy + 4 - d, cx + d, cy + 4 - d, CARPET_DARK)
    rect(px, cx, cy, cx, cy, BRASS)          # single gold knot
    # edge trim
    rect(px, 0, 144, 31, 144, CARPET_DARK)
    rect(px, 0, 145, 31, 145, BRASS)
    return px


def main() -> None:
    out = Path("apps/client/public/art/rooms/corridor-band.png")
    out.parent.mkdir(parents=True, exist_ok=True)
    band = build_band()
    band.save(out)
    print(f"wrote {out} ({band.width}x{band.height})")

    # tiled mock: full-width corridor at native scale, plus the reviewed
    # hero/props for the family read
    import importlib.util
    import sys

    sys.path.insert(0, str(Path(__file__).parent))

    def load(name: str, fn: str):
        path = Path(__file__).parent / (name.replace("_", "-") + ".py")
        spec = importlib.util.spec_from_file_location(name, path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return getattr(mod, fn)

    build_sheet = load("generate_staff_walk", "build_sheet")

    W, Hs = 832, 576
    mock = Image.new("RGBA", (W, Hs), NIGHT)
    for y in range(48, 350):
        for x in range(W):
            mock.putpixel((x, y), WALL)
    for x0 in range(0, W, W):
        pass
    for x0 in range(0, W, band.width):
        mock.paste(band, (x0, 350))

    doors = load("generate_doors_elevator", "door_closed")
    door_open = load("generate_doors_elevator", "door_open")
    card = load("generate_doors_elevator", "door_card")
    car = load("generate_doors_elevator", "elevator_car")
    panel = load("generate_doors_elevator", "elevator_panel")

    interior = Image.new("RGBA", (56, 86), (0, 0, 0, 0))

    def r(x0, y0, x1, y1, c):
        rect(interior, x0, y0, x1, y1, c)

    r(0, 0, 55, 85, (244, 217, 160, 255))
    r(0, 60, 55, 85, (90, 81, 72, 255))
    mock.alpha_composite(interior, (565, 339))
    mock.alpha_composite(door_open(), (560, 329))
    mock.alpha_composite(door_closed := doors(), (120, 329))
    mock.alpha_composite(card(), (204, 350))
    for y in range(48, 496):
        mock.putpixel((790, y), (26, 43, 60, 255))
    mock.alpha_composite(car(True), (700, 430 - 64))
    mock.alpha_composite(panel(True), (660, 340))
    walker = build_sheet().crop((2 * 28, 0, 3 * 28, 60))
    mock.alpha_composite(walker, (380, 430 - 60))
    mock.save("/tmp/opencode/corridor-tiled-mock.png")
    print("wrote /tmp/opencode/corridor-tiled-mock.png")


if __name__ == "__main__":
    main()
