// Smoke test of the help-recovery harness flow without AWS: a deaf recogniser, tone "speech".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOne, casesFromStories } from '../../tools/s2/help-recovery.ts';
import type { SpeechSource } from '../src/reading/speech.ts';

const deaf: SpeechSource = { name: 'deaf-test', simulated: true, open: () => ({ stats: { chunks: 0, bytes: 0, updates: 0 }, push() {}, end() {} }) };
const tone = (ms: number) => { const p = new Int16Array(ms * 16); for (let i = 0; i < p.length; i++) p[i] = Math.round(4000 * Math.sin(i / 3)); return p; };

test('help-recovery harness: cases come from the shipped stories; a run helps, waits for the clip, then streams the rest', { timeout: 30000 }, async () => {
  const cs = casesFromStories();
  assert.ok(cs.length >= 8 && cs.every((c) => c.stuck >= 1 && c.stuck + 1 < c.words.length));
  const c = { id: 't', lang: 'en-IN' as const, words: ['Can', 'you', 'see'], stuck: 1 };
  const r = await runOne(c, 'after', 600, { segA: tone(800), clip: tone(500), segB: tone(1200) }, deaf);
  assert.equal(r.helps[0], 0, 'deaf recogniser: word 0 helped first');
  assert.ok(r.helps.includes(1));
  assert.ok(r.helpDoneMs !== null && r.segBStartMs !== null && r.segBStartMs - r.helpDoneMs >= 450);
  assert.ok(r.activity && r.activity.speechChunks > 0, 'voice activity counted');
});
