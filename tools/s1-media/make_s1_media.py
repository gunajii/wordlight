#!/usr/bin/env python3
"""Generate the S1 timing-test story: content/stories/s1-timing/.

Instead of speech, each word is a short 1 kHz click placed exactly at the word's t0, so the
ground truth is known by construction. The TV app flashes a timing marker whenever the
highlighted word changes; filming the TV (picture + sound) and running
tools/audio-analysis/av_offset.py on the recording gives the highlight-vs-audio offset.

The page audio is written as MP3 and M4A (AAC): both formats add encoder delay that a
decoder may or may not compensate, so S1 measures each on the real device.

Lines mix English and Hindi, including conjuncts and matras, for the Devanagari check.
Requires ffmpeg (libmp3lame, aac, libwebp). Usage: python3 tools/s1-media/make_s1_media.py [--seconds 190]
"""
import argparse, json, math, os, random, struct, subprocess, sys, wave

LINES = [
    "The little cat ran home.",
    "एक छोटा चूहा था।",
    "Riya reads with her grandmother.",
    "विद्यालय में बच्चे पढ़ते हैं।",
    "क्षमा त्रिकोण ज्ञान श्रम।",
    "The big red ball rolled away.",
    "कृष्ण ने दूध पिया।",
    "हिंदी और हिन्दी दोनों सही हैं।",
]
SR = 44100

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=190.0)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "..", "content", "stories", "s1-timing"))
    a = ap.parse_args()
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    rnd = random.Random(20261002)  # deterministic
    t = 800.0
    lines = []
    li = 0
    while t < a.seconds * 1000 - 3000:
        text = LINES[li % len(LINES)]
        li += 1
        words = []
        for w in text.split():
            gap = rnd.uniform(380, 720)  # irregular on purpose: no periodicity to lock onto
            words.append({"w": w, "t0": round(t), "t1": round(t + gap)})
            t += gap
        lines.append({"text": text, "words": words, "turn": False})
        t += 900  # pause between lines
    dur_ms = round(t + 1000)

    # clicks: 25 ms 1 kHz tone burst with a 2 ms raised-cosine attack (sharp, well-defined onset)
    n = int(dur_ms / 1000 * SR)
    buf = [0.0] * n
    for l in lines:
        for w in l["words"]:
            s0 = int(w["t0"] / 1000 * SR)
            for i in range(int(0.025 * SR)):
                env = 0.5 - 0.5 * math.cos(math.pi * min(i, 88) / 88)
                if s0 + i < n:
                    buf[s0 + i] += 0.8 * env * math.sin(2 * math.pi * 1000 * i / SR)
    wav = os.path.join(out, "p1.wav")
    with wave.open(wav, "wb") as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR)
        f.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, x)) * 32767)) for x in buf))
    ff = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    subprocess.run(ff + ["-i", wav, "-c:a", "libmp3lame", "-b:a", "128k", os.path.join(out, "p1.mp3")], check=True)
    subprocess.run(ff + ["-i", wav, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", os.path.join(out, "p1.m4a")], check=True)
    subprocess.run(ff + ["-f", "lavfi", "-i", "color=c=0x1d2b3a:s=1280x720:d=1", "-frames:v", "1", os.path.join(out, "p1.webp")], check=True)

    story = {
        "packageVersion": 1, "id": "s1-timing", "lang": "en-IN", "level": 1,
        "title": "S1 timing test",
        "credits": {"source": "WordLight test content", "license": "original", "title": "S1 timing test",
                    "author": "WordLight", "attribution": "Timing test content made by the WordLight project."},
        "voice": {"engine": "synthetic-clicks", "id": "1khz-click-at-word-start"},
        "timing": {"source": "synthetic", "verified": True},
        "pages": [{"image": "p1.webp", "audio": "p1.mp3", "durationMs": dur_ms, "lines": lines}],
        "variants": {"audio": ["p1.mp3", "p1.m4a", "p1.wav"]},
    }
    with open(os.path.join(out, "story.json"), "w", encoding="utf-8") as f:
        json.dump(story, f, ensure_ascii=False, indent=1)
    nwords = sum(len(l["words"]) for l in lines)
    print(f"wrote {out}: {len(lines)} lines, {nwords} words, {dur_ms/1000:.1f} s (p1.mp3, p1.m4a, p1.wav, p1.webp, story.json)")

if __name__ == "__main__":
    sys.exit(main())
