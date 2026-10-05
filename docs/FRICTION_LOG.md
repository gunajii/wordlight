# Friction log

Only problems actually encountered. Format: Date / Environment / Component / Expected / Actual / Error / Tried / Worked / Workaround / Potential improvement.

### W1 — AudioPlayer API reference omits how to use the player
- **Date:** 2026-09-29
- **Environment:** Vega API reference 0.24, `classes.AudioPlayer.amazon-devices_react-native-w3cmedia`
- **Component:** `@amazon-devices/react-native-w3cmedia` AudioPlayer
- **Expected:** src, play/pause, currentTime, events documented on the class page.
- **Actual:** the page lists the constructor, `initialize`, `deinitialize`, `deinitializeSync`, `setMediaControlFocus`, and says the class extends HTMLMediaElement; no usage example.
- **Error:** none
- **Tried:** the W3C media overview page; the API index.
- **Worked:** reading the source of Amazon's `vega-audio-sample` (`src/utils/AudioHandler.ts`): `new AudioPlayer()` → `await initialize()` → `src = url`, `autoplay = false`, `play()`, `currentTime` in seconds.
- **Workaround:** followed the sample's usage.
- **Potential improvement:** a 10-line AudioPlayer example on the class page.

### W2 — Build command differs between CLI reference and Amazon's own sample
- **Date:** 2026-09-29
- **Environment:** Vega CLI reference 0.24; `AmazonAppDev/vega-audio-sample` package.json (SDK CLI `@amazon-devices/kepler-cli-platform ~0.22`)
- **Component:** Vega build tooling
- **Expected:** one documented build command.
- **Actual:** the 0.24 CLI reference says `npx react-native build-vega`; the audio sample's scripts use `react-native build-kepler` and `kepler device ...`. The installer notes it symlinked `vega` to `kepler` for backward compatibility.
- **Error:** none yet (not built)
- **Tried / Worked / Workaround:** `setup.sh` prints the generated project's own scripts and both commands; the project's own `build:debug` script is used first.
- **Potential improvement:** mark the kepler-era commands as deprecated in samples, or update the samples.

### W3 — "Hello World" page for 0.24 has no CLI commands
- **Date:** 2026-09-29
- **Environment:** Vega docs 0.24 `hello-world.html`
- **Component:** getting-started docs
- **Expected:** the CLI equivalent of the Vega Studio flow.
- **Actual:** only the VS Code (Vega Studio) flow; CLI syntax is in the separate CLI reference.
- **Workaround:** used `vega project generate --template helloWorld …` from the CLI reference.
- **Potential improvement:** add the 4 CLI commands (generate, build, virtual-device start, run-app) to the Hello World page. (The same gap was noted on 0.23 during the author's earlier Earshot project.)

## W4 — `expo-font` installed alone fails at bundle time (MEASURED, 2026-09-30)
- **What happened:** `npm install @amazon-devices/expo-font@~2.0.0` succeeded, but `npm run build:debug` failed in Metro: `Unable to resolve module @amazon-devices/expo-constants from .../expo-font/build/FontLoader.js`. The package's own `package.json` declares only `fontfaceobserver` as a dependency and `expo` as a peer, so npm gives no warning about `expo-constants`/`expo-asset`.
- **Where the answer was:** the expo-font API page lists five packages to add together (`keplerscript-turbomodule-api`, `expo-asset`, `expo-constants`, `expo-font`, `expo`).
- **Cost:** one failed build.
- **Suggestion:** declare `expo-asset`/`expo-constants` as dependencies (or peers) of `@amazon-devices/expo-font` so npm reports them.
- **Fix in repo:** `apps/vega-tv/setup.sh` installs the documented set.

## W5 — Media player silently refuses `http://` sources (MEASURED, 2026-09-30, VVD, SDK 0.24.12112, w3cmedia 2.3.2)
- **What happened:** `AudioPlayer.src = 'http://192.168.1.33:8787/…/p1.mp3'` → no audio. `play()` resolved, the state stayed paused. The JS side only ever gets MediaError code 4 (`MEDIA_ERR_SRC_NOT_SUPPORTED`), which reads like a codec problem.
- **Real cause, native log only:** `MEDIA_PLAYER: isUriSchemeSecure Got an insecure protocol/scheme http, return error` → `set_src_uri: MPB Call failed with code: 50004`. `fetch()` of `story.json` over the same http URL works, so the restriction is specific to the media pipeline.
- **Docs:** the URL-mode playback page shows only https examples; I found no statement that http is refused.
- **Cost:** ~40 min and three rebuilds (key handling was suspected first).
- **Suggestion:** document the https requirement on the URL-mode page, and put the scheme reason in `MediaError.message`.
- **Fix in repo:** audio/images come from `MEDIA_URL` (https); for local runs, an HTTPS tunnel to the dev server.

## W6 — Polly fails on a new AWS account with an error that doesn't say why (MEASURED, 2026-10-05)
- **Environment:** a new AWS account, root credentials via AWS CLI v2, region ap-south-1.
- **Component:** Amazon Polly (`DescribeVoices`, `SynthesizeSpeech`).
- **Expected:** Polly works, or an error that names the missing step (account activation, payment verification,
  or plan).
- **Actual:** `SubscriptionRequiredException: The AWS Access Key Id needs a subscription for the service`. In the
  same session AWS Budgets and AWS Organizations calls worked. The Billing console showed "Unable to load" for
  costs, and Credits showed USD 0.00.
- **Tried:** checked the identity (`sts get-caller-identity`), the region and the Billing pages.
- **Worked:** not resolved yet. We are waiting for account activation and hackathon credits.
- **Potential improvement:** say in the error which condition failed and where to fix it in the console.
- **Severity:** high for a time-boxed project. It blocks the whole speech pipeline.

## W7 — Opting out of AI-service data use changes the billing plan (MEASURED, 2026-10-05)
- **Environment:** a new account on the Free plan. AWS CLI `organizations create-organization`, then an
  `AISERVICES_OPT_OUT_POLICY`.
- **Component:** AWS Organizations / AI services opt-out / Free plan.
- **Expected:** opting a children's app out of Transcribe/Polly content use for service improvement would not
  change the account's plan.
- **Actual:** the opt-out policy needs AWS Organizations. The Billing docs ("Choosing a plan") state that a Free
  plan account that joins Organizations is upgraded to the Paid plan automatically. The CLI showed no warning
  before `create-organization`. Right after attaching the policy, the effective policy printed `{}`.
- **Workaround:** none needed for our use. The Paid plan still spends credits first, and Transcribe needs the
  Paid plan anyway.
- **Potential improvement:** a per-account opt-out setting that doesn't require Organizations, or a warning on
  the opt-out documentation page.
- **Severity:** medium. It surprised a student developer who didn't want to pay.

## W8 — Free plan includes Polly but not Transcribe (MEASURED, 2026-10-05)
- **Component:** AWS Free plan service list ("Supported AWS services", Account Management docs).
- **Expected:** both speech services available while trying them out on the Free plan.
- **Actual:** Polly is on the Free plan list; Transcribe appears only under the Paid plan. We found this from the
  docs after the error in W6, not during sign-up.
- **Potential improvement:** show which services need the Paid plan during sign-up, or on each service's
  console landing page.
- **Severity:** medium.

## W9 — Vega TypeScript environment has no `TextEncoder` type (MEASURED, 2026-10-05, SDK 0.24.12112)
- **Component:** React Native for Vega app (`tsc --noEmit` in the generated project).
- **Expected:** standard web text APIs (`TextEncoder` / `TextDecoder`) available, as in browsers and Node.
- **Actual:** `error TS2304: Cannot find name 'TextEncoder'` when shared code that maps Polly's UTF-8 byte offsets
  was vendored into the app. Runtime availability on Vega is UNKNOWN; we didn't test it.
- **Workaround:** a 10-line UTF-8 encoder in `@wordlight/karaoke-vega` (`utf8()`), tested against `TextEncoder` in
  Node.
- **Potential improvement:** document which Web APIs Vega's JS runtime provides, and ship types for them.
- **Severity:** low.
