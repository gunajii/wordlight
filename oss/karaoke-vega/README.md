# @wordlight/karaoke-vega

Word-timed ("karaoke") subtitles for **React Native on Vega OS (Fire TV)**, and for any React Native or JavaScript
target. Each word lights up as it is spoken.

Extracted from WordLight, a read-along app for Fire TV built for the Amazon "Build, Ship, Shape" hackathon (2026). MIT licence. Repository: https://github.com/gunajii/karaoke-vega

## Problem
A subtitle line that changes once per sentence is fine for following a story. A child learning to read needs to
see **which word** is being said, at the moment it is said. That takes three things:
1. word timings;
2. an accurate playhead;
3. a way to correct for the device's audio delay.

None of these come with the media player. This package provides all three, with no dependencies.

## Why word-timed subtitles matter
- **Same-language subtitling.** Highlighting each word as it is spoken links the sound of a word to its written
  form. The approach is studied in literacy programmes (for example PlanetRead's Same Language Subtitling in India).
  This package makes no learning claims: it is the timing mechanism.
- **Accessibility.** Viewers who are hard of hearing, or learning the language, can follow speech at word level.

## Installation
```
npm install @wordlight/karaoke-vega
```
The core (`@wordlight/karaoke-vega/core`) is plain TypeScript with no dependencies. `<KaraokeLine>` needs `react`
and `react-native` (optional peer dependencies).

## Basic usage
```ts
import { parseKaraokeVtt, phasesAt, lineIndexAt } from '@wordlight/karaoke-vega/core';

const lines = parseKaraokeVtt(`WEBVTT

00:00:00.300 --> 00:00:01.900
<00:00:00.300>Mina <00:00:00.610>has <00:00:00.920>a <00:00:01.230>red <00:00:01.540>kite.`);
const line = lines[lineIndexAt(lines, 700)];
phasesAt(line.words, 700);   // ['spoken', 'current', 'upcoming', 'upcoming', 'upcoming']
```

From **Amazon Polly** word speech marks (`OutputFormat: json`, `SpeechMarkTypes: ['word']`):
```ts
import { wordsFromPolly } from '@wordlight/karaoke-vega/core';
const words = wordsFromPolly(textSentToPolly, speechMarksNdjson, audioDurationMs);
```
Polly's `start`/`end` are **UTF-8 byte offsets** into the text you sent, not string indexes. In Devanagari a
character is 3 bytes, so using them as string indexes points at the wrong words. `wordsFromPolly` maps by bytes,
keeps punctuation on the display word, and gives a stand-alone token such as "—" the previous word's time.
`markByteMismatches(text, marks)` checks that the text you map onto is byte-for-byte the text Polly received.

## Vega integration
```tsx
import { AudioPlayer } from '@amazon-devices/react-native-w3cmedia';
import { KaraokeLine, createKaraokeClock } from '@wordlight/karaoke-vega';

const clock = createKaraokeClock({ player: () => player, onTick: setPositionMs, pollMs: 20 });
// …
<KaraokeLine words={line.words} positionMs={positionMs} leadMs={LEAD_MS} style={{ fontSize: 56 }} />
```
A complete minimal app is in [`example/vega/App.tsx`](example/vega/App.tsx). Two Vega specifics from building
WordLight:
- the W3C `AudioPlayer` refuses `http://` sources, so use https;
- on Vega, OK on the remote arrives as `select` or `kpenter`.

## Timing model
- Word `i` is **current** while `t0 ≤ position + leadMs < t1`. Words before it are **spoken**; words after it are
  **upcoming**. Words are sorted by `t0`, and lookup is a binary search.
- **Playhead.** A player's `currentTime` may update only every N ms. `PlayheadSampler` polls it often (20 ms),
  timestamps the moment the value *changes*, and extrapolates between changes. This removes the up-to-N-ms lag of
  reading `currentTime` directly, without bias. It also reports the measured update period, which is useful to know
  on a new platform.
- **`leadMs`** shifts the text relative to the audio. Measure your device's audio output delay and set
  `leadMs = −delay`. In WordLight's test on the Vega Virtual Device the measured offsets were −339 ms (M4A) and
  −392 ms (MP3). With the correction, the median highlight/audio offset was about −1 ms (SD about 11 ms, from
  screen recordings). Those numbers come from one emulator setup. Measure your own device.

## Example
`example/vega/App.tsx` is an audio player with subtitles. `example/data/sample.vtt` holds word timestamps in
standard WebVTT cue-text timestamp syntax.

## Testing
```
npm test        # node:test on the TypeScript sources (Node ≥ 22.18)
```
The tests cover:
- word and line lookup at boundaries, and the lead offset;
- monotonic timing checks;
- a WebVTT round trip;
- Polly byte offsets for Devanagari and English punctuation;
- clock accuracy against a player that updates every 250 ms.

## Limitations
- One line at a time: `<KaraokeLine>` renders a line and does not lay out paragraphs.
- Right-to-left scripts have not been tested.
- The WebVTT parser handles cue timestamps and word timestamps. It ignores styling, regions and voice spans.
- Polly speech marks are trusted as given. How well they match the audio depends on the voice and language;
  WordLight measures this separately (its "S4" check).
- `leadMs` is a constant. It does not follow output latency that drifts or changes, for example after switching
  Bluetooth audio.
- So far tested on the Vega Virtual Device only, not on physical Fire TV hardware.

## License
MIT © 2026 Gunaji Mohite
