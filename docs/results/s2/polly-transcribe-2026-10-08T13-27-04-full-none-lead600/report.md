# S2 evaluation — polly-transcribe

- Date: 2026-10-08T13:27:04.236Z
- Git: 29cd51a
- Engine: Amazon Polly (neural, adult synthetic voice) speaks each case; audio streamed in real time to Amazon Transcribe Streaming. Synthetic adult speech characterises the pipeline, not child reading.
- Transcribe stability: none · lead silence: 600 ms
- Cases: 169
- Speaker: Amazon Polly Kajal (adult synthetic)

## Verdict: FAIL

Basis: ≥ 90 % of correctly read words lit within 1 s AND ≤ 10 % of deliberately misread words accepted, per language. Latency = word.read emitted by the server − word spoken (audio injected at the server; the phone→server hop, measured in S3, and server→TV are not included).

## By language

| set | cases | passed | lit ≤ 1 s | misreads accepted | omitted accepted | latency ms median / p95 / max | errors |
|---|---|---|---|---|---|---|---|
| all | 169 | 136 | 58.8 % (507/862) | 11.1 % (5/45) | 0/20 | 798 / 1883 / 2881 | 0 |
| en-IN | 88 | 66 | 60.6 % (264/436) | 16 % (4/25) | 0/10 | 698 / 1837 / 2758 | 0 |
| hi-IN | 81 | 70 | 57 % (243/426) | 5 % (1/20) | 0/10 | 840 / 2004 / 2881 | 0 |

## By category

| set | cases | passed | lit ≤ 1 s | misreads accepted | omitted accepted | latency ms median / p95 / max | errors |
|---|---|---|---|---|---|---|---|
| correct | 20 | 16 | 82.5 % (94/114) | – % (0/0) | 0/0 | 597 / 1555 / 2179 | 0 |
| wrong-word | 20 | 14 | 37.2 % (35/94) | 10 % (2/20) | 0/0 | 1087 / 1804 / 2304 | 0 |
| correction | 20 | 16 | 48.2 % (55/114) | – % (0/0) | 0/0 | 983 / 1564 / 2194 | 0 |
| missing | 20 | 19 | 84 % (79/94) | – % (0/0) | 0/20 | 627 / 1228 / 1693 | 0 |
| repeated | 20 | 18 | 28.9 % (33/114) | – % (0/0) | 0/0 | 1378 / 2506 / 2881 | 0 |
| hesitation | 20 | 16 | 62.3 % (71/114) | – % (0/0) | 0/0 | 739 / 1875 / 2414 | 0 |
| long-pause | 20 | 14 | 64.9 % (61/94) | – % (0/0) | 0/0 | 683 / 1460 / 1670 | 0 |
| slip | 4 | 4 | 100 % (23/23) | – % (0/0) | 0/0 | 538 / 882 / 917 | 0 |
| multiple-wrong | 11 | 9 | 31.7 % (13/41) | 9.1 % (2/22) | 0/0 | 1156 / 1744 / 2063 | 0 |
| hindi-unicode | 7 | 6 | 78.6 % (22/28) | 50 % (1/2) | 0/0 | 773 / 1417 / 1433 | 0 |
| english-edge | 7 | 4 | 65.6 % (21/32) | 0 % (0/1) | 0/0 | 629 / 1391 / 1794 | 0 |

## Supplementary (not part of the verdict)

| set | first word of the line lit | lit eventually | latency from word END median / p95 (INFERRED) | lit ≤ 1 s after word END (INFERRED) |
|---|---|---|---|---|
| all | 86.7 % | 95.4 % | 524 / 1567 | 78.1 % |
| en-IN | 81.8 % | 95.4 % | 485 / 1457 | 76.1 % |
| hi-IN | 92.3 % | 95.3 % | 564 / 1698 | 80 % |

Word END is INFERRED from the synthetic audio (last 10 ms frame above 3 % of peak before the next word). A word cannot be recognised before it has been said, so this separates recogniser delay from word length. The verdict keeps the predefined start-based rule.

## Cases not as expected (33)

- **en-01-correction** (correction) expected “The little cat ran home.”, said “The little hat cat ran home”, recogniser: “Kat ran home”
  - word 2 “cat” label=corrected outcome=skipped
- **en-02-correct** (correct) expected “Tara had a red kite.”, said “Tara had a red kite”, recogniser: “Kara had a red kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-02-wrong-word** (wrong-word) expected “Tara had a red kite.”, said “Tara had a bed kite”, recogniser: “Sara had a bed kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-02-correction** (correction) expected “Tara had a red kite.”, said “Tara had a bed red kite”, recogniser: “Red kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-02-repeated** (repeated) expected “Tara had a red kite.”, said “Tara had a red kite kite”, recogniser: “Kara had a red kite kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-02-hesitation** (hesitation) expected “Tara had a red kite.”, said “Tara had a red kite”, recogniser: “Kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-02-long-pause** (long-pause) expected “Tara had a red kite.”, said “Tara had a red kite”, recogniser: “Kara had a red”
  - word 0 “Tara” label=correct outcome=skipped
- **en-03-multiple-wrong** (multiple-wrong) expected “The big dog sat down.”, said “The bag dog sat town”, recogniser: “The back dog sat down”
  - word 4 “down.” label=misread outcome=read heard=“down”
- **en-04-wrong-word** (wrong-word) expected “Sam looked under the bed.”, said “Sam liked under the bed”, recogniser: “Some lied under the bed”
  - word 0 “Sam” label=correct outcome=skipped
- **en-04-correction** (correction) expected “Sam looked under the bed.”, said “Sam liked looked under the bed”, recogniser: “Looked under the bed”
  - word 0 “Sam” label=correct outcome=skipped
- **en-06-wrong-word** (wrong-word) expected “She found a shell by the sea.”, said “She fond a shell by the sea”, recogniser: “She found a shell by the sea”
  - word 1 “found” label=misread outcome=read heard=“found”
- **en-07-correct** (correct) expected “Anu counted the stars.”, said “Anu counted the stars”, recogniser: “A who counted the stars”
  - word 0 “Anu” label=correct outcome=skipped
- **en-07-wrong-word** (wrong-word) expected “Anu counted the stars.”, said “Anu counter the stars”, recogniser: “And who counted the stars”
  - word 0 “Anu” label=correct outcome=skipped
  - word 1 “counted” label=misread outcome=read heard=“counted”
- **en-07-multiple-wrong** (multiple-wrong) expected “Anu counted the stars.”, said “Anu counter the cars”, recogniser: “And who counted the cars”
  - word 0 “Anu” label=correct outcome=skipped
  - word 1 “counted” label=misread outcome=read heard=“counted”
- **en-07-correction** (correction) expected “Anu counted the stars.”, said “Anu counter counted the stars”, recogniser: “Counted the stars”
  - word 0 “Anu” label=correct outcome=skipped
- **en-07-missing** (missing) expected “Anu counted the stars.”, said “Anu counted stars”, recogniser: “And who counted stars”
  - word 0 “Anu” label=correct outcome=skipped
- **en-07-hesitation** (hesitation) expected “Anu counted the stars.”, said “Anu counted the stars”, recogniser: “The stars”
  - word 0 “Anu” label=correct outcome=skipped
- **en-07-long-pause** (long-pause) expected “Anu counted the stars.”, said “Anu counted the stars”, recogniser: “A who counted the”
  - word 0 “Anu” label=correct outcome=skipped
- **en-08-repeated** (repeated) expected “The bus stopped near the school.”, said “The bus bus stopped near the school”, recogniser: “The bus bus stop near the school”
  - word 2 “stopped” label=correct outcome=skipped
- **hi-02-hesitation** (hesitation) expected “मीरा को किताबें पढ़ना पसंद है।”, said “मीरा को किताबें पढ़ना पसंद है”, recogniser: “पढ़ना पसंद है”
  - word 2 “किताबें” label=correct outcome=skipped
- **hi-02-long-pause** (long-pause) expected “मीरा को किताबें पढ़ना पसंद है।”, said “मीरा को किताबें पढ़ना पसंद है”, recogniser: “पढ़ना पसंद है”
  - word 2 “किताबें” label=correct outcome=helped
- **hi-05-correct** (correct) expected “राजू ने पानी में पत्थर देखा।”, said “राजू ने पानी में पत्थर देखा”, recogniser: “राज्यों ने पानी में पत्थर देखा”
  - word 0 “राजू” label=correct outcome=skipped
- **hi-05-wrong-word** (wrong-word) expected “राजू ने पानी में पत्थर देखा।”, said “राजू ने रानी में पत्थर देखा”, recogniser: “राज्यों ने रानी में पत्थर देखा”
  - word 0 “राजू” label=correct outcome=skipped
- **hi-05-long-pause** (long-pause) expected “राजू ने पानी में पत्थर देखा।”, said “राजू ने पानी में पत्थर देखा”, recogniser: “पत्थर देखा”
  - word 0 “राजू” label=correct outcome=skipped
- **hi-07-correct** (correct) expected “बच्चे मैदान में खेल रहे थे।”, said “बच्चे मैदान में खेल रहे थे”, recogniser: “बच्चे मैदान में खेल रहे थे”
  - word 1 “मैदान” label=correct outcome=skipped
- **hi-08-long-pause** (long-pause) expected “आसमान में बादल छा गए।”, said “आसमान में बादल छा गए”, recogniser: “छा गई”
  - word 4 “गए।” label=correct outcome=helped
- **hi-09-wrong-word** (wrong-word) expected “माँ ने गरम रोटी बनाई।”, said “माँ ने कम रोटी बनाई”, recogniser: “माने कम रोटी बनाई”
  - word 0 “माँ” label=correct outcome=helped
  - word 1 “ने” label=correct outcome=helped
  - word 3 “रोटी” label=correct outcome=helped
  - word 4 “बनाई।” label=correct outcome=none
- **hi-09-hesitation** (hesitation) expected “माँ ने गरम रोटी बनाई।”, said “माँ ने गरम रोटी बनाई”, recogniser: “रोटी बनाई”
  - word 0 “माँ” label=correct outcome=helped
  - word 1 “ने” label=correct outcome=helped
  - word 2 “गरम” label=correct outcome=helped
  - word 3 “रोटी” label=correct outcome=helped
  - word 4 “बनाई।” label=correct outcome=none
- **hi-09-long-pause** (long-pause) expected “माँ ने गरम रोटी बनाई।”, said “माँ ने गरम रोटी बनाई”, recogniser: “बनाई”
  - word 0 “माँ” label=correct outcome=helped
  - word 1 “ने” label=correct outcome=helped
  - word 2 “गरम” label=correct outcome=helped
  - word 3 “रोटी” label=correct outcome=helped
- **hi-u07** (hindi-unicode) expected “कल हम मेला जाएँगे।”, said “काल हम मेला जाएंगे”, recogniser: “कल हम मेला जाएंगे”
  - word 0 “कल” label=misread outcome=read heard=“कल”
- **en-e02** (english-edge) expected “Tara didn’t see the cat.”, said “Tara didnt see the cat”, recogniser: “Kara didn't see the cat”
  - word 0 “Tara” label=correct outcome=skipped
- **en-e05** (english-edge) expected “Mr. Rao has a dog.”, said “Mr Rao has a dog”, recogniser: “Mr Ralph has a dog”
  - word 1 “Rao” label=correct outcome=skipped
- **en-e05b** (english-edge) expected “The colour is red.”, said “The colour is red”, recogniser: “The color is red”
  - word 1 “colour” label=correct outcome=skipped

Legend: label = what should happen (correct/slip/corrected → should light; after-pause → light or help; misread/omitted → must not light as read). Outcome = what the reading engine did.
