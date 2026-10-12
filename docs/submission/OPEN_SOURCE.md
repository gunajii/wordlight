# Open Source mini-challenge: @wordlight/karaoke-vega

**What:** word-timed ("karaoke") subtitles for React Native on Vega OS / Fire TV. It provides:
- an accurate playhead from a coarse `currentTime` (`PlayheadSampler`, `createKaraokeClock`);
- word and line lookup with a latency lead;
- WebVTT word timestamps;
- Amazon Polly speech marks → timed words, mapped by UTF-8 bytes (Devanagari-safe, no `TextEncoder` needed);
- `<KaraokeLine>`.

**Licence:** MIT. **Tests:** 11 (`npm test` inside the package). **Example:** `example/vega/App.tsx`.
**Install:** `npm install github:gunajii/karaoke-vega` (not on the npm registry).

**Where it lives now:** `oss/karaoke-vega/` in the WordLight repository. WordLight uses it as its single source:
the TV subtitle is `<KaraokeLine>`, and the server and content pipeline import its Polly mapping.

**Standalone repository:** https://github.com/gunajii/karaoke-vega. **Published 2026-10-08** (commit `2a8f4d9` on `main` — the same files as the first push `4ad482b`; message and author e-mail rewritten on 2026-10-09; 11 tests, MIT). The CI workflow runs `npm test` on Node 22.18.
**Update 2026-10-10** (commit `8624470`): `<KaraokeLine>` highlights the current word with text colour, because a
`backgroundColor` on a nested `<Text>` is not drawn on the Vega Virtual Device (found in a screen recording, fix checked
in a second one; friction W19).
**Update 2026-10-12** (0.1.1, commits `05f057f` and `47ca205`): the README told users to `npm install @wordlight/karaoke-vega`, but the
package was never on the npm registry, and `tsc` failed on a clean checkout (`Array.prototype.at` needs `lib ES2022`).
Now `npm install github:gunajii/karaoke-vega` builds it on install (`prepare`); checked from an empty project against
GitHub, running the README's *Basic usage* example (MEASURED, 2026-10-12). Later changes are committed on top of `main` (the published history is one squashed
commit, so `tools/oss/publish.sh`'s subtree split no longer lines up with it).

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
