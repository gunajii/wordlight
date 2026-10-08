# Generative narration timing — Transcribe alignment vs Polly speech marks (busy-ants)

- Date: 2026-10-08T18:06:09.321Z · Transcribe ap-south-1 · generative Polly ap-southeast-1 · style {"rate":"90%","volume":"+6dB","lineBreakMs":650}
- Reference: acoustic onsets after ≥ 150 ms of silence (5 ms frames, 3 % of peak), each paired with the nearest predicted word start within 250 ms. Only words after a pause have a reference.

| timing | onsets paired | within 50 ms | median abs ms | p95 abs ms | bias ms |
|---|---|---|---|---|---|
| N: Polly speech marks (current) | 38 | 47.4 % | 52 | 101 | +22 |
| N: Transcribe alignment | 37 | 54.1 % | 49 | 184 | -49 |
| G: Transcribe alignment (raw) | 26 | 65.4 % | 34 | 186 | -19 |
| G: alignment + offset 49 ms (from N) | 26 | 69.2 % | 40 | 235 | +30 |

Generative words matched to a recognised word: **93.8 %** (121/129); the rest interpolated.

**Decision (rule fixed before the run): USE generative narration for English.** Rule: matched ≥ 90 % AND calibrated G median ≤ Polly-marks median + 20 ms.
