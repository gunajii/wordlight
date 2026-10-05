import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionHub, summaryText } from '../src/hub.ts';
import { ReadingDriver } from '../src/reading/driver.ts';
import { TranscribeSource, SimSource, type SpeechSource, type SpeechHandlers, type SpeechUpdate } from '../src/reading/speech.ts';

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

test('session end: deterministic summary from real counts goes to TV and phone', () => {
  const { hub, src, tv, phone, start } = setup();
  start(['one', 'two', 'three']);
  src.say([{ text: 'one' }, { text: 'two' }, { text: 'three' }], true);
  hub.handle(tv, { t: 'session.end' });
  const sum = phone.out.find((m) => m.type === 'session.summary');
  assert.equal(sum.text, 'Riya read 3 words aloud in 1 reading turn: all on their own.');
  assert.equal(sum.source, 'template');
  assert.ok(tv.out.some((m) => m.type === 'session.summary'));
  assert.equal(summaryText('Aarav', { readerId: 'x', lines: 4, read: 38, helped: 4, skipped: 1, readingMs: 1, stories: ['a'] }), 'Aarav read 42 words aloud in 4 reading turns: 38 on their own and 4 with a little help.');
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

test('SimSource (dev only) reads the expected words and can stall at one', async () => {
  const ups: SpeechUpdate[] = [];
  const sess = new SimSource({ paceMs: 10, leadMs: 5, stallAt: null }).open({ lang: 'en-IN', expected: ['a', 'b', 'c'] }, { onUpdate: (u) => ups.push(u), onError: () => {}, onClose: () => {} });
  await sleep(80);
  sess.end();
  assert.deepEqual(ups.at(-1)!.words.map((w) => w.text), ['a', 'b', 'c']);
});
