"""Coroid promo — particle and light effects (sprite/precomputation based).

Rendering is split into:
  * expensive per-look artifacts (orbs, glows, nebula, stars) precomputed
    once and reused every frame via cheap blits/rolls;
  * cheap per-frame dynamic layers (particles, streams) drawn at half
    resolution and upscaled.
"""
import math
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from common import W, H, _xx, _yy, _CX, _CY, font


def gaussian(arr, radius):
    if radius <= 0:
        return arr
    im = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(radius)), np.float32) / 255.0


# ---------------------------------------------------------------------------
# Blitting a sprite (RGBA float array) onto a frame
# ---------------------------------------------------------------------------
def blit(frame, sprite, cx, cy, alpha=1.0):
    """Add an RGBA sprite (float 0-1) centered at (cx,cy) onto frame.a."""
    s = sprite.shape[0]
    rgb = sprite[:, :, :3]
    a = sprite[:, :, 3:4] * alpha
    x0 = int(cx - s / 2)
    y0 = int(cy - s / 2)
    x1 = x0 + s
    y1 = y0 + s
    if x1 <= 0 or y1 <= 0 or x0 >= W or y0 >= H:
        return
    sx0, sy0 = max(0, -x0), max(0, -y0)
    sx1 = min(s, W - x0)
    sy1 = min(s, H - y0)
    if sx1 <= sx0 or sy1 <= sy0:
        return
    frame.a[y0 + sy0:y0 + sy1, x0 + sx0:x0 + sx1] += rgb[sy0:sy1, sx0:sx1] * a[sy0:sy1, sx0:sx1]


def blit_layer(layer, sprite, cx, cy, alpha=1.0):
    """Blit sprite into an RGB float layer (used without a Frame)."""
    s = sprite.shape[0]
    rgb = sprite[:, :, :3]
    a = sprite[:, :, 3:4] * alpha
    x0 = int(cx - s / 2)
    y0 = int(cy - s / 2)
    x1 = x0 + s
    y1 = y0 + s
    if x1 <= 0 or y1 <= 0 or x0 >= W or y0 >= H:
        return
    sx0, sy0 = max(0, -x0), max(0, -y0)
    sx1 = min(s, W - x0)
    sy1 = min(s, H - y0)
    if sx1 <= sx0 or sy1 <= sy0:
        return
    layer[y0 + sy0:y0 + sy1, x0 + sx0:x0 + sx1] += rgb[sy0:sy1, sx0:sx1] * a[sy0:sy1, sx0:sx1]


# ---------------------------------------------------------------------------
# Orb sprite (precomputed once per signature)
# ---------------------------------------------------------------------------
_ORB_CACHE = {}


def orb_sprite(r, color, seed=3, core=1.0, halo=1.0):
    """Return a cached RGBA float sprite of a luminous orb (square side 3.4r)."""
    rq = int(round(r / 20.0) * 20.0) or 20   # quantize to 20px to reuse sprites
    key = (rq, color, seed, round(core, 2), round(halo, 2))
    if key in _ORB_CACHE:
        return _ORB_CACHE[key]
    s = int(rq * 3.4)
    cx = cy = s / 2.0
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    rng = random.Random(seed)
    # base halo + core (use quantized rq for consistency)
    halom = np.exp(-((d / (rq * 1.7)) ** 2)) * halo
    corem = np.exp(-((d / (rq * 0.62)) ** 2)) * core * 1.6
    rgb = np.zeros((s, s, 3), np.float32)
    col = np.array(color, np.float32)
    for c in range(3):
        rgb[:, :, c] = corem * col[c] + halom * col[c] * 0.75
    # sparks via point splats
    for _ in range(120):
        ang = rng.uniform(0, 2 * math.pi)
        rr = rq * rng.uniform(0.7, 1.4)
        px = cx + math.cos(ang) * rr
        py = cy + math.sin(ang) * rr * 0.86
        pr = rng.uniform(1.5, 3.2)
        a_v = rng.uniform(0.15, 0.55)
        x0, y0 = int(px - pr * 2), int(py - pr * 2)
        x1, y1 = int(px + pr * 2) + 1, int(py + pr * 2) + 1
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(s, x1), min(s, y1)
        if x1 <= x0 or y1 <= y0:
            continue
        gy, gx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        sub = np.sqrt((gx - px) ** 2 + (gy - py) ** 2)
        wgt = np.exp(-((sub / pr) ** 2)) * a_v
        rgb[y0:y1, x0:x1] += wgt[..., None] * col[None, None, :] * 1.3
    alpha = np.clip(np.exp(-((d / (rq * 2.0)) ** 2)) * 2.0, 0, 1)
    spr = np.concatenate([np.clip(rgb, 0, 1.5), alpha[..., None]], axis=2)
    _ORB_CACHE[key] = spr.astype(np.float32)
    return _ORB_CACHE[key]


def orb(cx, cy, r, color, core=1.0, halo=1.0, seed=3):
    """Legacy full-frame orb (sprite + blit)."""
    spr = orb_sprite(r, color, seed=seed, core=core, halo=halo)
    layer = np.zeros((H, W, 3), np.float32)
    blit_layer(layer, spr, cx, cy)
    return layer


# ---------------------------------------------------------------------------
# Beam (vertical strip, rotated cheaply at use site)
# ---------------------------------------------------------------------------
_BEAM_CACHE = {}


def beam_sprite(length, spread, color, width=0.5, seed=5):
    key = (int(length), round(spread, 2), color, round(width, 2), seed)
    if key in _BEAM_CACHE:
        return _BEAM_CACHE[key]
    w = int(length * 2.4)
    h = int(length * 0.9)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx = xx - w * 0.55
    cy = yy - h / 2
    fall = np.clip(1 - np.clip(cx, 0, length) / length, 0, 1) ** 1.6
    g = np.exp(-((cy / (width * (0.35 + 0.65 * np.clip(cx, 0, length) / length + 1e-6))) ** 2))
    m = g * fall
    rgb = np.zeros((h, w, 3), np.float32)
    for c in range(3):
        rgb[:, :, c] = m * color[c] * 0.6
    alpha = np.clip(m, 0, 1)[..., None]
    spr = np.concatenate([np.clip(rgb, 0, 1), alpha], axis=2)
    _BEAM_CACHE[key] = spr
    return spr


def beam_frame(cx, cy, angle, length, spread, color, width=0.5, seed=5):
    """Blit a rotated beam sprite onto a full-frame layer."""
    spr = beam_sprite(length, spread, color, width=width, seed=seed)
    layer = np.zeros((H, W, 3), np.float32)
    # rotate via PIL
    h, w = spr.shape[0], spr.shape[1]
    pil = Image.fromarray((np.clip(spr, 0, 1) * 255).astype(np.uint8))
    ang_deg = math.degrees(angle)
    rot = pil.rotate(ang_deg, resample=Image.BICUBIC, expand=False)
    arr = np.asarray(rot, np.float32) / 255.0
    blit_layer(layer, arr, cx, cy)
    return layer


# ---------------------------------------------------------------------------
# Expanding ring (cheap low-res ring)
# ---------------------------------------------------------------------------
_GLOW_DOT_CACHE = {}


def glow_dot_sprite(r, color):
    """Cached soft radial glow sprite (side ~6r)."""
    key = (int(r), color)
    if key in _GLOW_DOT_CACHE:
        return _GLOW_DOT_CACHE[key]
    s = int(r * 2.0)
    cx = cy = s / 2.0
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    m = np.exp(-((d / (r * 0.45)) ** 2))
    rgb = np.zeros((s, s, 3), np.float32)
    for c in range(3):
        rgb[:, :, c] = m * color[c]
    spr = np.concatenate([np.clip(rgb, 0, 1), m[..., None]], axis=2)
    _GLOW_DOT_CACHE[key] = spr.astype(np.float32)
    return _GLOW_DOT_CACHE[key]


def ring(cx, cy, r, color, thickness=0.06, brightness=1.0):
    d = np.sqrt((_xx - cx) ** 2 + (_yy - cy) ** 2)
    m = np.exp(-(((d - r) / (thickness * r)) ** 2)) * brightness
    layer = np.zeros((H, W, 3), np.float32)
    for c in range(3):
        layer[:, :, c] = m * color[c]
    return layer


# ---------------------------------------------------------------------------
# Sparkles (cross glints) — direct PIL on full res, few points
# ---------------------------------------------------------------------------
def sparkles(points, color, layer=None):
    """Draw cross-shaped sparkle glints. points: list of (x,y,r,alpha)."""
    if layer is None:
        layer = np.zeros((H, W, 3), np.float32)
    if not points:
        return layer
    pil = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(pil)
    col = tuple(int(c * 255) for c in color)
    for (x, y, r, a) in points:
        a = int(min(255, a * 255))
        if a <= 0:
            continue
        w = max(1, int(r * 0.5))
        dr.line([x - r * 2.6, y, x + r * 2.6, y], fill=col + (a,), width=w)
        dr.line([x, y - r * 2.6, x, y + r * 2.6], fill=col + (a,), width=w)
        dr.ellipse([x - r, y - r, x + r, y + r], fill=col + (int(a * 0.7),))
    gl = np.asarray(pil, np.float32)[:, :, :3] / 255.0
    layer += gl
    return layer


def sparkles_multi(groups):
    """Draw many sparkle groups (each: (points, color)) in one PIL pass."""
    if not groups:
        return np.zeros((H, W, 3), np.float32)
    pil = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(pil)
    for (points, color) in groups:
        col = tuple(int(c * 255) for c in color)
        for (x, y, r, a) in points:
            a = int(min(255, a * 255))
            if a <= 0:
                continue
            w = max(1, int(r * 0.5))
            dr.line([x - r * 2.6, y, x + r * 2.6, y], fill=col + (a,), width=w)
            dr.line([x, y - r * 2.6, x, y + r * 2.6], fill=col + (a,), width=w)
            dr.ellipse([x - r, y - r, x + r, y + r], fill=col + (int(a * 0.7),))
    return np.asarray(pil, np.float32)[:, :, :3] / 255.0


# ---------------------------------------------------------------------------
# Data streams — low-res layer upscaled
# ---------------------------------------------------------------------------
def data_streams(n_cols=14, seed=11):
    rng = random.Random(seed)
    cols = []
    for _ in range(n_cols):
        cols.append({
            "x": rng.uniform(40, W - 40),
            "len": rng.uniform(160, 420),
            "speed": rng.uniform(0.6, 1.4),
            "phase": rng.uniform(0, 1),
            "bright": rng.uniform(0.5, 1.0),
        })
    return cols


_GLYPH_TILES = {}


def _glyph_tile(ch, color, size=14):
    key = (ch, color, size)
    if key not in _GLYPH_TILES:
        fnt = font("JetBrainsMono", size)
        bb = fnt.getbbox(ch)
        w = bb[2] - bb[0] + 4
        h = bb[3] - bb[1] + 4
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.text((-bb[0], -bb[1]) if bb[0] < 0 else (2, 2), ch, font=fnt, fill=color + (255,))
        _GLYPH_TILES[key] = im
    return _GLYPH_TILES[key]


def draw_streams(cols, t, color, glyphs="0123456789ABCDEF<>/\\|#*+=", cell=22):
    """Draw falling glyph columns at half res, upscaled to full res RGBA PIL."""
    sw, sh = W // 2, H // 2
    pil = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    dr = ImageDraw.Draw(pil)
    rng = random.Random(1234)
    scale = 0.5
    for col in cols:
        n = int(col["len"] // cell)
        offset = (t * col["speed"] * 60) % (n * cell)
        base_y = col["phase"] * H - offset
        x = col["x"] * scale
        for i in range(n):
            y = (base_y + i * cell) * scale
            if y < -30 or y > sh + 30:
                continue
            fade = 1.0 - (i / n)
            alpha = int(255 * col["bright"] * (0.25 + 0.75 * fade))
            if alpha <= 0:
                continue
            ch = glyphs[rng.randrange(len(glyphs))]
            if i == 0:
                tile = _glyph_tile(ch, (255, 255, 255), 14)
            else:
                c2 = tuple(int(c * 255 * (0.4 + 0.6 * fade)) for c in color)
                tile = _glyph_tile(ch, c2, 14)
            pil.alpha_composite(tile, (int(x - tile.width / 2), int(y - tile.height / 2)))
    return pil.resize((W, H), Image.BILINEAR)


# ---------------------------------------------------------------------------
# Particles — low-res upscaled
# ---------------------------------------------------------------------------
def make_particles(n=700, seed=9, region=(0, W, 0, H)):
    rng = random.Random(seed)
    x0, x1, y0, y1 = region
    return [{
        "x": rng.uniform(x0, x1),
        "y": rng.uniform(y0, y1),
        "z": rng.uniform(0.15, 1.0),
        "r": rng.uniform(0.6, 2.6),
        "ph": rng.uniform(0, 2 * math.pi),
        "sp": rng.uniform(0.4, 1.6),
        "color": rng.choice([(200, 160, 255), (120, 220, 255), (255, 255, 255), (255, 200, 130)]),
    } for _ in range(n)]


def draw_particles(parts, t, drift=(0, -14), twinkle=2.0, scale=0.5):
    sw, sh = int(W * scale), int(H * scale)
    pil = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    dr = ImageDraw.Draw(pil)
    s = scale
    for p in parts:
        x = (p["x"] + drift[0] * p["z"] * t * 60) % W
        y = (p["y"] + drift[1] * p["z"] * t * 60) % H
        b = 0.55 + 0.45 * math.sin(2 * math.pi * twinkle * t + p["ph"] * 6)
        a = int(255 * p["z"] * b)
        if a <= 0:
            continue
        r = max(1, int(p["r"] * (0.5 + 0.8 * p["z"]) * s))
        dr.ellipse([x * s - r, y * s - r, x * s + r, y * s + r], fill=p["color"] + (a,))
    return pil.resize((W, H), Image.BILINEAR)


# ---------------------------------------------------------------------------
# Connection lines between points
# ---------------------------------------------------------------------------
def connect(points, color, alpha=0.5):
    pil = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(pil)
    col = tuple(int(c * 255) for c in color)
    for i in range(len(points) - 1):
        x1, y1 = points[i]
        x2, y2 = points[i + 1]
        dr.line([x1, y1, x2, y2], fill=col + (int(255 * alpha),), width=1)
    return pil