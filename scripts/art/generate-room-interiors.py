#!/usr/bin/env python3
"""Generate the Turnover room-interior triptych (Deco Noir restyle, AD-028).

Three 112x96 opaque interiors, anchor bottom-left at the door threshold:
  apps/client/public/art/rooms/room-prepped.png         tidy baseline
  apps/client/public/art/rooms/room-trash-fresh.png     <=75s trash tier (FR-12)
  apps/client/public/art/rooms/room-trash-settled.png   settled trash tier

FR-12 rule enforced structurally: fresh and settled share identical geometry
(same mess) and differ only in palette tier — fresh is brighter with sickly
green spill accents, settled is desaturated and dim. Prepped is a separate
tidy composition (light pool, clear floor).

Output adds /tmp/opencode/rooms-hallway-mock.png: the three states seen
through open doors from the hallway — the gameplay read that must pass.

Run from repo root: python3 scripts/art/generate-room-interiors.py
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from PIL import Image

W, H = 112, 96

INK = (15, 27, 33, 255)


def C(r, g, b):
    return (r, g, b, 255)


# Shared furniture/debris geometry (identity locks: same room, same layout)
DEBRIS_PAPERS = [(50, 82), (60, 78), (72, 88), (84, 80), (94, 86), (66, 92)]
DEBRIS_CLUMPS = [(56, 86), (78, 78), (90, 90), (68, 80)]
SPILL_XY = (74, 84)


def rect(px: Image.Image, x0: int, y0: int, x1: int, y1: int, color) -> None:
    for y in range(max(0, y0), min(px.height, y1 + 1)):
        for x in range(max(0, x0), min(px.width, x1 + 1)):
            px.putpixel((x, y), color)


PREPPED = {
    "wall": C(43, 66, 75),
    "wall_shade": C(33, 51, 59),
    "floor": C(110, 72, 50),
    "floor_dark": C(88, 56, 40),
    "base": C(26, 38, 45),
    "sheet": C(246, 241, 230),
    "sheet_shade": C(207, 195, 168),
    "blanket": C(92, 36, 48),
    "blanket_shade": C(66, 24, 34),
    "wood": C(74, 48, 38),
    "wood_shade": C(58, 38, 32),
    "tv": C(35, 35, 43),
    "tv_screen": C(246, 241, 230),
    "brass": C(201, 161, 59),
    "night": C(15, 27, 33),
    "curtain": C(92, 36, 48),
    "pool": C(244, 217, 160),
    "paper": None,
    "clump": None,
    "spill": None,
}

FRESH = {**PREPPED,
         "wall": C(37, 57, 66), "wall_shade": C(28, 44, 51),
         "floor": C(98, 62, 44), "floor_dark": C(78, 48, 34),
         "sheet": C(226, 220, 206), "sheet_shade": C(190, 180, 160),
         "blanket": C(80, 32, 42), "blanket_shade": C(58, 22, 30),
         "paper": C(246, 241, 230), "clump": INK,
         "spill": C(164, 176, 106)}

SETTLED = {**PREPPED,
           "wall": C(30, 46, 53), "wall_shade": C(22, 34, 40),
           "floor": C(78, 50, 36), "floor_dark": C(62, 38, 28),
           "sheet": C(198, 190, 174), "sheet_shade": C(168, 158, 142),
           "blanket": C(66, 30, 38), "blanket_shade": C(48, 22, 28),
           "paper": C(156, 146, 128), "clump": C(60, 54, 48),
           "spill": C(90, 81, 72)}


def draw_room(state: dict, trashed: bool) -> Image.Image:
    px = Image.new("RGBA", (W, H), state["wall"])
    # back wall shading + baseboard
    rect(px, 0, 62, W - 1, 62, state["wall_shade"])
    rect(px, 0, 63, W - 1, 66, state["base"])
    # floor with plank pattern
    rect(px, 0, 67, W - 1, H - 1, state["floor"])
    for fx in range(8, W, 16):
        rect(px, fx, 67, fx, H - 1, state["floor_dark"])
    for fy in (80, 92):
        rect(px, 0, fy, W - 1, fy, state["floor_dark"])

    # window: night outside, curtains
    rect(px, 62, 12, 92, 40, state["wood_shade"])
    rect(px, 64, 14, 90, 38, state["night"])
    rect(px, 62, 12, 66, 40, state["curtain"])
    rect(px, 88, 12, 92, 40, state["curtain"])
    rect(px, 76, 14, 77, 38, state["wood_shade"])

    # framed art (tilted when trashed — same tilt in both trash tiers)
    if trashed:
        rect(px, 15, 20, 31, 34, state["brass"])
        rect(px, 17, 22, 29, 32, state["night"])
        rect(px, 14, 17, 18, 21, state["wall"])   # vacated corner
        rect(px, 14, 17, 30, 19, state["wall"])
    else:
        rect(px, 14, 18, 30, 32, state["brass"])
        rect(px, 16, 20, 28, 30, state["wall"])

    # bed (left): headboard, mattress, blanket
    rect(px, 4, 30, 10, 78, state["wood_shade"])          # headboard post
    rect(px, 4, 30, 8, 58, state["wood"])
    rect(px, 4, 52, 46, 74, state["sheet"])               # mattress
    rect(px, 4, 52, 46, 55, state["sheet_shade"])
    rect(px, 4, 58, 42, 74, state["blanket"])             # blanket
    rect(px, 4, 70, 42, 74, state["blanket_shade"])
    rect(px, 6, 74, 8, 86, state["wood_shade"])           # legs
    rect(px, 42, 74, 44, 86, state["wood_shade"])
    if trashed:                                           # blanket slumped off
        rect(px, 44, 74, 52, 84, state["blanket"])
        rect(px, 44, 80, 52, 84, state["blanket_shade"])

    # nightstand + lamp
    rect(px, 50, 56, 60, 74, state["wood"])
    rect(px, 50, 56, 60, 58, state["wood_shade"])
    rect(px, 54, 44, 56, 56, state["brass"])              # lamp stem
    if trashed:
        rect(px, 54, 44, 56, 56, state["wood_shade"])     # bare stem
        # shade fallen on the floor beside the nightstand
        rect(px, 42, 88, 50, 93, state["sheet"])
        rect(px, 42, 92, 50, 93, state["sheet_shade"])
    else:
        rect(px, 50, 38, 60, 44, state["sheet"])          # shade
        rect(px, 50, 43, 60, 44, state["sheet_shade"])

    # TV on stand (right)
    rect(px, 66, 56, 104, 58, state["wood_shade"])
    rect(px, 68, 58, 102, 74, state["wood"])
    rect(px, 70, 38, 98, 56, state["tv"])
    rect(px, 73, 41, 90, 53, state["tv_screen"] if not trashed else INK)
    if not trashed:
        rect(px, 73, 41, 76, 44, state["night"])
    rect(px, 72, 74, 74, 86, state["wood_shade"])         # stand legs
    rect(px, 96, 74, 98, 86, state["wood_shade"])

    if trashed:
        # debris: papers + dark clumps breaking the floor line (shared coords)
        for dx, dy in DEBRIS_PAPERS:
            rect(px, dx, dy, dx + 3, dy + 1, state["paper"])
            rect(px, dx + 1, dy - 1, dx + 2, dy - 1, state["paper"])
        for dx, dy in DEBRIS_CLUMPS:
            rect(px, dx, dy, dx + 1, dy + 1, state["clump"])
        # spill accent (green when fresh, dried brown when settled)
        sx, sy = SPILL_XY
        rect(px, sx, sy, sx + 6, sy + 1, state["spill"])
        rect(px, sx + 1, sy + 2, sx + 5, sy + 2, state["spill"])
        rect(px, sx + 4, sy - 2, sx + 6, sy - 1, state["spill"])
    else:
        # light pool: warm wash on the floor, soft dithered edge, no stripes
        for lx in range(48, 80):
            for ly in range(68, H):
                d = abs(lx - 63) / 16 + abs(ly - 81) / 14
                if d < 0.8:
                    px.putpixel((lx, ly), state["pool"])
                elif d < 1.1 and (lx + ly) % 2 == 0:
                    px.putpixel((lx, ly), state["pool"])
    return px


def main() -> None:
    out = Path("apps/client/public/art/rooms")
    out.mkdir(parents=True, exist_ok=True)
    rooms = {
        out / "room-prepped.png": draw_room(PREPPED, trashed=False),
        out / "room-trash-fresh.png": draw_room(FRESH, trashed=True),
        out / "room-trash-settled.png": draw_room(SETTLED, trashed=True),
    }
    for path, img in rooms.items():
        img.save(path)
        print(f"wrote {path} ({img.width}x{img.height})")

    # 3x working-scale contact sheet
    scale, pad = 3, 8
    sheet = Image.new("RGBA", (pad + (W * scale + pad) * 3, H * scale + pad * 2),
                      (90, 90, 90, 255))
    for i, img in enumerate(rooms.values()):
        sheet.alpha_composite(img.resize((W * scale, H * scale), Image.NEAREST),
                              (pad + i * (W * scale + pad), pad))
    sheet.save("/tmp/opencode/rooms-preview.png")

    # hallway read: three open doors, one per state (disposable mock)
    spec = importlib.util.spec_from_file_location(
        "gde", Path(__file__).parent / "generate-doors-elevator.py")
    gde = importlib.util.module_from_spec(spec)
    sys.modules["gde"] = gde
    spec.loader.exec_module(gde)

    mock = Image.new("RGBA", (832, 576), (15, 27, 33, 255))
    for y in range(48, 350):
        for x in range(832):
            mock.putpixel((x, y), PREPPED["wall"])
    band = Image.open("apps/client/public/art/rooms/corridor-band.png")
    for x0 in range(0, 832, band.width):
        mock.paste(band, (x0, 350))
    xs = (60, 340, 620)
    for x, img in zip(xs, rooms.values()):
        mock.alpha_composite(img, (x + 4, 329))   # bottom-left on the threshold
        mock.alpha_composite(gde.door_open(), (x, 329))
    mock.save("/tmp/opencode/rooms-hallway-mock.png")
    print("wrote /tmp/opencode/rooms-preview.png and /tmp/opencode/rooms-hallway-mock.png")


if __name__ == "__main__":
    main()
