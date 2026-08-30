#!/usr/bin/env python3
"""Generate the Turnover door + elevator prop family (AD-020).

Authors 5 manifest assets with the brief's locked palette:
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

INK = (29, 26, 46, 255)
NAVY = (47, 79, 111, 255)
NAVY_SHADE = (34, 57, 79, 255)
NAVY_DEEP = (26, 43, 60, 255)
BRASS = (217, 164, 65, 255)
BRASS_SHADE = (168, 122, 46, 255)
GLOVE = (242, 237, 226, 255)
CREAM = (232, 220, 192, 255)
TAN = (201, 178, 138, 255)

TRANSPARENT = (0, 0, 0, 0)
OUT = Path("apps/client/public/art")


def new(w: int, h: int) -> Image.Image:
    return Image.new("RGBA", (w, h), TRANSPARENT)


def rect(px: Image.Image, x0: int, y0: int, x1: int, y1: int, color) -> None:
    for y in range(max(0, y0), min(px.height, y1 + 1)):
        for x in range(max(0, x0), min(px.width, x1 + 1)):
            px.putpixel((x, y), color)


def outline(px: Image.Image, color=INK) -> None:
    """1px dark outline around non-transparent pixels (architecture rule:
    outlines are for characters only — but door/car slabs use darker-self
    edges inline, so this helper is used only where the brief allows it)."""
    src = px.copy()
    for y in range(px.height):
        for x in range(px.width):
            if src.getpixel((x, y))[3] != 0:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < px.width and 0 <= ny < px.height:
                    if src.getpixel((nx, ny))[3] != 0:
                        px.putpixel((x, y), color)
                        break


def door_frame(px: Image.Image) -> None:
    """Shared 72x96 doorframe: tan wood jamb + brass lintel."""
    rect(px, 0, 0, 71, 95, TAN)              # jamb block
    rect(px, 0, 0, 71, 5, BRASS)             # lintel
    rect(px, 0, 5, 71, 5, BRASS_SHADE)
    rect(px, 0, 0, 3, 95, BRASS_SHADE)       # jamb edge accents
    rect(px, 68, 0, 71, 95, BRASS_SHADE)


def door_closed() -> Image.Image:
    px = new(72, 96)
    door_frame(px)
    rect(px, 4, 6, 67, 95, NAVY)             # slab
    rect(px, 4, 6, 67, 7, NAVY_SHADE)
    rect(px, 4, 6, 5, 95, NAVY_SHADE)        # hinge-side shade
    # two recessed panels
    for py0, py1 in ((14, 46), (54, 86)):
        rect(px, 12, py0, 59, py1, NAVY_SHADE)
        rect(px, 14, py0 + 2, 57, py1 - 2, NAVY)
        rect(px, 14, py1 - 2, 57, py1 - 2, NAVY_SHADE)
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
    rect(px, 4, 6, 7, 95, NAVY_DEEP)         # inner shadow, hinge side
    rect(px, 64, 6, 67, 95, NAVY_DEEP)       # inner shadow, latch side
    rect(px, 4, 6, 67, 9, NAVY_DEEP)         # inner shadow, head
    # slab swung inward on the hinge side (foreshortened, covers right part)
    rect(px, 46, 6, 63, 95, NAVY)
    rect(px, 46, 6, 48, 95, NAVY_SHADE)
    for py0, py1 in ((14, 46), (54, 86)):    # foreshortened panel hints
        rect(px, 52, py0, 60, py1, NAVY_SHADE)
        rect(px, 54, py0 + 2, 58, py1 - 2, NAVY)
    rect(px, 52, 47, 55, 51, BRASS)          # knob near the opening edge
    # threshold
    rect(px, 4, 92, 45, 95, BRASS_SHADE)
    rect(px, 4, 92, 45, 92, BRASS)
    return px


def door_card() -> Image.Image:
    px = new(24, 16)
    rect(px, 11, 0, 12, 2, INK)              # hook nail
    rect(px, 2, 2, 21, 14, GLOVE)            # ivory plaque
    rect(px, 2, 2, 21, 2, BRASS)             # gold border
    rect(px, 2, 14, 21, 14, BRASS)
    rect(px, 2, 2, 2, 14, BRASS)
    rect(px, 21, 2, 21, 14, BRASS)
    rect(px, 4, 4, 19, 5, NAVY_SHADE)        # text bands (non-lexical)
    rect(px, 4, 8, 15, 9, NAVY_SHADE)
    rect(px, 17, 8, 19, 11, BRASS)           # seal
    return px


def elevator_car(open_doors: bool) -> Image.Image:
    px = new(48, 64)
    rect(px, 0, 0, 47, 5, BRASS)             # top beam
    rect(px, 0, 5, 47, 5, BRASS_SHADE)
    rect(px, 20, 1, 27, 4, GLOVE)            # ceiling light
    rect(px, 0, 0, 3, 63, BRASS)             # side posts
    rect(px, 44, 0, 47, 63, BRASS)
    rect(px, 0, 3, 3, 63, BRASS_SHADE)
    rect(px, 44, 3, 47, 63, BRASS_SHADE)
    if open_doors:
        # doors parked at the sides, opening transparent (shaft shows through)
        rect(px, 5, 6, 14, 57, NAVY)
        rect(px, 5, 6, 6, 57, NAVY_SHADE)
        rect(px, 33, 6, 42, 57, NAVY)
        rect(px, 40, 6, 42, 57, NAVY_SHADE)
        rect(px, 19, 6, 20, 57, BRASS_SHADE)  # cage bars across the opening
        rect(px, 27, 6, 28, 57, BRASS_SHADE)
    else:
        rect(px, 5, 6, 42, 57, NAVY)         # closed slab
        rect(px, 23, 6, 24, 57, NAVY_SHADE)  # center seam
        rect(px, 5, 6, 6, 57, NAVY_SHADE)
        rect(px, 41, 6, 42, 57, NAVY_SHADE)
        rect(px, 7, 29, 40, 30, BRASS_SHADE)  # safety rail across the slab
    rect(px, 0, 58, 47, 63, BRASS_SHADE)     # floor
    rect(px, 0, 58, 47, 58, BRASS)
    rect(px, 8, 60, 39, 61, BRASS)           # tread accent
    return px


def elevator_panel(flash: bool) -> Image.Image:
    px = new(16, 32)
    rect(px, 0, 0, 15, 31, NAVY_SHADE)
    rect(px, 0, 0, 15, 1, BRASS)             # brass border
    rect(px, 0, 30, 15, 31, BRASS)
    rect(px, 0, 0, 0, 31, BRASS)
    rect(px, 15, 0, 15, 31, BRASS)
    off = (26, 43, 60, 255)
    lamp = BRASS if flash else off
    rect(px, 5, 6, 10, 11, off)              # car-1 lamp socket
    rect(px, 5, 18, 10, 23, off)             # car-2 lamp socket
    rect(px, 6, 7, 9, 10, lamp)              # lit lamp (frame 2 only)
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
    mock = Image.new("RGBA", (W, H), (43, 36, 64, 255))
    for y in range(60, 430):
        for x in range(W):
            mock.putpixel((x, y), CREAM)
    for y in range(330, 430):
        for x in range(W):
            mock.putpixel((x, y), TAN)
    for y in range(430, 496):
        for x in range(W):
            mock.putpixel((x, y), (140, 59, 59, 255))
    for y in (430, 495):
        for x in range(W):
            mock.putpixel((x, y), BRASS)
    # room interior visible through the open door (disposable placeholder)
    interior = new(56, 86)
    rect(interior, 0, 0, 55, 85, (240, 217, 168, 255))
    rect(interior, 0, 60, 55, 85, (110, 97, 84, 255))   # settled clutter band
    mock.alpha_composite(interior, (565, 339))
    mock.alpha_composite(door_open(), (560, 329))
    mock.alpha_composite(door_closed(), (120, 329))
    mock.alpha_composite(door_card(), (204, 350))
    # elevator shaft: cable, car (open), wall panel (flash)
    for y in range(60, 496):
        mock.putpixel((790, y), (26, 43, 60, 255))
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
