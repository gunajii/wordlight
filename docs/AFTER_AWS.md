# Runbook: the day AWS works

Everything below is already built and tested. The real services only need to be connected and measured. Each step
says what to run, what it costs (INFERRED estimates; the budget alerts are the real guard) and what to record.

## Done
| Step | Status |
|---|---|
| 1. Credits and guard | ☐ |
| 2. S4: Polly word timing | ☐ |
| 3. First real story | ☐ |
| 4. S2: speech recognition | ☐ |
| 5. Deploy the secure server | ☐ |
| 6. Full loop: real phone + AWS + Vega | ☐ |
| 7. Stop the server | ☐ |

## 0. Before: credits and guard (free)
```
bash infra/aws/guard.sh --tighten      # Polly OK · Transcribe OK · opt-out = optOut · budget USD 5 gross + USD 1 alert
```
Stop here unless Polly and Transcribe both say OK and Billing → Credits shows a balance.

## 1. S4: Polly word timing (≈ 2 min, < USD 0.10)
```
npm run s4        # = polly-s4.ts + analyze.py --plots --report docs/results/s4
```
- **PASS** (≥ 95 % of words within 50 ms in each language): build stories with `--verified`.
- **FAIL**: read the worst words in the report. Keep the Polly marks, but add a per-language lead offset. Record it in `docs/SPIKES.md`.

## 2. First real story (≈ 1 min, < USD 0.05)
```
python3 tools/content/import-epub.py content/sources/<file>.epub     # then fix the CHECK credits by hand
AWS_REGION=ap-south-1 node tools/content/build-story.ts <id> [--verified]
npm run content:validate
```
Update `docs/CONTENT.md` (title, author, illustrator, licence, URL).

## 3. S2: speech recognition (quick ≈ 4 min / full ≈ 20 min, ≈ USD 0.15 / 0.60)
```
AWS_REGION=ap-south-1 node tools/s2/eval.ts --engine polly-transcribe --sample 40
AWS_REGION=ap-south-1 node tools/s2/eval.ts --engine polly-transcribe
```
Optionally, adult control recordings:
`node tools/s2/eval.ts --engine wav --audio-dir ~/WordLight-private/s2-adult --speaker "adult control"`.

Decide from the report, and do not loosen the matcher to reach the target:
- **PASS** → free reading.
- **PARTIAL** → free reading in the language and mode that passed.
- **FAIL** → set `READING_MODE=echo`.

Record the decision in `docs/SPIKES.md` and in `docs/submission/MEASURED_RESULTS.md`.

## 4. Deploy the secure server (≈ 5 min; t4g.micro + IP ≈ USD 0.015/h while running)
```
READING_MODE=free bash infra/aws/deploy.sh     # prints https://<ip-dashes>.sslip.io and runs tools/ops/healthcheck.ts
```
The health check must show OK for all of these:
- https and a valid certificate
- speech is real (`transcribe`, not simulated)
- the join link is on this host, not a tunnel
- WSS works

Then point the TV at AWS:
```
SERVER_URL=https://<host> MEDIA_URL=https://<host> bash apps/vega-tv/setup.sh && bash tools/vvd/run-tv.sh
```

## 5. Full loop: real phone + AWS + Vega (adult reader first)
- Scan the QR code. The phone's address bar must show the **sslip.io AWS host**, never trycloudflare.
- Read both turns of the story. Include one stall (help) and one deliberate misread.
- Measure end to end: the TV sends `word-lit` telemetry. Get the telemetry with
  `curl -s https://<host>/api/sessions/<CODE>/telemetry.json > ~/WordLight-private/e2e.json`,
  then run `node tools/e2e/word-lit-latency.ts ~/WordLight-private/e2e.json`.
- Child reading only under `docs/CHILD_TESTING.md`: written permission and the AWS path only.

## 6. After every session
```
bash infra/aws/deploy.sh --stop        # compute stops; the Elastic IP still costs ≈ USD 0.12/day
bash infra/aws/deploy.sh --delete      # after the hackathon: removes the instance, IP, role and bucket
```
