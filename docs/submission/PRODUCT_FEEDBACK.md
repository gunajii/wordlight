# Product feedback

Every tool, API and SDK we used. This is first-hand only. "Not used yet" means exactly that. Dated entries with
reproduction details are in [docs/FRICTION_LOG.md](../FRICTION_LOG.md) (W1–W9).

## Vega OS / Vega SDK (0.24.12112, CLI 1.4.2) and the Vega Virtual Device

**Onboarding**
- Generating a project with the CLI (`vega project generate --template helloWorld`) worked first time.
- The 0.24 Hello World page shows only the Vega Studio flow; the CLI commands are on a separate page (W3).
- Amazon's audio sample still uses `kepler` commands while the 0.24 docs use `vega` (W2).
- `vega run-app … -d VirtualDevice` fails with "VirtualDevice not found" unless `vega virtual-device start` was run
  first. A hint in that error would save a search.

**Documentation**
- The `AudioPlayer` class page lists lifecycle methods but has no usage example. We learned the pattern
  (`initialize` → `src` → `play`, `currentTime` in seconds) from the vega-audio-sample source (W1).
- `@amazon-devices/expo-font` installed alone fails at bundle time. Its required companion packages are listed
  only on the API page (W4).

**Media APIs**
- The W3C-style `AudioPlayer` felt familiar, and it was precise enough for word-level highlighting:
  - `currentTime` changed on every 20 ms poll on the VVD;
  - after one constant lead calibration, the highlight/audio offset was median −1.0 ms, SD 11 ms, drift −0.8 ms/min.
- **Biggest problem:** `http://` media sources are refused silently. JavaScript sees only `MediaError` 4, which reads
  like a codec issue; the real reason ("insecure scheme") appears only in the native log (W5). It cost about 40
  minutes and three rebuilds. Please put the reason in `MediaError.message` and document the https requirement.
- The system Play/Pause key (Player Session) competes with an app that also handles media keys. We stopped handling
  them and instead guard against playback starting during a reading turn.

**Input**
- OK on the remote arrives as `select` or `kpenter` depending on context. We found that by logging events. A table of
  `useTVEventHandler` event types per remote button would help.

**Debugging**
- `vega device start-log-stream` was the most useful tool we had: it showed the media error cause and our app logs.
  We pipe it to a file so test runs can be checked without screenshots.

**Simulator (VVD)**
- Stable over a 3-minute timing run. Devanagari conjuncts and matras rendered correctly with the system font.
- The audio output path has a large constant latency (−339 ms M4A / −392 ms MP3 relative to `currentTime`). That
  is fine for development once measured, but it is not representative of hardware: you need a per-device
  calibration.

**TypeScript environment**
- `TextEncoder` / `TextDecoder` are not in the app's type environment (W9). It's unclear which Web APIs the runtime
  provides.

**What we'd ask for**
- An http/https note and the scheme reason in media errors.
- CLI commands on the Hello World page.
- An AudioPlayer usage snippet.
- A remote key → event table.
- A list of available Web APIs.

## Amazon Polly
- **Onboarding (new account):** blocked so far. `SubscriptionRequiredException: The AWS Access Key Id needs a
  subscription for the service`, while Budgets and Organizations calls worked (W6). The message doesn't say whether
  activation, payment or the plan is missing.
- **Speech marks (from the docs, built against, not yet run):** word marks give UTF-8 **byte** offsets. That is
  correct and documented, but easy to misuse in JavaScript, where string indexes are UTF-16 code units. In
  Devanagari (3 bytes per character) a naive mapping lands on the wrong word. A JavaScript example in the docs would
  help. We added a byte-check (`markByteMismatches`) to catch it.
- **API ergonomics:** audio and speech marks need separate `SynthesizeSpeech` calls (mp3 for playback, PCM for an
  exact duration, JSON for marks). A combined response, or the duration in the response metadata, would halve the
  calls.
- **Voice quality / timing accuracy:** UNKNOWN until S4 runs.

## Amazon Transcribe Streaming
- **Onboarding:** not on the Free plan (W8). We learned that from the docs after the error, not during sign-up.
- **SDK ergonomics (built, run only against a fake client):** the async-generator `AudioStream` maps cleanly onto
  WebSocket audio frames. Partial-result stabilisation is exactly what a word-by-word UI needs. We retry without
  stabilisation if a language rejects it (unverified whether any of our languages does).
- **Child speech performance, latency, errors:** UNKNOWN. Not measured yet.

## Amazon Bedrock
- Not used yet. An optional, guarded summary adapter is built but disabled by default. No feedback until it runs.

## AWS infrastructure and account tools
- **AWS Organizations + AI services opt-out:** the right mechanism for a children's app, but on a Free plan account
  it forces the Paid plan. The CLI gave no warning, and right after attaching the policy the effective policy read
  `{}` (W7).
- **AWS Budgets:** easy from the CLI.
- **Billing console on a day-old account:** cost widgets show "Unable to load", and Credits shows USD 0.00, with no
  explanation of whether data is still arriving.
- **Cost Anomaly Detection:** set up automatically with a clear email. That was helpful.
- **CloudFormation / EC2 / SSM:** the template and deploy script are written but not deployed yet. Feedback pending.

## Development tools
- **Node.js type stripping (≥ 22.18):** running TypeScript directly, with no build step, kept server, tools and
  tests simple. The server even serves stripped TS to the phone browser.
- **Cloudflare quick tunnel:** essential for https media during development. The tunnel died after the Mac slept,
  and its URL changes on restart. We wrote a self-healing script that publishes the current URL to the TV at runtime.
