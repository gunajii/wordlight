# S4 — Polly word-timing accuracy

- Voice: Kajal · region: ap-south-1 · synthesized: 2026-10-08T12:25:33.252Z · git a431fa6
- Target: >= 95 % of words within 50 ms (per language), judged on reference A; B is a cross-check where it applies.
- Reference A = Amazon Transcribe word starts on the same audio (its own error is UNKNOWN: A bounds the combined error). Reference B = acoustic onsets after pauses (exact, few words).

## Verdict: FAIL

| set | ref | words | within 50 ms | % | median abs ms | p95 abs ms | max ms | bias ms |
|---|---|---|---|---|---|---|---|---|
| hi-IN | A | 131 | 40 | 30.5 % | 76.0 | 196.0 | 269.0 | +76.0 |
| hi-IN | B | 53 | 27 | 50.9 % | 45.0 | 162.8 | 190.0 | -3.0 |
| en-IN | A | 98 | 51 | 52.0 % | 47.5 | 128.7 | 204.0 | +29.0 |
| en-IN | B | 37 | 21 | 56.8 % | 40.0 | 150.4 | 170.0 | +15.0 |
| all | A | 229 | 91 | 39.7 % | 64.0 | 185.2 | 269.0 | +59.0 |
| all | B | 90 | 48 | 53.3 % | 40.0 | 159.1 | 190.0 | +5.0 |

## Per passage

| passage | lang | marked words | ref A matched | A within 50 ms | B onsets | worst A (word, mark, ref word, ref start) |
|---|---|---|---|---|---|---|
| hi-1 | hi-IN | 42 | 40 | 67.5 % | 14 | और 8547/और 8326; आज 13640/आज 13476; ऊपर 11602/ऊपर 11446 |
| hi-2 | hi-IN | 44 | 41 | 14.6 % | 17 | एक 8997/एक 8736; और 9647/और 9406; क्या 13365/क्या 13136 |
| hi-3 | hi-IN | 50 | 50 | 14.0 % | 22 | शायद 10715/शायद 10446; एक 7460/एक 7246; चमकता 7647/चमकता 7456 |
| en-1 | en-IN | 34 | 33 | 48.5 % | 10 | behind 4167/behind 4336; red 1200/red 1056; a 812/a 696 |
| en-2 | en-IN | 36 | 36 | 61.1 % | 13 | inside 4830/inside 5016; shoe 10047/shoe 9896; shoe. 1762/shoe 1636 |
| en-3 | en-IN | 32 | 29 | 44.8 % | 14 | her 2842/her 3046; roof 4330/roof 4216; eyes 9122/eyes 9016 |
