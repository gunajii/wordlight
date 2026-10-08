# S2 evaluation — polly-transcribe

- Date: 2026-10-08T13:09:58.593Z
- Git: 6ddbd17
- Engine: Amazon Polly (neural, adult synthetic voice) speaks each case; audio streamed in real time to Amazon Transcribe Streaming. Synthetic adult speech characterises the pipeline, not child reading.
- Transcribe stability: high · lead silence: 600 ms
- Cases: 169
- Speaker: Amazon Polly Kajal (adult synthetic)

## Verdict: FAIL

Basis: ≥ 90 % of correctly read words lit within 1 s AND ≤ 10 % of deliberately misread words accepted, per language. Latency = word.read emitted by the server − word spoken (audio injected at the server; the phone→server hop, measured in S3, and server→TV are not included).

## By language

| set | cases | passed | lit ≤ 1 s | misreads accepted | omitted accepted | latency ms median / p95 / max | errors |
|---|---|---|---|---|---|---|---|
| all | 169 | 137 | 49.2 % (424/862) | 8.9 % (4/45) | 0/20 | 989 / 1553 / 2365 | 0 |
| en-IN | 88 | 65 | 47.7 % (208/436) | 16 % (4/25) | 0/10 | 1000 / 1553 / 2365 | 0 |
| hi-IN | 81 | 72 | 50.7 % (216/426) | 0 % (0/20) | 0/10 | 972 / 1545 / 2214 | 0 |

## By category

| set | cases | passed | lit ≤ 1 s | misreads accepted | omitted accepted | latency ms median / p95 / max | errors |
|---|---|---|---|---|---|---|---|
| correct | 20 | 17 | 63.2 % (72/114) | – % (0/0) | 0/0 | 909 / 1253 / 1348 | 0 |
| wrong-word | 20 | 16 | 66 % (62/94) | 10 % (2/20) | 0/0 | 937 / 1221 / 1338 | 0 |
| correction | 20 | 15 | 23.7 % (27/114) | – % (0/0) | 0/0 | 1122 / 1549 / 1832 | 0 |
| missing | 20 | 18 | 60.6 % (57/94) | – % (0/0) | 0/20 | 940 / 1608 / 1986 | 0 |
| repeated | 20 | 16 | 29.8 % (34/114) | – % (0/0) | 0/0 | 1145 / 1694 / 1920 | 0 |
| hesitation | 20 | 14 | 37.7 % (43/114) | – % (0/0) | 0/0 | 1045 / 2247 / 2365 | 0 |
| long-pause | 20 | 18 | 59.6 % (56/94) | – % (0/0) | 0/0 | 957 / 1348 / 1521 | 0 |
| slip | 4 | 4 | 69.6 % (16/23) | – % (0/0) | 0/0 | 943 / 1142 / 1293 | 0 |
| multiple-wrong | 11 | 8 | 56.1 % (23/41) | 9.1 % (2/22) | 0/0 | 973 / 1293 / 1301 | 0 |
| hindi-unicode | 7 | 6 | 53.6 % (15/28) | 0 % (0/2) | 0/0 | 940 / 1224 / 1296 | 0 |
| english-edge | 7 | 5 | 59.4 % (19/32) | 0 % (0/1) | 0/0 | 964 / 1200 / 1373 | 0 |

## Supplementary (not part of the verdict)

| set | first word of the line lit | lit eventually | latency from word END median / p95 (INFERRED) | lit ≤ 1 s after word END (INFERRED) |
|---|---|---|---|---|
| all | 86.1 % | 95 % | 720 / 1117 | 85.6 % |
| en-IN | 81.8 % | 95.2 % | 774 / 1074 | 86.9 % |
| hi-IN | 91 % | 94.8 % | 662 / 1162 | 84.3 % |

Word END is INFERRED from the synthetic audio (last 10 ms frame above 3 % of peak before the next word). A word cannot be recognised before it has been said, so this separates recogniser delay from word length. The verdict keeps the predefined start-based rule.

## Cases not as expected (32)

- **en-01-correction** (correction) expected “The little cat ran home.”, said “The little hat cat ran home”, recogniser: “Kat ran home”
  - word 2 “cat” label=corrected outcome=skipped
- **en-02-correct** (correct) expected “Tara had a red kite.”, said “Tara had a red kite”, recogniser: “Kara had a red kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-02-wrong-word** (wrong-word) expected “Tara had a red kite.”, said “Tara had a bed kite”, recogniser: “Sara had a bed kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-02-correction** (correction) expected “Tara had a red kite.”, said “Tara had a bed red kite”, recogniser: “Red kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-02-missing** (missing) expected “Tara had a red kite.”, said “Tara had red kite”, recogniser: “Clara had red kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-02-repeated** (repeated) expected “Tara had a red kite.”, said “Tara had a red kite kite”, recogniser: “Sara had a red kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-02-hesitation** (hesitation) expected “Tara had a red kite.”, said “Tara had a red kite”, recogniser: “Kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-02-long-pause** (long-pause) expected “Tara had a red kite.”, said “Tara had a red kite”, recogniser: “Clara had a red”
  - word 0 “Tara” label=correct outcome=skipped
- **en-03-multiple-wrong** (multiple-wrong) expected “The big dog sat down.”, said “The bag dog sat town”, recogniser: “The back dog sat down”
  - word 4 “down.” label=misread outcome=read heard=“down”
- **en-03-hesitation** (hesitation) expected “The big dog sat down.”, said “The big dog sat down”, recogniser: “Doc sat down”
  - word 2 “dog” label=correct outcome=skipped
- **en-04-wrong-word** (wrong-word) expected “Sam looked under the bed.”, said “Sam liked under the bed”, recogniser: “Some liked under the bed”
  - word 0 “Sam” label=correct outcome=skipped
- **en-04-correction** (correction) expected “Sam looked under the bed.”, said “Sam liked looked under the bed”, recogniser: “Looked under the bed”
  - word 0 “Sam” label=correct outcome=skipped
- **en-06-wrong-word** (wrong-word) expected “She found a shell by the sea.”, said “She fond a shell by the sea”, recogniser: “She found a shell by the sea”
  - word 1 “found” label=misread outcome=read heard=“found”
- **en-07-correct** (correct) expected “Anu counted the stars.”, said “Anu counted the stars”, recogniser: “A who counted the stars”
  - word 0 “Anu” label=correct outcome=skipped
- **en-07-wrong-word** (wrong-word) expected “Anu counted the stars.”, said “Anu counter the stars”, recogniser: “I counted the stars”
  - word 0 “Anu” label=correct outcome=skipped
  - word 1 “counted” label=misread outcome=read heard=“counted”
- **en-07-multiple-wrong** (multiple-wrong) expected “Anu counted the stars.”, said “Anu counter the cars”, recogniser: “I counted the cars”
  - word 0 “Anu” label=correct outcome=skipped
  - word 1 “counted” label=misread outcome=read heard=“counted”
- **en-07-correction** (correction) expected “Anu counted the stars.”, said “Anu counter counted the stars”, recogniser: “Counted the stars”
  - word 0 “Anu” label=correct outcome=skipped
- **en-07-missing** (missing) expected “Anu counted the stars.”, said “Anu counted stars”, recogniser: “And who counted stars”
  - word 0 “Anu” label=correct outcome=skipped
- **en-07-repeated** (repeated) expected “Anu counted the stars.”, said “Anu Anu counted the stars”, recogniser: “I know I know counted the stars”
  - word 0 “Anu” label=correct outcome=skipped
- **en-07-hesitation** (hesitation) expected “Anu counted the stars.”, said “Anu counted the stars”, recogniser: “The stars”
  - word 0 “Anu” label=correct outcome=skipped
- **en-08-repeated** (repeated) expected “The bus stopped near the school.”, said “The bus bus stopped near the school”, recogniser: “The bus bus stop near the school”
  - word 2 “stopped” label=correct outcome=skipped
- **hi-02-hesitation** (hesitation) expected “मीरा को किताबें पढ़ना पसंद है।”, said “मीरा को किताबें पढ़ना पसंद है”, recogniser: “पढ़ना पसंद है”
  - word 2 “किताबें” label=correct outcome=skipped
- **hi-02-long-pause** (long-pause) expected “मीरा को किताबें पढ़ना पसंद है।”, said “मीरा को किताबें पढ़ना पसंद है”, recogniser: “पढ़ना पसंद है”
  - word 2 “किताबें” label=correct outcome=helped
- **hi-05-multiple-wrong** (multiple-wrong) expected “राजू ने पानी में पत्थर देखा।”, said “राजू ने रानी में पत्ते देखा”, recogniser: “राज्यों ने रानी में पत्ते देखा”
  - word 0 “राजू” label=correct outcome=skipped
- **hi-05-hesitation** (hesitation) expected “राजू ने पानी में पत्थर देखा।”, said “राजू ने पानी में पत्थर देखा”, recogniser: “पत्थर देखा”
  - word 0 “राजू” label=correct outcome=skipped
  - word 3 “में” label=correct outcome=skipped
- **hi-07-repeated** (repeated) expected “बच्चे मैदान में खेल रहे थे।”, said “बच्चे बच्चे मैदान में खेल रहे थे”, recogniser: “बच्ची बच्ची मैदान में खेल रहे थे”
  - word 0 “बच्चे” label=correct outcome=skipped
- **hi-09-correct** (correct) expected “माँ ने गरम रोटी बनाई।”, said “माँ ने गरम रोटी बनाई”, recogniser: “माने गरम रोटी बनाई”
  - word 0 “माँ” label=correct outcome=helped
  - word 1 “ने” label=correct outcome=helped
  - word 2 “गरम” label=correct outcome=helped
  - word 3 “रोटी” label=correct outcome=helped
  - word 4 “बनाई।” label=correct outcome=none
- **hi-09-correction** (correction) expected “माँ ने गरम रोटी बनाई।”, said “माँ ने कम गरम रोटी बनाई”, recogniser: “गरम रोटी बनाई”
  - word 0 “माँ” label=correct outcome=skipped
  - word 1 “ने” label=correct outcome=skipped
- **hi-09-hesitation** (hesitation) expected “माँ ने गरम रोटी बनाई।”, said “माँ ने गरम रोटी बनाई”, recogniser: “रोटी बनाई”
  - word 0 “माँ” label=correct outcome=helped
  - word 1 “ने” label=correct outcome=helped
  - word 2 “गरम” label=correct outcome=helped
  - word 3 “रोटी” label=correct outcome=helped
  - word 4 “बनाई।” label=correct outcome=none
- **hi-u02** (hindi-unicode) expected “बच्चे हँसते हुए आए।”, said “बच्चे हँसते हुए आए”, recogniser: “बच्ची हँसती हुई आई”
  - word 0 “बच्चे” label=correct outcome=helped
  - word 1 “हँसते” label=correct outcome=helped
  - word 2 “हुए” label=correct outcome=helped
  - word 3 “आए।” label=correct outcome=helped
- **en-e05** (english-edge) expected “Mr. Rao has a dog.”, said “Mr Rao has a dog”, recogniser: “Mr Ralph has a dog”
  - word 1 “Rao” label=correct outcome=skipped
- **en-e05b** (english-edge) expected “The colour is red.”, said “The colour is red”, recogniser: “The color is red”
  - word 1 “colour” label=correct outcome=skipped

Legend: label = what should happen (correct/slip/corrected → should light; after-pause → light or help; misread/omitted → must not light as read). Outcome = what the reading engine did.
