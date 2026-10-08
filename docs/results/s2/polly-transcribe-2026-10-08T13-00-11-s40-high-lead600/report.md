# S2 evaluation — polly-transcribe

- Date: 2026-10-08T13:00:11.869Z
- Git: 6ddbd17
- Engine: Amazon Polly (neural, adult synthetic voice) speaks each case; audio streamed in real time to Amazon Transcribe Streaming. Synthetic adult speech characterises the pipeline, not child reading.
- Transcribe stability: high · lead silence: 600 ms
- Cases: 40 (filter: sample=40)
- Speaker: Amazon Polly Kajal (adult synthetic)

## Verdict: FAIL

Basis: ≥ 90 % of correctly read words lit within 1 s AND ≤ 10 % of deliberately misread words accepted, per language. Latency = word.read emitted by the server − word spoken (audio injected at the server; the phone→server hop, measured in S3, and server→TV are not included).

## By language

| set | cases | passed | lit ≤ 1 s | misreads accepted | omitted accepted | latency ms median / p95 / max | errors |
|---|---|---|---|---|---|---|---|
| all | 40 | 28 | 46.1 % (94/204) | 33.3 % (3/9) | 0/8 | 1000 / 1549 / 2252 | 0 |
| en-IN | 20 | 13 | 48 % (47/98) | 50 % (2/4) | 0/5 | 996 / 1546 / 2252 | 0 |
| hi-IN | 20 | 15 | 44.3 % (47/106) | 20 % (1/5) | 0/3 | 1000 / 1628 / 2244 | 0 |

## By category

| set | cases | passed | lit ≤ 1 s | misreads accepted | omitted accepted | latency ms median / p95 / max | errors |
|---|---|---|---|---|---|---|---|
| correct | 9 | 6 | 48 % (24/50) | – % (0/0) | 0/0 | 967 / 1283 / 1330 | 0 |
| hesitation | 6 | 4 | 36.4 % (12/33) | – % (0/0) | 0/0 | 1174 / 2244 / 2252 | 0 |
| wrong-word | 4 | 2 | 68.4 % (13/19) | 25 % (1/4) | 0/0 | 912 / 1332 / 1332 | 0 |
| multiple-wrong | 2 | 1 | 71.4 % (5/7) | 25 % (1/4) | 0/0 | 926 / 1095 / 1095 | 0 |
| long-pause | 2 | 2 | 55.6 % (5/9) | – % (0/0) | 0/0 | 993 / 1200 / 1200 | 0 |
| missing | 8 | 6 | 47.2 % (17/36) | – % (0/0) | 0/8 | 962 / 1326 / 1689 | 0 |
| repeated | 4 | 3 | 23.1 % (6/26) | – % (0/0) | 0/0 | 1083 / 1546 / 1628 | 0 |
| slip | 1 | 1 | 40 % (2/5) | – % (0/0) | 0/0 | 1072 / 1734 / 1734 | 0 |
| correction | 1 | 1 | 50 % (3/6) | – % (0/0) | 0/0 | 1000 / 1481 / 1481 | 0 |
| hindi-unicode | 2 | 1 | 50 % (4/8) | 100 % (1/1) | 0/0 | 943 / 1456 / 1456 | 0 |
| english-edge | 1 | 1 | 60 % (3/5) | – % (0/0) | 0/0 | 968 / 1101 / 1101 | 0 |

## Supplementary (not part of the verdict)

| set | first word of the line lit | lit eventually | latency from word END median / p95 (INFERRED) | lit ≤ 1 s after word END (INFERRED) |
|---|---|---|---|---|
| all | 84.6 % | 91.7 % | 740 / 1048 | 83.3 % |
| en-IN | 80 % | 94.9 % | 782 / 1041 | 87.8 % |
| hi-IN | 89.5 % | 88.7 % | 699 / 1101 | 79.2 % |

Word END is INFERRED from the synthetic audio (last 10 ms frame above 3 % of peak before the next word). A word cannot be recognised before it has been said, so this separates recogniser delay from word length. The verdict keeps the predefined start-based rule.

## Cases not as expected (12)

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
- **hi-04-missing** (missing) expected “गाँव के पास एक नदी बहती थी।”, said “गाँव के एक नदी बहती थी”, recogniser: “गांव की एक नदी बहती थी”
  - word 1 “के” label=correct outcome=helped
  - word 3 “एक” label=correct outcome=helped
  - word 4 “नदी” label=correct outcome=helped
  - word 5 “बहती” label=correct outcome=none
  - word 6 “थी।” label=correct outcome=none
- **hi-05-correct** (correct) expected “राजू ने पानी में पत्थर देखा।”, said “राजू ने पानी में पत्थर देखा”, recogniser: “राज्यों ने पानी में पत्थर देखा”
  - word 0 “राजू” label=correct outcome=skipped
- **hi-09-correct** (correct) expected “माँ ने गरम रोटी बनाई।”, said “माँ ने गरम रोटी बनाई”, recogniser: “माने गरम रोटी बनाई”
  - word 0 “माँ” label=correct outcome=helped
  - word 1 “ने” label=correct outcome=helped
  - word 2 “गरम” label=correct outcome=helped
  - word 3 “रोटी” label=correct outcome=helped
  - word 4 “बनाई।” label=correct outcome=none
- **hi-u07** (hindi-unicode) expected “कल हम मेला जाएँगे।”, said “काल हम मेला जाएंगे”, recogniser: “कल हम मेला जाएंगे”
  - word 0 “कल” label=misread outcome=read heard=“कल”

Legend: label = what should happen (correct/slip/corrected → should light; after-pause → light or help; misread/omitted → must not light as read). Outcome = what the reading engine did.
