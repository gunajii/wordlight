# S2 evaluation — polly-transcribe

- Date: 2026-10-08T12:33:02.638Z
- Git: a431fa6
- Engine: Amazon Polly (neural, adult synthetic voice) speaks each case; audio streamed in real time to Amazon Transcribe Streaming. Synthetic adult speech characterises the pipeline, not child reading.
- Cases: 169
- Speaker: Amazon Polly Kajal (adult synthetic)

## Verdict: FAIL

Basis: ≥ 90 % of correctly read words lit within 1 s AND ≤ 10 % of deliberately misread words accepted, per language. Latency = word.read emitted by the server − word spoken (audio injected at the server; the phone→server hop, measured in S3, and server→TV are not included).

## By language

| set | cases | passed | lit ≤ 1 s | misreads accepted | omitted accepted | latency ms median / p95 / max | errors |
|---|---|---|---|---|---|---|---|
| all | 169 | 128 | 50.9 % (439/862) | 6.7 % (3/45) | 0/20 | 976 / 1556 / 2858 | 0 |
| en-IN | 88 | 61 | 49.3 % (215/436) | 12 % (3/25) | 0/10 | 990 / 1565 / 2309 | 0 |
| hi-IN | 81 | 67 | 52.6 % (224/426) | 0 % (0/20) | 0/10 | 964 / 1556 / 2858 | 0 |

## By category

| set | cases | passed | lit ≤ 1 s | misreads accepted | omitted accepted | latency ms median / p95 / max | errors |
|---|---|---|---|---|---|---|---|
| correct | 20 | 17 | 68.4 % (78/114) | – % (0/0) | 0/0 | 902 / 1155 / 1295 | 0 |
| wrong-word | 20 | 15 | 57.4 % (54/94) | 5 % (1/20) | 0/0 | 932 / 1273 / 1623 | 0 |
| correction | 20 | 13 | 26.3 % (30/114) | – % (0/0) | 0/0 | 1172 / 1569 / 1637 | 0 |
| missing | 20 | 17 | 70.2 % (66/94) | – % (0/0) | 0/20 | 918 / 1238 / 1732 | 0 |
| repeated | 20 | 16 | 31.6 % (36/114) | – % (0/0) | 0/0 | 1127 / 1728 / 2703 | 0 |
| hesitation | 20 | 14 | 41.2 % (47/114) | – % (0/0) | 0/0 | 1020 / 2255 / 2858 | 0 |
| long-pause | 20 | 16 | 55.3 % (52/94) | – % (0/0) | 0/0 | 929 / 1386 / 1669 | 0 |
| slip | 4 | 4 | 69.6 % (16/23) | – % (0/0) | 0/0 | 938 / 1070 / 1241 | 0 |
| multiple-wrong | 11 | 6 | 51.2 % (21/41) | 9.1 % (2/22) | 0/0 | 970 / 1261 / 1289 | 0 |
| hindi-unicode | 7 | 6 | 75 % (21/28) | 0 % (0/2) | 0/0 | 929 / 1252 / 1408 | 0 |
| english-edge | 7 | 4 | 56.3 % (18/32) | 0 % (0/1) | 0/0 | 968 / 1245 / 1321 | 0 |

## Cases not as expected (41)

- **en-01-correction** (correction) expected “The little cat ran home.”, said “The little hat cat ran home”, recogniser: “Kat ran home”
  - word 2 “cat” label=corrected outcome=skipped
- **en-02-correct** (correct) expected “Tara had a red kite.”, said “Tara had a red kite”, recogniser: “Sarah had a red kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-02-wrong-word** (wrong-word) expected “Tara had a red kite.”, said “Tara had a bed kite”, recogniser: “Sarah had a wet kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-02-correction** (correction) expected “Tara had a red kite.”, said “Tara had a bed red kite”, recogniser: “Red kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-02-missing** (missing) expected “Tara had a red kite.”, said “Tara had red kite”, recogniser: “Sara had red kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-02-repeated** (repeated) expected “Tara had a red kite.”, said “Tara had a red kite kite”, recogniser: “Sarah had a red kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-02-hesitation** (hesitation) expected “Tara had a red kite.”, said “Tara had a red kite”, recogniser: “Kite”
  - word 0 “Tara” label=correct outcome=skipped
- **en-02-long-pause** (long-pause) expected “Tara had a red kite.”, said “Tara had a red kite”, recogniser: “Sara had a red”
  - word 0 “Tara” label=correct outcome=skipped
- **en-03-multiple-wrong** (multiple-wrong) expected “The big dog sat down.”, said “The bag dog sat town”, recogniser: “The back dog sat down”
  - word 4 “down.” label=misread outcome=read heard=“down”
- **en-03-hesitation** (hesitation) expected “The big dog sat down.”, said “The big dog sat down”, recogniser: “Doc sat down”
  - word 2 “dog” label=correct outcome=skipped
- **en-04-wrong-word** (wrong-word) expected “Sam looked under the bed.”, said “Sam liked under the bed”, recogniser: “Somelid under the bed”
  - word 0 “Sam” label=correct outcome=helped
  - word 2 “under” label=correct outcome=helped
  - word 3 “the” label=correct outcome=none
  - word 4 “bed.” label=correct outcome=none
- **en-04-correction** (correction) expected “Sam looked under the bed.”, said “Sam liked looked under the bed”, recogniser: “Looked under the bed”
  - word 0 “Sam” label=correct outcome=skipped
- **en-05-multiple-wrong** (multiple-wrong) expected “The moon was round and bright.”, said “The man was round and night”, recogniser: “The man was round in night”
  - word 4 “and” label=correct outcome=helped
- **en-06-wrong-word** (wrong-word) expected “She found a shell by the sea.”, said “She fond a shell by the sea”, recogniser: “She found a shell by the sea”
  - word 1 “found” label=misread outcome=read heard=“found”
- **en-06-multiple-wrong** (multiple-wrong) expected “She found a shell by the sea.”, said “She fond a bell by the sea”, recogniser: “She found a bell by the sea”
  - word 1 “found” label=misread outcome=read heard=“found”
- **en-07-correct** (correct) expected “Anu counted the stars.”, said “Anu counted the stars”, recogniser: “A who counted the stars”
  - word 0 “Anu” label=correct outcome=skipped
- **en-07-wrong-word** (wrong-word) expected “Anu counted the stars.”, said “Anu counter the stars”, recogniser: “On account of the stars”
  - word 0 “Anu” label=correct outcome=skipped
- **en-07-multiple-wrong** (multiple-wrong) expected “Anu counted the stars.”, said “Anu counter the cars”, recogniser: “On account of the cars”
  - word 0 “Anu” label=correct outcome=skipped
- **en-07-correction** (correction) expected “Anu counted the stars.”, said “Anu counter counted the stars”, recogniser: “Counted the stars”
  - word 0 “Anu” label=correct outcome=skipped
- **en-07-missing** (missing) expected “Anu counted the stars.”, said “Anu counted stars”, recogniser: “I counted stars”
  - word 0 “Anu” label=correct outcome=skipped
- **en-07-repeated** (repeated) expected “Anu counted the stars.”, said “Anu Anu counted the stars”, recogniser: “I know I know counted the stars”
  - word 0 “Anu” label=correct outcome=skipped
- **en-07-hesitation** (hesitation) expected “Anu counted the stars.”, said “Anu counted the stars”, recogniser: “The stars”
  - word 0 “Anu” label=correct outcome=skipped
- **en-08-repeated** (repeated) expected “The bus stopped near the school.”, said “The bus bus stopped near the school”, recogniser: “The bus bus stop near the school”
  - word 2 “stopped” label=correct outcome=skipped
- **en-09-correction** (correction) expected “My grandmother tells funny stories.”, said “My grandmother sells tells funny stories”, recogniser: “There's funny stories”
  - word 2 “tells” label=corrected outcome=skipped
- **hi-02-hesitation** (hesitation) expected “मीरा को किताबें पढ़ना पसंद है।”, said “मीरा को किताबें पढ़ना पसंद है”, recogniser: “पढ़ना पसंद है”
  - word 2 “किताबें” label=correct outcome=skipped
- **hi-02-long-pause** (long-pause) expected “मीरा को किताबें पढ़ना पसंद है।”, said “मीरा को किताबें पढ़ना पसंद है”, recogniser: “पढ़ना पसंद है”
  - word 2 “किताबें” label=correct outcome=helped
- **hi-03-hesitation** (hesitation) expected “बिल्ली धीरे से दूध पी गई।”, said “बिल्ली धीरे से दूध पी गई”, recogniser: “दूध पी गई”
  - word 2 “से” label=correct outcome=skipped
- **hi-04-missing** (missing) expected “गाँव के पास एक नदी बहती थी।”, said “गाँव के एक नदी बहती थी”, recogniser: “गांव की एक नदी बहती थी”
  - word 1 “के” label=correct outcome=helped
  - word 3 “एक” label=correct outcome=helped
  - word 4 “नदी” label=correct outcome=helped
  - word 5 “बहती” label=correct outcome=none
  - word 6 “थी।” label=correct outcome=none
- **hi-05-correction** (correction) expected “राजू ने पानी में पत्थर देखा।”, said “राजू ने रानी पानी में पत्थर देखा”, recogniser: “पानी में पत्थर देखा”
  - word 0 “राजू” label=correct outcome=skipped
- **hi-05-long-pause** (long-pause) expected “राजू ने पानी में पत्थर देखा।”, said “राजू ने पानी में पत्थर देखा”, recogniser: “पत्थर देखा”
  - word 0 “राजू” label=correct outcome=skipped
- **hi-07-repeated** (repeated) expected “बच्चे मैदान में खेल रहे थे।”, said “बच्चे बच्चे मैदान में खेल रहे थे”, recogniser: “बच्ची बच्ची मैदान में खेल रहे थे”
  - word 0 “बच्चे” label=correct outcome=skipped
- **hi-09-correct** (correct) expected “माँ ने गरम रोटी बनाई।”, said “माँ ने गरम रोटी बनाई”, recogniser: “माने गरम रोटी बनाई”
  - word 0 “माँ” label=correct outcome=helped
  - word 1 “ने” label=correct outcome=helped
  - word 2 “गरम” label=correct outcome=helped
  - word 3 “रोटी” label=correct outcome=none
  - word 4 “बनाई।” label=correct outcome=none
- **hi-09-wrong-word** (wrong-word) expected “माँ ने गरम रोटी बनाई।”, said “माँ ने कम रोटी बनाई”, recogniser: “माने कम रोटी बनाई”
  - word 0 “माँ” label=correct outcome=helped
  - word 1 “ने” label=correct outcome=helped
  - word 3 “रोटी” label=correct outcome=none
  - word 4 “बनाई।” label=correct outcome=none
- **hi-09-multiple-wrong** (multiple-wrong) expected “माँ ने गरम रोटी बनाई।”, said “माँ ने कम रोटा बनाई”, recogniser: “माने कम रोटा बनाई”
  - word 0 “माँ” label=correct outcome=helped
  - word 1 “ने” label=correct outcome=helped
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
- **hi-09-long-pause** (long-pause) expected “माँ ने गरम रोटी बनाई।”, said “माँ ने गरम रोटी बनाई”, recogniser: “बनाई”
  - word 0 “माँ” label=correct outcome=helped
  - word 1 “ने” label=correct outcome=helped
  - word 2 “गरम” label=correct outcome=helped
  - word 3 “रोटी” label=correct outcome=helped
- **hi-u07** (hindi-unicode) expected “कल हम मेला जाएँगे।”, said “काल हम मेला जाएंगे”, recogniser: “काल हम मेला जायेंगे”
  - word 3 “जाएँगे।” label=correct outcome=helped
- **en-e02** (english-edge) expected “Tara didn’t see the cat.”, said “Tara didnt see the cat”, recogniser: “Sara didn't see the cat”
  - word 0 “Tara” label=correct outcome=skipped
- **en-e05** (english-edge) expected “Mr. Rao has a dog.”, said “Mr Rao has a dog”, recogniser: “Mr Ralph has a dog”
  - word 1 “Rao” label=correct outcome=skipped
- **en-e05b** (english-edge) expected “The colour is red.”, said “The colour is red”, recogniser: “The color is red”
  - word 1 “colour” label=correct outcome=skipped

Legend: label = what should happen (correct/slip/corrected → should light; after-pause → light or help; misread/omitted → must not light as read). Outcome = what the reading engine did.
