"""Coroid promo — scene renderers.

Each scene is a function `render(frame_index:int) -> Frame`. Scenes are
composed by the orchestrator with cinematic fades, grade, and letterbox.
"""
import math
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from common import (W, H, FPS, Frame, font, text_size, draw_text,
                    ease_out_cubic, ease_in_out_cubic, smoothstep, clamp,
                    lerp, pulse, C, VIOLET, VIOLET_L, CYAN, CYAN_D, MAGENTA,
                    GOLD, WHITE, INK, GREY, BG_DEEP, add_grain,
                    apply_vignette, letterbox, radial_mask, glow, from_pil)
import common as CM
import effects as FX
import typography as TY


def _base(t, color=None):
    f = Frame()
    if color is not None:
        f.a[:] = np.array(color, np.float32)
    return f


# Ambient drifting dust used to fill empty space in the "system" scenes.
_AMBIENT = FX.make_particles(520, seed=77, region=(0, W, 0, H))


def _add_ambient(frame, t, scale=0.5):
    pl = FX.draw_particles(_AMBIENT, t * 0.4, drift=(0, -20))
    frame.a += np.asarray(pl, np.float32)[:, :, :3] / 255.0 * scale
    return frame


# ===========================================================================
# SCENE 1 — COSMOS  (0.0 - 4.6s)
# "The intelligence behind everything"
# ===========================================================================
_STARS1 = CM.make_starfield(460, seed=7)

# precomputed nebula blobs
def _make_nebula(seed=3):
    rng = np.random.default_rng(seed)
    blobs = []
    for _ in range(26):
        blobs.append({
            "x": rng.uniform(0, W), "y": rng.uniform(0, H),
            "r": rng.uniform(160, 520),
            "col": rng.choice([(0.30, 0.14, 0.58), (0.08, 0.40, 0.55),
                               (0.45, 0.17, 0.42), (0.12, 0.22, 0.5)]),
            "a": rng.uniform(0.10, 0.30),
        })
    return blobs

_NEBULA = _make_nebula(3)
_NEBULA_IMG = None


def _make_nebula_static(seed=3):
    """Precompute a full nebula backdrop image (1x)."""
    rng = np.random.default_rng(seed)
    base = np.zeros((H, W, 3), np.float32)
    yy = np.linspace(0, 1, H)[:, None]
    base[:, :, 0] = 0.005 + 0.014 * yy
    base[:, :, 1] = 0.003 + 0.012 * yy
    base[:, :, 2] = 0.014 + 0.035 * yy
    blobs = _make_nebula(seed)
    for b in blobs:
        d = np.sqrt((_XX - b["x"]) ** 2 + (_YY - b["y"]) ** 2)
        m = np.exp(-((d / b["r"]) ** 2)) * b["a"]
        for c in range(3):
            base[:, :, c] += m * b["col"][c]
    return np.clip(base, 0, 1).astype(np.float32)


def _render_nebula(t, seed=3):
    """Render the cosmic nebula — precomputed once, scrolled per frame."""
    if _NEBULA_IMG is not None:
        # cheap horizontal scroll of the static backdrop
        ox = int(t * 8) % W
        return np.roll(_NEBULA_IMG, ox, axis=1)
    rng = np.random.default_rng(seed)
    base = np.zeros((H, W, 3), np.float32)
    # deep space gradient
    yy = np.linspace(0, 1, H)[:, None]
    base[:, :, 0] = 0.004 + 0.012 * yy
    base[:, :, 1] = 0.002 + 0.010 * yy
    base[:, :, 2] = 0.012 + 0.030 * yy
    dx = 14 * math.sin(t * 0.15)
    dy = 10 * math.cos(t * 0.11)
    for b in _NEBULA:
        cx = b["x"] + dx
        cy = b["y"] + dy
        d = np.sqrt((_XX - cx) ** 2 + (_YY - cy) ** 2)
        m = np.exp(-((d / b["r"]) ** 2)) * b["a"] * (0.85 + 0.15 * math.sin(t * 0.6 + b["x"]))
        for c in range(3):
            base[:, :, c] += m * b["col"][c]
    return np.clip(base, 0, 1)


_XX, _YY = np.mgrid[0:H, 0:W]


def scene1(fi):
    t = fi / FPS
    frame = _base(t)
    # nebula + starfield
    neb = _render_nebula(t)
    frame.a[:] = neb
    stars = CM.draw_starfield(None, _STARS1, t, drift=(6.0, 2.0))
    frame.a += np.asarray(stars, np.float32)[:, :, :3] / 255.0 * 0.9
    # central energy orb (slowly growing)
    orb_t = clamp((t - 0.3) / 3.4)
    orb_r = 150 + 90 * ease_out_cubic(orb_t)
    ox, oy = W / 2, H / 2 - 60
    orb_spr = FX.orb_sprite(int(orb_r), (0.48, 0.24, 0.92), seed=1, core=1.0, halo=0.7)
    FX.blit_layer(frame.a, orb_spr, ox, oy, alpha=0.9)
    # orbiting sparks around orb
    sp1 = []
    for i in range(3):
        ang = t * (0.8 + 0.3 * i) + i * 2.09
        rr = orb_r * (0.9 + 0.35 * i)
        px = ox + math.cos(ang) * rr
        py = oy + math.sin(ang) * rr * 0.72
        sp1.append((px, py, 6 + 3 * i, 0.7))
    frame.a += FX.sparkles_multi([(sp1, (0.62, 0.40, 1.0))]) * 0.9
    # ---- title ----
    if 0.9 <= t <= 4.4:
        p = ease_out_cubic(clamp((t - 0.9) / 1.0))
        # letter-spacing animation
        tracking = int(lerp(60, 6, p))
        fnt = font("Montserrat-Bold", 150)
        w, _ = text_size("COROID", fnt, tracking)
        # glow pulse
        gp = 0.5 + 0.5 * math.sin(2 * math.pi * (t - 0.9) / 1.6)
        TY.draw_glow_text(frame, (W / 2, oy + orb_r * 1.25), "COROID", fnt,
                          WHITE, glow_color=(124, 58, 237),
                          glow_radius=14, glow_intensity=0.7 + 0.6 * gp,
                          tracking=tracking, anchor="mm", alpha=p)
    # subtitle
    if 2.2 <= t <= 4.4:
        p = ease_out_cubic(clamp((t - 2.2) / 0.8))
        fnt = font("SpaceGrotesk", 54)
        TY.draw_glow_text(frame, (W / 2, H / 2 + 250), "THE INTELLIGENCE BEHIND EVERYTHING",
                          fnt, INK, glow_color=(140, 160, 255), glow_radius=5,
                          glow_intensity=0.5, anchor="mm", alpha=p * 0.9)
    # corner tag
    if t > 0.4:
        fnt = font("JetBrainsMono", 26)
        TY.draw_glow_text(frame, (70, 70), "COROID // 01", fnt, (150, 160, 180),
                          glow_color=(124, 58, 237), glow_radius=3, anchor="la")
    return frame


# ===========================================================================
# SCENE 2 — NETWORK  (4.6 - 9.6s)
# "One platform. Every system."
# ===========================================================================
def _network_graph(seed=5):
    rng = random.Random(seed)
    nodes = []
    for _ in range(14):
        ang = rng.uniform(0, 2 * math.pi)
        rr = rng.uniform(120, 360)
        nodes.append({
            "a0": ang, "r": rr, "sp": rng.uniform(0.4, 1.2),
            "ph": rng.uniform(0, 2 * math.pi),
            "s": rng.uniform(4, 9), "col": rng.choice([VIOLET, CYAN, MAGENTA, GOLD, VIOLET_L]),
        })
    # center hub
    return nodes


_NODES = _network_graph(5)


def scene2(fi):
    t = (fi / FPS) - 4.6
    frame = _base(t, (0.014, 0.010, 0.045))
    _add_ambient(frame, t, scale=0.5)
    # dark grid backdrop
    grid = _grid_layer(t * 0.3)
    frame.a += grid * 0.6
    cx, cy = W / 2, H / 2
    # compute node positions
    pts = []
    for n in _NODES:
        a = n["a0"] + t * n["sp"] * 0.5
        x = cx + math.cos(a) * n["r"]
        y = cy + math.sin(a) * n["r"] * 0.8
        pts.append((x, y, n))
    # connection lines (hub to all nodes) — batched single PIL pass
    conn_pil = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cdr = ImageDraw.Draw(conn_pil)
    for (x, y, n) in pts:
        cdr.line([cx, cy, x, y], fill=(116, 66, 235, 90), width=1)
    frame.a += np.asarray(conn_pil, np.float32)[:, :, :3] / 255.0 * 0.5
    # traveling pulse along each connection (batched sparkles)
    pulse_groups = []
    for (x, y, n) in pts:
        prog = (t * n["sp"] * 0.6 + n["ph"]) % 1.0
        px = lerp(cx, x, prog)
        py = lerp(cy, y, prog)
        pulse_groups.append(([(px, py, 4, 0.8)], n["col"]))
    frame.a += FX.sparkles_multi(pulse_groups) * 0.9
    # hub orb (sprite blit)
    hub = FX.orb_sprite(130, (0.5, 0.25, 0.95), seed=8, core=1.1, halo=0.8)
    FX.blit_layer(frame.a, hub, cx, cy, alpha=0.9)
    # nodes glow + sparkles (batched)
    node_groups = []
    for (x, y, n) in pts:
        b = 0.5 + 0.5 * math.sin(2 * math.pi * 1.2 * t + n["ph"])
        node_groups.append(([(x, y, n["s"], 0.5 + 0.5 * b)], n["col"]))
        FX.blit_layer(frame.a, FX.glow_dot_sprite(n["s"] * 7, n["col"]), x, y, alpha=0.5)
    frame.a += FX.sparkles_multi(node_groups) * 0.9
    # ---- text ----
    if 0.6 <= t <= 4.8:
        p = ease_out_cubic(clamp((t - 0.6) / 0.9))
        fnt = font("Montserrat-Bold", 118)
        TY.draw_glow_text(frame, (W / 2, 260), "ONE PLATFORM", fnt, WHITE,
                          glow_color=(124, 58, 237), glow_radius=12, anchor="mm", alpha=p)
    if 1.2 <= t <= 4.8:
        p = ease_out_cubic(clamp((t - 1.2) / 0.9))
        fnt = font("SpaceGrotesk", 96)
        TY.draw_glow_text(frame, (W / 2, 380), "EVERY SYSTEM.", fnt, INK,
                          glow_color=(34, 211, 238), glow_radius=8, anchor="mm", alpha=p * 0.9)
    # corner tag
    fnt = font("JetBrainsMono", 26)
    TY.draw_glow_text(frame, (70, 70), "COROID // 02", fnt, (150, 160, 180),
                      glow_color=(34, 211, 238), glow_radius=3, anchor="la")
    return frame


def _grid_layer(t, lines=14):
    """Perspective-ish grid receding to a vanishing point."""
    layer = np.zeros((H, W, 3), np.float32)
    vx, vy = W / 2, H / 2
    dr = ImageDraw.Draw(Image.new("RGBA", (W, H), (0, 0, 0, 0)))
    pil = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(pil)
    col = (70, 60, 120)
    # radial lines
    for i in range(12):
        a = i * 2 * math.pi / 12 + t * 0.02
        x2 = vx + math.cos(a) * 1400
        y2 = vy + math.sin(a) * 1400
        d.line([vx, vy, x2, y2], fill=col + (40,), width=1)
    # concentric rings
    for r in range(2, 16):
        rp = r * 60
        bbox = [vx - rp, vy - rp, vx + rp, vy + rp]
        d.ellipse(bbox, outline=col + (36,), width=1)
    arr = np.asarray(pil, np.float32)[:, :, :3] / 255.0
    return arr


# ===========================================================================
# SCENE 3 — DATA  (9.6 - 14.6s)
# "See what's invisible"
# ===========================================================================
_STREAMS = FX.data_streams(16, seed=21)


def scene3(fi):
    t = (fi / FPS) - 9.6
    frame = _base(t, (0.016, 0.012, 0.040))
    _add_ambient(frame, t, scale=0.5)
    # data streams behind
    sl = FX.draw_streams(_STREAMS, t, color=(0.25, 0.9, 0.95))
    frame.a += np.asarray(sl, np.float32)[:, :, :3] / 255.0 * 0.8
    # rising bar chart (animated)
    bars = _bars(t)
    frame.a += bars
    # big live counters
    if 0.5 <= t <= 4.8:
        p = ease_out_cubic(clamp((t - 0.5) / 0.8))
        fnt = font("SpaceGrotesk", 100)
        TY.draw_glow_text(frame, (W / 2, 300), "SEE WHAT'S", fnt, WHITE,
                          glow_color=(34, 211, 238), glow_radius=10, anchor="mm", alpha=p)
    if 1.1 <= t <= 4.8:
        p = ease_out_cubic(clamp((t - 1.1) / 0.8))
        fnt = font("SpaceGrotesk", 100)
        TY.draw_glow_text(frame, (W / 2, 420), "INVISIBLE", fnt, INK,
                          glow_color=(124, 58, 237), glow_radius=8, anchor="mm", alpha=p * 0.95)
    # HUD counters
    if t > 1.0:
        _draw_data_hud(frame, t)
    fnt = font("JetBrainsMono", 26)
    TY.draw_glow_text(frame, (70, 70), "COROID // 03", fnt, (150, 160, 180),
                      glow_color=(34, 211, 238), glow_radius=3, anchor="la")
    return frame


def _bars(t):
    """Animated ascending bar chart bottom area."""
    layer = np.zeros((H, W, 3), np.float32)
    nb = 24
    bw = 44
    gap = 12
    total = nb * (bw + gap)
    x0 = (W - total) / 2
    base_y = H - 140
    rng = random.Random(99)
    heights = [rng.uniform(80, 360) for _ in range(nb)]
    for i, h in enumerate(heights):
        grow = ease_out_cubic(clamp((t - 0.2 - i * 0.05) / 0.9))
        hh = h * grow
        x = x0 + i * (bw + gap)
        # gradient fill vertical
        col = (0.40, 0.24, 0.95) if i % 3 != 0 else (0.12, 0.65, 0.95)
        y0 = int(base_y - hh)
        y1 = int(base_y)
        if y1 <= y0:
            continue
        xi, xj = int(x), int(x + bw)
        for c in range(3):
            layer[y0:y1, xi:xj, c] = col[c] * 0.75
        # bright cap on top row of each bar
        if y0 - 1 >= 0:
            layer[y0 - 1:y0 + 1, xi:xj] += np.array(col, np.float32)[None, :] * 1.1
    return layer


def _draw_data_hud(frame, t):
    """Small HUD stat readouts bottom-left."""
    x, y = 120, H - 150
    stats = [
        ("THROUGHPUT", f"{int(820 + 40 * math.sin(t * 3)):,} GB/s", CYAN),
        ("LATENCY", f"{int(12 + 3 * math.sin(t * 5))} ms", VIOLET_L),
        ("UPTIME", "99.999%", GOLD),
    ]
    TY.draw_hud_box(frame, x - 20, y - 40, 560, 150, (124, 58, 237), alpha=0.30)
    for i, (label, val, col) in enumerate(stats):
        yy = y + i * 46
        fnt_l = font("JetBrainsMono", 22)
        fnt_v = font("JetBrainsMono", 30)
        TY.draw_glow_text(frame, (x, yy), label, fnt_l, GREY, glow_color=col, glow_radius=2, anchor="la")
        TY.draw_glow_text(frame, (x + 300, yy), val, fnt_v, INK, glow_color=col, glow_radius=3, anchor="ra")


# ===========================================================================
# SCENE 4 — CONTROL  (14.6 - 19.6s)
# "Command your world"
# ===========================================================================
def scene4(fi):
    t = (fi / FPS) - 14.6
    frame = _base(t, (0.014, 0.010, 0.045))
    _add_ambient(frame, t, scale=0.5)
    cx, cy = W / 2, H / 2
    # rotating HUD rings + crosshair — all in ONE PIL pass
    pil = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(pil)
    for i, (rr, col, spd) in enumerate([(330, CYAN, 0.12), (400, VIOLET_L, -0.08), (470, MAGENTA, 0.05)]):
        ccol = tuple(int(c * 255) for c in col) + (220,)
        for seg in range(3):
            a0 = t * spd * 2 * math.pi + seg * 2.09
            _draw_arc(d, cx, cy, rr, a0, a0 + 1.1, ccol, 6)
    # crosshair + scan line
    ch_col = (150, 200, 255)
    scan_y = (H / 2 + 300 * math.sin(t * 0.9)) % H
    d.line([0, scan_y, W, scan_y], fill=ch_col + (60,), width=2)
    for ang, rr in [(0, 150), (math.pi / 2, 150)]:
        d.line([cx, cy, cx + math.cos(ang) * rr, cy + math.sin(ang) * rr], fill=ch_col + (180,), width=2)
    frame.a += np.asarray(pil, np.float32)[:, :, :3] / 255.0 * 0.9
    # center core (sprite blit)
    core = FX.orb_sprite(120, (0.5, 0.27, 0.95), seed=12, core=1.2, halo=0.8)
    FX.blit_layer(frame.a, core, cx, cy, alpha=0.9)
    # rotating satellite nodes
    sat_pts = []
    for i in range(6):
        a = t * 0.9 + i * 1.047
        px = cx + math.cos(a) * 290
        py = cy + math.sin(a) * 290 * 0.8
        sat_pts.append((px, py, 5, 0.7))
    frame.a += FX.sparkles_multi([(sat_pts, (200, 160, 255))]) * 0.9
    # ---- text ----
    if 0.5 <= t <= 4.8:
        p = ease_out_cubic(clamp((t - 0.5) / 0.9))
        fnt = font("Montserrat-Bold", 118)
        TY.draw_glow_text(frame, (W / 2, 250), "COMMAND", fnt, WHITE,
                          glow_color=(124, 58, 237), glow_radius=12, anchor="mm", alpha=p)
    if 1.1 <= t <= 4.8:
        p = ease_out_cubic(clamp((t - 1.1) / 0.9))
        fnt = font("SpaceGrotesk", 96)
        TY.draw_glow_text(frame, (W / 2, 370), "YOUR WORLD", fnt, INK,
                          glow_color=(34, 211, 238), glow_radius=8, anchor="mm", alpha=p * 0.9)
    fnt = font("JetBrainsMono", 26)
    TY.draw_glow_text(frame, (70, 70), "COROID // 04", fnt, (150, 160, 180),
                      glow_color=(124, 58, 237), glow_radius=3, anchor="la")
    return frame


def _draw_arc(d, cx, cy, r, a0, a1, col, width):
    n = 60
    pts = []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    d.line(pts, fill=col, width=width, joint="curve")


# ===========================================================================
# SCENE 5 — IMPACT  (19.6 - 24.6s)
# "Built for what matters"
# ===========================================================================
_PART5 = FX.make_particles(650, seed=31)


def scene5(fi):
    t = (fi / FPS) - 19.6
    frame = _base(t, (0.010, 0.006, 0.030))
    cx, cy = W / 2, H / 2 - 40
    # converging particles
    pl = FX.draw_particles(_PART5, t, drift=(0, -30))
    frame.a += np.asarray(pl, np.float32)[:, :, :3] / 255.0 * 0.5
    # energy surge: expanding rings — batched into one PIL
    ring_pil = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring_pil)
    ring_col = (126, 64, 242, 255)
    for i in range(4):
        ph = (t * 0.5 + i * 0.25) % 1.0
        r = 60 + ph * 520
        b = (1 - ph) ** 2
        if b < 0.05:
            continue
        a = int(200 * b)
        rd.ellipse([cx - r, cy - r, cx + r, cy + r], outline=ring_col[:3] + (a,), width=3)
    frame.a += np.asarray(ring_pil, np.float32)[:, :, :3] / 255.0 * 1.0
    # central burst (sprite)
    burst = FX.orb_sprite(200, (0.55, 0.28, 0.98), seed=14, core=1.2, halo=0.9)
    FX.blit_layer(frame.a, burst, cx, cy, alpha=0.9)
    # golden sparks (batched)
    sp5 = []
    for i in range(8):
        a = t * 0.7 + i * 0.785
        px = cx + math.cos(a) * 260
        py = cy + math.sin(a) * 200
        sp5.append((px, py, 5, 0.6))
    frame.a += FX.sparkles_multi([(sp5, (1.0, 0.79, 0.3))]) * 0.9
    # ---- text ----
    if 0.5 <= t <= 4.8:
        p = ease_out_cubic(clamp((t - 0.5) / 0.9))
        fnt = font("Montserrat-Bold", 118)
        TY.draw_glow_text(frame, (W / 2, 240), "BUILT FOR", fnt, WHITE,
                          glow_color=(255, 201, 77), glow_radius=12, anchor="mm", alpha=p)
    if 1.1 <= t <= 4.8:
        p = ease_out_cubic(clamp((t - 1.1) / 0.9))
        fnt = font("SpaceGrotesk", 96)
        TY.draw_glow_text(frame, (W / 2, 360), "WHAT MATTERS", fnt, INK,
                          glow_color=(124, 58, 237), glow_radius=8, anchor="mm", alpha=p * 0.9)
    fnt = font("JetBrainsMono", 26)
    TY.draw_glow_text(frame, (70, 70), "COROID // 05", fnt, (150, 160, 180),
                      glow_color=(255, 201, 77), glow_radius=3, anchor="la")
    return frame


# ===========================================================================
# SCENE 6 — LOGO LOCKUP  (24.6 - 30.0s)
# ===========================================================================
_STARS6 = CM.make_starfield(300, seed=41)


def scene6(fi):
    t = (fi / FPS) - 24.6
    frame = _base(t)
    neb = _render_nebula(0.6 + t * 0.1, seed=9)
    frame.a[:] = neb
    stars = CM.draw_starfield(None, _STARS6, t, drift=(3.0, 1.0))
    frame.a += np.asarray(stars, np.float32)[:, :, :3] / 255.0 * 0.8
    # subtle center glow
    if t > 0.2:
        g = FX.orb_sprite(300, (0.4, 0.2, 0.85), seed=17, core=0.6, halo=0.5)
        FX.blit_layer(frame.a, g, W / 2, H / 2 - 40, alpha=0.5)
    # ---- logo ----
    if 0.3 <= t <= 5.2:
        p = ease_out_cubic(clamp((t - 0.3) / 1.1))
        tracking = int(lerp(50, 8, p))
        fnt = font("Montserrat-Bold", 170)
        glowc = (124, 58, 237)
        gp = 0.6 + 0.4 * math.sin(2 * math.pi * (t - 0.3) / 2.2)
        TY.draw_glow_text(frame, (W / 2, H / 2 - 60), "COROID", fnt, WHITE,
                          glow_color=glowc, glow_radius=18, glow_intensity=0.6 + 0.7 * gp,
                          tracking=tracking, anchor="mm", alpha=p)
    # tagline
    if 1.0 <= t <= 5.2:
        p = ease_out_cubic(clamp((t - 1.0) / 0.9))
        fnt = font("SpaceGrotesk", 52)
        TY.draw_glow_text(frame, (W / 2, H / 2 + 120), "INTELLIGENCE FOR EVERYTHING",
                          fnt, INK, glow_color=(140, 160, 255), glow_radius=5, anchor="mm", alpha=p * 0.9)
    # url
    if 1.6 <= t <= 5.2:
        p = ease_out_cubic(clamp((t - 1.6) / 0.9))
        fnt = font("JetBrainsMono", 40)
        TY.draw_glow_text(frame, (W / 2, H / 2 + 220), "coroid.ai", fnt, (120, 220, 255),
                          glow_color=(34, 211, 238), glow_radius=5, anchor="mm", alpha=p)
    # CTA pill
    if 2.2 <= t <= 5.2:
        p = ease_out_cubic(clamp((t - 2.2) / 0.8))
        TY.draw_pill(frame, W / 2, H / 2 + 320, 360, 66, (124, 58, 237), alpha=0.8 * p)
        fnt = font("Montserrat-SemiBold", 34)
        TY.draw_glow_text(frame, (W / 2, H / 2 + 320), "EXPLORE THE FUTURE", fnt, WHITE,
                          glow_color=None, anchor="mm", alpha=p)
    # corner
    fnt = font("JetBrainsMono", 26)
    TY.draw_glow_text(frame, (70, 70), "COROID // 06", fnt, (150, 160, 180),
                      glow_color=(124, 58, 237), glow_radius=3, anchor="la")
    return frame


# ===========================================================================
# Registry
# ===========================================================================
SCENES = [
    (0.0, 4.6, scene1),
    (4.6, 9.6, scene2),
    (9.6, 14.6, scene3),
    (14.6, 19.6, scene4),
    (19.6, 24.6, scene5),
    (24.6, 30.0, scene6),
]

# precompute the static nebula backdrops once
_NEBULA_IMG = _make_nebula_static(3)


def render_scene(fi):
    """Route a frame index to its scene. Returns the raw scene Frame."""
    t = fi / FPS
    for (t0, t1, fn) in SCENES:
        if t0 <= t < t1:
            return fn(fi)
    # fallback: last scene
    return scene6(fi)