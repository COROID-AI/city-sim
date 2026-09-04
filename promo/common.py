"""Coroid promo — shared design system, easing, and rendering primitives.

Everything is rendered procedurally with numpy + Pillow at 1920x1080@30fps.
This module holds the palette, fonts, easing, blending, and drawing helpers
used by the scene renderers.
"""
import os
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(ROOT, "fonts")

# ---------------------------------------------------------------------------
# Canvas / timing
# ---------------------------------------------------------------------------
W, H = 1920, 1080
FPS = 30
DUR = 30.0
NF = int(round(DUR * FPS))  # 900 frames

LETTERBOX = 74           # cinematic top/bottom bars (px)
VIS_H = H - 2 * LETTERBOX

# ---------------------------------------------------------------------------
# Palette (RGB 0-255)
# ---------------------------------------------------------------------------
BG_DEEP   = (4, 1, 12)       # near-black violet
VIOLET    = (124, 58, 237)   # electric violet
VIOLET_L  = (167, 139, 250)  # light violet
CYAN      = (34, 211, 238)   # cyan
CYAN_D    = (14, 165, 233)
MAGENTA   = (236, 72, 153)   # magenta
GOLD      = (255, 201, 77)
WHITE     = (255, 255, 255)
INK       = (238, 240, 246)  # off-white text
GREY      = (120, 126, 148)

# float 0-1 convenience
C = {k: tuple(v / 255.0 for v in val) for k, val in {
    "BG": BG_DEEP, "V": VIOLET, "VL": VIOLET_L, "C": CYAN,
    "CD": CYAN_D, "M": MAGENTA, "G": GOLD, "W": WHITE,
    "I": INK, "GR": GREY,
}.items()}

# ---------------------------------------------------------------------------
# Easing
# ---------------------------------------------------------------------------
def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def lerp(a, b, t):
    return a + (b - a) * t


def ease_out_cubic(t):
    t = clamp(t)
    return 1 - (1 - t) ** 3


def ease_in_cubic(t):
    t = clamp(t)
    return t ** 3


def ease_in_out_cubic(t):
    t = clamp(t)
    if t < 0.5:
        return 4 * t ** 3
    return 1 - ((-2 * t + 2) ** 3) / 2


def ease_out_expo(t):
    t = clamp(t)
    return 1.0 if t >= 1.0 else 1 - 2 ** (-10 * t)


def ease_in_out_sine(t):
    t = clamp(t)
    return -(math.cos(math.pi * t) - 1) / 2


def smoothstep(t):
    t = clamp(t)
    return t * t * (3 - 2 * t)


def pulse(t, lo=0.0, hi=1.0):
    """Smooth sine pulse in [lo, hi]."""
    return lo + (hi - lo) * (0.5 - 0.5 * math.cos(2 * math.pi * t))


# ---------------------------------------------------------------------------
# Fonts
# ---------------------------------------------------------------------------
_font_cache = {}


def font(name, size):
    key = (name, size)
    if key not in _font_cache:
        _font_cache[key] = ImageFont.truetype(os.path.join(FONTS, name + ".ttf"), size)
    return _font_cache[key]


def text_size(text, fnt, tracking=0):
    """Width/height of text including manual tracking."""
    if tracking == 0:
        bbox = fnt.getbbox(text)
        return bbox[2] - bbox[0], bbox[3] - bbox[1]
    w = 0
    for ch in text:
        bb = fnt.getbbox(ch)
        w += (bb[2] - bb[0]) + tracking
    return w - tracking, fnt.getbbox(text)[3] - fnt.getbbox(text)[1]


def draw_text(draw, xy, text, fnt, fill, tracking=0, anchor=None):
    """Draw text with optional manual letter tracking (px)."""
    if tracking == 0:
        draw.text(xy, text, font=fnt, fill=fill, anchor=anchor)
        return
    x, y = xy
    if anchor and "m" in anchor:
        w, _ = text_size(text, fnt, tracking)
        x -= w / 2
    if anchor and "m" in anchor[1:2]:
        _, h = text_size(text, fnt, tracking)
        y -= h / 2
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        bb = fnt.getbbox(ch)
        x += (bb[2] - bb[0]) + tracking


def render_text_layer(text, fnt, fill=(255, 255, 255), tracking=0):
    """Render text onto a transparent RGBA layer (for gradient/glow use)."""
    w, h = text_size(text, fnt, tracking)
    pad = 8
    layer = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    draw_text(d, (pad, pad), text, fnt, fill, tracking=tracking)
    return layer


# ---------------------------------------------------------------------------
# Frame buffer
# ---------------------------------------------------------------------------
class Frame:
    """Float RGB (0-1) HxWx3 buffer with blending helpers."""

    def __init__(self, arr=None):
        self.a = arr if arr is not None else np.zeros((H, W, 3), np.float32)

    def copy(self):
        return Frame(self.a.copy())

    def to_pil(self):
        return Image.fromarray((np.clip(self.a, 0, 1) * 255.0 + 0.5).astype(np.uint8)).convert("RGB")

    def from_pil(self, im):
        self.a = np.asarray(im.convert("RGB"), np.float32) / 255.0
        return self

    def add_(self, other, amount=1.0):
        self.a += other * amount
        return self


def from_pil(im):
    return Frame(np.asarray(im.convert("RGB"), np.float32) / 255.0)


# ---------------------------------------------------------------------------
# Blending
# ---------------------------------------------------------------------------
def add(a, b):
    return a + b


def screen(a, b):
    return 1 - (1 - a) * (1 - b)


def soft_light(a, b):
    """b is the 'light' layer (0-1)."""
    out = np.empty_like(a)
    lo = b <= 0.5
    out[lo] = a[lo] - (1 - 2 * b[lo]) * a[lo] * (1 - a[lo])
    hi = ~lo
    out[hi] = a[hi] + (2 * b[hi] - 1) * (np.sqrt(a[hi]) - a[hi])
    return out


def blend(base, top, mode="add", alpha=1.0):
    """Composite top (float 0-1) over base using a blend mode."""
    if mode == "add":
        return base + top * alpha
    if mode == "screen":
        return 1 - (1 - base) * (1 - top * alpha)
    if mode == "soft":
        return soft_light(base, top * alpha)
    if mode == "over":
        return base * (1 - alpha) + top * alpha
    return base + top * alpha


# ---------------------------------------------------------------------------
# Effects
# ---------------------------------------------------------------------------
def gaussian(arr, radius):
    if radius <= 0:
        return arr
    im = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(radius)), np.float32) / 255.0


def blur_layer(arr, radius):
    return gaussian(arr, radius)


def glow(mask, color, radius, intensity=1.0):
    """Build a colored glow RGB layer from a float 0-1 mask."""
    if radius <= 0:
        base = mask
    else:
        im = Image.fromarray((np.clip(mask, 0, 1) * 255).astype(np.uint8))
        base = np.asarray(im.filter(ImageFilter.GaussianBlur(radius)), np.float32) / 255.0
    layer = np.zeros((H, W, 3), np.float32)
    color = np.array(color, np.float32) / 255.0
    for c in range(3):
        layer[:, :, c] = base * color[c] * intensity
    return layer


# precomputed vignette (dark edges) and radial mask
_yy, _xx = np.mgrid[0:H, 0:W]
_CX, _CY = W / 2.0, H / 2.0
_dist = np.sqrt((_xx - _CX) ** 2 + (_yy - _CY) ** 2)
VIGNETTE = 1.0 - 0.62 * np.clip((_dist / (W * 0.72)) ** 1.7, 0, 1)
VIGNETTE = VIGNETTE.astype(np.float32)


def apply_vignette(frame, strength=1.0):
    frame.a *= (1.0 - strength * (1.0 - VIGNETTE))[..., None]
    return frame


def add_grain(frame, amount=0.012, seed=None):
    rng = np.random.default_rng(seed)
    g = rng.standard_normal((H, W, 3)).astype(np.float32) * amount
    frame.a += g
    return frame


def letterbox(frame, bar=LETTERBOX):
    frame.a[:bar, :, :] = 0.0
    frame.a[H - bar:, :, :] = 0.0
    return frame


def radial_mask(cx, cy, r_outer, r_inner=0.0, soft=0.0):
    """Soft circular mask centered at (cx,cy)."""
    d = np.sqrt((_xx - cx) ** 2 + (_yy - cy) ** 2)
    m = np.clip((r_outer - d) / max(soft, 1e-6), 0, 1)
    if r_inner > 0:
        m *= np.clip((d - r_inner) / max(soft, 1e-6), 0, 1)
    return m.astype(np.float32)


# ---------------------------------------------------------------------------
# Starfield / particle helpers
# ---------------------------------------------------------------------------
def make_starfield(n=420, seed=7):
    rng = np.random.default_rng(seed)
    stars = []
    for _ in range(n):
        stars.append({
            "x": rng.uniform(0, W),
            "y": rng.uniform(0, H),
            "z": rng.uniform(0.25, 1.0),      # depth -> parallax speed
            "r": rng.uniform(0.5, 2.2),
            "b": rng.uniform(0.25, 1.0),
            "ph": rng.uniform(0, 2 * math.pi),
            "tw": rng.uniform(0.5, 2.0),
            "hue": rng.choice(["w", "v", "c", "g"], p=[0.55, 0.2, 0.15, 0.1]),
        })
    return stars


_STARFIELD_CACHE = {}


def starfield_base(stars):
    """Precompute a static star layer (no drift/twinkle)."""
    key = id(stars)
    if key in _STARFIELD_CACHE:
        return _STARFIELD_CACHE[key]
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for s in stars:
        x = s["x"]
        y = s["y"]
        b = s["b"]
        if b < 0.08:
            continue
        col = {"w": (255, 255, 255), "v": (190, 160, 255),
               "c": (150, 220, 255), "g": (255, 220, 160)}[s["hue"]]
        r = s["r"] * (0.5 + 0.6 * b)
        a = int(255 * min(1.0, b))
        d.ellipse([x - r, y - r, x + r, y + r], fill=col + (a,))
        if b > 0.8 and r > 1.2:
            d.line([x - 3 * r, y, x + 3 * r, y], fill=col + (int(a * 0.35),))
            d.line([x, y - 3 * r, x, y + 3 * r], fill=col + (int(a * 0.35),))
    arr = np.asarray(layer, np.float32)[:, :, :3] / 255.0
    _STARFIELD_CACHE[key] = arr
    return arr


def draw_starfield(frame, stars, t, drift=(3.0, 1.2), twinkle=True):
    """Draw a drifting, twinkling starfield onto an RGBA PIL layer."""
    # fast path: precomputed star layer, rolled cheaply
    arr = starfield_base(stars)
    oz = int((drift[0] * t) % W)
    oy = int((drift[1] * t) % H)
    rolled = np.roll(np.roll(arr, oz, axis=1), oy, axis=0)
    layer = Image.fromarray((np.clip(rolled, 0, 1) * 255).astype(np.uint8)).convert("RGBA")
    return layer


def add_points(acc, ys, xs, vals):
    """Accumulate (y,x) points with values into an (H,W) float array."""
    np.add.at(acc, (np.clip(np.round(ys).astype(np.int64), 0, H - 1),
                    np.clip(np.round(xs).astype(np.int64), 0, W - 1)), vals)


def colorize_mask(mask, color):
    layer = np.zeros((H, W, 3), np.float32)
    for c in range(3):
        layer[:, :, c] = mask * color[c]
    return layer