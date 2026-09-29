#!/usr/bin/env python3
"""S1: measure highlight-vs-audio offset from a recording of the TV (picture + sound).

Film the TV while the S1 timing story plays (phone camera, 60 fps if possible, TV sound audible).
The story's audio has a 1 kHz click at each word start; the app flashes a white timing marker
whenever the highlighted word changes. This tool finds both in the recording and pairs them.

  offset = flash time − click time      (positive = the word lights up AFTER it is heard)

Resolution: flash onsets are timestamped between the last dark and first bright frame
(± half a frame: ±8 ms at 60 fps, ±17 ms at 30 fps); click onsets to ~1 ms.

Usage: python3 tools/audio-analysis/av_offset.py recording.mov [--json out.json] [--min-luma-rise 20]
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

def video_onsets(path, min_rise):
    pts = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "frame=best_effort_timestamp_time", "-of", "csv=p=0", path], capture_output=True, text=True, check=True).stdout
    times = np.array([float(l.strip().strip(",")) for l in pts.splitlines() if l.strip().strip(",") not in ("", "N/A")])
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-an", "-vf", "scale=32:18,format=gray", "-vsync", "passthrough", "-f", "rawvideo", "-"], capture_output=True, check=True).stdout
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
    for i in np.flatnonzero(bright[1:] & ~bright[:-1]) + 1:
        t = (times[i - 1] + times[i]) / 2  # between the last dark and the first bright frame
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
    ap.add_argument("--max-pair-ms", type=float, default=400)
    a = ap.parse_args()
    clicks = audio_onsets(a.recording)
    flashes, fps = video_onsets(a.recording, a.min_luma_rise)
    pairs = []
    for ft in flashes:
        if clicks.size == 0:
            break
        j = int(np.argmin(np.abs(clicks - ft)))
        d = (ft - clicks[j]) * 1000
        if abs(d) <= a.max_pair_ms:
            pairs.append((clicks[j], d))
    if len(pairs) < 10:
        sys.exit(f"only {len(pairs)} click/flash pairs found (clicks {clicks.size}, flashes {flashes.size}); check sound and framing")
    t = np.array([p[0] for p in pairs]); d = np.array([p[1] for p in pairs])
    slope = np.polyfit(t / 60, d, 1)[0] if t[-1] - t[0] > 30 else float("nan")
    first = d[t < t[0] + 60]; lastm = d[t > t[-1] - 60]
    res = {
        "pairs": len(pairs), "clicks": int(clicks.size), "flashes": int(flashes.size), "video_fps": round(fps, 2),
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
