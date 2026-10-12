# Changelog

## 0.1.1 (2026-10-12)

- Installable from GitHub: `npm install github:gunajii/karaoke-vega` (a `prepare` script builds `dist/`).
  The README's `npm install @wordlight/karaoke-vega` did not work: the package was never published to npm.
- The build compiles from a clean checkout (`lib: ES2022` for `Array.prototype.at`).

## 0.1.0 (unreleased)

The first extraction from WordLight, a read-along app for Fire TV.

- `wordIndexAt` and `phasesAt` (with a lead offset); `lineIndexAt`, `assertMonotonic`.
- `PlayheadSampler`: an accurate playhead from a quantised `currentTime`, plus a measured update period.
- WebVTT word timestamps: `parseKaraokeVtt` and `toKaraokeVtt`.
- Amazon Polly speech marks: `timeTokens` and `wordsFromPolly`, which map UTF-8 byte offsets to display words
  (Devanagari-safe), and `markByteMismatches`.
- `createKaraokeClock` (framework-free) and `<KaraokeLine>` (React Native).
- `<KaraokeLine>` default current-word style is yellow text rather than a yellow box: a nested-`<Text>`
  `backgroundColor` is not drawn on the Vega Virtual Device (seen in a screen recording of WordLight).
