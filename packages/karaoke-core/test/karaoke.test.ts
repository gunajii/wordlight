import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayheadSampler, wordIndexAt, phasesAt, lineIndexAt, assertMonotonic, parseKaraokeVtt, toKaraokeVtt, parseTimestamp, formatTimestamp, type TimedWord } from '../src/index.ts';

const W: TimedWord[] = [{ w: 'The', t0: 100, t1: 400 }, { w: 'little', t0: 400, t1: 800 }, { w: 'cat', t0: 800, t1: 1200 }];

test('word lookup at boundaries: before, exactly at t0, inside, after the last', () => {
  assert.equal(wordIndexAt(W, 0), -1);
  assert.equal(wordIndexAt(W, 100), 0);
  assert.equal(wordIndexAt(W, 399), 0);
  assert.equal(wordIndexAt(W, 400), 1);
  assert.equal(wordIndexAt(W, 5000), 2);
  assert.equal(wordIndexAt([], 10), -1);
});

test('phases: spoken / current / upcoming, and the lead offset lights words earlier', () => {
  assert.deepEqual(phasesAt(W, 500), ['spoken', 'current', 'upcoming']);
  assert.deepEqual(phasesAt(W, 1300), ['spoken', 'spoken', 'spoken']); // after the last word ends
  assert.deepEqual(phasesAt(W, 350, 60), ['spoken', 'current', 'upcoming']);
});

test('line lookup moves to the next line when its first word starts', () => {
  const lines = [{ text: 'a', words: [{ w: 'a', t0: 0, t1: 500 }] }, { text: 'b', words: [{ w: 'b', t0: 900, t1: 1500 }] }];
  assert.equal(lineIndexAt(lines, 899), 0);
  assert.equal(lineIndexAt(lines, 900), 1);
});

test('bad timing data fails loudly', () => {
  assert.throws(() => assertMonotonic([{ w: 'x', t0: 10, t1: 5 }]));
  assert.throws(() => assertMonotonic([{ w: 'a', t0: 50, t1: 60 }, { w: 'b', t0: 40, t1: 70 }]));
  assert.doesNotThrow(() => assertMonotonic(W));
});

test('sampler: coarse 250 ms currentTime polled every ~20 ms is timestamped near the change', () => {
  const s = new PlayheadSampler();
  let worst = 0;
  // 17 ms polls: not phase-locked to the 250 ms updates (a real poll loop drifts too)
  for (let now = 0; now <= 5000; now += 17) {
    const reported = Math.floor(now / 250) * 250; // the player's coarse clock
    s.sample(reported, now, true);
    if (now > 1000) worst = Math.max(worst, Math.abs(s.positionAt(now, true)! - now));
  }
  assert.ok(Math.abs(s.updatePeriodMs! - 250) <= 17, `period ${s.updatePeriodMs}`);
  assert.ok(worst <= 9, `worst error ${worst} ms`); // ≤ half a poll interval
});

test('sampler: continuous player is exact; paused position does not advance; reset forgets', () => {
  const s = new PlayheadSampler();
  for (let now = 0; now <= 400; now += 20) s.sample(now, now, true);
  assert.equal(s.positionAt(410, true), 410);
  s.sample(400, 500, false);
  assert.equal(s.positionAt(900, false), 400);
  s.reset();
  assert.equal(s.reading, null);
});

test('WebVTT word timestamps parse, round-trip, and handle Devanagari', () => {
  const vtt = 'WEBVTT\n\nNOTE demo\n\n00:00:00.120 --> 00:00:01.500\n<00:00:00.120>एक <00:00:00.380>छोटा <00:00:00.760>चूहा <00:00:01.100>था।\n\n00:00:02.000 --> 00:00:03.000\n<00:00:02.000>The <00:00:02.400>cat\n';
  const lines = parseKaraokeVtt(vtt);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].words.map((w) => [w.w, w.t0, w.t1]), [['एक', 120, 380], ['छोटा', 380, 760], ['चूहा', 760, 1100], ['था।', 1100, 1500]]);
  assert.deepEqual(parseKaraokeVtt(toKaraokeVtt(lines)), lines);
  assert.equal(parseTimestamp('01:02:03.004'), 3723004);
  assert.equal(formatTimestamp(3723004), '01:02:03.004');
  assert.throws(() => parseKaraokeVtt('nope'));
});
