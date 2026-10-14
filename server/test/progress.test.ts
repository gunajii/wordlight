import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DynamoProgressStore, MemoryProgressStore, type SessionRecord } from '../src/progress.ts';
import { SessionHub } from '../src/hub.ts';
import { ReadingDriver } from '../src/reading/driver.ts';
import type { SpeechSource, SpeechHandlers } from '../src/reading/speech.ts';

const R: SessionRecord = { readerId: 'rd-1', sessionId: 'ABCD', endedAt: '2026-10-08T07:00:00.000Z', lang: 'hi-IN', age: 7, storyIds: ['busy-ants-hi'], storiesCompleted: ['busy-ants-hi'], turns: 3, read: 14, helped: 2, skipped: 1, durationMs: 240000, helpedWords: ['चींटियाँ', 'कतार'], mode: 'free', speech: 'transcribe' };

test('DynamoDB item: counts only, keyed by reader then time, with a TTL; round-trips exactly', async () => {
  const sent: any[] = [];
  class Put { input: any; constructor(i: any) { this.input = i; } }
  class Query { input: any; constructor(i: any) { this.input = i; } }
  const client = { async send(c: any) { sent.push(c); return c instanceof Query ? { Items: sent.filter((x) => x instanceof Put).map((x) => x.input.Item) } : {}; } };
  const store = new DynamoProgressStore({ client, PutItemCommand: Put, QueryCommand: Query, table: 'wordlight-progress', ttlDays: 30 });
  await store.save(R);
  const item = sent[0].input.Item;
  assert.equal(sent[0].input.TableName, 'wordlight-progress');
  assert.equal(item.pk.S, 'reader#rd-1');
  assert.equal(item.sk.S, '2026-10-08T07:00:00.000Z#ABCD');
  assert.equal(Number(item.ttl.N), Date.parse(R.endedAt) / 1000 + 30 * 86400);
  assert.ok(!JSON.stringify(item).includes('Riya'), 'no names stored');
  assert.deepEqual(Object.keys(item).sort(), ['age', 'durationMs', 'endedAt', 'helped', 'helpedWords', 'lang', 'mode', 'pk', 'read', 'sessionId', 'sk', 'skipped', 'speech', 'storiesCompleted', 'storyIds', 'ttl', 'turns'].sort());
  assert.deepEqual((await store.recent('rd-1'))[0], R);
});

class Fake implements SpeechSource { readonly name = 'fake'; h: SpeechHandlers | null = null; open(_o: any, h: SpeechHandlers) { this.h = h; return { stats: { chunks: 0, bytes: 0, updates: 0 }, push() {}, end() {} }; } }

test('session end saves one counts-only record per reader (helped words are book words) — and a failing store does not break the summary', async () => {
  const now = () => performance.timeOrigin + performance.now();
  for (const failing of [false, true]) {
    const hub = new SessionHub({ now });
    const src = new Fake();
    hub.driver = new ReadingDriver({ hub, source: src, now, stallMs: 10_000, firstStallMs: 10_000 });
    const mem = new MemoryProgressStore();
    hub.progress = failing ? { name: 'broken', save: async () => { throw new Error('ddb down'); }, recent: async () => [] } : mem;
    const id = hub.createSession();
    const out: any[] = []; const tv = { send: (m: any) => out.push(m) }, phone = { send: () => {} };
    hub.handle(tv, { t: 'hello', role: 'tv', sessionId: id, clientId: 'tv' });
    hub.handle(phone, { t: 'hello', role: 'phone', sessionId: id, clientId: 'p' });
    hub.handle(phone, { type: 'reader.save', reader: { readerId: 'rd-1', firstName: 'Riya', age: 7, lang: 'en-IN' }, consent: { microphone: true, atMs: 1 } });
    hub.handle(tv, { type: 'turn.start', turnId: 'T', readerId: 'rd-1', storyId: 'kite', page: 0, line: 1, words: ['the', 'red', 'kite'], lang: 'en-IN' });
    const s = hub.get(id)!;
    hub.audio(phone, { seq: 0, tag: s.turn!.audioTag, last: false, capturedAtMs: now(), pcm: new Int16Array(640) });
    src.h!.onUpdate({ segmentId: 'a', final: false, receivedAtMs: now(), words: [{ text: 'the', stable: true }] });
    hub.handle(tv, { type: 'turn.help', turnId: 'T', kind: 'next-word' });
    src.h!.onUpdate({ segmentId: 'a', final: true, receivedAtMs: now(), words: [{ text: 'the' }, { text: 'kite' }] });
    hub.handle(tv, { t: 'session.end', storyId: 'kite', storyTitle: 'Kite', completed: true, durationMs: 60_000 });
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(out.some((m) => m.type === 'session.summary'), 'summary still sent');
    if (!failing) {
      assert.equal(mem.rows.length, 1);
      const r = mem.rows[0];
      assert.deepEqual([r.read, r.helped, r.turns, r.durationMs, r.storiesCompleted], [2, 1, 1, 60_000, ['kite']]);
      assert.deepEqual(r.helpedWords, ['red']);
      assert.ok(!JSON.stringify(r).includes('Riya'));
    } else assert.ok(s.telemetry.some((t: any) => t.kind === 'progress-save-failed'));
  }
});

test("the parent's reading diary: after session end only that reader's phone gets its recent sessions — counts only, no name", async () => {
  const hub = new SessionHub({ now: () => Date.now() });
  const mem = new MemoryProgressStore();
  mem.rows.push({ ...R, readerId: 'rd-1', endedAt: '2026-10-10T07:00:00.000Z', read: 9 }, { ...R, readerId: 'rd-other', read: 99 });
  hub.progress = mem;
  const id = hub.createSession();
  const tvOut: any[] = [], pOut: any[] = [], qOut: any[] = [];
  const tv = { send: (m: any) => tvOut.push(m) }, p = { send: (m: any) => pOut.push(m) }, q = { send: (m: any) => qOut.push(m) };
  hub.handle(tv, { t: 'hello', role: 'tv', sessionId: id, clientId: 'tv' });
  hub.handle(p, { t: 'hello', role: 'phone', sessionId: id, clientId: 'p' });
  hub.handle(q, { t: 'hello', role: 'phone', sessionId: id, clientId: 'q' });
  hub.handle(p, { type: 'reader.save', reader: { readerId: 'rd-1', firstName: 'Riya', age: 7, lang: 'en-IN' }, consent: { microphone: true, atMs: 1 } });
  await hub.sessionEnd(hub.get(id)!, { storyId: 'kite', storyTitle: 'Kite', completed: true, durationMs: 120_000 });
  await new Promise((r) => setTimeout(r, 10));
  const h = pOut.find((m) => m.t === 'reader.history');
  assert.ok(h, 'phone got the diary');
  assert.equal(h.readerId, 'rd-1');
  assert.equal(h.sessions.length, 2, 'this session + the earlier one, not the other reader');
  assert.deepEqual(Object.keys(h.sessions[0]).sort(), ['endedAt', 'helped', 'lang', 'minutes', 'read', 'skipped', 'storiesCompleted', 'storyIds', 'turns']);
  assert.equal(h.sessions[1].read, 9);
  assert.ok(!JSON.stringify(h).includes('Riya'));
  assert.ok(!tvOut.some((m) => m.t === 'reader.history') && !qOut.some((m) => m.t === 'reader.history'), 'nobody else gets it');
});

test('stickers: the TV gets the books each reader has finished (story ids only) on pairing and after finishing a book', async () => {
  const hub = new SessionHub({ now: () => Date.now() });
  const mem = new MemoryProgressStore();
  mem.rows.push({ ...R, readerId: 'rd-1', storiesCompleted: ['busy-ants'] }, { ...R, readerId: 'rd-1', storiesCompleted: [] }, { ...R, readerId: 'rd-x', storiesCompleted: ['clean-cat'] });
  hub.progress = mem;
  const id = hub.createSession();
  const tvOut: any[] = [], pOut: any[] = [];
  const tv = { send: (m: any) => tvOut.push(m) }, p = { send: (m: any) => pOut.push(m) };
  hub.handle(tv, { t: 'hello', role: 'tv', sessionId: id, clientId: 'tv' });
  hub.handle(p, { t: 'hello', role: 'phone', sessionId: id, clientId: 'p' });
  hub.handle(p, { type: 'reader.save', reader: { readerId: 'rd-1', firstName: 'Riya', age: 7, lang: 'mr-IN' }, consent: { microphone: true, atMs: 1 } });
  await new Promise((r) => setTimeout(r, 10));
  const first = tvOut.filter((m) => m.t === 'reader.stickers');
  assert.deepEqual(first.map((m) => [m.readerId, m.storyIds]), [['rd-1', ['busy-ants']]]);
  assert.deepEqual(Object.keys(first[0]).sort(), ['readerId', 'serverMs', 'storyIds', 't']);
  await hub.sessionEnd(hub.get(id)!, { storyId: 'busy-ants-mr', storyTitle: 'कामसू मुंग्या', completed: true, durationMs: 90_000 });
  await new Promise((r) => setTimeout(r, 20));
  const last = tvOut.filter((m) => m.t === 'reader.stickers').at(-1);
  assert.deepEqual(last.storyIds.sort(), ['busy-ants', 'busy-ants-mr'], 'the book just finished is included');
  assert.ok(!pOut.some((m) => m.t === 'reader.stickers'), 'stickers go to the TV only');
});
