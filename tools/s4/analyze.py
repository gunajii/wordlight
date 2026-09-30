#!/usr/bin/env python3
"""S4 analysis: do Polly word speech marks match where each word actually starts in the audio?

Two independent references, both computed on the exact PCM Polly returned (content/build/s4/<id>.pcm, 16 kHz):
  A. Amazon Transcribe Streaming word start times on that audio (independent ASR; its own error is UNKNOWN,
     so disagreement bounds the combined error of both systems).
  B. Acoustic onsets, only for words preceded by a pause: first 10 ms frame after >= 60 ms of silence whose
     energy rises 15 dB above the passage's silence floor, searched within ±200 ms of the mark. Exact where it
     applies; says nothing about words joined to the previous word (most words).
Target: >= 95 % of words within 50 ms. Reports n, within-50 count and %, median |err|, p95 |err|, worst, bias.
  python3 tools/s4/analyze.py [content/build/s4] [--plots]
"""
import json, os, re, sys, unicodedata
import numpy as np
from difflib import SequenceMatcher

D = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "content/build/s4"
PLOTS = "--plots" in sys.argv
SR = 16000

def key(w):
    w = unicodedata.normalize("NFC", w).lower()
    w = w.replace("़", "").replace("ँ", "ं")          # nukta off; chandrabindu -> anusvara
    w = re.sub(r"[।॥.,!?;:'\"“”‘’()\-–—]", "", w)        # danda, punctuation, hyphens
    return w

def stats(errs):
    if not errs: return None
    a = np.abs(np.array(errs, float)); s = np.array(errs, float)
    return {"n": int(len(a)), "within50": int((a <= 50).sum()), "pct": round(100 * float((a <= 50).mean()), 1),
            "medianAbs": round(float(np.median(a)), 1), "p95Abs": round(float(np.percentile(a, 95)), 1),
            "worst": round(float(a.max()), 1), "bias": round(float(np.median(s)), 1)}

def energy_db(pcm):
    x = pcm.astype(np.float64) / 32768
    hop, win = 160, 320
    n = max(0, (len(x) - win) // hop + 1)
    e = np.array([np.mean(x[i*hop:i*hop+win] ** 2) for i in range(n)])
    return 10 * np.log10(e + 1e-12)   # frame i covers [i*10, i*10+20) ms

def acoustic_onsets(db, marks_ms):
    floor = np.percentile(db, 10)
    thr = floor + 15
    out = {}
    for i, t in enumerate(marks_ms):
        f0 = max(0, int((t - 200) / 10)); f1 = min(len(db) - 1, int((t + 200) / 10))
        for f in range(f0 + 6, f1):
            if db[f] >= thr and np.all(db[f-6:f] < thr):   # >= 60 ms quiet, then rise
                out[i] = f * 10 + 10                        # centre of the 20 ms window where energy appears
                break
    return out

rows, all_A, all_B = [], {"hi-IN": [], "en-IN": []}, {"hi-IN": [], "en-IN": []}
summary = json.load(open(os.path.join(D, "summary.json")))
for p in summary["passages"]:
    pid, lang = p["id"], p["lang"]
    toks = json.load(open(os.path.join(D, f"{pid}.tokens.json")))
    toks = [t for t in toks if t["marked"]]
    tr_path = os.path.join(D, f"{pid}.transcribe.json")
    items = [i for i in json.load(open(tr_path)) if i["type"] == "pronunciation"] if os.path.exists(tr_path) else []
    pcm = np.fromfile(os.path.join(D, f"{pid}.pcm"), dtype="<i2")
    # A: align by normalized word sequence
    a, b = [key(t["w"]) for t in toks], [key(i["content"]) for i in items]
    errA, pairs = [], []
    for blk in SequenceMatcher(a=a, b=b, autojunk=False).get_matching_blocks():
        for k in range(blk.size):
            ti, ii = toks[blk.a + k], items[blk.b + k]
            errA.append(ti["t0"] - ii["start"]); pairs.append((ti["w"], ti["t0"], ii["content"], ii["start"]))
    # B: acoustic onsets after pauses
    db = energy_db(pcm)
    on = acoustic_onsets(db, [t["t0"] for t in toks])
    errB = [toks[i]["t0"] - o for i, o in on.items()]
    all_A[lang] += errA; all_B[lang] += errB
    rows.append({"id": pid, "lang": lang, "words": len(toks), "transcribeWords": len(items), "matchedA": len(errA), "A": stats(errA), "onsetsB": len(errB), "B": stats(errB),
                 "worstA": sorted(pairs, key=lambda q: -abs(q[1] - q[3]))[:3]})
    if PLOTS:
        import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
        fig, ax = plt.subplots(figsize=(22, 4))
        ax.specgram(pcm.astype(float), NFFT=512, Fs=SR, noverlap=384, cmap="magma")
        for t in toks: ax.axvline(t["t0"] / 1000, color="cyan", lw=0.8)
        for i in items: ax.axvline(i["start"] / 1000, color="lime", lw=0.8, ls="--")
        ax.set_title(f"{pid}: cyan = Polly word marks, green dashed = Transcribe word starts"); ax.set_ylim(0, 8000)
        fig.savefig(os.path.join(D, f"{pid}.png"), dpi=80, bbox_inches="tight"); plt.close(fig)

out = {"perPassage": rows, "hi-IN": {"A": stats(all_A["hi-IN"]), "B": stats(all_B["hi-IN"])}, "en-IN": {"A": stats(all_A["en-IN"]), "B": stats(all_B["en-IN"])},
       "all": {"A": stats(all_A["hi-IN"] + all_A["en-IN"]), "B": stats(all_B["hi-IN"] + all_B["en-IN"])}}
json.dump(out, open(os.path.join(D, "analysis.json"), "w"), ensure_ascii=False, indent=1)
for r in rows:
    print(f"{r['id']}: words {r['words']} · A (Transcribe) matched {r['matchedA']}/{r['words']} {r['A']} · B (onsets after pauses) {r['onsetsB']} {r['B']}")
for L in ("hi-IN", "en-IN", "all"):
    print(f"{L}: A {out[L]['A']} · B {out[L]['B']}")
