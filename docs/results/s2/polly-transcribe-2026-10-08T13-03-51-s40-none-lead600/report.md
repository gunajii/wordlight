# S2 evaluation — polly-transcribe

- Date: 2026-10-08T13:03:51.821Z
- Git: 6ddbd17
- Engine: Amazon Polly (neural, adult synthetic voice) speaks each case; audio streamed in real time to Amazon Transcribe Streaming. Synthetic adult speech characterises the pipeline, not child reading.
- Transcribe stability: none · lead silence: 600 ms
- Cases: 40 (filter: sample=40)
- Speaker: Amazon Polly Kajal (adult synthetic)

## Verdict: FAIL

Basis: ≥ 90 % of correctly read words lit within 1 s AND ≤ 10 % of deliberately misread words accepted, per language. Latency = word.read emitted by the server − word spoken (audio injected at the server; the phone→server hop, measured in S3, and server→TV are not included).

## By language

| set | cases | passed | lit ≤ 1 s | misreads accepted | omitted accepted | latency ms median / p95 / max | errors |
|---|---|---|---|---|---|---|---|
| all | 40 | 30 | 63.7 % (130/204) | 33.3 % (3/9) | 0/8 | 708 / 1851 / 2628 | 0 |
| en-IN | 20 | 13 | 64.3 % (63/98) | 50 % (2/4) | 0/5 | 637 / 1684 / 1871 | 0 |
| hi-IN | 20 | 17 | 63.2 % (67/106) | 20 % (1/5) | 0/3 | 781 / 2079 / 2628 | 0 |

## By category

| set | cases | passed | lit ≤ 1 s | misreads accepted | omitted accepted | latency ms median / p95 / max | errors |
|---|---|---|---|---|---|---|---|
| correct | 9 | 7 | 80 % (40/50) | – % (0/0) | 0/0 | 542 / 1808 / 2191 | 0 |
| hesitation | 6 | 4 | 54.5 % (18/33) | – % (0/0) | 0/0 | 781 / 1871 / 2042 | 0 |
| wrong-word | 4 | 2 | 42.1 % (8/19) | 25 % (1/4) | 0/0 | 1005 / 1684 / 1684 | 0 |
| multiple-wrong | 2 | 1 | 28.6 % (2/7) | 25 % (1/4) | 0/0 | 1221 / 1965 / 1965 | 0 |
| long-pause | 2 | 2 | 77.8 % (7/9) | – % (0/0) | 0/0 | 554 / 1249 / 1249 | 0 |
| missing | 8 | 7 | 75 % (27/36) | – % (0/0) | 0/8 | 665 / 1274 / 1675 | 0 |
| repeated | 4 | 3 | 30.8 % (8/26) | – % (0/0) | 0/0 | 1242 / 2266 / 2628 | 0 |
| slip | 1 | 1 | 100 % (5/5) | – % (0/0) | 0/0 | 625 / 928 / 928 | 0 |
| correction | 1 | 1 | 66.7 % (4/6) | – % (0/0) | 0/0 | 749 / 1562 / 1562 | 0 |
| hindi-unicode | 2 | 1 | 75 % (6/8) | 100 % (1/1) | 0/0 | 908 / 1406 / 1406 | 0 |
| english-edge | 1 | 1 | 100 % (5/5) | – % (0/0) | 0/0 | 576 / 689 / 689 | 0 |

## Supplementary (not part of the verdict)

| set | first word of the line lit | lit eventually | latency from word END median / p95 (INFERRED) | lit ≤ 1 s after word END (INFERRED) |
|---|---|---|---|---|
| all | 87.2 % | 96.6 % | 451 / 1585 | 80.9 % |
| en-IN | 80 % | 94.9 % | 434 / 1324 | 77.6 % |
| hi-IN | 94.7 % | 98.1 % | 518 / 1745 | 84 % |

Word END is INFERRED from the synthetic audio (last 10 ms frame above 3 % of peak before the next word). A word cannot be recognised before it has been said, so this separates recogniser delay from word length. The verdict keeps the predefined start-based rule.

## Cases not as expected (10)

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
- **hi-u07** (hindi-unicode) expected “कल हम मेला जाएँगे।”, said “काल हम मेला जाएंगे”, recogniser: “कल हम मेला जाएंगे”
  - word 0 “कल” label=misread outcome=read heard=“कल”

Legend: label = what should happen (correct/slip/corrected → should light; after-pause → light or help; misread/omitted → must not light as read). Outcome = what the reading engine did.
