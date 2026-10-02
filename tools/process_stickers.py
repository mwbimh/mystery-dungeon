#!/usr/bin/env python3
"""Split generated two-pose sticker sheets into town sticker PNGs.

Input:  tmp/gen/sticker-<name>.png (same character twice: idle left, hover right,
        magenta background or already transparent)
Output: assets/runtime/ui/town/<file>-idle.png / <file>-hover.png plus debug
        previews under tmp/gen/debug/.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from process_sheet import key_out_magenta  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
GEN = ROOT / "tmp" / "gen"
DBG = GEN / "debug"
OUT = ROOT / "assets" / "runtime" / "ui" / "town"

# generated file -> (runtime file stem, canvas size)
TARGETS = {
    "deepseek": ("deepseek", 360),
    "chatgpt": ("chatgpt", 300),
    "claude": ("claude", 300),
    "harness": ("harness", 300),
    "zai": ("glm", 300),
    "kimi": ("kimi", 300),
}
MARGIN = 10


def clean_alpha(img: Image.Image) -> Image.Image:
    """Drop faint haze (low alpha) and small isolated specks in the background."""
    from scipy import ndimage

    arr = np.asarray(img).copy()
    alpha = arr[:, :, 3]
    alpha[alpha < 24] = 0
    solid = alpha > 8
    labels, n = ndimage.label(solid)
    if n > 1:
        sizes = np.bincount(labels.ravel())
        keep = sizes >= max(2000, sizes[1:].max() // 200)
        keep[0] = False
        alpha[~keep[labels]] = 0
    arr[:, :, 3] = alpha
    return Image.fromarray(arr, "RGBA")


def drop_specks(img: Image.Image, floor: int = 1500) -> Image.Image:
    """Remove small isolated alpha components relative to the largest one."""
    from scipy import ndimage

    arr = np.asarray(img).copy()
    alpha = arr[:, :, 3]
    solid = alpha > 8
    labels, n = ndimage.label(solid)
    if n > 1:
        sizes = np.bincount(labels.ravel())
        keep = sizes >= max(floor, sizes[1:].max() // 100)
        keep[0] = False
        alpha[~keep[labels]] = 0
    arr[:, :, 3] = alpha
    return Image.fromarray(arr, "RGBA")


def split_halos(img: Image.Image) -> list[Image.Image]:
    """Cut the two poses apart at the least-occupied column near the middle."""
    alpha = np.asarray(img)[:, :, 3]
    w = img.width
    lo, hi = int(w * 0.35), int(w * 0.65)
    mass = (alpha > 8).sum(axis=0)
    cut = lo + int(np.argmin(mass[lo:hi]))
    left = img.crop((0, 0, cut, img.height))
    right = img.crop((cut, 0, w, img.height))
    halves = []
    for half in (left, right):
        bbox = half.getbbox()
        if bbox is None:
            raise SystemExit("empty half after split")
        half = drop_specks(half.crop(bbox))
        if half.getbbox() is None:
            raise SystemExit("half empty after speck cleanup")
        halves.append(half)
    return halves


def to_sticker(cut: Image.Image, size: int) -> Image.Image:
    scale = (size - 2 * MARGIN) / max(cut.width, cut.height)
    scaled = cut.resize(
        (max(1, round(cut.width * scale)), max(1, round(cut.height * scale))),
        Image.LANCZOS,
    )
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = (size - scaled.width) // 2
    y = size - MARGIN - scaled.height
    canvas.alpha_composite(scaled, (x, y))
    return canvas


def main() -> None:
    DBG.mkdir(parents=True, exist_ok=True)
    for name, (stem, size) in TARGETS.items():
        src = GEN / f"sticker-{name}.png"
        if not src.exists():
            print(f"skip {name}: {src.name} missing")
            continue
        img = Image.open(src)
        keyed = clean_alpha(key_out_magenta(img))
        idle, hover = split_halos(keyed)
        for tag, cut in (("idle", idle), ("hover", hover)):
            out = to_sticker(cut, size)
            out.save(OUT / f"{stem}-{tag}.png")
            out.save(DBG / f"sticker-{stem}-{tag}.png")
        print(f"{name}: idle {idle.size} hover {hover.size} -> {stem}-idle/hover @ {size}px")


if __name__ == "__main__":
    main()
