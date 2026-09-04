"""Coroid promo — typography and compositing helpers.

Gradient fills, glow text, animated counters, and motion-graphic
primitives drawn on top of the float RGB frame.
"""
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from common import (W, H, font, text_size, draw_text, render_text_layer,
                    ease_out_cubic, ease_in_out_cubic, smoothstep, clamp,
                    lerp, gaussian)


def _to_pil_layer(arr):
    return Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))


def _from_pil_layer(im):
    return np.asarray(im.convert("RGB"), np.float32) / 255.0


# ---------------------------------------------------------------------------
# Gradient fills
# ---------------------------------------------------------------------------
def gradient_text(text, fnt, colors, angle_deg=90, tracking=0):
    """Render text filled with a linear gradient between colors."""
    layer = render_text_layer(text, fnt, (255, 255, 255), tracking=tracking)
    w, h = layer.size
    grad = np.zeros((h, w, 3), np.float32)
    a = math.radians(angle_deg)
    ca, sa = math.cos(a), math.sin(a)
    cx, cy = w / 2, h / 2
    yy, xx = np.mgrid[0:h, 0:w]
    # project onto gradient axis
    proj = (xx - cx) * ca + (yy - cy) * sa
    span = (abs(ca) * w + abs(sa) * h) / 2
    t = np.clip((proj + span) / (2 * span), 0, 1)
    n = len(colors)
    tscaled = t * (n - 1)
    i0 = np.clip(np.floor(tscaled).astype(np.int32), 0, n - 2)
    i1 = i0 + 1
    f = (tscaled - i0)[..., None]
    c0 = np.array(colors[: n - 1], np.float32) / 255.0
    c1 = np.array(colors[1:], np.float32) / 255.0
    grad = c0[i0] * (1 - f) + c1[i0] * f
    alpha = np.asarray(layer)[:, :, 3:4].astype(np.float32) / 255.0
    out = np.zeros((h, w, 3), np.float32)
    out += grad * alpha
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).convert("RGBA"), layer


def gradient_rect(w, h, colors, angle_deg=90):
    """Solid gradient rectangle as RGBA PIL image."""
    grad = np.zeros((h, w, 3), np.float32)
    a = math.radians(angle_deg)
    ca, sa = math.cos(a), math.sin(a)
    cx, cy = w / 2, h / 2
    yy, xx = np.mgrid[0:h, 0:w]
    proj = (xx - cx) * ca + (yy - cy) * sa
    span = (abs(ca) * w + abs(sa) * h) / 2
    t = np.clip((proj + span) / (2 * span), 0, 1)
    n = len(colors)
    tscaled = t * (n - 1)
    i0 = np.clip(np.floor(tscaled).astype(np.int32), 0, n - 2)
    i1 = i0 + 1
    f = (tscaled - i0)[..., None]
    c0 = np.array(colors[: n - 1], np.float32) / 255.0
    c1 = np.array(colors[1:], np.float32) / 255.0
    grad = c0[i0] * (1 - f) + c1[i0] * f
    arr = np.dstack([grad, np.ones((h, w, 1), np.float32)])
    return Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8)).convert("RGBA")


# ---------------------------------------------------------------------------
# Glow text
# ---------------------------------------------------------------------------
def draw_glow_text(frame, xy, text, fnt, fill, glow_color=None, glow_radius=6,
                   glow_intensity=1.0, tracking=0, anchor=None, alpha=1.0):
    """Draw text with a soft glow onto the float frame."""
    layer = render_text_layer(text, fnt, fill, tracking=tracking)
    w, h = layer.size
    # glow
    if glow_color is not None and glow_radius > 0:
        g = layer.filter(ImageFilter.GaussianBlur(glow_radius))
        g = g.point(lambda p: p * glow_intensity)
        garr = np.asarray(g, np.float32) / 255.0
        gc = np.array(glow_color, np.float32) / 255.0
        gw = garr[:, :, 3:4] * gc[None, None, :]
        # paste glow
        x0, y0 = _anchor_xy(xy, w, h, anchor)
        _paste(frame, gw, x0, y0, alpha)
    arr = np.asarray(layer, np.float32) / 255.0
    rgb = arr[:, :, :3] * arr[:, :, 3:4]
    x0, y0 = _anchor_xy(xy, w, h, anchor)
    _paste(frame, rgb, x0, y0, alpha)
    return frame


def _anchor_xy(xy, w, h, anchor):
    x, y = xy
    if anchor and "m" in anchor:
        x -= w / 2
    if anchor and "m" in anchor[1:2]:
        y -= h / 2
    return int(round(x)), int(round(y))


def _paste(frame, arr, x, y, alpha=1.0):
    """Add arr (RGB float) at integer offset with additive alpha."""
    h, w = arr.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return
    src = arr[y0 - y:y1 - y, x0 - x:x1 - x]
    frame.a[y0:y1, x0:x1] += src * alpha


# ---------------------------------------------------------------------------
# Counter
# ---------------------------------------------------------------------------
def draw_counter(frame, xy, value, fnt, fill, glow_color=None, tracking=0,
                 anchor="mm", decimals=0, prefix="", suffix=""):
    s = prefix + (f"{value:,.{decimals}f}" if decimals else f"{int(round(value)):,}") + suffix
    draw_glow_text(frame, xy, s, fnt, fill, glow_color, tracking=tracking, anchor=anchor)
    return s


# ---------------------------------------------------------------------------
# Fitted text (auto scale to width)
# ---------------------------------------------------------------------------
def fit_font(text, max_w, name="Montserrat-Bold", start=160, min_size=24):
    size = start
    while size > min_size:
        f = font(name, size)
        w, _ = text_size(text, f)
        if w <= max_w:
            return f
        size -= 4
    return font(name, min_size)


# ---------------------------------------------------------------------------
# Motion graphics
# ---------------------------------------------------------------------------
def draw_scanline_bar(frame, cx, cy, w, h, color, alpha=0.9, glow=True):
    """Horizontal accent bar with gradient fade."""
    layer = np.zeros((H, W, 3), np.float32)
    x0, x1 = int(cx - w / 2), int(cx + w / 2)
    y0, y1 = int(cy - h / 2), int(cy + h / 2)
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(W, x1), min(H, y1)
    xs = np.arange(x0, x1)
    fade = np.sin(np.pi * (xs - x0) / max(1, x1 - x0 - 1)) ** 0.7
    for c in range(3):
        layer[y0:y1, x0:x1, c] = fade[None, :] * color[c] * alpha
    if glow:
        layer = gaussian(layer, 4)
    frame.a += layer
    return frame


def draw_vertical_rule(frame, x, y0, y1, color, alpha=0.7):
    layer = np.zeros((H, W, 3), np.float32)
    y0, y1 = int(y0), int(y1)
    ys = np.arange(y0, y1)
    fade = np.sin(np.pi * (ys - y0) / max(1, y1 - y0 - 1)) ** 0.7
    layer[y0:y1, x, :] = fade[:, None] * np.array(color, np.float32)[None, :] * alpha
    frame.a += layer
    return frame


def draw_animated_number(frame, cx, cy, value, prev, fnt, fill, glow_color,
                         tracking=0, t=0.0, duration=1.2):
    """Number that rolls/ticks toward `value`."""
    p = smoothstep(t / duration)
    disp = lerp(prev, value, p)
    draw_counter(frame, (cx, cy), disp, fnt, fill, glow_color, tracking=tracking)
    return disp


def draw_pill(frame, cx, cy, w, h, color, alpha=0.85, radius=None, glow=True):
    """Rounded pill behind content."""
    radius = radius if radius is not None else h / 2
    pil = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(pil)
    x0, y0 = int(cx - w / 2), int(cy - h / 2)
    col = tuple(int(c * 255) for c in color) + (int(255 * alpha),)
    dr.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=radius, fill=col)
    arr = np.asarray(pil, np.float32)[:, :, :3] / 255.0 * (np.asarray(pil, np.float32)[:, :, 3:4] / 255.0)
    if glow:
        arr = gaussian(arr, 3)
    frame.a += arr
    return frame


def draw_hud_box(frame, x, y, w, h, border_color, fill_color=(0, 0, 0), alpha=0.35, radius=10):
    """Glass HUD panel."""
    pil = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(pil)
    fill = tuple(int(c * 255) for c in fill_color) + (int(255 * alpha),)
    dr.rounded_rectangle([x, y, x + w, y + h], radius=radius, fill=fill,
                         outline=tuple(int(c * 255) for c in border_color) + (180,), width=2)
    arr = np.asarray(pil, np.float32)[:, :, :3] / 255.0 * (np.asarray(pil, np.float32)[:, :, 3:4] / 255.0)
    frame.a += arr
    return frame