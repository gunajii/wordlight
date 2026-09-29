#!/usr/bin/env python3
"""Validation for av_offset.py: build a fake 'recording' of the S1 story with a KNOWN offset.

Video: dark frames with a white flash starting `offset` ms after each word's click (quantised to
the frame rate, like a real camera). Audio: the S1 story's own click track, plus noise.
Usage: python3 make_synthetic_recording.py story_dir out.mp4 --offset-ms 60 --fps 30 [--drift-ms-per-min 0]
"""
import argparse, json, os, subprocess
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("story_dir"); ap.add_argument("out")
ap.add_argument("--offset-ms", type=float, default=60); ap.add_argument("--fps", type=float, default=30)
ap.add_argument("--jitter-ms", type=float, default=10); ap.add_argument("--drift-ms-per-min", type=float, default=0)
ap.add_argument("--seconds", type=float, default=185)
a = ap.parse_args()
story = json.load(open(os.path.join(a.story_dir, "story.json"), encoding="utf-8"))
t0s = [w["t0"] / 1000 for l in story["pages"][0]["lines"] for w in l["words"] if w["t0"] / 1000 < a.seconds - 1]
rng = np.random.default_rng(7)
flash = [t + (a.offset_ms + a.drift_ms_per_min * t / 60 + rng.normal(0, a.jitter_ms)) / 1000 for t in t0s]
n = int(a.seconds * a.fps)
W, H = 64, 36
frames = np.full((n, H, W), 20, dtype=np.uint8)
for ft in flash:
    i0 = int(np.ceil(ft * a.fps)); i1 = int(np.ceil((ft + 0.1) * a.fps))  # 100 ms marker, frame-quantised
    frames[max(0, i0):min(n, i1)] = 230
raw = os.path.join(os.path.dirname(os.path.abspath(a.out)), "synthetic.gray")
frames.tofile(raw)
noise = os.path.join(os.path.dirname(os.path.abspath(a.out)), "noise.wav")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{W}x{H}", "-r", str(a.fps), "-i", raw,
                "-i", os.path.join(a.story_dir, "p1.wav"), "-f", "lavfi", "-i", f"anoisesrc=d={a.seconds}:c=pink:a=0.05",
                "-filter_complex", "[1:a][2:a]amix=inputs=2:duration=first[a]", "-map", "0:v", "-map", "[a]", "-t", str(a.seconds),
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", a.out], check=True)
os.remove(raw)
print(f"wrote {a.out}: {len(flash)} flashes, true offset {a.offset_ms} ms (+{a.drift_ms_per_min} ms/min), {a.fps} fps")
