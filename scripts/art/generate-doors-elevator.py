#!/usr/bin/env python3
"""Generate the Turnover door + elevator prop family (Deco Noir restyle, AD-029).

Authors 5 manifest assets with the adopted Deco Noir palette (sheet contracts
unchanged from AD-020):
  apps/client/public/art/doors/door-closed.png     (72x96, opaque slab)
  apps/client/public/art/doors/door-open.png       (72x96, opening transparent
                                                    so the room interior renders
                                                    behind it — FR-10)
  apps/client/public/art/doors/door-card.png       (24x16, hallway-readable, FR-11)
  apps/client/public/art/elevator/elevator-car.png (96x64 sheet, open|closed)
  apps/client/public/art/elevator/elevator-panel.png (32x32 sheet, idle|flash)

Deterministic: no randomness, no generation model. Run from repo root:
  python3 scripts/art/generate-doors-elevator.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

INK = (15, 27, 33, 255)
WALNUT = (58, 38, 32, 255)
WALNUT_SHADE = (43, 27, 23, 255)
WALNUT_DEEP = (32, 20, 17, 255)
JAMB = (74, 48, 38, 255)          # lighter walnut jamb block
CHARCOAL = (35, 35, 43, 255)      # elevator slab / panel face
CHARCOAL_SHADE = (24, 24, 30, 255)
BRASS = (201, 161, 59, 255)
BRASS_SHADE = (156, 120, 44, 255)
IVORY = (246, 241, 230, 255)
WALL = (51, 80, 90, 255)          # slate teal wall (mocks)
WAINSCOT = (36, 51, 59, 255)
CARPET = (92, 36, 48, 255)
BRASS_DIM = (179, 135, 58, 255)

TRANSPARENT = (0, 0, 0, 0)
OUT = Path("apps/client/public/art")


def new(w: int, h: int) -> Image.Image:
    return Image.new("RGBA", (w, h), TRANSPARENT)


def rect(px: Image.Image, x0: int, y0: int, x1: int, y1: int, color) -> None:
    for y in range(max(0, y0), min(px.height, y1 + 1)):
        for x in range(max(0, x0), min(px.width, x1 + 1)):
            px.putpixel((x, y), color)


def door_frame(px: Image.Image) -> None:
    """Shared 72x96 doorframe: walnut jamb + stepped brass lintel."""
    rect(px, 0, 0, 71, 95, JAMB)             # jamb block
    # stepped pediment carved from the jamb top
    rect(px, 8, 0, 63, 3, BRASS)             # brass cap band
    rect(px, 4, 3, 67, 5, JAMB)
    rect(px, 0, 0, 3, 5, WALL)               # steps recede into the wall
    rect(px, 68, 0, 71, 5, WALL)
    rect(px, 0, 5, 71, 6, BRASS_SHADE)       # lintel shadow line
    rect(px, 0, 0, 3, 95, BRASS_SHADE)       # jamb edge accents
    rect(px, 68, 0, 71, 95, BRASS_SHADE)


def door_closed() -> Image.Image:
    px = new(72, 96)
    door_frame(px)
    rect(px, 4, 6, 67, 95, WALNUT)           # slab
    rect(px, 4, 6, 67, 7, WALNUT_SHADE)
    rect(px, 4, 6, 5, 95, WALNUT_SHADE)      # hinge-side shade
    # two recessed panels
    for py0, py1 in ((14, 46), (54, 86)):
        rect(px, 12, py0, 59, py1, WALNUT_SHADE)
        rect(px, 14, py0 + 2, 57, py1 - 2, WALNUT)
        rect(px, 14, py1 - 2, 57, py1 - 2, WALNUT_SHADE)
    # brass kick plate + knob
    rect(px, 12, 88, 59, 93, BRASS_SHADE)
    rect(px, 12, 88, 59, 89, BRASS)
    rect(px, 59, 47, 62, 51, BRASS)
    rect(px, 59, 51, 62, 51, BRASS_SHADE)
    return px


def door_open() -> Image.Image:
    px = new(72, 96)
    door_frame(px)
    # opening: transparent interior (room interior renders behind, FR-10);
    # inner jamb shadows frame the hole
    rect(px, 4, 6, 67, 95, TRANSPARENT)
    rect(px, 4, 6, 7, 95, WALNUT_DEEP)       # inner shadow, hinge side
    rect(px, 64, 6, 67, 95, WALNUT_DEEP)     # inner shadow, latch side
    rect(px, 4, 6, 67, 9, WALNUT_DEEP)       # inner shadow, head
    # slab swung inward on the hinge side (foreshortened, covers right part)
    rect(px, 46, 6, 63, 95, WALNUT)
    rect(px, 46, 6, 48, 95, WALNUT_SHADE)
    for py0, py1 in ((14, 46), (54, 86)):    # foreshortened panel hints
        rect(px, 52, py0, 60, py1, WALNUT_SHADE)
        rect(px, 54, py0 + 2, 58, py1 - 2, WALNUT)
    rect(px, 52, 47, 55, 51, BRASS)          # knob near the opening edge
    # threshold
    rect(px, 4, 92, 45, 95, BRASS_SHADE)
    rect(px, 4, 92, 45, 92, BRASS)
    return px


def door_card() -> Image.Image:
    px = new(24, 16)
    rect(px, 11, 0, 12, 2, INK)              # hook nail
    rect(px, 2, 2, 21, 14, IVORY)            # ivory plaque
    rect(px, 2, 2, 21, 2, BRASS)             # gold border
    rect(px, 2, 14, 21, 14, BRASS)
    rect(px, 2, 2, 2, 14, BRASS)
    rect(px, 21, 2, 21, 14, BRASS)
    rect(px, 4, 4, 19, 5, WALNUT_SHADE)      # text bands (non-lexical)
    rect(px, 4, 8, 15, 9, WALNUT_SHADE)
    rect(px, 17, 8, 19, 11, BRASS)           # seal
    return px


def elevator_car(open_doors: bool) -> Image.Image:
    px = new(48, 64)
    rect(px, 0, 0, 47, 5, BRASS)             # top beam
    rect(px, 0, 5, 47, 5, BRASS_SHADE)
    rect(px, 20, 1, 27, 4, IVORY)            # ceiling light
    rect(px, 0, 0, 3, 63, BRASS)             # side posts
    rect(px, 44, 0, 47, 63, BRASS)
    rect(px, 0, 3, 3, 63, BRASS_SHADE)
    rect(px, 44, 3, 47, 63, BRASS_SHADE)
    if open_doors:
        # doors parked at the sides, opening transparent (shaft shows through)
        rect(px, 5, 6, 14, 57, CHARCOAL)
        rect(px, 5, 6, 6, 57, CHARCOAL_SHADE)
        rect(px, 33, 6, 42, 57, CHARCOAL)
        rect(px, 40, 6, 42, 57, CHARCOAL_SHADE)
        rect(px, 19, 6, 20, 57, BRASS_SHADE)  # cage bars across the opening
        rect(px, 27, 6, 28, 57, BRASS_SHADE)
    else:
        rect(px, 5, 6, 42, 57, CHARCOAL)      # closed slab
        rect(px, 23, 6, 24, 57, BRASS_SHADE)  # brass center seam
        rect(px, 5, 6, 6, 57, CHARCOAL_SHADE)
        rect(px, 41, 6, 42, 57, CHARCOAL_SHADE)
        rect(px, 7, 29, 40, 30, BRASS_SHADE)  # safety rail across the slab
    rect(px, 0, 58, 47, 63, BRASS_SHADE)      # floor
    rect(px, 0, 58, 47, 58, BRASS)
    rect(px, 8, 60, 39, 61, BRASS)            # tread accent
    return px


def elevator_panel(flash: bool) -> Image.Image:
    px = new(16, 32)
    rect(px, 0, 0, 15, 31, CHARCOAL)
    rect(px, 0, 0, 15, 1, BRASS)              # brass border
    rect(px, 0, 30, 15, 31, BRASS)
    rect(px, 0, 0, 0, 31, BRASS)
    rect(px, 15, 0, 15, 31, BRASS)
    off = CHARCOAL_SHADE
    lamp = BRASS if flash else off
    rect(px, 5, 6, 10, 11, off)               # car-1 lamp socket
    rect(px, 5, 18, 10, 23, off)              # car-2 lamp socket
    rect(px, 6, 7, 9, 10, lamp)               # lit lamp (frame 2 only)
    rect(px, 6, 19, 9, 22, lamp)
    return px


def main() -> None:
    (OUT / "doors").mkdir(parents=True, exist_ok=True)
    (OUT / "elevator").mkdir(parents=True, exist_ok=True)

    files = {
        OUT / "doors/door-closed.png": door_closed(),
        OUT / "doors/door-open.png": door_open(),
        OUT / "doors/door-card.png": door_card(),
        OUT / "elevator/elevator-car.png": _hstack(
            [elevator_car(True), elevator_car(False)]
        ),
        OUT / "elevator/elevator-panel.png": _hstack(
            [elevator_panel(False), elevator_panel(True)]
        ),
    }
    for path, img in files.items():
        img.save(path)
        print(f"wrote {path} ({img.width}x{img.height})")

    tmp = Path("/tmp/opencode")
    tmp.mkdir(parents=True, exist_ok=True)
    _preview(files, tmp / "props-preview.png")
    _mock(tmp / "props-corridor-mock.png")
    print(f"wrote {tmp / 'props-preview.png'} and {tmp / 'props-corridor-mock.png'}")


def _hstack(images: list[Image.Image]) -> Image.Image:
    sheet = Image.new(
        "RGBA", (sum(i.width for i in images), max(i.height for i in images)),
        TRANSPARENT,
    )
    x = 0
    for img in images:
        sheet.paste(img, (x, 0))
        x += img.width
    return sheet


def _preview(files: dict, out: Path) -> None:
    scale = 3
    pad = 8
    imgs = list(files.values())
    w = sum(i.width * scale + pad for i in imgs) + pad
    h = max(i.height for i in imgs) * scale + pad * 2
    sheet = Image.new("RGBA", (w, h), (90, 90, 90, 255))
    x = pad
    for img in imgs:
        big = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
        sheet.alpha_composite(big, (x, pad))
        x += img.width * scale + pad
    sheet.save(out)


def _mock(out: Path) -> None:
    W, H = 832, 576
    mock = Image.new("RGBA", (W, H), INK)
    for y in range(60, 430):
        for x in range(W):
            mock.putpixel((x, y), WALL)
    for y in range(330, 430):
        for x in range(W):
            mock.putpixel((x, y), WAINSCOT)
    for y in range(430, 496):
        for x in range(W):
            mock.putpixel((x, y), CARPET)
    for y in (430, 495):
        for x in range(W):
            mock.putpixel((x, y), BRASS_DIM)
    # room interior visible through the open door (disposable placeholder)
    interior = new(56, 86)
    rect(interior, 0, 0, 55, 85, (244, 217, 160, 255))
    rect(interior, 0, 60, 55, 85, (90, 81, 72, 255))    # settled clutter band
    mock.alpha_composite(interior, (565, 339))
    mock.alpha_composite(door_open(), (560, 329))
    mock.alpha_composite(door_closed(), (120, 329))
    mock.alpha_composite(door_card(), (204, 350))
    # elevator shaft: cable, car (open), wall panel (flash)
    for y in range(60, 496):
        mock.putpixel((790, y), WALNUT_DEEP)
    mock.alpha_composite(elevator_car(True), (700, 430 - 64))
    mock.alpha_composite(elevator_panel(True), (660, 340))
    import importlib.util
    import sys

    sys.path.insert(0, str(Path(__file__).parent))
    spec = importlib.util.spec_from_file_location(
        "generate_staff_walk", Path(__file__).parent / "generate-staff-walk.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    build_sheet = mod.build_sheet

    walker = build_sheet().crop((2 * 28, 0, 3 * 28, 60))
    mock.alpha_composite(walker, (380, 430 - 60))
    mock.save(out)


if __name__ == "__main__":
    main()
