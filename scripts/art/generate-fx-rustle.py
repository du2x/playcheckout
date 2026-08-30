#!/usr/bin/env python3
"""Generate the Turnover sabotage rustle FX (AD-020).

4-frame 32x32 dust puff that accompanies the rustle audio cue at a door
(FR-13). Subtle by design: cream/tan motes on transparent background,
anchored bottom-center on the door threshold. Plays once on room:rustle.

Output:
  apps/client/public/art/props/fx-rustle-4f.png   (128x32 sheet)
  /tmp/opencode/fx-rustle-preview.png

Run from repo root: python3 scripts/art/generate-fx-rustle.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

FRAME = 32
FRAMES = 4

CREAM = (242, 237, 226, 255)
CREAM_DIM = (216, 206, 186, 255)
TAN = (201, 178, 138, 255)
TAN_DIM = (168, 152, 118, 255)

TRANSPARENT = (0, 0, 0, 0)

# Mote spawn sites (x, y) inside the frame; sets grow + scatter per frame.
SITES = [(13, 27), (18, 26), (15, 24), (20, 28), (12, 25), (17, 22)]
DRIFT = [(-1, -1), (0, -2), (1, -1), (-1, -2), (1, -2), (0, -3)]


def rect(px: Image.Image, x0: int, y0: int, x1: int, y1: int, color) -> None:
    for y in range(max(0, y0), min(px.height, y1 + 1)):
        for x in range(max(0, x0), min(px.width, x1 + 1)):
            px.putpixel((x, y), color)


def frame(n: int) -> Image.Image:
    px = Image.new("RGBA", (FRAME, FRAME), TRANSPARENT)
    if n == 3:  # dissipating: only the far-drifted specks remain
        specks = [(11, 20), (17, 18), (21, 22)]
        for x, y in specks:
            rect(px, x, y, x, y, TAN_DIM)
        return px
    for i, (sx, sy) in enumerate(SITES):
        dx, dy = DRIFT[i]
        x = sx + dx * n
        y = sy + dy * n
        size = 1 + (n + i) % 2  # alternating 1-2px motes
        color = (CREAM, CREAM_DIM, TAN, TAN_DIM)[i % 4]
        rect(px, x, y, x + size, y + size, color)
    if n == 0:
        rect(px, 14, 27, 17, 28, CREAM_DIM)  # low puff where the mess starts
    return px


def main() -> None:
    out = Path("apps/client/public/art/props/fx-rustle-4f.png")
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
    preview.save("/tmp/opencode/fx-rustle-preview.png")
    print("wrote /tmp/opencode/fx-rustle-preview.png")


if __name__ == "__main__":
    main()
