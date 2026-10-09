# Friction log

Real problems we hit while building WordLight (solo developer, macOS arm64, Vega SDK 0.24.12112, new AWS account in
ap-south-1), each written as: **task → steps → expected → actual → severity → workaround → suggestion**. Nothing here is
invented; where a detail was not recorded at the time it says so. Severity is our own rating of the cost to us.

| # | Product | Friction | Severity |
|---|---|---|---|
| [W1](#w1) | Vega · AudioPlayer docs | API page has no usage example | Medium |
| [W2](#w2) | Vega · CLI / samples | Build command differs between CLI docs (`vega`) and Amazon's sample (`kepler`) | Low |
| [W3](#w3) | Vega · getting started | 0.24 Hello World page has no CLI commands | Low |
| [W4](#w4) | Vega · expo-font | Installed alone, fails at bundle time (undeclared companions) | Medium |
| [W5](#w5) | Vega · media player | `http://` media silently refused; JS only sees MediaError 4 | High |
| [W6](#w6) | AWS · Polly (new account) | `SubscriptionRequiredException` without saying what is missing | High |
| [W7](#w7) | AWS · Organizations AI opt-out | Opting out of AI data use moves a Free plan account to the Paid plan, no warning | Medium |
| [W8](#w8) | AWS · Free plan | Polly is on the Free plan, Transcribe is not — learned only after an error | Medium |
| [W9](#w9) | Vega · TypeScript env | No `TextEncoder` type in the app's environment | Low |
| [W10](#w10) | AWS · account activation | Services came online one by one ~30 min after the Paid-plan upgrade | Medium |
| [W11](#w11) | AWS · Polly voices | Kajal not listed for hi-IN unless `IncludeAdditionalLanguageCodes` | Low |
| [W12](#w12) | AWS · Bedrock | Every model refused on a new account (`NOT_AUTHORIZED`), no remedy in the error | Medium |
| [W13](#w13) | (our tooling) macOS Python | numpy missing — **not Amazon friction**, kept for honesty | Low |
| [W14](#w14) | Vega · Virtual Device | Clock hours behind → HTTPS fails as “Network request failed” | High |
| [W15](#w15) | AWS · EC2 | Stopped t4g.micro would not start (`InsufficientInstanceCapacity`) | Medium |
| [W16](#w16) | AWS · Polly SSML marks | hi-IN returned a *word* speech mark for a `<break/>` tag | Low |
| [W17](#w17) | AWS · Polly generative | Generative voices return no speech marks — no word highlighting | Medium |

---

<a id="w1"></a>
### W1 — AudioPlayer API reference has no usage example
**Date / env:** 2026-09-29 · Vega API reference 0.24, `@amazon-devices/react-native-w3cmedia` AudioPlayer
- **Task:** play a story's narration and read the playhead every 20 ms for word highlighting.
- **Steps:** opened the AudioPlayer class page → the W3C media overview → the API index.
- **Expected:** `src`, `play`/`pause`, `currentTime` and events documented with an example.
- **Actual:** the class page lists the constructor, `initialize`, `deinitialize`, `deinitializeSync`,
  `setMediaControlFocus` and says it extends HTMLMediaElement; no example of the required order of calls.
- **Severity:** Medium (time lost reading sample source).
- **Workaround:** read Amazon's `vega-audio-sample` (`src/utils/AudioHandler.ts`): `new AudioPlayer()` →
  `await initialize()` → `src = url`, `autoplay = false` → `play()`; `currentTime` is in seconds.
- **Suggestion:** a 10-line AudioPlayer example on the class page.

<a id="w2"></a>
### W2 — Build command differs between the CLI reference and Amazon's own sample
**Date / env:** 2026-09-29 · Vega CLI reference 0.24; `AmazonAppDev/vega-audio-sample` (CLI `@amazon-devices/kepler-cli-platform ~0.22`)
- **Task:** build the generated app from the command line.
- **Steps:** compared the CLI reference with the sample's `package.json` scripts.
- **Expected:** one documented build command.
- **Actual:** the 0.24 reference says `npx react-native build-vega`; the sample uses `react-native build-kepler` and
  `kepler device …`. The installer notes it symlinked `vega` to `kepler` for compatibility.
- **Severity:** Low.
- **Workaround:** use the generated project's own `npm run build:debug` (it worked throughout the project).
- **Suggestion:** mark kepler-era commands as deprecated in the samples, or update the samples.

<a id="w3"></a>
### W3 — The 0.24 Hello World page has no CLI commands
**Date / env:** 2026-09-29 · Vega docs 0.24 `hello-world.html`
- **Task:** create and run a first app without VS Code.
- **Steps:** followed the Hello World page, then searched the CLI reference.
- **Expected:** the CLI equivalent of the Vega Studio flow.
- **Actual:** only the VS Code (Vega Studio) flow; the CLI syntax is on a separate page.
- **Severity:** Low.
- **Workaround:** `vega project generate --template helloWorld …` from the CLI reference.
- **Suggestion:** add the four commands (generate, build, `virtual-device start`, `run-app`) to the Hello World page.

<a id="w4"></a>
### W4 — `expo-font` installed alone fails at bundle time
**Date / env:** 2026-09-30 · Vega SDK 0.24, `@amazon-devices/expo-font@~2.0.0`, Metro
- **Task:** bundle Noto Sans Devanagari so Hindi renders reliably.
- **Steps:** `npm install @amazon-devices/expo-font@~2.0.0` → `npm run build:debug`.
- **Expected:** npm installs (or warns about) everything the package needs.
- **Actual:** Metro failed: `Unable to resolve module @amazon-devices/expo-constants from …/expo-font/build/FontLoader.js`.
  The package declares only `fontfaceobserver` (and `expo` as a peer), so npm gave no warning.
- **Severity:** Medium (one failed build and a search).
- **Workaround:** install the five packages the expo-font API page lists together (`keplerscript-turbomodule-api`,
  `expo-asset`, `expo-constants`, `expo-font`, `expo`); `apps/vega-tv/setup.sh` does it.
- **Suggestion:** declare `expo-asset`/`expo-constants` as dependencies or peers of `@amazon-devices/expo-font`.

<a id="w5"></a>
### W5 — Media player silently refuses `http://` sources
**Date / env:** 2026-09-30 · Vega Virtual Device, SDK 0.24.12112, w3cmedia 2.3.2
- **Task:** play page narration served by the local dev server.
- **Steps:** `AudioPlayer.src = 'http://192.168.1.33:8787/…/p1.mp3'` → `play()`; suspected key handling first;
  three rebuilds; then read `vega device start-log-stream`.
- **Expected:** playback, or an error naming the reason.
- **Actual:** no audio; `play()` resolved, state stayed paused; JS saw only MediaError 4
  (`MEDIA_ERR_SRC_NOT_SUPPORTED`), which reads like a codec problem. Only the native log said
  `isUriSchemeSecure Got an insecure protocol/scheme http, return error` (`MPB Call failed with code: 50004`).
  `fetch()` over the same URL worked, so the rule is specific to media. The URL-mode page shows only https examples.
- **Severity:** High (~40 min, three rebuilds, misleading error).
- **Workaround:** serve media over https (an HTTPS tunnel locally; Caddy TLS on AWS).
- **Suggestion:** document the https requirement on the URL-mode page and put the reason in `MediaError.message`.

<a id="w6"></a>
### W6 — Polly fails on a new account with an error that does not say why
**Date / env:** 2026-10-05 · new AWS account, root via AWS CLI v2, ap-south-1
- **Task:** first Polly call (`DescribeVoices`, `SynthesizeSpeech`) for narration.
- **Steps:** ran the call → checked `sts get-caller-identity`, the region and the Billing pages; Budgets and
  Organizations calls in the same session worked.
- **Expected:** Polly works, or the error names the missing step (activation, payment verification or plan).
- **Actual:** `SubscriptionRequiredException: The AWS Access Key Id needs a subscription for the service`. Billing
  showed “Unable to load” and Credits USD 0.00.
- **Severity:** High for a time-boxed project — it blocked the whole speech pipeline for three days.
- **Workaround / resolution:** none at the time; it resolved after the account was upgraded to the Paid plan on
  2026-10-08 (and the wait in W10).
- **Suggestion:** name the failed condition and where to fix it in the console.

<a id="w7"></a>
### W7 — Opting out of AI-service data use changes the billing plan
**Date / env:** 2026-10-05 · new account on the Free plan, AWS CLI `organizations create-organization`
- **Task:** opt a children's app out of Transcribe/Polly content use for service improvement before any child audio.
- **Steps:** `create-organization` → create and attach an `AISERVICES_OPT_OUT_POLICY` → read the effective policy.
- **Expected:** the opt-out does not change the account's plan.
- **Actual:** the opt-out needs AWS Organizations, and a Free plan account that joins Organizations is upgraded to the
  Paid plan (Billing docs, “Choosing a plan”). The CLI gave no warning before `create-organization`; right after
  attaching, the effective policy printed `{}`.
- **Severity:** Medium (a surprise for a student who did not want to pay).
- **Workaround:** none needed — credits are still spent first, and Transcribe needs the Paid plan anyway.
- **Suggestion:** a per-account opt-out that does not need Organizations, or a warning on the opt-out page.

<a id="w8"></a>
### W8 — Free plan includes Polly but not Transcribe
**Date / env:** 2026-10-05 · AWS Free plan, “Supported AWS services” (Account Management docs)
- **Task:** try both speech services on the Free plan before committing money.
- **Steps:** after the W6 error, read the Free plan service list.
- **Expected:** both speech services available to try.
- **Actual:** Polly is on the Free plan list; Transcribe only on the Paid plan — found in the docs after the error, not
  during sign-up.
- **Severity:** Medium.
- **Workaround:** planned the Paid plan upgrade (done 2026-10-08).
- **Suggestion:** show which services need the Paid plan at sign-up and on each service's console page.

<a id="w9"></a>
### W9 — The Vega TypeScript environment has no `TextEncoder` type
**Date / env:** 2026-10-05 · React Native for Vega app, SDK 0.24.12112, `tsc --noEmit`
- **Task:** share the Polly speech-mark mapping (UTF-8 byte offsets) between server and TV.
- **Steps:** vendored the shared module into the app → type-checked.
- **Expected:** `TextEncoder`/`TextDecoder` available, as in browsers and Node.
- **Actual:** `error TS2304: Cannot find name 'TextEncoder'`. Runtime availability on Vega: not tested.
- **Severity:** Low.
- **Workaround:** a 10-line UTF-8 encoder (`utf8()` in `@wordlight/karaoke-vega`), tested against `TextEncoder` in Node.
- **Suggestion:** document which Web APIs the Vega JS runtime provides and ship their types.

<a id="w10"></a>
### W10 — Services came online one by one after the Paid-plan upgrade
**Date / env:** 2026-10-08 · same account; “Your AWS account upgraded to a paid plan” e-mail at 17:26 IST
- **Task:** start the AWS measurements as soon as the upgrade was confirmed.
- **Steps:** ran our guard script (`infra/aws/guard.sh`: Polly, Transcribe, EC2 probes) every few minutes.
- **Expected:** every service usable once the e-mail arrives.
- **Actual:** Transcribe answered first; Polly and EC2 kept returning `SubscriptionRequiredException` /
  `OptInRequired` until about 17:54 — roughly 30 minutes.
- **Severity:** Medium (looks like a permissions bug until it resolves itself).
- **Workaround:** the guard script checks each service before any spending step.
- **Suggestion:** say in the e-mail/console that activation can take ~30 minutes, with a status per service.

<a id="w11"></a>
### W11 — Kajal not listed for hi-IN without `IncludeAdditionalLanguageCodes`
**Date / env:** 2026-10-08 · Amazon Polly `DescribeVoices`, neural, ap-south-1
- **Task:** confirm a neural Hindi voice before narrating the Hindi story.
- **Steps:** `describe-voices --engine neural --language-code hi-IN` → empty → read the voice list → retried with the flag.
- **Expected:** the Hindi neural voice is listed.
- **Actual:** empty list. Kajal's primary language is en-IN with hi-IN as an “additional language”; she appears only
  with `--include-additional-language-codes`, yet `SynthesizeSpeech` with `LanguageCode=hi-IN` works.
- **Severity:** Low (one debugging round; our guard script had reported Hindi as unavailable).
- **Workaround:** always pass the flag.
- **Suggestion:** list bilingual voices under their additional languages by default, or note it on the voice page.

<a id="w12"></a>
### W12 — Bedrock refuses every model on a new account
**Date / env:** 2026-10-08 · Bedrock Runtime `Converse`, ap-south-1, root credentials, account upgraded that day
- **Task:** a parent “reading coach” summary from session counts with the cheapest suitable model.
- **Steps:** SDK benchmark over five small models → bare CLI `converse` per model → `GetFoundationModelAvailability`
  → opened an AWS Support case (2026-10-08; no reply as of 2026-10-09).
- **Expected:** Amazon Nova Micro (first-party, APAC inference profile) usable on demand.
- **Actual:** SDK `AccessDeniedException`; CLI `ValidationException: Operation not allowed` for Nova Micro (direct and
  APAC), Nova Lite and Ministral 3B, while `ListFoundationModels`/`ListInferenceProfiles` listed them.
  Availability: region, entitlement, agreement AVAILABLE but `authorizationStatus: NOT_AUTHORIZED`, with no console
  action to change it.
- **Severity:** Medium (it blocked the Bedrock feature).
- **Workaround:** a deterministic template summary (the product works without Bedrock).
- **Suggestion:** an actionable message (“new accounts need …; open a case at …”) and one exception name for one cause.

<a id="w13"></a>
### W13 — (our own tooling) macOS system Python has no numpy
**Date / env:** 2026-10-08 · macOS 26 `python3`
- **Task / steps:** run our S4 timing analysis on the Mac → `import numpy` failed.
- **Severity:** Low. **Workaround:** synthesise on the Mac, analyse elsewhere. **Not an Amazon product issue** —
  kept so the record is complete; not part of the friction bonus.

<a id="w14"></a>
### W14 — Virtual Device clock hours behind → every HTTPS request fails as “Network request failed”
**Date / env:** 2026-10-08 · Vega Virtual Device (SDK 0.24.12112) on macOS, `fetch` in a React Native for Vega app
- **Task:** point the TV app at our AWS server (Let's Encrypt certificate).
- **Steps:** health check from the Mac passed → TV showed “No WordLight server answered” → read the device log
  (`CURL Error code 60`) → suspected the certificate chain and switched Caddy to RSA (no change) → logged the device
  clock from the app → restarted the Virtual Device.
- **Expected:** the virtual device keeps the host's time, or a TLS failure names its cause.
- **Actual:** the device clock read 10:04 UTC at 17:26 UTC; the certificate (valid from 16:21 UTC) looked “not yet
  valid”. JavaScript saw only `Network request failed`; nothing mentioned time. On 2026-10-09 the device's log timestamps again
  lagged the real time by many hours (their time zone not verified; HTTPS still worked because the certificate was older).
- **Severity:** High for first-time developers (looks exactly like a server or network outage; ~1 hour lost).
- **Workaround:** restart the Virtual Device before testing (our demo script offers it); the app shows its clock on
  the error screen.
- **Suggestion:** keep the virtual device clock synced with the host (also after sleep), and report
  `certificate not yet valid` distinctly to the app and the log.

<a id="w15"></a>
### W15 — A stopped t4g.micro could not be started
**Date / env:** 2026-10-09 · Amazon EC2 `StartInstances`, ap-south-1, t4g.micro (Graviton), stopped overnight
- **Task:** start the demo server for a test run.
- **Steps:** `aws ec2 start-instances` (via our deploy script) → failed → read the error → changed the instance type.
- **Expected:** a stopped instance of the smallest size starts, or the CLI can wait for capacity.
- **Actual:** `InsufficientInstanceCapacity … (reached max retries: 2): Insufficient capacity.` The instance is tied to
  its Availability Zone, so the only options are to wait or change the type.
- **Severity:** Medium (a cost-saving stop-when-idle design becomes “the demo server may not come back”).
- **Workaround:** `tools/aws/start-server.sh` retries 3× a minute apart, then switches the stopped instance to
  t4g.small (same image) and logs it — it started.
- **Suggestion:** suggest an alternative type in the error, or offer “start when capacity returns”.

<a id="w16"></a>
### W16 — Polly hi-IN returned a word speech mark for an SSML `<break/>` tag
**Date / env:** 2026-10-08 · Amazon Polly neural Kajal, `LanguageCode=hi-IN`, SSML input, `SpeechMarkTypes=["word"]`
- **Task:** add pauses between lines (`<break time="650ms"/>`) and keep word highlighting exact.
- **Steps:** built the Hindi story with SSML → our byte check (`markByteMismatches`) stopped the build → inspected the marks.
- **Expected:** word marks only for spoken words (offsets into the SSML input, as documented).
- **Actual:** a `"type":"word"` mark whose value was the tag itself: `{"value":"<break time=\"650ms\"/>", …}`. The same
  SSML style in en-IN produced no such mark.
- **Severity:** Low (caught by our validation; a silent mis-highlight without it).
- **Workaround:** drop word marks whose value is an SSML tag before mapping offsets.
- **Suggestion:** never emit word marks for SSML tags, or document it.

<a id="w17"></a>
### W17 — Polly generative voices return no speech marks
**Date / env:** 2026-10-08 · Amazon Polly generative Kajal (en-IN), ap-southeast-1
- **Task:** a more expressive narrator for children while keeping word-by-word highlighting.
- **Steps:** auditioned neural vs generative → requested speech marks → read the generative-voices page.
- **Expected:** word speech marks like the neural voices (they are what makes read-along possible).
- **Actual:** generative voices do not support speech marks (documented), so the expressive voice cannot highlight words.
- **Severity:** Medium (forces a second service for timing).
- **Workaround:** Amazon Transcribe listens to the generative narration and our aligner maps its words onto the known
  text (measured before adoption: median 40 ms vs 52 ms for neural speech marks on the same pages).
- **Suggestion:** speech marks for generative voices — it would make them usable for read-along and karaoke apps.
