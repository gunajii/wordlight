// WordLight addition: SyncClient.reconnect() (phone page waking from a lock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClockSync, SyncClient } from '../src/index.js';

test('client.reconnect: drops a socket that still looks open, connects at once and says hello again', () => {
  const sockets = [];
  class FakeWS { constructor(u) { this.u = u; this.sent = []; this.closed = false; sockets.push(this); } send(x) { this.sent.push(JSON.parse(x).t); } close() { this.closed = true; } }
  const statuses = [];
  const c = new SyncClient({
    url: 'ws://x', sessionId: 'ABCD', role: 'viewer', clientId: 'p', clock: new ClockSync(), now: () => 0, WebSocketImpl: FakeWS,
    setTimeout: () => 1, clearTimeout: () => {}, onStatus: (st) => statuses.push(st),
  });
  c.start();
  sockets[0].onopen();
  assert.equal(c.status, 'open');
  c.reconnect(); // the old socket never reported a close (suspended page)
  assert.equal(sockets[0].closed, true);
  assert.equal(sockets.length, 2, 'a new socket right away, no backoff wait');
  sockets[0].onclose?.(); // a late close from the old socket changes nothing
  assert.equal(sockets.length, 2);
  sockets[1].onopen();
  assert.equal(sockets[1].sent[0], 'hello');
  assert.deepEqual(statuses, ['connecting', 'open', 'connecting', 'open']);
  c.stop();
  c.reconnect(); // stopped: does nothing
  assert.equal(sockets.length, 2);
});
