import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignIndexes, tokenStarts, marksFromStarts } from '../../tools/content/align.ts';
import { GenerativeNarration, fakePollyClient } from '../../tools/content/narration.ts';
import { parseSpeechMarks, markByteMismatches, timeTokens } from '@wordlight/story-package';

test('alignment: misheard and missing words do not shift the rest', () => {
  const toks = 'Hello, I am the fourth one in the line.'.split(' ');
  // "Hello" heard as "Hollow" (no match → interpolated later), "fourth" missing, an extra "um"
  const heard = ['Hollow', 'I', 'am', 'um', 'the', 'one', 'in', 'the', 'line'];
  assert.deepEqual(alignIndexes(toks, heard, 'en-IN'), [-1, 1, 2, 4, -1, 5, 6, 7, 8]);
});

test('token starts: matched take the recogniser time + offset, unmatched interpolate by length, monotonic', () => {
  const toks = ['We', 'walk', 'quietly.'];
  const r = tokenStarts(toks, [{ text: 'we', startMs: 100, endMs: 250 }, { text: 'quietly', startMs: 700, endMs: 1200 }], 'en-IN', { offsetMs: -20, endMs: 1500 });
  assert.equal(r.matched, 2);
  assert.equal(r.t0[0], 80); assert.equal(r.t0[2], 680);
  assert.ok(r.t0[1] > 80 && r.t0[1] < 680);
  const text = toks.join(' ');
  const marks = parseSpeechMarks(marksFromStarts(text, r.t0));
  assert.deepEqual(markByteMismatches(text, marks), []);
  assert.deepEqual(timeTokens(text, marks, 1500).map((t) => t.t0), r.t0);
});

test('generative narration: SSML to Polly generative, timings from the (fake) recogniser, Hindi refused', async () => {
  const calls: any[] = [];
  const fake = fakePollyClient(calls);
  const g = new GenerativeNarration({ ...fake, voiceId: 'Kajal', style: { volume: '+6dB', lineBreakMs: 650 }, offsetMs: 0,
    transcribe: async () => [{ text: 'we', startMs: 50, endMs: 200 }, { text: 'walk', startMs: 300, endMs: 500 }, { text: 'we', startMs: 1400, endMs: 1500 }, { text: 'talk', startMs: 1900, endMs: 2100 }] });
  const lines = ['We walk.', 'We do not talk.'];
  const n = await g.synthesize(lines.join(' '), 'en-IN', lines);
  assert.ok(calls.every((c) => c.Engine === 'generative' && c.TextType === 'ssml'));
  const t = timeTokens(lines.join(' '), parseSpeechMarks(n.marksNdjson), n.durationMs);
  assert.deepEqual(t.map((x) => x.w), ['We', 'walk.', 'We', 'do', 'not', 'talk.']);
  assert.deepEqual([t[0].t0, t[1].t0, t[2].t0, t[5].t0], [50, 300, 1400, 1900]);
  assert.deepEqual(g.stats, [{ page: 1, tokens: 6, matched: 4 }]);
  assert.equal(g.voice.engine, 'polly-generative');
  await assert.rejects(g.synthesize('एक', 'hi-IN'), /no generative/);
});

test('align-check: onsets after silence and pairing with predicted starts', async () => {
  const { onsets, errorsVsOnsets, summary } = await import('../../tools/s4/align-check.ts');
  const pcm = new Int16Array(16 * 2000);
  for (const [a, b] of [[200, 500], [900, 1300]]) for (let i = a * 16; i < b * 16; i++) pcm[i] = i % 2 ? 8000 : -8000;
  assert.deepEqual(onsets(pcm), [200, 900]);
  const e = errorsVsOnsets([200, 900], [230, 600, 880]);
  assert.deepEqual(e, [30, -20]);
  assert.deepEqual(summary(e), { n: 2, within50: 100, medianAbs: 20, p95Abs: 30, bias: -20 });
});
