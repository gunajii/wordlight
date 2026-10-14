// Marathi (mr-IN): a third reading language, narrated by a recorded human voice (no Polly voice exists for Marathi).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { normalizeWord, tokenize, ReadingTurn } from '@wordlight/reading-engine';
import { validateEvent, LANGS } from '@wordlight/shared-protocol';
import { childText, langLabel, isDevanagari } from '../../packages/tv-core/src/text.ts';
import { RecordedNarration, readWav16k, trimTail, encodeMp3 } from '../../tools/content/narration.ts';
import { parseSpeechMarks, markByteMismatches } from '@wordlight/story-package';

function wav16k(pcm: Int16Array): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.byteLength, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([h, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)]);
}
/** "speech" bursts at the given ms ranges, silence elsewhere */
function bursts(totalMs: number, ranges: [number, number][]) {
  const p = new Int16Array(totalMs * 16);
  for (const [a, b] of ranges) for (let i = a * 16; i < b * 16; i++) p[i] = Math.round(6000 * Math.sin(i / 7));
  return p;
}

test('mr-IN is a protocol language; Marathi text uses the Devanagari rules (nukta, nasal spellings, number words)', () => {
  assert.ok((LANGS as readonly string[]).includes('mr-IN'));
  assert.equal(validateEvent({ type: 'reader.save', sessionId: 'ABCD', serverMs: 1, reader: { readerId: 'r', firstName: 'Riya', age: 7, lang: 'mr-IN' }, consent: { microphone: true, atMs: 1 } }).ok, true);
  assert.equal(normalizeWord('चालतो.', 'mr-IN'), 'चालतो');
  assert.equal(normalizeWord('दोन', 'mr-IN'), '2');
  assert.equal(normalizeWord('पाच', 'mr-IN'), '5');
  assert.deepEqual(tokenize('डावा-उजवा, डावा-उजवा.', 'mr-IN'), ['डावा', 'उजवा', 'डावा', 'उजवा']);
});

test('the reading engine lights a Marathi line read correctly and keeps a different word dark', () => {
  const words = 'आम्ही शांतपणे रांगेत चालतो.'.split(' ');
  const say = (t: ReadingTurn, txt: string) => t.feed({ segmentId: 's', final: true, words: txt.split(' ').map((w) => ({ text: w })) }, 1000);
  const ok = say(new ReadingTurn({ words, lang: 'mr-IN', startMs: 0 }), 'आम्ही शांतपणे रांगेत चालतो');
  assert.equal(ok.filter((x) => x.type === 'word.read').length, 4);
  assert.ok(ok.some((x) => x.type === 'line.done'));
  const wrong = say(new ReadingTurn({ words, lang: 'mr-IN', startMs: 0 }), 'आम्ही शांत');
  assert.equal(wrong.filter((x) => x.type === 'word.read').length, 1, 'a different word does not light');
});

test('TV text for Marathi: its own child-facing strings, label and the Devanagari font', () => {
  const t = childText('mr-IN');
  assert.equal(t.yourTurn('Riya', 'echo'), 'Riya, आता तू म्हण');
  assert.notEqual(t.wellRead, childText('hi-IN').wellRead);
  assert.equal(langLabel('mr-IN'), 'मराठी');
  assert.ok(isDevanagari('mr-IN') && isDevanagari('hi-IN') && !isDevanagari('en-IN'));
  for (const s of [t.wellRead, t.hint, t.end.pairNext]) assert.ok(!/चूक|wrong/i.test(s), 'nothing says wrong');
});

test('WAV reader: 16 kHz mono 16-bit only; tail trimming keeps a little room', () => {
  const p = bursts(1000, [[100, 400]]);
  assert.equal(readWav16k(wav16k(p)).length, 16000);
  const bad = wav16k(p); bad.writeUInt32LE(44100, 24);
  assert.throws(() => readWav16k(bad), /16 kHz/);
  const t = trimTail(p);
  assert.ok(t.length >= 400 * 16 && t.length <= 480 * 16, `trimmed to ${t.length / 16} ms`);
});

test('mp3 encoder (pure JS): a decodable 24 kHz mp3 of about the right length', async () => {
  const mp3 = await encodeMp3(bursts(800, [[0, 800]]));
  const dir = mkdtempSync(path.join(tmpdir(), 'mp3-')); writeFileSync(path.join(dir, 'a.mp3'), mp3);
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate:format=duration', '-of', 'default=nw=1', path.join(dir, 'a.mp3')]).toString();
  assert.match(out, /sample_rate=24000/);
  const d = Number(/duration=([\d.]+)/.exec(out)![1]);
  assert.ok(d > 0.75 && d < 0.95, `duration ${d}`);
});

test('recorded narration: word times from alignment of the recording, marks match the text, help clips cut from the same voice', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rec-'));
  const text = 'आम्ही शांतपणे रांगेत चालतो.';
  writeFileSync(path.join(dir, 'p1.wav'), wav16k(bursts(2000, [[100, 400], [500, 900], [1000, 1300], [1400, 1800]])));
  writeFileSync(path.join(dir, 'p1.mp3'), Buffer.from([0xff, 0xfb, 0x90, 0x00]));
  const heard = [{ text: 'आम्ही', startMs: 100, endMs: 400 }, { text: 'शांतपणे', startMs: 500, endMs: 900 }, { text: 'रांगेत', startMs: 1000, endMs: 1300 }, { text: 'चालतो', startMs: 1400, endMs: 1800 }];
  const langs: string[] = [];
  const rn = new RecordedNarration({ dir, narrator: 'test narrator', offsetMs: 0, transcribe: async (_pcm, lang) => { langs.push(lang); return heard; } });
  const n = await rn.synthesize(text, 'mr-IN');
  assert.deepEqual(langs, ['mr-IN'], 'Transcribe hears the recording in Marathi');
  assert.equal(n.durationMs, 2000);
  const marks = parseSpeechMarks(n.marksNdjson);
  assert.deepEqual(marks.map((m) => m.time), [100, 500, 1000, 1400]);
  assert.deepEqual(markByteMismatches(text, marks), []);
  assert.deepEqual(rn.voice, { engine: 'recorded', id: 'test narrator' });
  const clip = await rn.wordClip('“शांतपणे,');
  assert.ok(clip.length > 500, 'an mp3 clip');
  await assert.rejects(rn.wordClip('मुंगी'), /no recorded occurrence/);
  await assert.rejects(rn.synthesize('दुसरे पान', 'mr-IN'), /no recording for page 2/);
});
