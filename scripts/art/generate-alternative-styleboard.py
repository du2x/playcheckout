#!/usr/bin/env python3
"""Generate the Deco Noir alternative style board (docs/art/alternative/).

Authors the proposal-phase seed assets for the ALTERNATIVE art direction
brief (docs/art/alternative/art-direction-brief.md): a native-scale corridor
mock (832x576) + one staff hero frame (34x64, profile) + one idle pose.
Deterministic: no randomness, no generation model. Flat 2-tone fills, hard
edges, no anti-aliasing, palette locked to the brief's 20 swatches.

Output:
  docs/art/alternative/seeds/styleboard-corridor-832x576.png
  docs/art/alternative/seeds/staff-idle-34x64.png
  /tmp/opencode/deco-noir-board-preview.png   (2x nearest, viewing copy)

Run from repo root:
  python3 scripts/art/generate-alternative-styleboard.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

# Palette (docs/art/alternative/art-direction-brief.md)
NIGHT = (15, 27, 33, 255)          # ink teal backdrop
WALL = (51, 80, 90, 255)           # slate teal wall field
FRIEZE = (66, 99, 110, 255)        # upper deco frieze band
CHEVRON = (138, 106, 47, 255)      # dim brass ornament
WAINSCOT = (36, 51, 59, 255)       # dark wainscot
CARPET = (92, 36, 48, 255)         # deep burgundy
BRASS_DIM = (179, 135, 58, 255)    # carpet diamond chain
BRASS = (201, 161, 59, 255)        # trim, cap band, buttons, seals
IVORY = (242, 234, 216, 255)       # mess jacket
IVORY_SHADE = (207, 195, 168, 255)
GLOVE = (246, 241, 230, 255)
CHARCOAL = (35, 35, 43, 255)       # trousers + cap
SKIN = (217, 168, 120, 255)
SKIN_SHADE = (179, 131, 92, 255)
WALNUT = (58, 38, 32, 255)         # doors
WALNUT_SEAM = (43, 27, 23, 255)
CANDLE = (244, 217, 160, 255)      # light core
HALO = (232, 180, 100, 255)        # light halo
CHARTREUSE = (164, 176, 106, 255)  # fresh-trash accent
DUST = (90, 81, 72, 255)           # settled trash
INK = (15, 27, 33, 255)            # shoes (reuses night ink)

TRANSPARENT = (0, 0, 0, 0)

GROUND_Y = 430            # game ground line
W, H = 832, 576


def rect(img: Image.Image, x0: int, y0: int, x1: int, y1: int, color) -> None:
    """Inclusive-coordinate filled rectangle, clipped to the image."""
    w, h = img.size
    for y in range(max(0, y0), min(h, y1 + 1)):
        for x in range(max(0, x0), min(w, x1 + 1)):
            img.putpixel((x, y), color)


def blend_rect(img: Image.Image, x0: int, y0: int, x1: int, y1: int,
               color, alpha: int) -> None:
    """Alpha-blend a flat color over an existing opaque region."""
    w, h = img.size
    r, g, b, _ = color
    for y in range(max(0, y0), min(h, y1 + 1)):
        for x in range(max(0, x0), min(w, x1 + 1)):
            pr, pg, pb, pa = img.getpixel((x, y))
            if pa == 0:
                continue
            f = alpha / 255
            img.putpixel((x, y), (round(pr * (1 - f) + r * f),
                                  round(pg * (1 - f) + g * f),
                                  round(pb * (1 - f) + b * f), 255))


def blend_ellipse(img: Image.Image, cx: int, cy: int, rx: int, ry: int,
                  color, alpha: int) -> None:
    """Alpha-blend a filled ellipse (flat, hard-edged) over opaque pixels."""
    w, h = img.size
    r, g, b, _ = color
    for y in range(max(0, cy - ry), min(h, cy + ry + 1)):
        dy = (y - cy) / ry
        for x in range(max(0, cx - rx), min(w, cx + rx + 1)):
            dx = (x - cx) / rx
            if dx * dx + dy * dy > 1:
                continue
            pr, pg, pb, pa = img.getpixel((x, y))
            if pa == 0:
                continue
            f = alpha / 255
            img.putpixel((x, y), (round(pr * (1 - f) + r * f),
                                  round(pg * (1 - f) + g * f),
                                  round(pb * (1 - f) + b * f), 255))


# ---------------------------------------------------------------- character

FRAME_W, FRAME_H = 34, 64


def draw_staff() -> Image.Image:
    """One idle staff frame, strict profile facing right, feet at row 63."""
    px = Image.new("RGBA", (FRAME_W, FRAME_H), TRANSPARENT)

    # cap: charcoal crown, brass band, short forward brim
    rect(px, 10, 4, 23, 9, CHARCOAL)
    rect(px, 10, 8, 23, 8, BRASS)
    rect(px, 20, 9, 26, 10, CHARCOAL)

    # head + eye + jaw shade
    rect(px, 12, 10, 22, 18, SKIN)
    rect(px, 12, 17, 22, 18, SKIN_SHADE)
    rect(px, 20, 13, 20, 14, INK)

    # torso: long ivory mess jacket, back-edge shade, brass front buttons
    rect(px, 8, 19, 26, 40, IVORY)
    rect(px, 8, 19, 9, 40, IVORY_SHADE)
    for by in (22, 27, 32):
        rect(px, 25, by, 25, by, BRASS)
    rect(px, 8, 40, 12, 44, IVORY)          # coat tail (behind legs)

    # arms at sides: near sleeve + cuff + white glove
    rect(px, 23, 22, 26, 35, IVORY)
    rect(px, 23, 35, 26, 35, BRASS)
    rect(px, 23, 36, 26, 40, GLOVE)

    # legs: charcoal trousers, 1px ink seam between
    rect(px, 10, 41, 15, 58, CHARCOAL)
    rect(px, 17, 41, 22, 58, CHARCOAL)
    rect(px, 16, 41, 16, 58, INK)

    # shoes: ink, forward-extended
    rect(px, 9, 58, 15, 62, INK)
    rect(px, 16, 58, 24, 62, INK)
    return px


# ------------------------------------------------------------- architecture

def chevron_band(img: Image.Image, y0: int, y1: int) -> None:
    """Repeating stepped ziggurat ornament on the frieze, 16 px pitch."""
    for pitch_x in range(0, W, 16):
        cx = pitch_x + 8
        rows = ((12, 2), (8, 2), (4, 2))
        y = y0
        for width, height in rows:
            rect(img, cx - width // 2, y, cx + width // 2, y + height - 1,
                 CHEVRON)
            y += height


def diamond_chain(img: Image.Image, y: int, color) -> None:
    """Diamond chain along the carpet center line, 32 px pitch."""
    half_rows = ((2, 0), (4, 1), (6, 2), (8, 3), (6, 4), (4, 5), (2, 6))
    for pitch_x in range(0, W, 32):
        cx = pitch_x + 16
        for width, dy in half_rows:
            rect(img, cx - width // 2, y - 3 + dy, cx + width // 2,
                 y - 3 + dy, color)


def sconce(img: Image.Image, cx: int) -> None:
    """Stepped brass bracket + sunburst rays; glow is drawn separately."""
    rect(img, cx - 3, 300, cx + 3, 312, BRASS)
    rect(img, cx - 6, 312, cx + 6, 314, BRASS)
    rect(img, cx - 2, 296, cx + 2, 300, CANDLE)
    for dx, dy in ((-10, -12), (-7, -16), (0, -18), (7, -16), (10, -12)):
        for step in range(6):
            rect(img, cx + dx * step // 6, 296 + dy * step // 6,
                 cx + dx * step // 6 + 1, 296 + dy * step // 6 + 1, BRASS)


def light_glow(img: Image.Image, cx: int) -> None:
    """Stepped concentric halo behind the sconce + candle pool on carpet."""
    blend_ellipse(img, cx, 295, 34, 26, HALO, 60)
    blend_ellipse(img, cx, 295, 16, 13, CANDLE, 90)
    blend_ellipse(img, cx, GROUND_Y + 13, 40, 13, HALO, 60)
    blend_ellipse(img, cx, GROUND_Y + 8, 22, 8, CANDLE, 60)


def closed_door(img: Image.Image, x: int, card: bool) -> None:
    """72x96 walnut door with stepped pediment + brass trim, y 334..430."""
    # leaf
    rect(img, x, 350, x + 71, GROUND_Y - 1, WALNUT)
    rect(img, x + 6, 358, x + 32, GROUND_Y - 8, WALNUT_SEAM)
    rect(img, x + 39, 358, x + 65, GROUND_Y - 8, WALNUT_SEAM)
    rect(img, x + 60, 388, x + 63, 391, BRASS)          # knob
    # stepped pediment + trim
    rect(img, x + 6, 342, x + 65, 349, WALNUT)
    rect(img, x + 16, 336, x + 55, 341, WALNUT)
    rect(img, x + 6, 341, x + 65, 341, BRASS)
    rect(img, x + 16, 335, x + 55, 335, BRASS)
    if card:
        rect(img, x + 76, 356, x + 87, 374, GLOVE)      # ivory card plaque
        rect(img, x + 79, 360, x + 84, 365, BRASS)      # brass seal


def open_doorway(img: Image.Image, x: int, prepped: bool) -> None:
    """Open doorway 72 wide (x..x+71), y 320..430, showing room state."""
    # stepped lintel above the opening
    rect(img, x - 2, 314, x + 73, 319, WALNUT)
    rect(img, x - 2, 313, x + 73, 313, BRASS)
    # opening: shaded interior back wall + burgundy floor plane
    rect(img, x, 320, x + 71, 399, WAINSCOT)
    blend_rect(img, x, 320, x + 71, 399, NIGHT, 90)
    rect(img, x, 400, x + 71, GROUND_Y - 1, CARPET)
    blend_rect(img, x, 400, x + 71, GROUND_Y - 1, NIGHT, 70)
    # swung-open leaf as a walnut sliver on the hinge side
    rect(img, x - 6, 324, x - 1, GROUND_Y - 1, WALNUT)
    if prepped:
        # aligned furniture silhouette + warm pool on the floor plane
        rect(img, x + 34, 380, x + 66, 400, WALNUT_SEAM)     # bed block
        rect(img, x + 34, 380, x + 66, 383, WALNUT)          # pillow band
        blend_rect(img, x, 396, x + 71, GROUND_Y - 1, CANDLE, 110)
        blend_ellipse(img, x + 30, GROUND_Y + 8, 44, 9, CANDLE, 70)
    else:
        # jagged trash silhouettes breaking the floor line + fresh accents
        rect(img, x + 8, 404, x + 20, 412, DUST)
        rect(img, x + 14, 398, x + 24, 404, DUST)
        rect(img, x + 34, 402, x + 44, 414, DUST)
        rect(img, x + 48, 406, x + 62, 413, DUST)
        rect(img, x + 26, 414, x + 30, 422, CHARTREUSE)
        rect(img, x + 52, 415, x + 55, 420, CHARTREUSE)


def corridor_board() -> Image.Image:
    img = Image.new("RGBA", (W, H), NIGHT)
    # wall field + frieze + wainscot
    rect(img, 0, 60, W - 1, GROUND_Y - 1, WALL)
    rect(img, 0, 60, W - 1, 122, FRIEZE)
    chevron_band(img, 68, 114)
    rect(img, 0, 122, W - 1, 123, BRASS_DIM)
    rect(img, 0, 330, W - 1, GROUND_Y - 1, WAINSCOT)
    # carpet + brass borders + diamond chain
    rect(img, 0, GROUND_Y, W - 1, 496, CARPET)
    rect(img, 0, GROUND_Y, W - 1, GROUND_Y + 1, BRASS_DIM)
    rect(img, 0, 494, W - 1, 496, BRASS_DIM)
    diamond_chain(img, 462, BRASS_DIM)

    # door rhythm: closed+card, open prepped, open trashed
    closed_door(img, 90, card=True)
    open_doorway(img, 300, prepped=True)
    open_doorway(img, 560, prepped=False)

    # sconces between doors, glows before characters
    for cx in (230, 470, 690):
        light_glow(img, cx)
    for cx in (230, 470, 690):
        sconce(img, cx)

    # staff hero, facing left toward the doors
    staff = draw_staff().transpose(Image.FLIP_LEFT_RIGHT)
    img.alpha_composite(staff, (700, GROUND_Y - FRAME_H))
    return img


def main() -> None:
    seeds = Path("docs/art/alternative/seeds")
    seeds.mkdir(parents=True, exist_ok=True)

    staff = draw_staff()
    staff.save(seeds / "staff-idle-34x64.png")
    print(f"wrote {seeds / 'staff-idle-34x64.png'} ({FRAME_W}x{FRAME_H})")

    board = corridor_board()
    board.save(seeds / "styleboard-corridor-832x576.png")
    print(f"wrote {seeds / 'styleboard-corridor-832x576.png'} ({W}x{H})")

    tmp = Path("/tmp/opencode")
    tmp.mkdir(parents=True, exist_ok=True)
    board.resize((W * 2, H * 2), Image.NEAREST).save(
        tmp / "deco-noir-board-preview.png")
    print(f"wrote {tmp / 'deco-noir-board-preview.png'} (viewing copy, 2x)")


if __name__ == "__main__":
    main()
