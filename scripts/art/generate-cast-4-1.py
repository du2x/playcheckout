#!/usr/bin/env python3
"""Generate the Phase 4.1 cast sheets (Deco Noir, 34x64 @ 32px/tile).

Three families, all deterministic Pillow authoring (no generation model):

  staff-body   34x64 x 7 frames (frame 0 idle, 1..6 walk) — headless body:
               the head zone (rows 0..17) stays transparent because the
               variant overlay supplies head + cap + hair + accessory.
               Identical for every player (FR-9).
  staff-variant 34x64 x 8 variants — head + cap + hair + accessory only.
               Variant = skin(2) x hair(2) x accessory(2); the cap stays
               charcoal + brass band for all (uniform identity, not role).
  guest-*      34x64 x 10 silhouettes (suite / tourist / clerk / elder /
                dandy / diva / flapper / merchant / professor / child) in a
                neutral grayscale base — the client setTint()s the palette
                rotation (teal/burgundy/moss/plum), so no guest ever carries
                staff ivory or brass as authored color (VPOL-07 denylist).

Guests face right like staff; the client flips for left.

Output:
  apps/client/public/art/chars/staff-body-34x64-7f.png    (238x64)
  apps/client/public/art/chars/staff-variant-8f.png       (272x64)
  apps/client/public/art/chars/guest-suite.png  guest-tourist.png
  apps/client/public/art/chars/guest-clerk.png  guest-elder.png
  apps/client/public/art/chars/guest-dandy.png  guest-diva.png
  apps/client/public/art/chars/guest-flapper.png  guest-merchant.png
  apps/client/public/art/chars/guest-professor.png  guest-child.png
  /tmp/opencode/cast-4-1-preview.png                      (contact sheet)
  /tmp/opencode/cast-4-1-corridor-mock.png                (native-scale read)

Run from repo root:  python3 scripts/art/generate-cast-4-1.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

FRAME_W, FRAME_H = 34, 64
BODY_FRAMES = 7  # 0 = idle, 1..6 = walk
GROUND_ROW = 63
VARIANTS = 8

TRANSPARENT = (0, 0, 0, 0)

# --- Deco Noir palette (docs/art/alternative/art-direction-brief.md) ---
INK = (15, 27, 33, 255)
IVORY = (242, 234, 216, 255)
IVORY_SHADE = (207, 195, 168, 255)
CHARCOAL = (35, 35, 43, 255)
CHARCOAL_SHADE = (24, 24, 30, 255)
BRASS = (201, 161, 59, 255)
BRASS_SHADE = (156, 120, 44, 255)
GLOVE = (246, 241, 230, 255)
SKIN = (217, 168, 120, 255)
SKIN_SHADE = (179, 131, 92, 255)
SKIN_DEEP = (166, 116, 78, 255)
SKIN_DEEP_SHADE = (128, 88, 58, 255)
HAIR_BLACK = (43, 38, 34, 255)
HAIR_AUBURN = (138, 74, 47, 255)
EYE = (15, 27, 33, 255)

# --- Guest grayscale base (tint carrier — never ivory/brass authored) ---
G_WHITE = (245, 245, 245, 255)
G_LIGHT = (205, 205, 205, 255)
G_MID = (130, 130, 130, 255)
G_DARK = (60, 60, 60, 255)
G_INK = (22, 22, 26, 255)

# Body walk cycle: 6 frames. No head bob (the head lives on the variant
# overlay — a stable neck line keeps the overlay pixel-locked).
# Symmetric contact/pass cycle: contact(0) - stride(+7) - pass(+5) -
# contact(0) - stride(-7) - pass(-5) — loops without a swing pop.
LEG_SWING = [0, 5, 7, 0, -5, -7]
FOOT_LIFT = {1: 3, 2: 2, 4: 3, 5: 2}


def rect(px: Image.Image, x0: int, y0: int, x1: int, y1: int, color) -> None:
    for y in range(max(0, y0), min(FRAME_H, y1 + 1)):
        for x in range(max(0, x0), min(FRAME_W, x1 + 1)):
            px.putpixel((x, y), color)


def hline(px: Image.Image, x0: int, x1: int, y: int, color) -> None:
    rect(px, x0, y, x1, y, color)


def draw_body_leg(px: Image.Image, hip_x: int, swing: int, lift: int, far: bool) -> None:
    pants = CHARCOAL_SHADE if far else CHARCOAL
    top, bottom = 36, 56
    for y in range(top, bottom + 1):
        t = (y - top) / (bottom - top)
        x = hip_x + round(swing * t)
        rect(px, x, y, x + 3, y, pants)
    foot_y = bottom + 1 - lift
    shoe_x = hip_x + swing
    rect(px, shoe_x, foot_y, shoe_x + 5, GROUND_ROW, INK)


def draw_body_arm(px: Image.Image, shoulder_x: int, swing: int, far: bool) -> None:
    sleeve = IVORY_SHADE if far else IVORY
    for y in range(22, 37):
        t = (y - 22) / 14
        x = shoulder_x + round(swing * t)
        rect(px, x, y, x + 2, y, sleeve)
    glove_x = shoulder_x + swing
    rect(px, glove_x, 36, glove_x + 2, 39, GLOVE)
    rect(px, glove_x, 36, glove_x + 2, 36, BRASS_SHADE)


def draw_body_frame(sheet_index: int) -> Image.Image:
    """Headless body; sheet_index 0 = idle, 1..6 = walk cycle frames.

    Neck collar tops out at y18; rows 0..17 stay transparent (the variant
    overlay supplies the head)."""
    px = Image.new("RGBA", (FRAME_W, FRAME_H), TRANSPARENT)
    cycle = sheet_index - 1  # LEG_SWING indexes the 6 walk frames
    swing = LEG_SWING[cycle]
    lift = FOOT_LIFT.get(cycle, 0)
    # The far leg mirrors the near stride half a cycle away (frames 1..2
    # mirror 4..5; contact frames keep both feet down).
    mirror = (cycle + 3) % 6
    back_lift = FOOT_LIFT.get(mirror, 0)

    # far arm then far leg
    draw_body_arm(px, 11 + swing // 2, swing // 2, far=True)
    draw_body_leg(px, 17, -swing, back_lift, far=True)

    # torso: ivory mess jacket (y18..38), coat tail behind
    rect(px, 9, 18, 24, 38, IVORY)
    rect(px, 9, 18, 10, 38, IVORY_SHADE)
    rect(px, 9, 38, 12, 42, IVORY)
    for by in (22, 27, 32):
        rect(px, 22, by, 22, by, BRASS)
    hline(px, 9, 24, 37, BRASS_SHADE)

    # near leg over the hem, then near arm
    draw_body_leg(px, 13, swing, lift, far=False)
    draw_body_arm(px, 19 - swing // 2, -swing // 2, far=False)
    # collar
    hline(px, 14, 21, 18, IVORY_SHADE)
    return px


def build_body_sheet() -> Image.Image:
    sheet = Image.new("RGBA", (FRAME_W * BODY_FRAMES, FRAME_H), TRANSPARENT)
    for i in range(BODY_FRAMES):
        sheet.paste(draw_body_frame(i), (i * FRAME_W, 0))
    return sheet


def draw_variant_head(index: int) -> Image.Image:
    """Head + cap + hair + accessory; body rows 18..63 stay transparent.

    Variant decomposition (8): skin = i % 2, hair = (i >> 1) % 2,
    accessory = (i >> 2) % 2 (0 = brass cap band, 1 = round glasses).
    """
    px = Image.new("RGBA", (FRAME_W, FRAME_H), TRANSPARENT)
    skin = SKIN_DEEP if index % 2 else SKIN
    skin_shade = SKIN_DEEP_SHADE if index % 2 else SKIN_SHADE
    hair = HAIR_AUBURN if (index >> 1) % 2 else HAIR_BLACK
    glasses = (index >> 2) % 2 == 1

    # head (y6..16), jaw shade
    rect(px, 12, 6, 22, 16, skin)
    hline(px, 12, 22, 16, skin_shade)
    # hair: back/side mass under the cap (strict profile, right-facing)
    rect(px, 11, 8, 14, 14, hair)
    rect(px, 12, 6, 22, 8, hair)
    # eye
    rect(px, 19, 10, 19, 10, EYE)
    if glasses:
        # round brass-wire glasses (accessory half A)
        hline(px, 17, 21, 10, BRASS)
        hline(px, 22, 23, 10, BRASS)
    # cap: charcoal crown + band + forward brim (uniform for every variant)
    rect(px, 12, 1, 21, 5, CHARCOAL)
    if not glasses:
        hline(px, 12, 21, 5, BRASS)  # accessory half B: the band
    else:
        hline(px, 12, 21, 5, CHARCOAL_SHADE)
    rect(px, 18, 5, 24, 5, CHARCOAL_SHADE)
    rect(px, 12, 1, 13, 5, CHARCOAL_SHADE)
    # neck
    rect(px, 16, 17, 20, 18, skin_shade)
    return px


def build_variant_sheet() -> Image.Image:
    sheet = Image.new("RGBA", (FRAME_W * VARIANTS, FRAME_H), TRANSPARENT)
    for i in range(VARIANTS):
        sheet.paste(draw_variant_head(i), (i * FRAME_W, 0))
    return sheet


# --- Guests: grayscale tint carriers -------------------------------------


def guest_base() -> Image.Image:
    return Image.new("RGBA", (FRAME_W, FRAME_H), TRANSPARENT)


def guest_leg(px: Image.Image, hip_x: int, bottom: int, swing: int, far: bool, top: int = 38) -> None:
    col = G_DARK if far else G_MID
    for y in range(top, bottom + 1):
        t = (y - top) / max(1, bottom - top)
        x = hip_x + round(swing * t)
        rect(px, x, y, x + 3, y, col)
    rect(px, hip_x + swing, bottom + 1, hip_x + swing + 5, GROUND_ROW, G_INK)


def guest_torso(px: Image.Image, x0: int, x1: int, y0: int, y1: int) -> None:
    rect(px, x0, y0, x1, y1, G_WHITE)
    rect(px, x0, y0, x0 + 1, y1, G_LIGHT)


def guest_head(px: Image.Image, x0: int, x1: int, y0: int, y1: int) -> None:
    rect(px, x0, y0, x1, y1, G_LIGHT)
    rect(px, x1 - 1, y0 + 4, x1 - 1, y0 + 5, G_INK)  # eye


def draw_guest_suite() -> Image.Image:
    """Tall figure: wide-brim hat, long coat to mid-calf, slim trousers."""
    px = guest_base()
    guest_leg(px, 15, 56, 0, far=True)
    guest_leg(px, 12, 56, 0, far=False)
    guest_torso(px, 10, 22, 16, 52)  # long coat
    rect(px, 10, 52, 13, 54, G_LIGHT)
    guest_head(px, 13, 21, 6, 16)
    rect(px, 10, 2, 24, 5, G_MID)    # wide brim
    rect(px, 13, 0, 21, 3, G_MID)    # crown
    return px


def draw_guest_tourist() -> Image.Image:
    """Broad figure: sun hat, short jacket, wide trousers."""
    px = guest_base()
    guest_leg(px, 14, 56, 0, far=True)
    guest_leg(px, 11, 56, 0, far=False)
    guest_torso(px, 8, 24, 18, 38)   # short jacket
    rect(px, 8, 38, 24, 40, G_LIGHT)  # hem
    guest_head(px, 13, 21, 7, 17)
    rect(px, 11, 3, 23, 6, G_MID)    # sun hat
    return px


def draw_guest_clerk() -> Image.Image:
    """Slim figure: flat cap, long straight skirt/coat to the ankle."""
    px = guest_base()
    guest_leg(px, 16, 56, 0, far=True)
    guest_torso(px, 11, 21, 16, 56)  # full-length coat
    rect(px, 11, 56, 22, 58, G_LIGHT)
    guest_head(px, 14, 21, 7, 16)
    rect(px, 13, 4, 23, 6, G_MID)    # flat cap
    return px


def draw_guest_elder() -> Image.Image:
    """Stooped figure: shawl, cane, shortened stride."""
    px = guest_base()
    guest_leg(px, 14, 52, 0, far=True)
    guest_leg(px, 12, 52, 0, far=False)
    guest_torso(px, 10, 22, 18, 46)  # shawl
    rect(px, 10, 46, 12, 48, G_LIGHT)
    guest_head(px, 13, 21, 9, 18)    # carried low (stoop)
    rect(px, 12, 7, 21, 10, G_MID)   # shawl over the head
    rect(px, 25, 40, 26, GROUND_ROW, G_INK)  # cane
    return px


def draw_guest_dandy() -> Image.Image:
    """Tall slim figure: stovepipe hat, long frock coat, cane."""
    px = guest_base()
    guest_leg(px, 15, 56, 0, far=True)
    guest_leg(px, 12, 56, 0, far=False)
    guest_torso(px, 10, 22, 16, 54)  # frock coat
    rect(px, 9, 54, 14, 57, G_LIGHT)  # coat tails (behind, left)
    guest_head(px, 13, 21, 6, 16)
    rect(px, 14, 0, 20, 5, G_MID)    # stovepipe crown (tall, narrow)
    rect(px, 11, 5, 23, 7, G_MID)    # hat brim
    rect(px, 25, 46, 26, GROUND_ROW, G_INK)  # cane
    return px


def draw_guest_diva() -> Image.Image:
    """Broad figure: feathered plume, fur stole, tapered skirt."""
    px = guest_base()
    guest_leg(px, 14, 54, 0, far=True)
    guest_leg(px, 11, 54, 0, far=False)
    guest_torso(px, 8, 25, 16, 40)   # stole across broad shoulders
    rect(px, 10, 40, 23, 50, G_WHITE)  # tapered skirt
    rect(px, 10, 40, 11, 50, G_LIGHT)
    rect(px, 23, 28, 27, 40, G_LIGHT)  # stole tail (forward side)
    guest_head(px, 13, 21, 7, 17)
    rect(px, 12, 4, 21, 8, G_MID)    # updo
    rect(px, 9, 0, 11, 7, G_LIGHT)   # plume
    rect(px, 8, 5, 10, 9, G_MID)
    return px


def draw_guest_flapper() -> Image.Image:
    """Slim figure: bobbed hair, dropped-waist dress, fringed hem (no hat)."""
    px = guest_base()
    guest_leg(px, 14, 54, 0, far=True)
    guest_leg(px, 12, 54, 0, far=False)
    guest_torso(px, 10, 23, 18, 44)  # straight drop-waist dress
    hline(px, 10, 23, 34, G_LIGHT)   # dropped waist seam
    for x in range(10, 24, 2):       # fringe hem
        rect(px, x, 44, x, 46, G_LIGHT)
    guest_head(px, 13, 21, 8, 18)
    rect(px, 12, 6, 22, 10, G_MID)   # bob crown
    rect(px, 11, 6, 14, 17, G_MID)   # bob side mass
    return px


def draw_guest_merchant() -> Image.Image:
    """Heavyset figure: bowler hat, broad coat, peddler's pack on the back."""
    px = guest_base()
    guest_leg(px, 17, 56, 0, far=True)
    guest_leg(px, 10, 56, 0, far=False)
    guest_torso(px, 7, 25, 16, 44)   # broad coat
    hline(px, 7, 25, 40, G_LIGHT)    # hem
    rect(px, 3, 22, 8, 36, G_LIGHT)  # pack hump (behind, left)
    rect(px, 3, 22, 4, 36, G_MID)
    guest_head(px, 13, 21, 6, 15)
    rect(px, 14, 2, 20, 6, G_MID)    # bowler dome
    rect(px, 12, 6, 22, 7, G_MID)    # bowler brim
    return px


def draw_guest_professor() -> Image.Image:
    """Thin figure: bald dome with back hair, spectacles, book under arm."""
    px = guest_base()
    guest_leg(px, 16, 56, 0, far=True)
    guest_leg(px, 13, 56, 0, far=False)
    guest_torso(px, 11, 22, 16, 48)  # knee-length frock
    rect(px, 11, 48, 22, 50, G_LIGHT)
    guest_head(px, 13, 22, 6, 16)
    rect(px, 12, 10, 15, 16, G_MID)  # back hair, high bald forehead
    hline(px, 17, 23, 10, G_INK)     # spectacles (round wire read)
    rect(px, 18, 17, 21, 18, G_DARK)  # bow tie
    rect(px, 23, 26, 27, 34, G_MID)  # book under arm
    return px


def draw_guest_child() -> Image.Image:
    """Half-height figure: big head, short coat, ball in hand."""
    px = guest_base()
    guest_leg(px, 15, 56, 0, far=True, top=48)
    guest_leg(px, 12, 56, 0, far=False, top=48)
    guest_torso(px, 12, 22, 34, 50)  # short coat
    rect(px, 12, 50, 22, 52, G_LIGHT)
    guest_head(px, 14, 21, 26, 36)
    rect(px, 13, 24, 22, 29, G_MID)  # hair cap (big head ratio)
    rect(px, 23, 54, 28, 59, G_MID)  # ball
    rect(px, 24, 55, 27, 58, G_LIGHT)
    return px


def corridor_mock(body: Image.Image, variants: Image.Image, guests: dict[str, Image.Image]) -> Image.Image:
    """Native-scale 960x576 read: corridor bands + cast composited in place."""
    W, H = 960, 576
    mock = Image.new("RGBA", (W, H), INK)
    wall = (51, 80, 90, 255)
    wainscot = (36, 51, 59, 255)
    carpet = (92, 36, 48, 255)
    brass_dim = (179, 135, 58, 255)
    for y in range(48, 350):
        for x in range(W):
            mock.putpixel((x, y), wall)
    for y in range(330, 350):
        for x in range(W):
            mock.putpixel((x, y), wainscot)
    for y in range(350, 496):
        for x in range(W):
            mock.putpixel((x, y), carpet)
    for y in (350, 495):
        for x in range(W):
            mock.putpixel((x, y), brass_dim)
    # one walnut door + card
    walnut = (58, 38, 32, 255)
    for y in range(240, 430):
        for x in range(120, 192):
            mock.putpixel((x, y), walnut)
    for y in range(236, 240):
        for x in range(120, 192):
            mock.putpixel((x, y), (201, 161, 59, 255))
    # staff variant 2 (light skin, auburn hair, glasses) walking mid-hall
    body_f2 = body.crop((2 * FRAME_W, 0, 3 * FRAME_W, FRAME_H))
    head_v2 = variants.crop((2 * FRAME_W, 0, 3 * FRAME_W, FRAME_H))
    staff = Image.new("RGBA", (FRAME_W, FRAME_H), TRANSPARENT)
    staff.alpha_composite(body_f2)
    staff.alpha_composite(head_v2)
    mock.alpha_composite(staff, (400, 431 - FRAME_H))  # game ground line y430
    # guests tinted teal / burgundy beside them (the runtime setTint read)
    tints = {"guest-suite.png": (90, 154, 170, 255), "guest-clerk.png": (176, 106, 122, 255)}
    x0 = 480
    for name, tint in tints.items():
        base = guests[name].copy()
        px = base.load()
        for yy in range(base.height):
            for xx in range(base.width):
                r, g, b, a = px[xx, yy]
                if a:
                    px[xx, yy] = (r * tint[0] // 255, g * tint[1] // 255, b * tint[2] // 255, a)
        mock.alpha_composite(base, (x0, 431 - FRAME_H))
        x0 += 60
    return mock


def main() -> None:
    out = Path("apps/client/public/art/chars")
    out.mkdir(parents=True, exist_ok=True)

    body = build_body_sheet()
    body.save(out / "staff-body-34x64-7f.png")
    variants = build_variant_sheet()
    variants.save(out / "staff-variant-8f.png")
    guests = {
        "guest-suite.png": draw_guest_suite(),
        "guest-tourist.png": draw_guest_tourist(),
        "guest-clerk.png": draw_guest_clerk(),
        "guest-elder.png": draw_guest_elder(),
        "guest-dandy.png": draw_guest_dandy(),
        "guest-diva.png": draw_guest_diva(),
        "guest-flapper.png": draw_guest_flapper(),
        "guest-merchant.png": draw_guest_merchant(),
        "guest-professor.png": draw_guest_professor(),
        "guest-child.png": draw_guest_child(),
    }
    for name, img in guests.items():
        img.save(out / name)

    for name in ["staff-body-34x64-7f.png", "staff-variant-8f.png", *guests.keys()]:
        p = out / name
        print(f"wrote {p} ({p and Image.open(p).size})")

    # Contact sheet at 3x over a dark backdrop, wrapped rows
    tmp = Path("/tmp/opencode")
    tmp.mkdir(parents=True, exist_ok=True)
    items = [body] + [variants] + list(guests.values())
    scale = 3
    margin = 8
    row_w = 1200
    rows: list[list[tuple[Image.Image, int]]] = [[]]
    x = margin
    for img in items:
        w = img.width * scale
        if x + w > row_w - margin:
            rows.append([])
            x = margin
        rows[-1].append((img, x))
        x += w + 12
    preview = Image.new("RGBA", (row_w, len(rows) * (FRAME_H * scale + margin + 4) + margin), (38, 48, 54, 255))
    for r, row in enumerate(rows):
        y0 = margin + r * (FRAME_H * scale + margin + 4)
        for img, x in row:
            big = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
            preview.alpha_composite(big, (x, y0))
    preview.save(tmp / "cast-4-1-preview.png")
    print(f"wrote {tmp / 'cast-4-1-preview.png'}")

    mock = corridor_mock(body, variants, guests)
    mock.convert("RGB").save(tmp / "cast-4-1-corridor-mock.png")
    print(f"wrote {tmp / 'cast-4-1-corridor-mock.png'}")


if __name__ == "__main__":
    main()
