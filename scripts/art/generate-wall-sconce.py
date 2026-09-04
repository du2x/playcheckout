#!/usr/bin/env python3
"""Generate the Turnover 4.2 corridor wall + sconce sheets (Deco Noir, AD-029).

Phase 4.2 authors the corridor wall for real (design
`.specs/features/environment-4-2/design.md`, decisions D-1/D-2):
  apps/client/public/art/rooms/wall-field.png  (32x302 opaque tile: frieze
      band with 16px-pitch dim-brass chevron over slate-teal field; tiles
      horizontally with period 32)
  apps/client/public/art/props/sconce.png      (48x52: 24x40 brass sconce
      prop centered over a baked 48x16 pool ellipse; origin bottom-center
      at the lintel top; flat pixels only, no blend modes — glow is 4.3)

Palette is brief section 80 swatches only (no new colors). Deterministic:
no randomness, no generation model. Run from repo root:
  python3 scripts/art/generate-wall-sconce.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

# Brief swatches (docs/art/alternative/art-direction-brief.md:80)
FRIEZE = (66, 99, 110, 255)        # #42636e frieze band
BRASS_DIM = (138, 106, 47, 255)    # #8a6a2f dim brass chevron
FIELD = (51, 80, 90, 255)          # #33505a slate-teal wall field
BRASS = (201, 161, 59, 255)
BRASS_SHADE = (156, 120, 44, 255)
CANDLE = (244, 217, 160, 255)      # #f4d9a0 core
HALO = (232, 180, 100, 255)        # #e8b464 halo
IVORY = (246, 241, 230, 255)
NIGHT = (15, 27, 33, 255)

TRANSPARENT = (0, 0, 0, 0)
OUT_ROOMS = Path("apps/client/public/art/rooms")
OUT_PROPS = Path("apps/client/public/art/props")

WALL_W, WALL_H = 32, 302
FRIEZE_H = 45  # upper ~15% of the 302px wall strip
SCONCE_W, SCONCE_H = 48, 52


def rect(px: Image.Image, x0: int, y0: int, x1: int, y1: int, color) -> None:
    for y in range(max(0, y0), min(px.height, y1 + 1)):
        for x in range(max(0, x0), min(px.width, x1 + 1)):
            px.putpixel((x, y), color)


def build_wall() -> Image.Image:
    """32x302 tile: frieze band (chevron pitch 16, seamless at period 32)
    over a quiet flat field."""
    px = Image.new("RGBA", (WALL_W, WALL_H), FIELD)
    rect(px, 0, 0, WALL_W - 1, FRIEZE_H - 1, FRIEZE)
    # chevron teeth: apex at y2, feet at y14, two teeth per tile (pitch 16);
    # x wraps so the t=16 tooth flows into the next tile (period 32)
    for t in (0, 16):
        for i in range(9):
            y = 14 - round(i * 1.5)
            px.putpixel(((t + i) % WALL_W, y), BRASS_DIM)
            px.putpixel(((t + 16 - i) % WALL_W, y), BRASS_DIM)
    rect(px, 0, FRIEZE_H - 1, WALL_W - 1, FRIEZE_H - 1, BRASS_DIM)
    return px


def build_sconce() -> Image.Image:
    """48x52: baked pool ellipse first, 24x40 prop centered over it."""
    px = Image.new("RGBA", (SCONCE_W, SCONCE_H), TRANSPARENT)
    # pool: halo ellipse center (24,44) rx23 ry7, core rx14 ry4
    for y in range(SCONCE_H):
        for x in range(SCONCE_W):
            hx, hy = (x - 24) / 23, (y - 44) / 7
            cx, cy = (x - 24) / 14, (y - 44) / 4
            if cx * cx + cy * cy <= 1:
                px.putpixel((x, y), CANDLE)
            elif hx * hx + hy * hy <= 1:
                px.putpixel((x, y), HALO)
    # prop: wall plate, arm, cup, candle, flame (24 wide: x12..35, y0..39)
    rect(px, 21, 4, 26, 38, BRASS_SHADE)   # wall plate
    rect(px, 22, 4, 25, 38, BRASS)         # plate face
    rect(px, 22, 24, 30, 27, BRASS_SHADE)  # arm
    rect(px, 19, 20, 28, 24, BRASS)        # cup
    rect(px, 19, 20, 28, 21, BRASS_SHADE)  # cup lip shade
    rect(px, 21, 10, 26, 20, IVORY)        # candle
    rect(px, 25, 10, 26, 20, CANDLE)       # candle warm side
    rect(px, 22, 5, 25, 9, CANDLE)         # flame
    return px


def main() -> None:
    OUT_ROOMS.mkdir(parents=True, exist_ok=True)
    OUT_PROPS.mkdir(parents=True, exist_ok=True)
    wall = build_wall()
    sconce = build_sconce()
    wall.save(OUT_ROOMS / "wall-field.png")
    sconce.save(OUT_PROPS / "sconce.png")
    print(f"wrote {OUT_ROOMS / 'wall-field.png'} ({wall.width}x{wall.height})")
    print(f"wrote {OUT_PROPS / 'sconce.png'} ({sconce.width}x{sconce.height})")
    _mock(Path("/tmp/opencode/wall-sconce-corridor-mock.png"))


def _mock(out: Path) -> None:
    """Native-scale corridor read from the shipped bytes on disk."""
    art = Path("apps/client/public/art")
    W, H = 960, 576
    mock = Image.new("RGBA", (W, H), NIGHT)
    wall = Image.open(art / "rooms/wall-field.png")
    for x0 in range(0, W, wall.width):
        mock.paste(wall, (x0, 48))
    band = Image.open(art / "rooms/corridor-band.png")
    for x0 in range(0, W, band.width):
        mock.alpha_composite(band, (x0, 350))
    # guest-floor door rhythm: 7 rooms (AD-046 centers) + sconce beats
    centers = [116, 220, 324, 428, 532, 636, 740]
    door = Image.open(art / "doors/door-closed.png")
    for cx in centers:
        mock.alpha_composite(door, (cx - 36, 334))
    eldoor = Image.open(art / "elevator/elevator-door.png").crop((0, 0, 80, 96))
    mock.alpha_composite(eldoor, (880, 334))
    sconce = Image.open(art / "props/sconce.png")
    # west mouth at x=24: inside the 1-tile mouth zone [0, 32] with the
    # 48px pool fully on-canvas (x=16 would clip the pool at the edge)
    for cx in [*centers, 920, 24]:
        mock.alpha_composite(sconce, (cx - 24, 336 - 52))
    # ivory character sample for the grayscale read
    body = Image.open(art / "chars/staff-body-34x64-7f.png").crop((0, 0, 34, 64))
    mock.alpha_composite(body, (380, 430 - 64))
    out.parent.mkdir(parents=True, exist_ok=True)
    mock.save(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
