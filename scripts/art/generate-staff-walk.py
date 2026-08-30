#!/usr/bin/env python3
"""Generate the Turnover staff walk cycle (hero sprite, AD-020).

Authors the 8-frame bellhop walk sheet at 28x60 px per frame, profile view,
facing right. Palette and locks come from docs/art/art-direction-brief.md:
identical uniform for every player (no saboteur tell), hard pixel clusters,
1px darker-self outline on the character only, no anti-aliasing.

Output:
  apps/client/public/art/chars/staff-walk-8f.png   (224x60 sheet)
  /tmp/opencode/staff-walk-preview.png             (6x contact sheet)
  /tmp/opencode/staff-walk-corridor-mock.png       (native-scale corridor read)

Deterministic: no randomness, no generation model. Run from repo root:
  python3 scripts/art/generate-staff-walk.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

FRAME_W, FRAME_H, FRAMES = 28, 60, 8
GROUND_ROW = 58  # feet bottom edge (row index, inclusive); baseline for anchor

# Palette (docs/art/art-direction-brief.md)
INK = (29, 26, 46, 255)          # shoes / darkest accents
NAVY = (47, 79, 111, 255)        # uniform jacket (current gray-box color kept)
NAVY_SHADE = (34, 57, 79, 255)   # darker-self: pants, far limbs, outline base
NAVY_DEEP = (26, 43, 60, 255)    # pants shade
BRASS = (217, 164, 65, 255)      # buttons, cap band, belt
BRASS_SHADE = (168, 122, 46, 255)
GLOVE = (242, 237, 226, 255)     # white gloves
SKIN = (232, 184, 138, 255)
SKIN_SHADE = (201, 141, 99, 255)
EYE = (29, 26, 46, 255)

TRANSPARENT = (0, 0, 0, 0)

# Near-leg swing offset per frame (px, + = forward/right). Far leg mirrors.
LEG_SWING = [0, 4, 6, 4, 0, -4, -6, -4]
# Body bob (px down) on leg-pass frames.
BOB = [0, 0, 1, 0, 0, 0, 1, 0]
# Foot lift (px) while a leg swings through the air.
FOOT_LIFT = {1: 3, 2: 2, 5: 3, 6: 2}


def rect(px: Image.Image, x0: int, y0: int, x1: int, y1: int, color) -> None:
    """Inclusive-coordinate filled rectangle, clipped to the frame."""
    for y in range(max(0, y0), min(FRAME_H, y1 + 1)):
        for x in range(max(0, x0), min(FRAME_W, x1 + 1)):
            px.putpixel((x, y), color)


def hline(px: Image.Image, x0: int, x1: int, y: int, color) -> None:
    rect(px, x0, y, x1, y, color)


def draw_leg(px: Image.Image, hip_x: int, swing: int, lift: int, far: bool) -> None:
    """Slanted leg column from hip (y=32) to ankle (y=52) + shoe."""
    pants = NAVY_DEEP if far else NAVY_SHADE
    top, bottom = 32, 52
    for y in range(top, bottom + 1):
        t = (y - top) / (bottom - top)
        x = hip_x + round(swing * t)
        rect(px, x, y, x + 3, y, pants)
    # shoe: extends forward, lifts while swinging through
    foot_y = bottom + 1 - lift
    shoe_x = hip_x + swing
    rect(px, shoe_x, foot_y, shoe_x + 5, GROUND_ROW, INK)
    if lift == 0:
        rect(px, shoe_x, foot_y, shoe_x + 5, foot_y, NAVY_DEEP)


def draw_arm(px: Image.Image, shoulder_x: int, swing: int, far: bool) -> None:
    """Arm column from shoulder (y=18) to cuff (y=30) with white glove."""
    sleeve = NAVY_SHADE if far else NAVY
    for y in range(18, 31):
        t = (y - 18) / 12
        x = shoulder_x + round(swing * t)
        rect(px, x, y, x + 2, y, sleeve)
    glove_x = shoulder_x + swing
    rect(px, glove_x, 30, glove_x + 2, 33, GLOVE)
    rect(px, glove_x, 30, glove_x + 2, 30, BRASS_SHADE)  # cuff


def draw_frame(frame: int) -> Image.Image:
    px = Image.new("RGBA", (FRAME_W, FRAME_H), TRANSPARENT)
    bob = BOB[frame]
    swing = LEG_SWING[frame]
    lift = FOOT_LIFT.get(frame, 0)
    back_lift = FOOT_LIFT.get((frame + 4) % 8, 0)

    # far arm (behind torso): swings WITH the near leg (counter to near arm)
    draw_arm(px, 8 + swing // 2, swing // 2, far=True)
    # far leg
    draw_leg(px, 14, -swing, back_lift, far=True)

    # torso: navy jacket, hem at hip (y30)
    rect(px, 7, 15 + bob, 20, 30 + bob, NAVY)
    rect(px, 7, 15 + bob, 8, 30 + bob, NAVY_SHADE)      # back edge shade
    # brass buttons down the front
    for by in (18, 22, 26):
        rect(px, 18, by + bob, 18, by + bob, BRASS)
    # belt
    hline(px, 7, 20, 29 + bob, BRASS_SHADE)

    # head + cap
    rect(px, 9, 6 + bob, 19, 15 + bob, SKIN)            # head
    hline(px, 9, 19, 15 + bob, SKIN_SHADE)              # jaw shade
    rect(px, 16, 10 + bob, 16, 10 + bob, EYE)           # eye
    rect(px, 9, 1 + bob, 18, 5 + bob, NAVY)             # cap crown
    hline(px, 9, 18, 5 + bob, BRASS)                    # cap band
    rect(px, 15, 5 + bob, 21, 5 + bob, NAVY_SHADE)      # brim (forward)
    rect(px, 9, 1 + bob, 10, 5 + bob, NAVY_SHADE)       # cap back shade

    # near leg (over jacket hem)
    draw_leg(px, 11, swing, lift, far=False)

    # near arm (over torso): swings opposite the near leg
    draw_arm(px, 15 - swing // 2, -swing // 2, far=False)
    # collar
    hline(px, 12, 17, 15 + bob, NAVY_SHADE)
    return px


def outline(px: Image.Image) -> None:
    """1px darker-self outline around non-transparent pixels."""
    src = px.copy()
    w, h = px.size
    for y in range(h):
        for x in range(w):
            if src.getpixel((x, y))[3] != 0:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h:
                    n = src.getpixel((nx, ny))
                    if n[3] != 0:
                        px.putpixel((x, y), NAVY_DEEP)
                        break


def build_sheet() -> Image.Image:
    frames = []
    for f in range(FRAMES):
        fr = draw_frame(f)
        outline(fr)
        frames.append(fr)
    sheet = Image.new("RGBA", (FRAME_W * FRAMES, FRAME_H), TRANSPARENT)
    for i, fr in enumerate(frames):
        sheet.paste(fr, (i * FRAME_W, 0))
    return sheet


def corridor_mock(frame_img: Image.Image) -> Image.Image:
    """Disposable 832x576 corridor read: character at native scale mid-hall."""
    W, H = 832, 576
    mock = Image.new("RGBA", (W, H), (43, 36, 64, 255))  # night shadow
    cream = (232, 220, 192, 255)
    tan = (201, 178, 138, 255)
    carpet = (140, 59, 59, 255)
    gold = (217, 164, 65, 255)
    navy = (47, 79, 111, 255)
    for y in range(60, 430):        # wall
        for x in range(W):
            mock.putpixel((x, y), cream)
    for y in range(330, 430):       # wainscot
        for x in range(W):
            mock.putpixel((x, y), tan)
    for y in range(430, 496):       # carpet strip
        for x in range(W):
            mock.putpixel((x, y), carpet)
    for y in (430, 495):
        hline_mock(mock, 0, W - 1, y, gold)
    # two doors + card
    for dx in (120, 560):
        for y in range(240, 430):
            for x in range(dx, dx + 72):
                mock.putpixel((x, y), navy)
        for y in range(236, 240):
            hline_mock(mock, dx, dx + 71, y, gold)
        for y in range(250, 266):
            for x in range(dx + 60, dx + 72):
                mock.putpixel((x, y), (242, 237, 226, 255))
    mock.alpha_composite(frame_img, (400, 430 - FRAME_H))
    return mock


def hline_mock(img: Image.Image, x0: int, x1: int, y: int, color) -> None:
    for x in range(x0, x1 + 1):
        img.putpixel((x, y), color)


def main() -> None:
    out_dir = Path("apps/client/public/art/chars")
    out_dir.mkdir(parents=True, exist_ok=True)
    sheet = build_sheet()
    sheet.save(out_dir / "staff-walk-8f.png")
    print(f"wrote {out_dir / 'staff-walk-8f.png'} ({sheet.width}x{sheet.height})")

    tmp = Path("/tmp/opencode")
    tmp.mkdir(parents=True, exist_ok=True)
    # 6x nearest contact sheet on checkerboard
    cell, scale = FRAME_H + 8, 6
    preview = Image.new("RGBA", (cell * FRAMES * scale, cell * scale), (90, 90, 90, 255))
    for i in range(FRAMES):
        fr = sheet.crop((i * FRAME_W, 0, (i + 1) * FRAME_W, FRAME_H))
        big = fr.resize((FRAME_W * scale, FRAME_H * scale), Image.NEAREST)
        preview.alpha_composite(big, (i * cell * scale + 8, 8))
    preview.save(tmp / "staff-walk-preview.png")

    mock = corridor_mock(build_sheet().crop((2 * FRAME_W, 0, 3 * FRAME_W, FRAME_H)))
    mock.save(tmp / "staff-walk-corridor-mock.png")
    print(f"wrote {tmp / 'staff-walk-preview.png'} and {tmp / 'staff-walk-corridor-mock.png'}")


if __name__ == "__main__":
    main()
