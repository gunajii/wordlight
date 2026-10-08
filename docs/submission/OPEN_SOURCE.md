# Open Source mini-challenge: @wordlight/karaoke-vega

**What:** word-timed ("karaoke") subtitles for React Native on Vega OS / Fire TV. It provides:
- an accurate playhead from a coarse `currentTime` (`PlayheadSampler`, `createKaraokeClock`);
- word and line lookup with a latency lead;
- WebVTT word timestamps;
- Amazon Polly speech marks → timed words, mapped by UTF-8 bytes (Devanagari-safe, no `TextEncoder` needed);
- `<KaraokeLine>`.

**Licence:** MIT. **Tests:** 11 (`npm test` inside the package). **Example:** `example/vega/App.tsx`.

**Where it lives now:** `oss/karaoke-vega/` in the WordLight repository. WordLight uses it as its single source:
the TV subtitle is `<KaraokeLine>`, and the server and content pipeline import its Polly mapping.

**Standalone repository:** `https://github.com/gunajii/karaoke-vega`. Status: to be created by the owner.
1. On github.com, create an empty **public** repo named `karaoke-vega`. Don't add a README, licence or .gitignore.
2. Then run `bash tools/oss/publish.sh`. It splits `oss/karaoke-vega` out with its history and pushes it to `main`.
Optional: `cd oss/karaoke-vega && npm install && npm run build && npm publish --access public`. Publishing needs an
npm account and the `@wordlight` scope; otherwise rename the package to an unscoped or personal scope.

**Devpost fields**
- Repository URL: `https://github.com/gunajii/karaoke-vega`
- GitHub username: `gunajii`
- Description: "Word-timed (karaoke) subtitles for Vega OS / Fire TV: an accurate playhead from a coarse
  currentTime, WebVTT word timestamps, Amazon Polly speech marks mapped by UTF-8 bytes, and a `<KaraokeLine>`
  component. Extracted from WordLight. MIT."

**Honest limits** (also in the package README):
- tested on the Vega Virtual Device only, not physical Fire TV;
- one line at a time;
- no right-to-left testing;
- the lead is a constant.
