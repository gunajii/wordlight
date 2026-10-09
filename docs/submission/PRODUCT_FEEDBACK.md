# Product feedback

Every tool, API and SDK we used. This is first-hand only. "Not used yet" means exactly that. Dated entries with
reproduction details are in [docs/FRICTION_LOG.md](../FRICTION_LOG.md) (W1–W17).

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
- Stable over a 3-minute timing run. Devanagari conjuncts and matras rendered correctly.
- **Its clock drifted 7 h 22 min behind** (we suspect after the Mac slept; not verified). Every HTTPS request then failed as "Network request
  failed" (native log: curl error 60) because the certificate looked "not yet valid" (W14). Restarting the VVD fixed
  it; a distinct "certificate not yet valid" error would have saved an hour.
- Starting a page's `AudioPlayer` after a seek can take longer than a short word, so timer-based "play one word"
  overran into the next words; we moved help words to separate clips in a second player.
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
- **Onboarding (new account):** `SubscriptionRequiredException` until the Paid plan upgrade, then services came
  online one at a time over ~30 minutes (W6, W10). The message never says what is missing.
- **Bilingual voice discovery:** `DescribeVoices --language-code hi-IN` returns nothing for Kajal, the voice that
  speaks Hindi; she appears only with `--include-additional-language-codes` (W11).
- **Speech marks:** word marks carry UTF-8 **byte** offsets — correct, but easy to misuse in JavaScript (UTF-16). In
  Devanagari a naive mapping lands on the wrong word; our `markByteMismatches` check catches it. With SSML input, the
  offsets point into the SSML, and for hi-IN Polly also returned a "word" mark for a `<break/>` tag. A JavaScript
  example and a note on SSML offsets would help.
- **Timing accuracy (MEASURED, S4):** 53 % of word marks within 50 ms of the acoustic onset, median 40 ms — good
  enough to read along, not frame-exact. Byte-identical audio for identical input, which made caching safe.
- **Generative voices:** clearly more expressive for a children's story, but **no speech marks** — so no word
  highlighting without a second service. Speech marks for generative voices would make them usable for read-along.
- **Volume:** neural narration measured −24 LUFS (broadcast level); `<prosody volume="+6dB">` fixed it in SSML.
- **API ergonomics:** audio, PCM (for the exact duration) and marks are three `SynthesizeSpeech` calls.

## Amazon Transcribe Streaming
- **Onboarding:** not on the Free plan (W8).
- **SDK ergonomics:** the async-generator `AudioStream` maps cleanly onto WebSocket frames; partial-result
  stabilisation is exactly what a word-by-word UI needs.
- **Latency (MEASURED, S2 + real loop):** the decisive limit for read-along. Words are recognised reliably (≈ 95 %
  eventually) but typically ~1 s after they start; stability "none" is faster but less conservative. A documented
  low-latency mode (or per-word "early" results) would open up real-time reading tutors.
- **Accuracy notes (adult synthetic speech):** names are misheard (Tara → "Sarah", Anu → "A who"); in hi-IN
  "माँ ने" came back as "माने". Custom vocabularies per story would likely help (not tried).
- **Child speech:** UNKNOWN — not tested without a guardian's permission.

## Amazon Bedrock
- **Blocked on a new account:** `ValidationException: Operation not allowed` (CLI) / `AccessDeniedException` (SDK)
  for every model, while listing works; `GetFoundationModelAvailability` says `NOT_AUTHORIZED` with no console action
  to fix it (W12). Two different exception names and no remedy in the message.

## AWS infrastructure and account tools
- **AWS Organizations + AI services opt-out:** the right mechanism for a children's app, but on a Free plan account
  it forces the Paid plan, with no warning in the CLI (W7).
- **AWS Budgets / Cost Explorer:** easy from the CLI; Cost Explorer returned nothing for the first day.
- **CloudFormation / EC2 / SSM:** a one-stack deploy worked first time; SSM `send-command` made updates without SSH
  simple. Our own bug: re-checking the TLS certificate before Caddy had restarted requested a new Let's Encrypt
  certificate on every deploy (fixed; verified in docs/results/deploy/).

## Development tools
- **Node.js type stripping (≥ 22.18):** running TypeScript directly, with no build step, kept server, tools and
  tests simple. The server even serves stripped TS to the phone browser.
- **Cloudflare quick tunnel:** essential for https media during development. The tunnel died after the Mac slept,
  and its URL changes on restart. We wrote a self-healing script that publishes the current URL to the TV at runtime.
