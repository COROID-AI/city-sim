"""Coroid promo — orchestrator.

Renders all 900 frames, applies cinematic grade (vignette, grain), and
encodes a 30s 1920x1080@30fps MP4. Frames are piped directly to ffmpeg via
stdin as raw RGB24 to avoid slow PNG disk I/O.
"""
import os
import sys
import math
import time
import subprocess

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common import (W, H, FPS, DUR, NF, Frame, LETTERBOX, apply_vignette,
                    add_grain, letterbox, clamp, ease_in_out_cubic)
import scenes as SC


def grade(frame, fi):
    """Cinematic grade: vignette + subtle grain + letterbox."""
    apply_vignette(frame, strength=0.55)
    add_grain(frame, amount=0.008, seed=fi)
    letterbox(frame, LETTERBOX)
    frame.a = np.clip(frame.a, 0, 1)
    return frame


def render_frame(fi):
    t = fi / FPS
    frame = SC.render_scene(fi)
    # crossfade between scenes (0.5s overlap)
    for i, (t0, t1, _fn) in enumerate(SC.SCENES[:-1]):
        fade_start = t1 - 0.5
        if fade_start <= t < t1:
            p = (t - fade_start) / 0.5
            p = ease_in_out_cubic(p)
            nxt = SC.SCENES[i + 1][2](fi)
            frame.a = frame.a * (1 - p) + nxt.a * p
            break
    grade(frame, fi)
    return frame


def main():
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "coroid_promo_30s.mp4")

    import imageio_ffmpeg
    exe = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [
        exe, "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{W}x{H}", "-r", str(FPS),
        "-i", "-",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        out_path,
    ]
    print("starting encode ->", out_path, flush=True)
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                            stderr=subprocess.PIPE, text=False)

    t0 = time.time()
    try:
        for fi in range(NF):
            frame = render_frame(fi)
            buf = (np.clip(frame.a, 0, 1) * 255.0 + 0.5).astype(np.uint8).tobytes()
            proc.stdin.write(buf)
            if fi % 60 == 0:
                el = time.time() - t0
                print(f"frame {fi}/{NF}  ({el:.1f}s, {fi/max(el,1e-6):.1f} f/s)", flush=True)
        proc.stdin.close()
    except BrokenPipeError:
        err = proc.stderr.read().decode(errors="replace")
        print("FFMPEG pipe broken. stderr:\n", err[-3000:])
        sys.exit(1)

    proc.wait()
    if proc.returncode != 0:
        err = proc.stderr.read().decode(errors="replace")
        print("FFMPEG FAILED rc", proc.returncode, "\n", err[-3000:])
        sys.exit(1)
    print("DONE:", out_path, f"{os.path.getsize(out_path)/1e6:.1f} MB", flush=True)


if __name__ == "__main__":
    main()