import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionHub, summaryText } from '../src/hub.ts';
import { ReadingDriver } from '../src/reading/driver.ts';
import { TranscribeSource, type SpeechSource, type SpeechHandlers, type SpeechUpdate } from '../src/reading/speech.ts';
import { ScriptedSource, scriptFor, misreadOf, slipOf, type Scenario } from '../src/reading/scripted.ts';

const conn = () => { const out: any[] = []; return { out, send: (m: any) => out.push(m) }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A speech source the test drives by hand. */
class FakeSource implements SpeechSource {
  readonly name = 'fake';
  h: SpeechHandlers | null = null; pushed = 0; ended = false;
  open(_o: any, h: SpeechHandlers) { this.h = h; return { stats: { chunks: 0, bytes: 0, updates: 0 }, push: () => { this.pushed++; }, end: () => { this.ended = true; } }; }
  say(words: { text: string; startMs?: number }[], final = false, segmentId = 's1') {
    this.h!.onUpdate({ segmentId, final, receivedAtMs: performance.timeOrigin + performance.now(), words: words.map((w) => ({ stable: final, ...w })) } as SpeechUpdate);
  }
}

function setup(stallMs = 300) {
  const now = () => performance.timeOrigin + performance.now();
  const hub = new SessionHub({ now });
  const src = new FakeSource();
  const driver = new ReadingDriver({ hub, source: src, now, stallMs, firstStallMs: stallMs });
  hub.driver = driver;
  const id = hub.createSession();
  const tv = conn(), phone = conn();
  hub.handle(tv, { t: 'hello', role: 'tv', sessionId: id, clientId: 'tv' });
  hub.handle(phone, { t: 'hello', role: 'phone', sessionId: id, clientId: 'p1' });
  hub.handle(phone, { type: 'reader.save', reader: { readerId: 'r1', firstName: 'Riya', age: 7, lang: 'en-IN' }, consent: { microphone: true, atMs: 1 } });
  hub.handle(phone, { t: 'clock.report', offsetMs: 0, minRttMs: 5 });
  const s = hub.get(id)!;
  const start = (words: string[]) => {
    hub.handle(tv, { type: 'turn.start', turnId: 'T1', readerId: 'r1', storyId: 'demo', page: 0, line: 2, words, lang: 'en-IN' });
    const tag = s.turn!.audioTag;
    hub.audio(phone, { seq: 0, tag, last: false, capturedAtMs: now() - 40, pcm: new Int16Array(640) });
  };
  return { hub, src, driver, id, tv, phone, s, start };
}

test('reading driver: recognised words light in order on the TV; line.done ends the turn; mic audio reached the source', () => {
  const { src, driver, tv, phone, s, start } = setup();
  start(['The', 'little', 'cat', 'ran', 'home.']);
  assert.equal(src.pushed, 1);
  src.say([{ text: 'the', startMs: 100 }, { text: 'little', startMs: 400 }]);
  src.say([{ text: 'the' }, { text: 'little' }, { text: 'cat' }, { text: 'ran' }, { text: 'home' }], true);
  const read = tv.out.filter((m) => m.type === 'word.read').map((m) => m.index);
  assert.deepEqual(read, [0, 1, 2, 3, 4]);
  const done = tv.out.find((m) => m.type === 'line.done');
  assert.deepEqual([done.read, done.helped, done.skipped], [5, 0, 0]);
  assert.equal(phone.out.filter((m) => m.type === 'word.read').length, 5, 'phone also sees progress');
  assert.equal(s.turn, null);
  assert.equal(src.ended, true, 'speech stream closed with the turn');
  const tr = driver.traces[0];
  assert.equal(tr.events.length, 5);
  assert.ok(tr.events[0].spokenServerMs !== null, 'spoken time mapped from the word start');
  assert.equal(tr.events[0].heard, undefined, 'no transcript text in traces unless DEV_TRANSCRIPTS');
});

test('reading driver: a misread word is NOT lit; silence → help after the stall time (amber), then the child continues', async () => {
  const { src, tv, start } = setup(300);
  start(['The', 'little', 'cat']);
  src.say([{ text: 'the' }, { text: 'hat' }], true, 'a'); // "hat" ≠ "little": not accepted
  assert.deepEqual(tv.out.filter((m) => m.type === 'word.read').map((m) => m.index), [0]);
  await sleep(450);
  const helped = tv.out.filter((m) => m.type === 'word.helped');
  assert.deepEqual(helped.map((m) => [m.index, m.reason]), [[1, 'stall']]);
  src.say([{ text: 'cat' }], true, 'b');
  const done = tv.out.find((m) => m.type === 'line.done');
  assert.deepEqual([done.read, done.helped, done.skipped], [2, 1, 0]);
});

test('reading driver: the TV can ask for help (remote)', () => {
  const { hub, src, tv, start } = setup(5000);
  start(['big', 'red', 'ball']);
  src.say([{ text: 'big' }], true);
  hub.handle(tv, { type: 'turn.help', turnId: 'T1', kind: 'next-word' });
  const h = tv.out.filter((m) => m.type === 'word.helped');
  assert.deepEqual(h.map((m) => [m.index, m.reason]), [[1, 'asked']]);
});

test('session end: deterministic summary from real counts goes to TV and phone', async () => {
  const { hub, src, tv, phone, start } = setup();
  start(['one', 'two', 'three']);
  src.say([{ text: 'one' }, { text: 'two' }, { text: 'three' }], true);
  hub.handle(tv, { t: 'session.end', storyId: 'demo', storyTitle: 'Mina’s Red Kite', completed: true, durationMs: 185_000 });
  await sleep(5);
  const sum = phone.out.find((m) => m.type === 'session.summary');
  assert.equal(sum.text, 'Riya read 3 words independently without help, and finished “Mina’s Red Kite” (1 reading turn, 3 minutes).');
  assert.equal(sum.source, 'template');
  assert.deepEqual([sum.wordsReadAlone, sum.wordsHelped, sum.wordsSkipped, sum.turns, sum.storiesCompleted, sum.sessionMs], [3, 0, 0, 1, 1, 185_000]);
  assert.ok(tv.out.some((m) => m.type === 'session.summary'));
  assert.equal(summaryText('Aarav', { readerId: 'x', lines: 4, read: 38, helped: 4, skipped: 1, readingMs: 1, stories: ['a'] }), 'Aarav read 38 words independently and needed help with 4 words (4 reading turns, under a minute). 1 word was skipped.');
});

test('speech error ends the turn (error) instead of leaving the TV waiting', () => {
  const { src, tv, s, start } = setup();
  start(['a', 'b']);
  src.h!.onError(new Error('AccessDenied'));
  assert.equal(s.turn, null);
  assert.equal(tv.out.at(-1).type, 'turn.cancel');
  assert.equal(tv.out.at(-1).reason, 'error');
});

// ---- TranscribeSource against a fake Transcribe client ----
function fakeClient(script: (audio: AsyncIterable<any>) => AsyncIterable<any>, failFirstWith?: string) {
  const calls: any[] = [];
  return { calls, send: async (cmd: any) => {
    calls.push(cmd.input);
    if (failFirstWith && calls.length === 1) throw new Error(failFirstWith);
    return { TranscriptResultStream: script(cmd.input.AudioStream) };
  } };
}

test('TranscribeSource: streams pushed PCM, maps partial/final results (Stable, timing), closes when audio ends', async () => {
  let sent = 0;
  const client = fakeClient(async function* (audio) {
    for await (const a of audio) { sent += a.AudioEvent.AudioChunk.length; if (sent >= 1280) break; }
    yield { TranscriptEvent: { Transcript: { Results: [{ ResultId: 'r1', IsPartial: true, Alternatives: [{ Items: [{ Type: 'pronunciation', Content: 'little', Stable: true, StartTime: 0.5, EndTime: 0.8, Confidence: 0.9 }, { Type: 'pronunciation', Content: 'ca', Stable: false, StartTime: 0.8, EndTime: 0.9 }] }] }] } } };
    yield { TranscriptEvent: { Transcript: { Results: [{ ResultId: 'r1', IsPartial: false, Alternatives: [{ Items: [{ Type: 'pronunciation', Content: 'little', StartTime: 0.5 }, { Type: 'punctuation', Content: '.' }, { Type: 'pronunciation', Content: 'cat', StartTime: 0.8 }] }] }] } } };
  });
  const ups: SpeechUpdate[] = []; let closed = false;
  const src = new TranscribeSource({ client, now: () => 1 });
  const sess = src.open({ lang: 'hi-IN' }, { onUpdate: (u) => ups.push(u), onError: (e) => assert.fail(e.message), onClose: () => (closed = true) });
  sess.push(new Int16Array(320)); sess.push(new Int16Array(320));
  await sleep(20);
  sess.end();
  await sleep(20);
  assert.equal(client.calls[0].LanguageCode, 'hi-IN');
  assert.equal(client.calls[0].MediaSampleRateHertz, 16000);
  assert.equal(client.calls[0].EnablePartialResultsStabilization, true);
  assert.equal(ups.length, 2);
  assert.deepEqual(ups[0].words.map((w) => [w.text, w.stable, w.startMs]), [['little', true, 500], ['ca', false, 800]]);
  assert.equal(ups[1].final, true);
  assert.deepEqual(ups[1].words.map((w) => w.text), ['little', 'cat'], 'punctuation dropped');
  assert.ok(closed);
});

test('TranscribeSource: retries once without stabilisation if the language rejects it', async () => {
  const client = fakeClient(async function* () { yield { TranscriptEvent: { Transcript: { Results: [] } } }; }, 'Partial results stabilization is not supported for this language');
  let err: Error | null = null;
  const sess = new TranscribeSource({ client }).open({ lang: 'hi-IN' }, { onUpdate: () => {}, onError: (e) => (err = e), onClose: () => {} });
  sess.end();
  await sleep(30);
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[1].EnablePartialResultsStabilization, undefined);
  assert.equal(err, null);
});

// ---- ScriptedSource: local simulation through the REAL reading engine ----
const FAST = { paceMs: 30, leadMs: 10, partialDelayMs: 8, stableDelayMs: 20, finalDelayMs: 40, hesitationMs: 60, correctionGapMs: 40, stallSilenceMs: 200 };
async function scripted(scenario: Scenario, words: string[], lang: 'en-IN' | 'hi-IN' = 'en-IN', stallMs = 150, timing: Record<string, number> = {}) {
  const now = () => performance.timeOrigin + performance.now();
  const hub = new SessionHub({ now });
  const src = new ScriptedSource({ scenario, timing: { ...FAST, ...timing } });
  const driver = new ReadingDriver({ hub, source: src, now, stallMs, firstStallMs: stallMs });
  hub.driver = driver;
  const id = hub.createSession();
  const tv = conn(), phone = conn();
  hub.handle(tv, { t: 'hello', role: 'tv', sessionId: id, clientId: 'tv' });
  hub.handle(phone, { t: 'hello', role: 'phone', sessionId: id, clientId: 'p1' });
  hub.handle(phone, { type: 'reader.save', reader: { readerId: 'r1', firstName: 'Riya', age: 7, lang }, consent: { microphone: true, atMs: 1 } });
  hub.handle(phone, { t: 'clock.report', offsetMs: 0, minRttMs: 5 });
  hub.handle(tv, { type: 'turn.start', turnId: 'T1', readerId: 'r1', storyId: 'demo', page: 0, line: 0, words, lang });
  const s = hub.get(id)!;
  const tag = s.turn!.audioTag;
  for (let i = 0; i < 150 && s.turn; i++) { hub.audio(phone, { seq: i, tag, last: false, capturedAtMs: now(), pcm: new Int16Array(640) }); await sleep(10); }
  const marks = words.map((_, i) => { const m = tv.out.find((x) => (x.type === 'word.read' || x.type === 'word.helped' || x.type === 'word.skipped') && x.index === i); return m ? m.type.split('.')[1] : 'none'; });
  return { marks, done: tv.out.find((m) => m.type === 'line.done'), trace: driver.traces[0], src };
}
const LINE = ['The', 'little', 'rabbit', 'ran', 'home.'];

test('scripted (simulation): nothing happens until the first audio chunk', async () => {
  const ups: SpeechUpdate[] = [];
  const sess = new ScriptedSource({ scenario: 'correct', timing: FAST }).open({ lang: 'en-IN', expected: ['a', 'b'] }, { onUpdate: (u) => ups.push(u), onError: () => {}, onClose: () => {} });
  await sleep(80);
  assert.equal(ups.length, 0, 'no microphone stream → no transcript');
  sess.push(new Int16Array(640));
  await sleep(120);
  sess.end();
  assert.deepEqual(ups.at(-1)!.words.map((w) => w.text), ['a', 'b']);
  assert.ok(ups.some((u) => u.words.some((w) => w.stable === false)), 'partials come first, unstable');
});

test('scripted correct reading: the real engine lights every word; trace is marked simulated', async () => {
  const r = await scripted('correct', LINE);
  assert.deepEqual(r.marks, ['read', 'read', 'read', 'read', 'read']);
  assert.equal(r.trace.simulated, true);
  assert.equal(r.trace.source, 'scripted');
});

test('scripted misread: the engine does NOT light the misread word (the mock does not make turns succeed)', async () => {
  const r = await scripted('misread', LINE);
  assert.notEqual(r.marks[2], 'read');
  assert.deepEqual([r.marks[0], r.marks[1], r.marks[3], r.marks[4]], ['read', 'read', 'read', 'read']);
});

test('scripted two misreads: neither lights', async () => {
  const r = await scripted('misread2', LINE);
  assert.notEqual(r.marks[2], 'read'); assert.notEqual(r.marks[4], 'read');
});

test('scripted correction: wrong word, then the right one → the word lights after the correction', async () => {
  const r = await scripted('correction', LINE);
  assert.deepEqual(r.marks, ['read', 'read', 'read', 'read', 'read']);
});

test('scripted stall: silence on the middle word → the TV helps it (amber), the rest is read', async () => {
  const r = await scripted('stall', LINE, 'en-IN', 300, { stallSilenceMs: 450 }); // silence between one and two help times (ticker is 100 ms)
  assert.deepEqual(r.marks, ['read', 'read', 'helped', 'read', 'read']);
});

test('scripted silence: no speech at all → every word is helped, never read', async () => {
  const r = await scripted('silence', ['big', 'red', 'bus']);
  assert.deepEqual(r.marks, ['helped', 'helped', 'helped']);
});

test('scripted slip: an ASR spelling slip of a long word (rabbit → rabit) is accepted by the strict matcher', async () => {
  assert.equal(slipOf('rabbit'), 'rabit');
  assert.equal(slipOf('elephant'), 'elefant');
  assert.equal(slipOf('cat'), null);
  const r = await scripted('slip', LINE);
  assert.deepEqual(r.marks, ['read', 'read', 'read', 'read', 'read']);
});

test('scripted Hindi misread (vowel change) is rejected', async () => {
  assert.notEqual(misreadOf('बिल्ली'), 'बिल्ली');
  const r = await scripted('misread', ['मेरी', 'बिल्ली', 'काली', 'है।']);
  assert.notEqual(r.marks[2], 'read');
});

test('scriptFor is deterministic and the demo scenario stalls on the longest word', () => {
  assert.deepEqual(scriptFor('demo', LINE), scriptFor('demo', LINE));
  const steps = scriptFor('demo', ['Look', 'at', 'the', 'bird!']);
  const said = steps.filter((s: any) => 'say' in s).map((s: any) => s.expectIndex);
  assert.deepEqual(said, [0, 1, 2], '"bird" is left for the TV to help');
  assert.deepEqual(scriptFor('demo', LINE).filter((s: any) => 'say' in s).map((s: any) => s.expectIndex), [0, 2, 3, 4], 'ties → the earliest long word ("little")');
});
