# Changelog

## 0.1.0 (unreleased)

The first extraction from WordLight, a read-along app for Fire TV.

- `wordIndexAt` and `phasesAt` (with a lead offset); `lineIndexAt`, `assertMonotonic`.
- `PlayheadSampler`: an accurate playhead from a quantised `currentTime`, plus a measured update period.
- WebVTT word timestamps: `parseKaraokeVtt` and `toKaraokeVtt`.
- Amazon Polly speech marks: `timeTokens` and `wordsFromPolly`, which map UTF-8 byte offsets to display words
  (Devanagari-safe), and `markByteMismatches`.
- `createKaraokeClock` (framework-free) and `<KaraokeLine>` (React Native).
