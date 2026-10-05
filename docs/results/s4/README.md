# S4 results — Polly word timing

**Status: NOT MEASURED YET.** We have no Polly result until Polly works on the account. On 2026-10-05 the call
failed with `SubscriptionRequiredException`: the account was not active yet and had no credits.

**Question.** Do Amazon Polly's word speech marks (Kajal, neural, hi-IN and en-IN) start where each word starts in
the audio?
**Target (fixed in advance).** At least 95 % of words within 50 ms, in each language.
**Method.** `tools/s4/analyze.py` compares the marks against two references:
- **A.** Amazon Transcribe word starts on the same PCM. Transcribe has its own error, so A bounds the combined
  error of both systems.
- **B.** Acoustic onsets after pauses. These are exact, but they cover only a few words.

The report gives words, words within 50 ms, %, median, p95, max and bias, per language.

**Run (≈ 2 min, under USD 0.10 — INFERRED):**
```
AWS_REGION=ap-south-1 node tools/s4/polly-s4.ts
python3 tools/s4/analyze.py content/build/s4 --plots --report docs/results/s4
```
**Check of the analysis code (SIMULATED, no AWS):**
```
node tools/s4/polly-s4.ts --fixture && python3 tools/s4/analyze.py content/build/s4-fixture
```
This feeds in tones with exact marks and a reference with known errors, and must reproduce them. It is covered by
`server/test/s4-analysis.test.ts`. A report from it is titled SIMULATED and is not an S4 result.
