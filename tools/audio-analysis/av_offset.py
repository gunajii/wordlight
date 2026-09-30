#!/usr/bin/env python3
"""S1: measure highlight-vs-audio offset from a recording of the TV (picture + sound).

Film the TV while the S1 timing story plays (phone camera, 60 fps if possible, TV sound audible).
The story's audio has a 1 kHz click at each word start; the app flashes a white timing marker
whenever the highlighted word changes. This tool finds both in the recording and pairs them.

  offset = flash time − click time      (positive = the word lights up AFTER it is heard)

Resolution: flash onsets are timestamped between the last dark and first bright frame
(± half a frame: ±8 ms at 60 fps, ±17 ms at 30 fps); click onsets to ~1 ms.

Usage: python3 tools/audio-analysis/av_offset.py recording.mov [--json out.json] [--min-luma-rise 20] [--crop auto|none|w:h:x:y]
(--crop auto finds the marker square, so a full-screen capture works; filming only the marker also works.)
Needs ffmpeg/ffprobe and numpy.
"""
import argparse, json, subprocess, sys
import numpy as np

SR = 48000

def audio_onsets(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float64) / 32768.0
    if x.size == 0:
        sys.exit("no audio track in the recording")
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(x.size, 1 / SR)
    X[(f < 850) | (f > 1150)] = 0  # keep the 1 kHz click band, drop speech/room noise elsewhere
    y = np.abs(np.fft.irfft(X, n=x.size))
    k = int(0.001 * SR)
    env = np.convolve(y, np.ones(k) / k, mode="same")
    thr = 0.3 * np.percentile(env, 99.7)
    above = env > thr
    onsets, last = [], -1e9
    for i in np.flatnonzero(above[1:] & ~above[:-1]) + 1:
        t = i / SR
        if t - last > 0.15:
            onsets.append(t)
            last = t
    return np.array(onsets)

def find_marker(path, seconds=60, W=192):
    """Locate the timing marker in a recording that shows more than the marker (e.g. a full-screen capture).

    The marker is a solid square that switches between dark and white; subtitle words also flip brightness but
    are thin and scattered. So: per pixel (downscaled), take the p99−p1 luma range and the fraction of frames that
    are white; keep pixels that swing hard and are white < 60 % of the time; return the connected component with
    the best (size × fill-ratio) as an ffmpeg crop in input pixels, or None to use the whole frame."""
    info = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path], capture_output=True, text=True, check=True).stdout.strip().split(",")
    iw, ih = int(info[0]), int(info[1])
    H = max(2, round(W * ih / iw / 2) * 2)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-t", str(seconds), "-i", path, "-an", "-vf", f"scale={W}:{H},format=gray", "-vsync", "passthrough", "-f", "rawvideo", "-"], capture_output=True, check=True).stdout
    fr = np.frombuffer(raw, dtype=np.uint8).reshape(-1, H, W).astype(np.float32)
    if len(fr) < 10:
        return None
    rng = np.percentile(fr, 99, axis=0) - np.percentile(fr, 1, axis=0)
    white = (fr > 200).mean(axis=0)
    m = (rng > 150) & (white > 0.005) & (white < 0.6)
    seen = np.zeros_like(m); best, best_score = None, 0.0
    for y0, x0 in zip(*np.nonzero(m)):
        if seen[y0, x0]:
            continue
        stack, pts = [(y0, x0)], []
        seen[y0, x0] = True
        while stack:
            y, x = stack.pop(); pts.append((y, x))
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < H and 0 <= xx < W and m[yy, xx] and not seen[yy, xx]:
                    seen[yy, xx] = True; stack.append((yy, xx))
        ys = [q[0] for q in pts]; xs = [q[1] for q in pts]
        bh, bw = max(ys) - min(ys) + 1, max(xs) - min(xs) + 1
        fill = len(pts) / (bh * bw)
        score = len(pts) * fill ** 2
        if len(pts) >= 12 and fill >= 0.6 and score > best_score:
            best, best_score = (min(xs), min(ys), bw, bh), score
    if best is None:
        return None
    x, y, bw, bh = best
    sx, sy = iw / W, ih / H
    # shrink by one downscaled pixel on each side so the crop is inside the square
    cx, cy = int((x + 1) * sx), int((y + 1) * sy)
    cw, ch = max(2, int((bw - 2) * sx)), max(2, int((bh - 2) * sy))
    return f"{cw}:{ch}:{cx}:{cy}"

def video_onsets(path, min_rise, crop=None):
    pts = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "frame=best_effort_timestamp_time", "-of", "csv=p=0", path], capture_output=True, text=True, check=True).stdout
    times = np.array([float(l.strip().strip(",")) for l in pts.splitlines() if l.strip().strip(",") not in ("", "N/A")])
    vf = (f"crop={crop}," if crop else "") + "scale=32:18,format=gray"
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-an", "-vf", vf, "-vsync", "passthrough", "-f", "rawvideo", "-"], capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 18 * 32)
    n = min(len(frames), len(times))
    luma = frames[:n].astype(np.float64).mean(axis=1)
    times = times[:n]
    base = np.percentile(luma, 20)
    peak = np.percentile(luma, 99.5)
    if peak - base < min_rise:
        sys.exit(f"no clear flashes found (luma range {peak - base:.1f}); is the timing marker in view?")
    thr = base + 0.5 * (peak - base)
    bright = luma > thr
    onsets, last = [], -1e9
    dt = float(np.median(np.diff(times))) if n > 1 else 0.0
    for i in np.flatnonzero(bright[1:] & ~bright[:-1]) + 1:
        # Between the last dark and the first bright frame. Screen recordings (macOS) are variable-frame-rate and
        # emit a frame only when something changes; after a long gap the midpoint would be far too early, so there
        # the first bright frame's own timestamp is used.
        gap = times[i] - times[i - 1]
        t = (times[i - 1] + times[i]) / 2 if gap <= 1.5 * dt else times[i]
        if t - last > 0.15:
            onsets.append(t)
            last = t
    fps = (n - 1) / (times[-1] - times[0]) if n > 1 else 0
    return np.array(onsets), fps

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("recording")
    ap.add_argument("--json")
    ap.add_argument("--min-luma-rise", type=float, default=20)
    ap.add_argument("--max-offset-ms", type=float, default=1500, help="search range for the global offset")
    ap.add_argument("--crop", default="auto", help="auto (find the marker), none (whole frame), or ffmpeg w:h:x:y")
    a = ap.parse_args()
    clicks = audio_onsets(a.recording)
    crop = None if a.crop == "none" else (find_marker(a.recording) if a.crop == "auto" else a.crop)
    print(f"marker region: {crop or 'whole frame'}")
    flashes, fps = video_onsets(a.recording, a.min_luma_rise, crop)
    # Pairing. Nearest-click pairing breaks when |offset| approaches half the word gap (380–720 ms here): the
    # first real VVD recordings had offsets near −390 ms and nearest-pairing mixed neighbours (stdev 220 ms).
    # So first estimate the global offset as the densest 20 ms bin of all flash−click differences within
    # ±max-offset, then pair each flash with the click closest to (flash − offset), keeping |residual| ≤ 150 ms.
    diffs = (flashes[:, None] - clicks[None, :]).ravel() * 1000 if clicks.size and flashes.size else np.array([])
    diffs = diffs[np.abs(diffs) <= a.max_offset_ms]
    if diffs.size == 0:
        sys.exit(f"no flash/click pairs within ±{a.max_offset_ms} ms (clicks {clicks.size}, flashes {flashes.size})")
    hist, edges = np.histogram(diffs, bins=np.arange(-a.max_offset_ms, a.max_offset_ms + 20, 20))
    k = int(np.argmax(hist)); window = diffs[(diffs >= edges[k] - 20) & (diffs < edges[k + 1] + 20)]
    est = float(np.median(window))
    pairs, used = [], set()
    for ft in flashes:
        j = int(np.argmin(np.abs(clicks - (ft - est / 1000))))
        d = (ft - clicks[j]) * 1000
        if abs(d - est) <= 150 and j not in used:
            used.add(j); pairs.append((clicks[j], d))
    if len(pairs) < 10:
        sys.exit(f"only {len(pairs)} click/flash pairs found (clicks {clicks.size}, flashes {flashes.size}); check sound and framing")
    t = np.array([p[0] for p in pairs]); d = np.array([p[1] for p in pairs])
    slope = np.polyfit(t / 60, d, 1)[0] if t[-1] - t[0] > 30 else float("nan")
    first = d[t < t[0] + 60]; lastm = d[t > t[-1] - 60]
    res = {
        "crop": crop, "pairs": len(pairs), "clicks": int(clicks.size), "flashes": int(flashes.size), "video_fps": round(fps, 2),
        "duration_s": round(float(t[-1] - t[0]), 1),
        "median_ms": round(float(np.median(d)), 1), "mean_ms": round(float(d.mean()), 1), "stdev_ms": round(float(d.std(ddof=1)), 1),
        "p95_abs_ms": round(float(np.percentile(np.abs(d), 95)), 1), "min_ms": round(float(d.min()), 1), "max_ms": round(float(d.max()), 1),
        "drift_ms_per_min": round(float(slope), 2), "first_minute_median_ms": round(float(np.median(first)), 1), "last_minute_median_ms": round(float(np.median(lastm)), 1),
    }
    res["pass_median_le_100ms"] = abs(res["median_ms"]) <= 100
    res["pass_stable_3min"] = res["duration_s"] >= 170 and abs(res["first_minute_median_ms"] - res["last_minute_median_ms"]) <= 20
    print(f"pairs {res['pairs']} (clicks {res['clicks']}, flashes {res['flashes']}), video {res['video_fps']} fps, {res['duration_s']} s")
    print(f"offset (flash − click): median {res['median_ms']} ms · mean {res['mean_ms']} · stdev {res['stdev_ms']} · p95 |offset| {res['p95_abs_ms']} · range {res['min_ms']}..{res['max_ms']}")
    print(f"stability: first-minute median {res['first_minute_median_ms']} ms, last-minute {res['last_minute_median_ms']} ms, drift {res['drift_ms_per_min']} ms/min")
    print(f"S1 bar — median |offset| ≤ 100 ms: {'PASS' if res['pass_median_le_100ms'] else 'FAIL'} · stable over ≥ 3 min (first vs last minute within 20 ms): {'PASS' if res['pass_stable_3min'] else 'FAIL / too short'}")
    print("positive = word lights up after it is heard")
    if a.json:
        json.dump(res, open(a.json, "w"), indent=1)

if __name__ == "__main__":
    main()
