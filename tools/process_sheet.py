#!/usr/bin/env python3
"""Slice a generated 4x2 direction grid into the 2048x1216 player atlas.

Input:  tmp/gen/sheet-deepseek.png  (magenta background, 8 chibi poses,
        order S,SE,E,NE / N,NW,W,SW)
Output: assets/runtime/player/<anim>.png for all PLAYER_ANIMS, plus debug
        previews under tmp/gen/debug/.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
GEN = ROOT / "tmp" / "gen"
DBG = GEN / "debug"
OUT = ROOT / "assets" / "runtime" / "player"

CELL_W, CELL_H = 256, 304
COLS, ROWS = 8, 4
CHAR_H = 280
FOOT_PAD = 16
MAX_CHAR_W = 244
ANIMS = ["idle", "walk", "run", "attack", "defend", "climb", "fail"]
# gentle bob/squash cycle: (dy up px, scale-y about the foot line)
FRAMES = [(0, 1.0), (4, 1.012), (8, 1.0), (3, 0.996)]


def key_out_magenta(img: Image.Image) -> Image.Image:
    """Flood-fill magenta from the borders into transparency, with despill.

    The generator may already return a transparent background; in that case the
    source alpha is kept as-is.
    """
    rgb = np.asarray(img.convert("RGB")).astype(np.int16)
    h, w, _ = rgb.shape
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    bg = (r > 130) & (b > 130) & (g < r - 50) & (g < b - 50)

    out = img.convert("RGBA")
    src_alpha = np.asarray(out)[:, :, 3].astype(np.int16)
    arr = np.asarray(out).astype(np.int16)
    if bg.sum() == 0:
        arr[:, :, 3] = np.where(arr[:, :, 3] < 8, 0, arr[:, :, 3])
        return Image.fromarray(arr.astype(np.uint8), "RGBA")

    # BFS from every border pixel that matches the background colour
    from collections import deque

    mask = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if bg[y, x] and not mask[y, x]:
                mask[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if bg[y, x] and not mask[y, x]:
                mask[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and bg[ny, nx] and not mask[ny, nx]:
                mask[ny, nx] = True
                q.append((ny, nx))

    # zero flooded magenta, keep the source alpha everywhere else
    alpha = np.where(mask | bg, 0, src_alpha).astype(np.uint8)
    a_img = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(1.0))
    out = img.convert("RGBA")
    out.putalpha(a_img)

    # despill: magenta halo on kept pixels -> pull towards the pixel's grey
    arr = np.asarray(out).astype(np.int16)
    keep = arr[:, :, 3] > 0
    halo = keep & (arr[:, :, 0] > arr[:, :, 1] + 40) & (arr[:, :, 2] > arr[:, :, 1] + 40)
    grey = arr[:, :, 1]
    for c in (0, 2):
        ch = arr[:, :, c]
        arr[:, :, c] = np.where(halo, (ch + grey) // 2, ch)

    # bleed: semi-transparent edge pixels take the colour of the nearest
    # fully-opaque pixel, removing any remaining background fringe
    from scipy import ndimage

    u8 = arr.astype(np.uint8)
    opq = u8[:, :, 3] >= 250
    if opq.any() and not opq.all():
        _, idx = ndimage.distance_transform_edt(~opq, return_indices=True)
        bleed = u8[idx[0], idx[1]]
        u8[:, :, :3] = np.where(opq[:, :, None], u8[:, :, :3], bleed[:, :, :3])
    return Image.fromarray(u8, "RGBA")


def cut_cells(img: Image.Image) -> list[Image.Image]:
    w, h = img.size
    cw, chh = w // 4, h // 2
    cuts = []
    for row in range(2):
        for col in range(4):
            cell = img.crop((col * cw, row * chh, (col + 1) * cw, (row + 1) * chh))
            bbox = cell.getbbox()
            if bbox is None:
                raise SystemExit(f"empty cell row={row} col={col}")
            cuts.append(cell.crop(bbox))
    return cuts


def fit_char(cut: Image.Image) -> Image.Image:
    scale = min(CHAR_H / cut.height, MAX_CHAR_W / cut.width)
    return cut.resize(
        (max(1, round(cut.width * scale)), max(1, round(cut.height * scale))),
        Image.LANCZOS,
    )


def paste_frame(base: Image.Image, char: Image.Image, dy: int, sy: float) -> None:
    w = round(char.width * (1.0 + (sy - 1.0) * 0.5))  # mostly vertical squash
    h = max(1, round(char.height * sy))
    scaled = char.resize((w, h), Image.LANCZOS)
    x = (CELL_W - w) // 2
    y = CELL_H - FOOT_PAD - h - dy
    base.alpha_composite(scaled, (x, y))


def main() -> None:
    import sys

    DBG.mkdir(parents=True, exist_ok=True)
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else GEN / "sheet-deepseek.png"
    pair_mirror = "--pair-mirror" in sys.argv
    img = Image.open(src)
    print(f"source {img.size}")
    keyed = key_out_magenta(img)
    keyed.save(DBG / "keyed-grid.png")

    cuts = cut_cells(keyed)
    if pair_mirror:
        # The model mirrors requested chirality, so build the atlas from one
        # pose per axis pair: S, N, an E-facing profile, an SW-leaning front
        # diagonal (cuts[7]) and a dedicated back diagonal (--backdiag, body
        # angled away toward the viewer's right, tail sweeping right).
        # Atlas order S,SE,E,NE,N,NW,W,SW; E/W and the diagonals are exact
        # mirrors of each other.
        m = lambda im: im.transpose(Image.FLIP_LEFT_RIGHT)
        back_arg = "--backdiag"
        if back_arg in sys.argv:
            back_src = Path(sys.argv[sys.argv.index(back_arg) + 1])
            back_keyed = key_out_magenta(Image.open(back_src))
            bb = back_keyed.getbbox()
            back_cut = back_keyed.crop(bb)
        else:
            back_cut = cuts[3]
        cells = [
            cuts[0],           # S
            m(cuts[7]),        # SE (mirror of the left-leaning diagonal)
            m(cuts[6]),        # E  (generated profile faces left, mirror it right)
            back_cut,          # NE (away toward viewer's right, tail right)
            cuts[4],           # N
            m(back_cut),       # NW (mirror: away toward viewer's left)
            cuts[6],           # W  (generated profile already faces left)
            cuts[7],           # SW
        ]
    else:
        cells = cuts
    chars = [fit_char(c) for c in cells]
    for i, c in enumerate(chars):
        c.save(DBG / f"cut-{i}.png")
        print(f"cut {i}: {c.size}")

    sheet = Image.new("RGBA", (CELL_W * COLS, CELL_H * ROWS), (0, 0, 0, 0))
    for col, char in enumerate(chars):
        for row, (dy, sy) in enumerate(FRAMES):
            cell = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
            paste_frame(cell, char, dy, sy)
            sheet.alpha_composite(cell, (col * CELL_W, row * CELL_H))
    sheet.save(DBG / "sheet-preview.png")

    for anim in ANIMS:
        sheet.save(OUT / f"{anim}.png")
    print(f"wrote {len(ANIMS)} anims -> {OUT} ({sheet.size})")


if __name__ == "__main__":
    main()
