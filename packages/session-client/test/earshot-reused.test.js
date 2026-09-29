// Tests copied from Earshot (packages/vega-sync/test/core.test.js, commit fe64ce9) for the reused modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClockSync, ClockPinger, SyncClient } from '../src/index.js';

test('clock: symmetric path recovers exact offset', () => {
  const c = new ClockSync();
  // true offset +5000: server = local + 5000; one-way delay 20ms each way
  for (let i = 0; i < 5; i++) {
    const c0 = i * 100;
    assert.ok(c.addSample(c0, c0 + 20 + 5000, c0 + 40));
  }
  assert.equal(c.ready, true);
  assert.equal(c.offset, 5000);
  assert.equal(c.minRtt, 40);
});

test('clock: prefers low-RTT samples over congested ones', () => {
  const c = new ClockSync({ best: 3 });
  // good samples: offset 1000, rtt 10
  for (let i = 0; i < 3; i++) c.addSample(i * 10, i * 10 + 5 + 1000, i * 10 + 10);
  // congested samples with asymmetric queueing: rtt 400, biased offset
  for (let i = 0; i < 6; i++) c.addSample(100 + i, 100 + i + 350 + 1000, 100 + i + 400);
  assert.equal(c.offset, 1000);
});

test('clock: rejects negative rtt and non-finite values', () => {
  const c = new ClockSync();
  assert.equal(c.addSample(10, 5, 5), false);
  assert.equal(c.addSample(0, NaN, 5), false);
  assert.equal(c.samples.length, 0);
  assert.equal(c.ready, false);
});

test('clock: window bounds memory', () => {
  const c = new ClockSync({ window: 4 });
  for (let i = 0; i < 10; i++) c.addSample(i, i + 1, i + 2);
  assert.equal(c.samples.length, 4);
});

test('clock: tracks a drifting clock (200 ppm) without lagging', () => {
  const c = new ClockSync();
  const drift = 200e-6;
  // true server = local + 1000 + drift * local ; symmetric 10ms each way
  const server = (local) => local + 1000 + drift * local;
  for (let i = 0; i < 32; i++) {
    const c0 = i * 2000;
    c.addSample(c0, server(c0 + 10), c0 + 20);
  }
  const now = 64000;
  assert.ok(Math.abs(c.toServer(now) - server(now)) < 0.5, `err ${c.toServer(now) - server(now)}`);
  assert.ok(Math.abs(c.driftPpm - 200) < 5);
  assert.ok(Math.abs(c.toLocal(c.toServer(now)) - now) < 1e-6);
});

const A = (o) => ({ bootId: 'b1', bootStartedAt: 0, seq: 1, epoch: 1, playing: true, positionMs: 0, rate: 1, atServerMs: 0, ...o });

test('pinger: ignores unknown / duplicate pongs', () => {
  let t = 0;
  const sent = [];
  const clock = new ClockSync();
  const p = new ClockPinger({ clock, now: () => t, send: (m) => sent.push(m), setTimeout: () => 0, clearTimeout: () => {} });
  p.start();
  const ping = sent[0];
  t = 30;
  assert.equal(p.onPong({ id: ping.id, c0: ping.c0, s: 1015 }), true);
  assert.equal(p.onPong({ id: ping.id, c0: ping.c0, s: 1015 }), false);
  assert.equal(p.onPong({ id: 999, c0: 0, s: 0 }), false);
  assert.equal(clock.offset, 1000);
});

// ---------- provisional / settled anchors ----------

test('client: hello is the first message, even if an onStatus(open) handler sends something', () => {
  const sent = [];
  class FakeWS { constructor() { FakeWS.last = this; } send(x) { sent.push(JSON.parse(x).t); } close() {} }
  const timers = [];
  const c = new SyncClient({
    url: 'ws://x', sessionId: 'ABCD', role: 'viewer', clientId: 'p', clock: new ClockSync(), now: () => 0, WebSocketImpl: FakeWS,
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
    onStatus: (st) => { if (st === 'open') c.send({ t: 'telemetry', kind: 'phone-event', event: 'link-open' }); },
  });
  c.start();
  FakeWS.last.onopen();
  assert.deepEqual(sent.slice(0, 2), ['hello', 'telemetry']);
  c.stop();
});
