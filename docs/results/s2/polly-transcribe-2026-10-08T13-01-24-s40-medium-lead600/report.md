# S2 evaluation — polly-transcribe

- Date: 2026-10-08T13:01:24.492Z
- Git: 6ddbd17
- Engine: Amazon Polly (neural, adult synthetic voice) speaks each case; audio streamed in real time to Amazon Transcribe Streaming. Synthetic adult speech characterises the pipeline, not child reading.
- Transcribe stability: medium · lead silence: 600 ms
- Cases: 40 (filter: sample=40)
- Speaker: Amazon Polly Kajal (adult synthetic)

## Verdict: FAIL

Basis: ≥ 90 % of correctly read words lit within 1 s AND ≤ 10 % of deliberately misread words accepted, per language. Latency = word.read emitted by the server − word spoken (audio injected at the server; the phone→server hop, measured in S3, and server→TV are not included).

## By language

| set | cases | passed | lit ≤ 1 s | misreads accepted | omitted accepted | latency ms median / p95 / max | errors |
|---|---|---|---|---|---|---|---|
| all | 40 | 31 | 47.1 % (96/204) | 22.2 % (2/9) | 0/8 | 1016 / 1676 / 2267 | 0 |
| en-IN | 20 | 13 | 46.9 % (46/98) | 50 % (2/4) | 0/5 | 1002 / 1667 / 2267 | 0 |
| hi-IN | 20 | 18 | 47.2 % (50/106) | 0 % (0/5) | 0/3 | 1019 / 1676 / 2249 | 0 |

## By category

| set | cases | passed | lit ≤ 1 s | misreads accepted | omitted accepted | latency ms median / p95 / max | errors |
|---|---|---|---|---|---|---|---|
| correct | 9 | 7 | 50 % (25/50) | – % (0/0) | 0/0 | 980 / 1331 / 1740 | 0 |
| hesitation | 6 | 4 | 45.5 % (15/33) | – % (0/0) | 0/0 | 1113 / 2249 / 2267 | 0 |
| wrong-word | 4 | 2 | 63.2 % (12/19) | 25 % (1/4) | 0/0 | 902 / 1676 / 1676 | 0 |
| multiple-wrong | 2 | 1 | 28.6 % (2/7) | 25 % (1/4) | 0/0 | 1227 / 1552 / 1552 | 0 |
| long-pause | 2 | 2 | 44.4 % (4/9) | – % (0/0) | 0/0 | 1002 / 1236 / 1236 | 0 |
| missing | 8 | 7 | 58.3 % (21/36) | – % (0/0) | 0/8 | 968 / 1352 / 1667 | 0 |
| repeated | 4 | 3 | 26.9 % (7/26) | – % (0/0) | 0/0 | 1183 / 1724 / 1780 | 0 |
| slip | 1 | 1 | 40 % (2/5) | – % (0/0) | 0/0 | 1046 / 1325 / 1325 | 0 |
| correction | 1 | 1 | 16.7 % (1/6) | – % (0/0) | 0/0 | 1019 / 1448 / 1448 | 0 |
| hindi-unicode | 2 | 2 | 50 % (4/8) | 0 % (0/1) | 0/0 | 979 / 1291 / 1291 | 0 |
| english-edge | 1 | 1 | 60 % (3/5) | – % (0/0) | 0/0 | 952 / 1100 / 1100 | 0 |

## Supplementary (not part of the verdict)

| set | first word of the line lit | lit eventually | latency from word END median / p95 (INFERRED) | lit ≤ 1 s after word END (INFERRED) |
|---|---|---|---|---|
| all | 87.2 % | 96.6 % | 742 / 1187 | 83.8 % |
| en-IN | 80 % | 94.9 % | 783 / 1162 | 83.7 % |
| hi-IN | 94.7 % | 98.1 % | 694 / 1187 | 84 % |

Word END is INFERRED from the synthetic audio (last 10 ms frame above 3 % of peak before the next word). A word cannot be recognised before it has been said, so this separates recogniser delay from word length. The verdict keeps the predefined start-based rule.

## Cases not as expected (9)

- **en-02-wrong-word** (wrong-word) expected “Tara had a red kite.”, said “Tara had a bed kite”, recogniser: “Sara had a bed kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-02-hesitation** (hesitation) expected “Tara had a red kite.”, said “Tara had a red kite”, recogniser: “Kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-03-multiple-wrong** (multiple-wrong) expected “The big dog sat down.”, said “The bag dog sat town”, recogniser: “The back dog sat down”
  - word 4 “down.” label=misread outcome=read heard=“down”
- **en-06-wrong-word** (wrong-word) expected “She found a shell by the sea.”, said “She fond a shell by the sea”, recogniser: “She found a shell by the sea”
  - word 1 “found” label=misread outcome=read heard=“found”
- **en-07-correct** (correct) expected “Anu counted the stars.”, said “Anu counted the stars”, recogniser: “A who counted the stars”
  - word 0 “Anu” label=correct outcome=skipped
- **en-07-missing** (missing) expected “Anu counted the stars.”, said “Anu counted stars”, recogniser: “And who counted stars”
  - word 0 “Anu” label=correct outcome=skipped
- **en-08-repeated** (repeated) expected “The bus stopped near the school.”, said “The bus bus stopped near the school”, recogniser: “The bus bus stop near the school”
  - word 2 “stopped” label=correct outcome=skipped
- **hi-02-hesitation** (hesitation) expected “मीरा को किताबें पढ़ना पसंद है।”, said “मीरा को किताबें पढ़ना पसंद है”, recogniser: “पढ़ना पसंद है”
  - word 2 “किताबें” label=correct outcome=skipped
- **hi-05-correct** (correct) expected “राजू ने पानी में पत्थर देखा।”, said “राजू ने पानी में पत्थर देखा”, recogniser: “राज्यों ने पानी में पत्थर देखा”
  - word 0 “राजू” label=correct outcome=skipped

Legend: label = what should happen (correct/slip/corrected → should light; after-pause → light or help; misread/omitted → must not light as read). Outcome = what the reading engine did.
