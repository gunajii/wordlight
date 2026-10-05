#!/usr/bin/env python3
"""S4 analysis: do Polly word speech marks match where each word actually starts in the audio?

Two independent references, both computed on the exact PCM Polly returned (content/build/s4/<id>.pcm, 16 kHz):
  A. Amazon Transcribe Streaming word start times on that audio (independent ASR; its own error is UNKNOWN,
     so disagreement bounds the combined error of both systems).
  B. Acoustic onsets, only for words preceded by a pause: first 10 ms frame after >= 60 ms of silence whose
     energy rises 15 dB above the passage's silence floor, searched within ±200 ms of the mark. Exact where it
     applies; says nothing about words joined to the previous word (most words).
Target (fixed before measuring): >= 95 % of words within 50 ms, per language.
Reports per language and overall: words, within 50 ms, %, median |err|, p95 |err|, max, bias.
  python3 tools/s4/analyze.py [content/build/s4] [--plots] [--report docs/results/s4]
--report writes <dir>/<date>/{results.json,report.md}. Data from a fixture run (summary.simulated) is labelled
SIMULATED and its verdict is not an S4 result.
"""
import json, os, re, sys, unicodedata, subprocess, datetime
import numpy as np
from difflib import SequenceMatcher

SR = 16000
TARGET_PCT, TARGET_MS = 95.0, 50

def key(w):
    w = unicodedata.normalize("NFC", w).lower()
    w = w.replace("़", "").replace("ँ", "ं")          # nukta off; chandrabindu -> anusvara
    w = re.sub(r"[।॥.,!?;:'\"“”‘’()\-–—]", "", w)        # danda, punctuation, hyphens
    return w

def stats(errs):
    if not errs: return None
    a = np.abs(np.array(errs, float)); s = np.array(errs, float)
    return {"n": int(len(a)), "within50": int((a <= TARGET_MS).sum()), "pct": round(100 * float((a <= TARGET_MS).mean()), 1),
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

def verdict(s):
    if not s: return "UNKNOWN"
    return "PASS" if s["pct"] >= TARGET_PCT else "FAIL"

def analyze(D, plots=False):
    rows, all_A, all_B = [], {"hi-IN": [], "en-IN": []}, {"hi-IN": [], "en-IN": []}
    summary = json.load(open(os.path.join(D, "summary.json")))
    for p in summary["passages"]:
        pid, lang = p["id"], p["lang"]
        toks = [t for t in json.load(open(os.path.join(D, f"{pid}.tokens.json"))) if t["marked"]]
        tr_path = os.path.join(D, f"{pid}.transcribe.json")
        items = [i for i in json.load(open(tr_path)) if i["type"] == "pronunciation"] if os.path.exists(tr_path) else []
        pcm = np.fromfile(os.path.join(D, f"{pid}.pcm"), dtype="<i2")
        a, b = [key(t["w"]) for t in toks], [key(i["content"]) for i in items]
        errA, pairs = [], []
        for blk in SequenceMatcher(a=a, b=b, autojunk=False).get_matching_blocks():
            for k in range(blk.size):
                ti, ii = toks[blk.a + k], items[blk.b + k]
                errA.append(ti["t0"] - ii["start"]); pairs.append((ti["w"], ti["t0"], ii["content"], ii["start"]))
        db = energy_db(pcm)
        on = acoustic_onsets(db, [t["t0"] for t in toks])
        errB = [toks[i]["t0"] - o for i, o in on.items()]
        all_A[lang] += errA; all_B[lang] += errB
        rows.append({"id": pid, "lang": lang, "words": len(toks), "transcribeWords": len(items), "matchedA": len(errA), "A": stats(errA), "onsetsB": len(errB), "B": stats(errB),
                     "worstA": sorted(pairs, key=lambda q: -abs(q[1] - q[3]))[:3]})
        if plots:
            import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
            fig, ax = plt.subplots(figsize=(22, 4))
            ax.specgram(pcm.astype(float), NFFT=512, Fs=SR, noverlap=384, cmap="magma")
            for t in toks: ax.axvline(t["t0"] / 1000, color="cyan", lw=0.8)
            for i in items: ax.axvline(i["start"] / 1000, color="lime", lw=0.8, ls="--")
            ax.set_title(f"{pid}: cyan = Polly word marks, green dashed = Transcribe word starts"); ax.set_ylim(0, 8000)
            fig.savefig(os.path.join(D, f"{pid}.png"), dpi=80, bbox_inches="tight"); plt.close(fig)
    out = {"simulated": bool(summary.get("simulated")), "voice": summary.get("voice"), "region": summary.get("region"), "synthesizedAt": summary.get("at"),
           "target": f">= {TARGET_PCT:.0f} % of words within {TARGET_MS} ms", "perPassage": rows}
    for L in ("hi-IN", "en-IN"):
        out[L] = {"A": stats(all_A[L]), "B": stats(all_B[L]), "verdictA": verdict(stats(all_A[L]))}
    out["all"] = {"A": stats(all_A["hi-IN"] + all_A["en-IN"]), "B": stats(all_B["hi-IN"] + all_B["en-IN"])}
    langs = [L for L in ("hi-IN", "en-IN") if out[L]["A"]]
    v = [out[L]["verdictA"] for L in langs]
    out["verdict"] = "UNKNOWN" if not v else "PASS" if all(x == "PASS" for x in v) else "PARTIAL" if "PASS" in v else "FAIL"
    return out

def fmt(s):
    return "–" if not s else f"{s['n']} | {s['within50']} | {s['pct']} % | {s['medianAbs']} | {s['p95Abs']} | {s['worst']} | {s['bias']:+}"

def report_md(out, git=""):
    L = []
    sim = out["simulated"]
    L.append(f"# S4 — Polly word-timing accuracy{' (SIMULATED)' if sim else ''}\n")
    if sim:
        L.append("> **SIMULATED fixture data — not an S4 result.** Tones with exact marks and a synthetic reference with known errors; this run only checks the analysis code.\n")
    L.append(f"- Voice: {out['voice']} · region: {out.get('region') or '–'} · synthesized: {out.get('synthesizedAt') or '–'} · git {git}")
    L.append(f"- Target: {out['target']} (per language), judged on reference A; B is a cross-check where it applies.")
    L.append("- Reference A = Amazon Transcribe word starts on the same audio (its own error is UNKNOWN: A bounds the combined error). Reference B = acoustic onsets after pauses (exact, few words).\n")
    L.append(f"## Verdict: {'n/a (simulation) — ' if sim else ''}{out['verdict']}\n")
    L.append("| set | ref | words | within 50 ms | % | median abs ms | p95 abs ms | max ms | bias ms |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for name in ("hi-IN", "en-IN", "all"):
        for ref in ("A", "B"):
            L.append(f"| {name} | {ref} | {fmt(out[name][ref])} |")
    L.append("\n## Per passage\n")
    L.append("| passage | lang | marked words | ref A matched | A within 50 ms | B onsets | worst A (word, mark, ref word, ref start) |")
    L.append("|---|---|---|---|---|---|---|")
    for r in out["perPassage"]:
        L.append(f"| {r['id']} | {r['lang']} | {r['words']} | {r['matchedA']} | {r['A']['pct'] if r['A'] else '–'} % | {r['onsetsB']} | {'; '.join(f'{a} {b}/{c} {d}' for a, b, c, d in r['worstA'])} |")
    return "\n".join(L) + "\n"

if __name__ == "__main__":
    args = sys.argv[1:]
    D = args[0] if args and not args[0].startswith("--") else "content/build/s4"
    out = analyze(D, "--plots" in args)
    json.dump(out, open(os.path.join(D, "analysis.json"), "w"), ensure_ascii=False, indent=1)
    for r in out["perPassage"]:
        print(f"{r['id']}: words {r['words']} · A (Transcribe) matched {r['matchedA']}/{r['words']} {r['A']} · B (onsets after pauses) {r['onsetsB']} {r['B']}")
    for L in ("hi-IN", "en-IN", "all"):
        print(f"{L}: A {out[L]['A']} · B {out[L]['B']}")
    print(f"{'SIMULATED ' if out['simulated'] else ''}verdict {out['verdict']}")
    if "--report" in args:
        base = args[args.index("--report") + 1]
        try: git = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"]).decode().strip()
        except Exception: git = ""
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H-%M")
        d = os.path.join(base, ("SIMULATED-" if out["simulated"] else "") + stamp)
        os.makedirs(d, exist_ok=True)
        json.dump(out, open(os.path.join(d, "results.json"), "w"), ensure_ascii=False, indent=1)
        open(os.path.join(d, "report.md"), "w").write(report_md(out, git))
        print("wrote", os.path.join(d, "report.md"))
