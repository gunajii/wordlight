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
