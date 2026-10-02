#!/usr/bin/env python3
"""Key whale-maid stills, punch ahoge holes, complete clipped flukes,
animate tail/ahoge/blink, pack 8x4 sheets at 128x160."""
from __future__ import annotations

from collections import Counter, deque
from pathlib import Path

from PIL import Image, ImageDraw

SPLIT = Path("/workspace/mystery-dungeon/assets/ref/split")
GEN = Path("/home/box/sand-data/agents/4ecaf214-0954-447c-99fd-47f2f0b80a0a/assets")
OUT = Path("/workspace/mystery-dungeon/assets/runtime/player")
DBG = Path("/tmp/dbg/player")
DBG.mkdir(parents=True, exist_ok=True)

CELL_W, CELL_H = 128, 160
FOOT = 10
CHAR_H = 140
DIRS = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"]

STILLS = {
    "S": SPLIT / "turn-front.png",
    "SE": GEN / "0e7cabe9f1b1611161d97238ad258e70cda6ca4daceccf8a7815036b19e902ce.png",
    "E": SPLIT / "turn-east.png",
    "NE": GEN / "12cdefc7f5f9c83a0f8499e9f9b2702195d78fa5281b6ff7ed2f04188c2dc2de.png",
    "N": SPLIT / "turn-back.png",
    "NW": GEN / "09013a21ed0aa5f0cb56ea97b6c125011f9041bbc80b35ac3501328ef4d791c2.png",
    "W": SPLIT / "turn-side.png",
    "SW": GEN / "134432df24c7118939e1996b1f8160e1e4573a75ed080dc1056ead5abaf6d60e.png",
}

# tail_deg, ahoge_deg, body_sy, bob_px, blink, lean_deg
CLIPS = {
    "idle": [
        (0, 0, 1.000, 0, False, 0),
        (18, -18, 1.010, 6, True, 0),
        (-8, 14, 1.000, 16, False, 0),
        (12, -8, 0.994, 2, False, 0),
    ],
    "walk": [
        (22, -12, 1.00, 22, False, 0),
        (-10, 10, 1.02, -4, False, 0),
        (24, -10, 1.00, 22, False, 0),
        (-12, 12, 1.02, -4, False, 0),
    ],
    "run": [
        (28, -16, 1.00, 32, False, 0),
        (-16, 14, 1.03, -8, False, 0),
        (30, -12, 1.00, 32, False, 0),
        (-18, 16, 1.03, -8, False, 0),
    ],
    "attack": [
        (-22, 10, 1.00, 4, False, -4),
        (14, -8, 0.97, 22, False, 8),
        (6, 0, 1.00, 10, False, 3),
        (0, 0, 1.00, 0, False, 0),
    ],
    "defend": [
        (8, -8, 0.94, -2, False, 0),
        (10, -10, 0.93, -4, True, 0),
        (8, -6, 0.94, -2, False, 0),
        (6, -8, 0.95, 0, False, 0),
    ],
    "climb": [
        (10, 12, 1.00, 24, False, 0),
        (-6, -10, 1.00, 40, False, 0),
        (10, 12, 1.00, 24, False, 0),
        (-6, -10, 1.00, 6, False, 0),
    ],
    "fail": [
        (24, -18, 0.96, -10, True, 10),
        (28, -22, 0.90, -22, True, 16),
        (20, -14, 0.88, -30, True, 20),
        (14, -8, 0.86, -38, True, 24),
    ],
}


def is_paper(p):
    r, g, b, a = p
    if a < 8:
        return True
    if r >= 190 and b >= 190 and g <= 90:
        return True
    mn, mx = min(r, g, b), max(r, g, b)
    if mn >= 198 and (mx - mn) <= 48:
        return True
    if mn >= 180 and (mx - mn) <= 22 and (r + g + b) / 3 >= 198:
        return True
    return False


def is_hole_white(p):
    r, g, b, a = p
    if a < 8:
        return False
    mn, mx = min(r, g, b), max(r, g, b)
    return mn >= 180 and (mx - mn) <= 60


def is_hair(p):
    r, g, b, a = p
    if a < 20 or min(r, g, b) >= 190:
        return False
    return b >= r + 8 and b >= 50


def flood_mask(w, h, pred, seeds):
    seen = bytearray(w * h)
    q = deque()
    for x, y in seeds:
        if 0 <= x < w and 0 <= y < h and not seen[y * w + x] and pred(x, y):
            seen[y * w + x] = 1
            q.append((x, y))
    while q:
        x, y = q.popleft()
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nx, ny = x + dx, y + dy
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            i = ny * w + nx
            if seen[i] or not pred(nx, ny):
                continue
            seen[i] = 1
            q.append((nx, ny))
    return seen


def key_background(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    pix = im.load()

    def paper_at(x, y):
        return is_paper(pix[x, y])

    seeds = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)]
    seeds += [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    seen = flood_mask(w, h, paper_at, seeds)
    out = im.copy()
    op = out.load()
    for y in range(h):
        for x in range(w):
            if seen[y * w + x]:
                r, g, b, a = op[x, y]
                op[x, y] = (r, g, b, 0)

    bb = out.getbbox()
    if not bb:
        return out
    x0, y0, x1, y1 = bb
    bw, bh = x1 - x0, y1 - y0

    # punch remaining paper/white holes: ahoge loop + tail-body gap
    visited = bytearray(w * h)
    for y in range(y0, y1):
        for x in range(x0, x1):
            i = y * w + x
            if visited[i] or op[x, y][3] < 8:
                continue
            if not (is_hole_white(op[x, y]) or is_paper(op[x, y])):
                continue
            # ahoge holes live in the top band; skip starting from headband white
            blob = []
            q = deque([(x, y)])
            visited[i] = 1
            hair_n = 0
            while q:
                cx, cy = q.popleft()
                blob.append((cx, cy))
                for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    nx, ny = cx + dx, cy + dy
                    if nx < 0 or ny < 0 or nx >= w or ny >= h:
                        continue
                    j = ny * w + nx
                    if op[nx, ny][3] < 8:
                        continue
                    if is_hair(op[nx, ny]):
                        hair_n += 1
                    if visited[j]:
                        continue
                    if is_hole_white(op[nx, ny]) or is_paper(op[nx, ny]):
                        # keep top-of-head holes from swallowing the white headband
                        if y < y0 + int(bh * 0.12) and ny > y0 + int(bh * 0.12):
                            continue
                        visited[j] = 1
                        q.append((nx, ny))
            if not blob or len(blob) > 18000:
                continue
            # don't let ahoge-hole flood merge into the white headband
            if any(by > y0 + int(bh * 0.12) for _, by in blob) and all(by < y0 + int(bh * 0.20) for _, by in blob[:1]):
                pass
            cx = sum(p[0] for p in blob) / len(blob)
            cy = sum(p[1] for p in blob) / len(blob)
            rel_y = (cy - y0) / float(bh)
            rel_x = (cx - x0) / float(bw)
            in_ahoge = rel_y < 0.12 and len(blob) < 8000 and hair_n >= 4
            in_tail_gap = rel_y > 0.28 and (rel_x < 0.28 or rel_x > 0.72) and len(blob) < 14000
            if in_ahoge or in_tail_gap:
                extra = []
                for bx, by in blob:
                    r, g, b, a = op[bx, by]
                    op[bx, by] = (r, g, b, 0)
                    extra.append((bx, by))
                # 1px dilate on remaining near-white neighbors
                for bx, by in extra:
                    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                        nx, ny = bx + dx, by + dy
                        if 0 <= nx < w and 0 <= ny < h and is_hole_white(op[nx, ny]):
                            r, g, b, a = op[nx, ny]
                            op[nx, ny] = (r, g, b, 0)

    # paper fringe next to transparent
    for y in range(h):
        for x in range(w):
            r, g, b, a = op[x, y]
            if a < 8:
                continue
            if not (is_paper((r, g, b, a)) or is_hole_white((r, g, b, a))):
                continue
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and op[nx, ny][3] < 8:
                    op[x, y] = (r, g, b, 0)
                    break
    return out


def extend_clipped_tail(im: Image.Image, extra: int = 72) -> Image.Image:
    w, h = im.size
    pix = im.load()
    bb = im.getbbox()
    if not bb:
        return im
    x0, y0, x1, y1 = bb
    ys0 = y0 + int((y1 - y0) * 0.36)

    def max_x_rows():
        rows = []
        for y in range(ys0, y1):
            xs = [x for x in range(x0, min(w, x1 + 1)) if pix[x, y][3] > 40]
            if xs:
                rows.append((y, max(xs), min(xs)))
        return rows

    rows = max_x_rows()
    if not rows:
        return im

    gmax = max(mx for _, mx, _ in rows)
    gmin = min(mn for _, _, mn in rows)
    xs = sorted(mx for _, mx, _ in rows)
    median_max = xs[len(xs)//2]
    ns = sorted(mn for _, _, mn in rows)
    median_min = ns[len(ns)//2]
    wall_r = [y for y, mx, _ in rows if mx >= gmax - 1] if gmax >= median_max + 36 else []
    wall_l = [y for y, _, mn in rows if mn <= gmin + 1] if gmin <= median_min - 36 else []
    # fluke is a short run, not a full-height hair edge
    bh = y1 - y0
    if len(wall_r) > int(bh * 0.28):
        wall_r = []
    if len(wall_l) > int(bh * 0.28):
        wall_l = []

    def paint_lobe(out, edge_x, ys, direction):
        op = out.load()
        y_lo, y_hi = min(ys), max(ys)
        mid = (y_lo + y_hi) / 2.0
        half = max(6, (y_hi - y_lo) / 2.0)
        for y in ys:
            t = abs(y - mid) / half
            reach = int(extra * max(0.12, 1.0 - t * t) * 0.98)
            srcx = edge_x if 0 <= edge_x < w else max(0, min(w - 1, edge_x))
            # sample a bit inward
            inward = -3 if direction > 0 else 3
            sx = max(0, min(w - 1, edge_x + inward))
            r, g, b, a = im.getpixel((sx, min(h - 1, y)))
            for k in range(1, reach + 1):
                fade = 1.0 - (k / float(reach + 1)) ** 1.35
                xx = edge_x + direction * k
                if xx < 0 or xx >= out.size[0] or y < 0 or y >= h:
                    continue
                aa = int(min(255, a * (0.45 + 0.55 * fade)))
                op[xx, y] = (r, g, b, aa)

    did = False
    out = im
    if len(wall_r) >= 8:
        out = Image.new("RGBA", (w + extra, h), (0, 0, 0, 0))
        out.paste(im, (0, 0))
        paint_lobe(out, gmax, wall_r, +1)
        did = True
        w, h = out.size
        im = out
        pix = im.load()
    if len(wall_l) >= 8 and gmin <= x0 + 2:
        pad = extra
        out2 = Image.new("RGBA", (im.size[0] + pad, im.size[1]), (0, 0, 0, 0))
        out2.paste(im, (pad, 0))
        # shift coords
        paint_lobe.__wrapped__ if False else None
        op = out2.load()
        y_lo, y_hi = min(wall_l), max(wall_l)
        mid = (y_lo + y_hi) / 2.0
        half = max(6, (y_hi - y_lo) / 2.0)
        edge = pad + gmin
        for y in wall_l:
            t = abs(y - mid) / half
            reach = int(extra * max(0.12, 1.0 - t * t) * 0.98)
            sx = min(im.size[0] - 1, max(0, gmin + 3))
            r, g, b, a = im.getpixel((sx, min(im.size[1] - 1, y)))
            for k in range(1, reach + 1):
                fade = 1.0 - (k / float(reach + 1)) ** 1.35
                xx = edge - k
                if xx < 0:
                    continue
                op[xx, y] = (r, g, b, int(min(255, a * (0.45 + 0.55 * fade))))
        out = out2
        did = True
    return out if did else im


def flood_from_seeds(im, seeds, allow):
    w, h = im.size
    pix = im.load()
    seen = bytearray(w * h)
    q = deque()
    for x, y in seeds:
        if 0 <= x < w and 0 <= y < h and allow(x, y, pix[x, y]) and not seen[y * w + x]:
            seen[y * w + x] = 1
            q.append((x, y))
    while q:
        x, y = q.popleft()
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, -1), (-1, 1), (1, 1)):
            nx, ny = x + dx, y + dy
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            i = ny * w + nx
            if seen[i] or not allow(nx, ny, pix[nx, ny]):
                continue
            seen[i] = 1
            q.append((nx, ny))
    m = Image.new("L", (w, h), 0)
    mp = m.load()
    for y in range(h):
        row = y * w
        for x in range(w):
            if seen[row + x]:
                mp[x, y] = 255
    return m


def split_layers(im: Image.Image, dname: str):
    bb = im.getbbox() or (0, 0, im.size[0], im.size[1])
    x0, y0, x1, y1 = bb
    bw, bh = x1 - x0, y1 - y0
    pad = 110
    canvas = Image.new("RGBA", (bw + pad * 2, bh + pad * 2), (0, 0, 0, 0))
    canvas.paste(im.crop(bb), (pad, pad))
    w, h = canvas.size
    pix = canvas.load()

    # --- ahoge: only the topmost 7.5% ---
    ahoge_y1 = pad + max(12, int(bh * 0.075))
    seeds = []
    for x in range(pad, pad + bw):
        for y in range(pad, ahoge_y1):
            if pix[x, y][3] > 40:
                seeds.append((x, y))
                break

    def allow_ahoge(x, y, p):
        return p[3] >= 20 and y <= pad + int(bh * 0.09)

    ahoge_m = flood_from_seeds(canvas, seeds, allow_ahoge) if seeds else Image.new("L", (w, h), 0)
    ab = ahoge_m.getbbox()
    if ab and (ab[2] - ab[0]) > bw * 0.55:
        # too wide = grabbed the whole hair; keep only the highest 55px blob
        ahoge_m = Image.new("L", (w, h), 0)
        ap = ahoge_m.load()
        for x, y in seeds:
            if y < pad + int(bh * 0.075):
                ap[x, y] = 255
        ahoge_m = flood_from_seeds(canvas, seeds[:], lambda x, y, p: p[3] >= 20 and y <= pad + int(bh * 0.07))
        ab = ahoge_m.getbbox()

    # --- tail: flood from the farthest lower protrusion ---
    ys0 = pad + int(bh * 0.40)
    rightmost = (-1, 0, 0)
    leftmost = (10**9, 0, 0)
    for y in range(ys0, pad + bh):
        for x in range(pad, pad + bw):
            if pix[x, y][3] > 40:
                if x > rightmost[0]:
                    rightmost = (x, y, pix[x, y])
                if x < leftmost[0]:
                    leftmost = (x, y, pix[x, y])
    cx = pad + bw // 2
    right_span = rightmost[0] - cx
    left_span = cx - leftmost[0]
    # official turnaround: tail is on the character's left = viewer's right when facing us
    FORCE_RIGHT = {"S": True, "SE": True, "W": True, "SW": True, "N": True}
    FORCE_LEFT = {"E": True, "NE": True, "NW": True}
    if dname in FORCE_RIGHT:
        tail_on_right = True
    elif dname in FORCE_LEFT:
        tail_on_right = False
    else:
        tail_on_right = right_span >= left_span
    tip = rightmost if tail_on_right else leftmost
    max_inward = int(bw * 0.42)

    def allow_tail(x, y, p):
        if p[3] < 20 or y < pad + int(bh * 0.32):
            return False
        if tail_on_right and x < tip[0] - max_inward:
            return False
        if (not tail_on_right) and x > tip[0] + max_inward:
            return False
        # don't climb into the head
        if y < pad + int(bh * 0.32):
            return False
        return True

    seeds_t = []
    if tip[0] < 10**9:
        tx, ty = tip[0], tip[1]
        for dy in range(-12, 13):
            for dx in range(-6, 7):
                seeds_t.append((tx + dx, ty + dy))
    tail_m = flood_from_seeds(canvas, seeds_t, allow_tail) if seeds_t else Image.new("L", (w, h), 0)
    tbox = tail_m.getbbox()
    if tbox:
        area = (tbox[2] - tbox[0]) * (tbox[3] - tbox[1])
        if area < (bw * bh) * 0.02 or area > (bw * bh) * 0.55:
            # retry with tighter inward
            def allow_tight(x, y, p):
                if p[3] < 20 or y < pad + int(bh * 0.38):
                    return False
                span = int(bw * 0.28)
                if tail_on_right and x < tip[0] - span:
                    return False
                if (not tail_on_right) and x > tip[0] + span:
                    return False
                return True

            tail_m = flood_from_seeds(canvas, seeds_t, allow_tight)
            tbox = tail_m.getbbox()
            if tbox:
                area = (tbox[2] - tbox[0]) * (tbox[3] - tbox[1])
                if area < (bw * bh) * 0.015:
                    tail_m = Image.new("L", (w, h), 0)
                    tbox = None

    body_m = Image.new("L", (w, h), 0)
    bp, tp, ap = body_m.load(), tail_m.load(), ahoge_m.load()
    for y in range(h):
        for x in range(w):
            if pix[x, y][3] > 20 and tp[x, y] < 128 and ap[x, y] < 128:
                bp[x, y] = 255

    def layer(mask):
        lay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        lay.paste(canvas, (0, 0), mask)
        return lay

    body, tail, ahoge = layer(body_m), layer(tail_m), layer(ahoge_m)
    if ab:
        ahoge_pivot = ((ab[0] + ab[2]) // 2, ab[3] - 1)
    else:
        ahoge_pivot = (w // 2, pad + int(bh * 0.06))
    if tbox:
        if tail_on_right:
            tail_pivot = (tbox[0] + max(6, (tbox[2] - tbox[0]) // 8), (tbox[1] + tbox[3]) // 2)
        else:
            tail_pivot = (tbox[2] - max(6, (tbox[2] - tbox[0]) // 8), (tbox[1] + tbox[3]) // 2)
    else:
        tail_pivot = (w // 2, pad + int(bh * 0.62))

    return {
        "canvas": canvas,
        "body": body,
        "tail": tail,
        "ahoge": ahoge,
        "ahoge_m": ahoge_m,
        "tail_m": tail_m,
        "ahoge_pivot": ahoge_pivot,
        "tail_pivot": tail_pivot,
        "foot": (pad + bw // 2, pad + bh),
        "pad": pad,
        "bw": bw,
        "bh": bh,
        "tail_on_right": tail_on_right,
        "dname": dname,
    }


def blink_on(body: Image.Image, dname: str) -> Image.Image:
    if dname == "N":
        return body
    im = body.copy()
    pix = im.load()
    bb = im.getbbox()
    if not bb:
        return im
    x0, y0, x1, y1 = bb
    fy0 = y0 + int((y1 - y0) * 0.17)
    fy1 = y0 + int((y1 - y0) * 0.34)
    fx0 = x0 + int((x1 - x0) * 0.28)
    fx1 = x0 + int((x1 - x0) * 0.72)
    pts = []
    for y in range(fy0, fy1):
        for x in range(fx0, fx1):
            r, g, b, a = pix[x, y]
            if a < 50:
                continue
            if b > 110 and b > r + 30 and b > g + 15 and r < 140 and g < 160:
                pts.append((x, y))
    if len(pts) < 25 or len(pts) > 4000:
        return im
    # split left/right of median x
    xs = sorted(p[0] for p in pts)
    mid = xs[len(xs) // 2]
    left = [p for p in pts if p[0] <= mid]
    right = [p for p in pts if p[0] > mid]
    draw = ImageDraw.Draw(im)

    def lid(cluster):
        if len(cluster) < 12:
            return
        xs = [p[0] for p in cluster]
        ys = [p[1] for p in cluster]
        ww = max(xs) - min(xs)
        hh = max(ys) - min(ys)
        if ww > 70 or hh > 40:
            return
        cy = (min(ys) + max(ys)) // 2
        draw.ellipse([min(xs), cy - 2, max(xs), cy + 4], fill=(32, 48, 96, 255))

    lid(left)
    lid(right)
    return im


def compose_pose(layers, tail_deg, ahoge_deg, body_sy, bob, blink, lean, dname):
    w, h = layers["canvas"].size
    body = layers["body"]
    if blink:
        body = blink_on(body, dname)
    if abs(body_sy - 1.0) > 0.001:
        fx, fy = layers["foot"]
        nh = max(1, int(round(h * body_sy)))
        scaled = body.resize((w, nh), Image.Resampling.BICUBIC)
        body2 = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        body2.paste(scaled, (0, fy - int(round(fy * body_sy))))
        body = body2
    tail = layers["tail"].rotate(
        tail_deg, resample=Image.Resampling.BICUBIC, center=layers["tail_pivot"], expand=False
    )
    ahoge = layers["ahoge"].rotate(
        ahoge_deg, resample=Image.Resampling.BICUBIC, center=layers["ahoge_pivot"], expand=False
    )
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.alpha_composite(body)
    out.alpha_composite(tail)
    out.alpha_composite(ahoge)
    if abs(lean) > 0.01:
        out = out.rotate(lean, resample=Image.Resampling.BICUBIC, center=layers["foot"], expand=False)
    if bob:
        shifted = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        shifted.paste(out, (0, -int(bob)))
        out = shifted
    foot = (layers["foot"][0], layers["foot"][1] - int(bob or 0))
    return out, foot


def paste_neg(dst, src, xy):
    x, y = xy
    sw, sh = src.size
    dw, dh = dst.size
    sx0, sy0 = max(0, -x), max(0, -y)
    dx0, dy0 = max(0, x), max(0, y)
    sx1, sy1 = min(sw, dw - x), min(sh, dh - y)
    if sx1 <= sx0 or sy1 <= sy0:
        return
    dst.alpha_composite(src.crop((sx0, sy0, sx1, sy1)), (dx0, dy0))


def place_anchored(im, foot, scale):
    nw = max(1, int(round(im.size[0] * scale)))
    nh = max(1, int(round(im.size[1] * scale)))
    resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
    fx = int(round(foot[0] * scale))
    fy = int(round(foot[1] * scale))
    cell = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    paste_neg(cell, resized, (CELL_W // 2 - fx, CELL_H - FOOT - fy))
    return cell


def scale_for(layers):
    # union of idle poses so a wagging tail still fits
    minx, miny, maxx, maxy = 10**9, 10**9, -1, -1
    for params in CLIPS["idle"]:
        pose, _ = compose_pose(layers, *params, layers["dname"])
        bb = pose.getbbox()
        if not bb:
            continue
        minx, miny = min(minx, bb[0]), min(miny, bb[1])
        maxx, maxy = max(maxx, bb[2]), max(maxy, bb[3])
    sw, sh = max(1, maxx - minx), max(1, maxy - miny)
    return min((CELL_W - 6) / float(sw), CHAR_H / float(sh))


def dark_preview(im, bg=(36, 36, 44, 255)):
    g = Image.new("RGBA", im.size, bg)
    g.alpha_composite(im.convert("RGBA"))
    return g


def mask_preview(canvas, mask, color):
    g = dark_preview(canvas)
    mp = mask.load()
    gp = g.load()
    w, h = canvas.size
    for y in range(h):
        for x in range(w):
            if mp[x, y] > 128:
                r, g0, b, a = gp[x, y]
                gp[x, y] = (
                    min(255, int(r * 0.4 + color[0] * 0.6)),
                    min(255, int(g0 * 0.4 + color[1] * 0.6)),
                    min(255, int(b * 0.4 + color[2] * 0.6)),
                    255,
                )
    return g


def main():
    layers = {}
    scales = {}
    for d in DIRS:
        path = STILLS[d]
        print("load", d, path.name)
        k = extend_clipped_tail(key_background(Image.open(path)))
        dark_preview(k).resize((220, int(220 * k.size[1] / max(1, k.size[0])))).save(DBG / f"keyed-{d}.png")
        L = split_layers(k, d)
        layers[d] = L
        scales[d] = scale_for(L)
        print(
            " ",
            d,
            "tail_right",
            L["tail_on_right"],
            "tail_bb",
            L["tail_m"].getbbox(),
            "ahoge_bb",
            L["ahoge_m"].getbbox(),
            "scale",
            round(scales[d], 4),
        )
        bb = L["canvas"].getbbox()
        crop = lambda im: im.crop(bb).resize((200, 320))
        crop(mask_preview(L["canvas"], L["tail_m"], (255, 60, 60))).save(DBG / f"mask-tail-{d}.png")
        crop(mask_preview(L["canvas"], L["ahoge_m"], (80, 220, 80))).save(DBG / f"mask-ahoge-{d}.png")

    for clip, frames in CLIPS.items():
        sheet = Image.new("RGBA", (CELL_W * 8, CELL_H * 4), (0, 0, 0, 0))
        for row, params in enumerate(frames):
            for col, d in enumerate(DIRS):
                pose, foot = compose_pose(layers[d], *params, d)
                cell = place_anchored(pose, foot, scales[d])
                sheet.paste(cell, (col * CELL_W, row * CELL_H), cell)
        sheet.save(OUT / f"{clip}.png", "PNG")
        print("wrote", clip)

    pose, foot = compose_pose(layers["S"], *CLIPS["idle"][0], "S")
    cell = place_anchored(pose, foot, scales["S"])
    g = Image.new("RGBA", (CELL_W, CELL_H), (40, 40, 48, 255))
    d = ImageDraw.Draw(g)
    d.rectangle([0, 0, CELL_W - 1, CELL_H - 1], outline=(180, 180, 190, 255))
    yb = CELL_H - FOOT
    d.line([(0, yb), (CELL_W, yb)], fill=(255, 80, 80, 255), width=1)
    d.line([(0, yb - CHAR_H), (CELL_W, yb - CHAR_H)], fill=(80, 180, 255, 255), width=1)
    g.alpha_composite(cell)
    g.save(OUT / "cell-guide.png")
    dark_preview(g).save(DBG / "cell-guide.png")

    face = cell.crop((18, 6, 110, 108)).resize((96, 96), Image.Resampling.LANCZOS)
    Path("/workspace/mystery-dungeon/assets/runtime/ui").mkdir(parents=True, exist_ok=True)
    face.save("/workspace/mystery-dungeon/assets/runtime/ui/avatar-face.png")

    strip = Image.new("RGBA", (CELL_W * 4, CELL_H), (36, 36, 44, 255))
    for i, params in enumerate(CLIPS["idle"]):
        pose, foot = compose_pose(layers["S"], *params, "S")
        c = place_anchored(pose, foot, scales["S"])
        bg = Image.new("RGBA", (CELL_W, CELL_H), (36, 36, 44, 255))
        bg.alpha_composite(c)
        strip.paste(bg, (i * CELL_W, 0))
    strip.save(DBG / "idle-S-strip.png")

    row = Image.new("RGBA", (CELL_W * 8, CELL_H), (36, 36, 44, 255))
    for i, d in enumerate(DIRS):
        pose, foot = compose_pose(layers[d], *CLIPS["idle"][0], d)
        c = place_anchored(pose, foot, scales[d])
        bg = Image.new("RGBA", (CELL_W, CELL_H), (36, 36, 44, 255))
        bg.alpha_composite(c)
        row.paste(bg, (i * CELL_W, 0))
    row.save(DBG / "idle-row0.png")
    print("debug", DBG)


if __name__ == "__main__":
    main()
