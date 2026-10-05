import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordsFromPolly, displayTokens, markByteMismatches, parseSpeechMarks, createKaraokeClock, phasesAt } from '../src/core.ts';

const enc = new TextEncoder();
const mark = (text: string, word: string, from: number, time: number) => {
  const i = text.indexOf(word, from);
  const start = enc.encode(text.slice(0, i)).length;
  return { time, type: 'word', start, end: start + enc.encode(word).length, value: word };
};

test('Polly speech marks are UTF-8 BYTE offsets: Devanagari maps by bytes, not string index', () => {
  const text = 'बिल्ली ने दूध पिया।';
  const marks = [mark(text, 'बिल्ली', 0, 6), mark(text, 'ने', 0, 480), mark(text, 'दूध', 0, 700), mark(text, 'पिया', 0, 1100)];
  const ndjson = marks.map((m) => JSON.stringify(m)).join('\n');
  assert.deepEqual(markByteMismatches(text, parseSpeechMarks(ndjson)), []);
  const words = wordsFromPolly(text, ndjson, 1800);
  assert.deepEqual(words.map((w) => [w.w, w.t0]), [['बिल्ली', 6], ['ने', 480], ['दूध', 700], ['पिया।', 1100]]);
  assert.equal(words.at(-1)!.t1, 1800, 'the last word runs to the end of the audio');
  // using string indexes instead of bytes would land on the wrong words:
  assert.ok(marks[1].start > text.indexOf('ने'), 'bytes ≠ string index for Devanagari');
  assert.equal(displayTokens(text).length, 4);
});

test('English: punctuation stays on the display word; a stand-alone dash takes the previous word’s time', () => {
  const text = '“Come here,” said Mom — now.';
  const marks = [mark(text, 'Come', 0, 0), mark(text, 'here', 0, 300), mark(text, 'said', 0, 700), mark(text, 'Mom', 0, 950), mark(text, 'now', 0, 1400)];
  const words = wordsFromPolly(text, marks.map((m) => JSON.stringify(m)).join('\n'), 2000);
  assert.deepEqual(words.map((w) => w.w), ['“Come', 'here,”', 'said', 'Mom', '—', 'now.']);
  assert.equal(words[4].t0, 950);
});

test('clock: a player whose currentTime updates only every 250 ms still yields a smooth, unbiased position', () => {
  let t = 0; const ticks: number[] = []; let fn: (() => void) | null = null;
  const player = { get currentTime() { return Math.floor(t / 250) * 0.25; }, paused: false };
  const clock = createKaraokeClock({ player: () => player, onTick: (p) => ticks.push(p), pollMs: 20, now: () => t, setInterval: (f) => { fn = f; return 1; }, clearInterval: () => {} });
  for (t = 0; t <= 2000; t += 20) fn!();
  const errs = ticks.slice(40).map((p, i) => Math.abs(p - (800 + 20 * i)));
  assert.ok(Math.max(...errs) <= 20, `max error ${Math.max(...errs)} ms (raw currentTime would be up to 250 ms behind)`);
  assert.ok(Math.abs(clock.sampler.updatePeriodMs! - 250) <= 20, 'measures the player update period');
  assert.deepEqual(phasesAt([{ w: 'a', t0: 0, t1: 500 }, { w: 'b', t0: 500, t1: 900 }], ticks.at(-1)!), ['spoken', 'spoken']);
});

test('utf8() matches TextEncoder for ASCII, Devanagari, curly quotes and emoji', async () => {
  const { utf8 } = await import('../src/polly.ts');
  for (const s of ['abc', 'बिल्ली ने दूध पिया।', '“Hi” — ok', 'a😀b', 'ज़']) assert.deepEqual(utf8(s), [...new TextEncoder().encode(s)]);
});
