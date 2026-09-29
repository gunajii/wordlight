import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionHub, type TurnDriver } from '../src/hub.ts';

const conn = () => { const out: any[] = []; return { out, send: (m: unknown) => out.push(m) }; };
const setup = () => {
  let t = 1000;
  const hub = new SessionHub({ now: () => t, random: () => 0.1 });
  const id = hub.createSession();
  const tv = conn(), phone = conn();
  hub.handle(tv, { t: 'hello', role: 'tv', sessionId: id, clientId: 'tv' });
  hub.handle(phone, { t: 'hello', role: 'phone', sessionId: id, clientId: 'p1' });
  hub.handle(phone, { type: 'reader.save', reader: { readerId: 'r1', firstName: 'Riya', age: 7, lang: 'hi-IN' }, consent: { microphone: true, atMs: 1 } });
  const start = { type: 'turn.start', turnId: 'T1', readerId: 'r1', storyId: 's', page: 0, line: 1, words: ['एक', 'चूहा'], lang: 'hi-IN' };
  return { hub, id, tv, phone, start, tick: (ms: number) => (t += ms) };
};

test('join: welcome has the session; a saved reader reaches the TV (no phone id leaked)', () => {
  const { tv, phone } = setup();
  assert.equal(phone.out[0].t, 'welcome');
  const readers = tv.out.find((m) => m.t === 'readers').readers;
  assert.deepEqual(readers, [{ readerId: 'r1', firstName: 'Riya', age: 7, lang: 'hi-IN', online: true }]);
});

test('wrong session and missing hello are refused', () => {
  const { hub } = setup();
  const c = conn();
  hub.handle(c, { t: 'hello', role: 'phone', sessionId: 'ZZZZ', clientId: 'x' });
  assert.equal(c.out[0].code, 'no-session');
  const d = conn();
  hub.handle(d, { type: 'turn.start' });
  assert.equal(d.out[0].code, 'no-hello');
});

test('roles are enforced: a phone cannot start turns or fake word events', () => {
  const { hub, phone, start } = setup();
  hub.handle(phone, start);
  assert.equal(phone.out.at(-1).code, 'not-allowed');
  hub.handle(phone, { type: 'word.read', turnId: 'T1', index: 0, confidence: 1, atMs: 0 });
  assert.equal(phone.out.at(-1).code, 'not-allowed');
});

test('turn.start goes to the reader\'s phone, stamped; duplicates are ignored; unknown reader refused', () => {
  const { hub, tv, phone, start } = setup();
  hub.handle(tv, start);
  hub.handle(tv, start);
  const got = phone.out.filter((m) => m.type === 'turn.start');
  assert.equal(got.length, 1);
  assert.equal(got[0].serverMs, 1000);
  hub.handle(tv, { ...start, turnId: 'T2', readerId: 'nobody' });
  assert.equal(tv.out.at(-1).code, 'unknown-reader');
});

test('stale help is refused; cancel ends the turn on both TV and phone', () => {
  const { hub, tv, phone, start } = setup();
  hub.handle(tv, start);
  hub.handle(tv, { type: 'turn.help', turnId: 'OLD', kind: 'next-word' });
  assert.equal(tv.out.at(-1).code, 'stale-turn');
  hub.handle(tv, { type: 'turn.cancel', turnId: 'T1', reason: 'skipped' });
  assert.equal(phone.out.at(-1).type, 'turn.cancel');
  assert.equal(hub.get(setup().id)?.turn ?? null, null);
});

test('phone lost mid-turn: TV hears reader disconnected AND turn cancelled (never stuck)', () => {
  const { hub, tv, phone, start } = setup();
  hub.handle(tv, start);
  hub.disconnect(phone, 'timeout');
  const kinds = tv.out.filter((m) => m.type).map((m) => `${m.type}${m.state ? ':' + m.state : ''}${m.reason ? ':' + m.reason : ''}`);
  assert.deepEqual(kinds.slice(-2), ['reader.status:disconnected', 'turn.cancel:phone-lost']);
});

test('reconnect: same phone id rejoins, TV hears reader connected, old socket closing late is harmless', () => {
  const { hub, id, tv, phone } = setup();
  const phone2 = conn();
  hub.handle(phone2, { t: 'hello', role: 'phone', sessionId: id, clientId: 'p1' });
  assert.equal(tv.out.at(-1).state, 'connected');
  hub.disconnect(phone); // the old socket
  assert.equal(hub.get(id)!.phones.get('p1'), phone2);
  assert.ok(hub.get(id)!.telemetry.some((r) => r.kind === 'rejoin'));
});

test('driver receives start, audio only from the reader\'s phone, help, and stop on line.done', () => {
  const { hub, id, tv, phone, start } = setup();
  const calls: string[] = [];
  const driver: TurnDriver = {
    start: () => calls.push('start'), audio: (_s, _t, f) => calls.push(`audio:${f.seq}`),
    help: (_s, _t, k) => calls.push(`help:${k}`), stop: (_s, _t, r) => calls.push(`stop:${r}`),
  };
  hub.driver = driver;
  hub.handle(tv, start);
  const intruder = conn();
  hub.handle(intruder, { t: 'hello', role: 'phone', sessionId: id, clientId: 'p2' });
  hub.audio(intruder, { seq: 9, last: false, capturedAtMs: 0, pcm: new Int16Array(0) });
  hub.audio(phone, { seq: 1, last: false, capturedAtMs: 0, pcm: new Int16Array(0) });
  hub.handle(tv, { type: 'turn.help', turnId: 'T1', kind: 'next-word' });
  const s = hub.get(id)!;
  hub.emit(s, { type: 'word.read', sessionId: id, turnId: 'T1', index: 0, confidence: 1, atMs: 500 });
  hub.emit(s, { type: 'line.done', sessionId: id, turnId: 'T1', read: 2, helped: 0, skipped: 0, durationMs: 900 });
  assert.deepEqual(calls, ['start', 'audio:1', 'help:next-word', 'stop:done']);
  assert.equal(s.turn, null);
  assert.equal(tv.out.filter((m) => m.type === 'word.read').length, 1);
  assert.equal(phone.out.at(-1).type, 'line.done');
});
