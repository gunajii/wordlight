# S2 evaluation — polly-transcribe

- Date: 2026-10-08T12:58:47.518Z
- Git: 6ddbd17
- Engine: Amazon Polly (neural, adult synthetic voice) speaks each case; audio streamed in real time to Amazon Transcribe Streaming. Synthetic adult speech characterises the pipeline, not child reading.
- Transcribe stability: high · lead silence: 0 ms
- Cases: 40 (filter: sample=40)
- Speaker: Amazon Polly Kajal (adult synthetic)

## Verdict: FAIL

Basis: ≥ 90 % of correctly read words lit within 1 s AND ≤ 10 % of deliberately misread words accepted, per language. Latency = word.read emitted by the server − word spoken (audio injected at the server; the phone→server hop, measured in S3, and server→TV are not included).

## By language

| set | cases | passed | lit ≤ 1 s | misreads accepted | omitted accepted | latency ms median / p95 / max | errors |
|---|---|---|---|---|---|---|---|
| all | 40 | 31 | 54.4 % (111/204) | 22.2 % (2/9) | 0/8 | 965 / 1522 / 2288 | 0 |
| en-IN | 20 | 13 | 56.1 % (55/98) | 50 % (2/4) | 0/5 | 977 / 1363 / 2282 | 0 |
| hi-IN | 20 | 18 | 52.8 % (56/106) | 0 % (0/5) | 0/3 | 948 / 1522 / 2288 | 0 |

## By category

| set | cases | passed | lit ≤ 1 s | misreads accepted | omitted accepted | latency ms median / p95 / max | errors |
|---|---|---|---|---|---|---|---|
| correct | 9 | 8 | 62 % (31/50) | – % (0/0) | 0/0 | 901 / 1205 / 1301 | 0 |
| hesitation | 6 | 4 | 45.5 % (15/33) | – % (0/0) | 0/0 | 1070 / 2282 / 2288 | 0 |
| wrong-word | 4 | 2 | 68.4 % (13/19) | 25 % (1/4) | 0/0 | 894 / 1265 / 1265 | 0 |
| multiple-wrong | 2 | 1 | 57.1 % (4/7) | 25 % (1/4) | 0/0 | 946 / 1104 / 1104 | 0 |
| long-pause | 2 | 2 | 55.6 % (5/9) | – % (0/0) | 0/0 | 935 / 1264 / 1264 | 0 |
| missing | 8 | 6 | 58.3 % (21/36) | – % (0/0) | 0/8 | 946 / 1282 / 1734 | 0 |
| repeated | 4 | 3 | 34.6 % (9/26) | – % (0/0) | 0/0 | 1117 / 1499 / 1524 | 0 |
| slip | 1 | 1 | 60 % (3/5) | – % (0/0) | 0/0 | 983 / 1277 / 1277 | 0 |
| correction | 1 | 1 | 0 % (0/6) | – % (0/0) | 0/0 | 1041 / 1522 / 1522 | 0 |
| hindi-unicode | 2 | 2 | 75 % (6/8) | 0 % (0/1) | 0/0 | 935 / 1189 / 1189 | 0 |
| english-edge | 1 | 1 | 80 % (4/5) | – % (0/0) | 0/0 | 932 / 1032 / 1032 | 0 |

## Supplementary (not part of the verdict)

| set | first word of the line lit | lit eventually | latency from word END median / p95 (INFERRED) | lit ≤ 1 s after word END (INFERRED) |
|---|---|---|---|---|
| all | 89.7 % | 94.6 % | 678 / 1053 | 85.8 % |
| en-IN | 80 % | 94.9 % | 754 / 1010 | 89.8 % |
| hi-IN | 100 % | 94.3 % | 636 / 1098 | 82.1 % |

Word END is INFERRED from the synthetic audio (last 10 ms frame above 3 % of peak before the next word). A word cannot be recognised before it has been said, so this separates recogniser delay from word length. The verdict keeps the predefined start-based rule.

## Cases not as expected (9)

- **en-02-wrong-word** (wrong-word) expected “Tara had a red kite.”, said “Tara had a bed kite”, recogniser: “Sarah had a wet kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-02-hesitation** (hesitation) expected “Tara had a red kite.”, said “Tara had a red kite”, recogniser: “Kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-03-multiple-wrong** (multiple-wrong) expected “The big dog sat down.”, said “The bag dog sat town”, recogniser: “The back dog sat down”
  - word 4 “down.” label=misread outcome=read heard=“down”
- **en-06-wrong-word** (wrong-word) expected “She found a shell by the sea.”, said “She fond a shell by the sea”, recogniser: “She found a shell by the sea”
  - word 1 “found” label=misread outcome=read heard=“found”
- **en-07-correct** (correct) expected “Anu counted the stars.”, said “Anu counted the stars”, recogniser: “A who counted the stars”
  - word 0 “Anu” label=correct outcome=skipped
- **en-07-missing** (missing) expected “Anu counted the stars.”, said “Anu counted stars”, recogniser: “I counted stars”
  - word 0 “Anu” label=correct outcome=skipped
- **en-08-repeated** (repeated) expected “The bus stopped near the school.”, said “The bus bus stopped near the school”, recogniser: “The bus bus stop near the school”
  - word 2 “stopped” label=correct outcome=skipped
- **hi-02-hesitation** (hesitation) expected “मीरा को किताबें पढ़ना पसंद है।”, said “मीरा को किताबें पढ़ना पसंद है”, recogniser: “पढ़ना पसंद है”
  - word 2 “किताबें” label=correct outcome=skipped
- **hi-04-missing** (missing) expected “गाँव के पास एक नदी बहती थी।”, said “गाँव के एक नदी बहती थी”, recogniser: “गांव की एक नदी बहती थी”
  - word 1 “के” label=correct outcome=helped
  - word 3 “एक” label=correct outcome=helped
  - word 4 “नदी” label=correct outcome=helped
  - word 5 “बहती” label=correct outcome=none
  - word 6 “थी।” label=correct outcome=none

Legend: label = what should happen (correct/slip/corrected → should light; after-pause → light or help; misread/omitted → must not light as read). Outcome = what the reading engine did.
