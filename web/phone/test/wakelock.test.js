import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WakeLockKeeper } from '../wakelock.js';

function fakes({ supported = true, fail = false } = {}) {
  const doc = { visibilityState: 'visible', l: {}, addEventListener(t, f) { this.l[t] = f; } };
  const sentinels = [];
  const nav = supported ? { wakeLock: { request: async (type) => {
    assert.equal(type, 'screen');
    if (fail) throw Object.assign(new Error('not allowed'), { name: 'NotAllowedError' });
    const s = { released: false, l: {}, addEventListener(t, f) { this.l[t] = f; }, async release() { this.released = true; this.l.release?.(); } };
    sentinels.push(s); return s;
  } } } : {};
  return { doc, nav, sentinels };
}

test('not requested until a session starts; released when it ends', async () => {
  const f = fakes();
  const w = new WakeLockKeeper({ nav: f.nav, doc: f.doc });
  assert.equal(w.state, 'off'); assert.equal(f.sentinels.length, 0);
  await w.enable();
  assert.equal(w.state, 'on'); assert.equal(f.sentinels.length, 1);
  await w.disable();
  assert.equal(w.state, 'off'); assert.equal(f.sentinels[0].released, true);
});

test('browser drops the lock when hidden → lost; visible again → re-requested', async () => {
  const f = fakes();
  const w = new WakeLockKeeper({ nav: f.nav, doc: f.doc });
  await w.enable();
  f.doc.visibilityState = 'hidden';
  f.sentinels[0].l.release(); // what the browser does on hide
  assert.equal(w.state, 'lost');
  f.doc.visibilityState = 'visible';
  f.doc.l.visibilitychange();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(w.state, 'on'); assert.equal(f.sentinels.length, 2);
});

test('no re-request after the session ended', async () => {
  const f = fakes();
  const w = new WakeLockKeeper({ nav: f.nav, doc: f.doc });
  await w.enable(); await w.disable();
  f.doc.l.visibilitychange();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(f.sentinels.length, 1); assert.equal(w.state, 'off');
});

test('unsupported and refused are reported, not hidden', async () => {
  const u = fakes({ supported: false });
  const w1 = new WakeLockKeeper({ nav: u.nav, doc: u.doc });
  await w1.enable(); assert.equal(w1.state, 'unsupported');
  const r = fakes({ fail: true });
  const w2 = new WakeLockKeeper({ nav: r.nav, doc: r.doc });
  await w2.enable(); assert.equal(w2.state, 'error'); assert.match(w2.error, /NotAllowedError/);
});

test('a hidden page does not request', async () => {
  const f = fakes(); f.doc.visibilityState = 'hidden';
  const w = new WakeLockKeeper({ nav: f.nav, doc: f.doc });
  await w.enable(); assert.equal(f.sentinels.length, 0);
});
