#!/usr/bin/env python3
"""Generate the Turnover breath-puff FX (own stairs breath, breath-sprites).

4-frame 32x32 exhalation loop that floats above the breather's head for the
2 s arrival breath (AD-051). Cool pale puffs on transparent background,
anchored bottom-center — deliberately distinct from the warm rustle dust
(ivory/brass) and the anger chartreuse: breath is cool white that rises and
thins. Loops while the breath lasts; own-viewer only.

Output:
  apps/client/public/art/props/fx-breath-4f.png   (128x32 sheet)
  /tmp/opencode/fx-breath-preview.png

Run from repo root: python3 scripts/art/generate-fx-breath.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

FRAME = 32
FRAMES = 4

BREATH = (232, 240, 242, 255)      # cool exhaled white
BREATH_DIM = (185, 200, 206, 255)  # thinning edge
BREATH_DEEP = (150, 170, 178, 255)  # near-dissipated wisp

TRANSPARENT = (0, 0, 0, 0)


def rect(px: Image.Image, x0: int, y0: int, x1: int, y1: int, color) -> None:
    for y in range(max(0, y0), min(px.height, y1 + 1)):
        for x in range(max(0, x0), min(px.width, x1 + 1)):
            px.putpixel((x, y), color)


def puff(px: Image.Image, cx: int, cy: int, r: int, core, edge) -> None:
    """Flat filled disc: core circle + 1px edge ring (no gradients)."""
    for y in range(cy - r - 1, cy + r + 2):
        for x in range(cx - r - 1, cx + r + 2):
            d = (x - cx) ** 2 + (y - cy) ** 2
            if d <= r * r:
                px.putpixel((x, y), core)
            elif d <= (r + 1) ** 2:
                px.putpixel((x, y), edge)


def frame(n: int) -> Image.Image:
    px = Image.new("RGBA", (FRAME, FRAME), TRANSPARENT)
    # two puffs exhaled in alternation: while one rises and thins, the next
    # gathers low — the loop reads as steady panting, not one sigh.
    if n in (0, 1):
        puff(px, 13, 24 - n * 3, 3, BREATH, BREATH_DIM)
    if n in (1, 2):
        puff(px, 19, 26 - (n - 1) * 3, 2, BREATH, BREATH_DIM)
    if n == 2:
        puff(px, 13, 16, 2, BREATH_DIM, BREATH_DEEP)
    if n == 3:
        puff(px, 19, 18, 2, BREATH_DIM, BREATH_DEEP)
        puff(px, 13, 12, 1, BREATH_DEEP, BREATH_DEEP)
    return px


def main() -> None:
    out = Path("apps/client/public/art/props/fx-breath-4f.png")
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet = Image.new("RGBA", (FRAME * FRAMES, FRAME), TRANSPARENT)
    for n in range(FRAMES):
        sheet.paste(frame(n), (n * FRAME, 0))
    sheet.save(out)
    print(f"wrote {out} ({sheet.width}x{sheet.height})")

    scale = 6
    preview = Image.new("RGBA", (FRAME * FRAMES * scale + 40, FRAME * scale + 16),
                        (90, 90, 90, 255))
    for n in range(FRAMES):
        img = sheet.crop((n * FRAME, 0, (n + 1) * FRAME, FRAME))
        preview.alpha_composite(img.resize((FRAME * scale, FRAME * scale), Image.NEAREST),
                                (n * FRAME * scale + 8, 8))
    preview.save("/tmp/opencode/fx-breath-preview.png")
    print("wrote /tmp/opencode/fx-breath-preview.png")


if __name__ == "__main__":
    main()
