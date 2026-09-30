import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvent, mayClientSend, encodeAudioFrame, decodeAudioFrame } from '../src/index.ts';

const start = { type: 'turn.start', sessionId: 'ABCD', turnId: 't1', readerId: 'r1', storyId: 's', page: 0, line: 2, words: ['the', 'cat'], lang: 'en-IN' };

test('valid turn.start passes; each missing/bad field is named', () => {
  assert.equal(validateEvent(start).ok, true);
  assert.match((validateEvent({ ...start, words: [] }) as any).error, /words/);
  assert.match((validateEvent({ ...start, lang: 'mr-IN' }) as any).error, /lang/);
  assert.match((validateEvent({ ...start, page: -1 }) as any).error, /page/);
  assert.match((validateEvent({ ...start, sessionId: '' }) as any).error, /sessionId/);
  assert.match((validateEvent({ ...start, type: 'nope' }) as any).error, /unknown type/);
  assert.equal(validateEvent(null).ok, false);
});

test('reader.save requires explicit microphone consent', () => {
  const r = { type: 'reader.save', sessionId: 'ABCD', reader: { readerId: 'r1', firstName: 'Riya', age: 7, lang: 'hi-IN' }, consent: { microphone: true, atMs: 1 } };
  assert.equal(validateEvent(r).ok, true);
  assert.equal(validateEvent({ ...r, consent: { microphone: false, atMs: 1 } }).ok, false);
  assert.equal(validateEvent({ ...r, consent: undefined }).ok, false);
});

test('roles: TV starts turns, phone saves readers, clients never send matcher events', () => {
  assert.equal(mayClientSend('tv', 'turn.start'), true);
  assert.equal(mayClientSend('phone', 'turn.start'), false);
  assert.equal(mayClientSend('phone', 'reader.save'), true);
  assert.equal(mayClientSend('phone', 'word.read'), false);
  assert.equal(mayClientSend('tv', 'word.read'), false);
});

test('audio frames round-trip; malformed frames are rejected', () => {
  const pcm = Int16Array.from([0, 1, -1, 32767, -32768]);
  const buf = encodeAudioFrame({ seq: 42, last: true, capturedAtMs: 1234.5, pcm });
  const f = decodeAudioFrame(buf)!;
  assert.equal(f.seq, 42);
  assert.equal(f.last, true);
  assert.equal(f.capturedAtMs, 1234.5);
  assert.deepEqual([...f.pcm], [...pcm]);
  assert.equal(f.tag, 0, 'tag defaults to 0 (pre-S3 encoders)');
  const tagged = decodeAudioFrame(encodeAudioFrame({ seq: 7, tag: 0xbeef, last: false, capturedAtMs: 1, pcm }))!;
  assert.equal(tagged.tag, 0xbeef);
  assert.equal(tagged.seq, 7);
  assert.equal(decodeAudioFrame(buf.subarray(0, 10)), null);
  const bad = new Uint8Array(buf); bad[0] = 9;
  assert.equal(decodeAudioFrame(bad), null);
});
