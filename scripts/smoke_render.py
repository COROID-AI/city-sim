#!/usr/bin/env python3
"""Smoke render: verifies scene rendering executes and is deterministic.

Renders a representative frame from each scene twice and compares MD5 hashes
to prove determinism. Writes dist/frame_hashes.json consumed by
scripts/verify_output.js (AC-4).
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "promo"))

import numpy as np
import scenes as SC
from common import FPS, NF

DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist")
os.makedirs(DIST, exist_ok=True)

# One representative frame per scene (first, mid, last) + boundaries.
SAMPLE_FRAMES = sorted(set([0, 30, 90, 138, 150, 250, 300, 430, 500, 580, 650, 700, 800, 899]))


def render_bytes(fi):
    f = SC.render_scene(fi)
    return (np.clip(f.a, 0, 1) * 255.0 + 0.5).astype(np.uint8).tobytes()


def md5(b):
    return hashlib.md5(b).hexdigest()


def main():
    frames = []
    for fi in SAMPLE_FRAMES:
        b1 = render_bytes(fi)
        b2 = render_bytes(fi)
        h1, h2 = md5(b1), md5(b2)
        consistent = h1 == h2
        frames.append({"frame": fi, "hash": h1, "consistent": consistent})
        print(f"frame {fi:4d}  {h1[:12]}  consistent={consistent}", flush=True)
    manifest = {
        "resolution": "1920x1080",
        "fps": FPS,
        "total_frames": NF,
        "frames": frames,
    }
    out = os.path.join(DIST, "frame_hashes.json")
    with open(out, "w") as fh:
        json.dump(manifest, fh, indent=2)
    ok = all(fr["consistent"] for fr in frames)
    print(f"SMOKE {'OK' if ok else 'FAIL'} -> {out}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()