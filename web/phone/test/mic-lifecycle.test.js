import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, micWanted, needsTap } from '../mic-lifecycle.js';

const run = (s, ...evs) => { let r; for (const e of evs) { r = reduce(s, e); s = r.state; } return { s, r }; };
const base = () => run(initialState(), { type: 'consent' }, { type: 'ready' }, { type: 'connected' }).s;
const T = (id = 't1') => ({ type: 'turn-start', turnId: id, tag: 7, chunkMs: 40 });

test('home / shelf / narration / before Your Turn (no turn) → MIC OFF', () => {
  const s = base();
  assert.equal(micWanted(s), false);
});

test('page load: nothing opens the mic before consent, tap and a turn', () => {
  let { s, r } = run(initialState(), { type: 'connected' }, T());
  assert.equal(r.rejected, 'no-consent'); assert.equal(micWanted(s), false);
  ({ s, r } = run(s, { type: 'consent' }, T()));
  assert.equal(micWanted(s), false, 'no tap yet');
  assert.equal(needsTap(s), true);
  ({ s, r } = run(s, { type: 'ready' }));
  assert.equal(r.mic, 'open', 'the tap during an active turn opens it');
});

test('Your Turn → MIC ON; line finished → OFF; cancelled → OFF; session ended → OFF', () => {
  let { s, r } = run(base(), T());
  assert.equal(r.mic, 'open');
  ({ s, r } = run(s, { type: 'turn-end', turnId: 't1', reason: 'done' }));
  assert.equal(r.mic, 'closed'); assert.equal(r.stopReason, 'turn-ended:done');
  ({ s, r } = run(s, T('t2'), { type: 'turn-end', turnId: 't2', reason: 'skipped' }));
  assert.equal(r.mic, 'closed'); assert.equal(r.stopReason, 'turn-ended:skipped');
  ({ s, r } = run(s, T('t3'), { type: 'session-end' }));
  assert.equal(r.mic, 'closed'); assert.equal(r.stopReason, 'session-ended');
  ({ s, r } = run(s, T('t4')));
  assert.equal(r.rejected, 'no-session'); assert.equal(micWanted(s), false);
});

test('a stale turn-end for another turn does not close the current one', () => {
  const { r } = run(base(), T('t1'), { type: 'turn-end', turnId: 'old' });
  assert.equal(r.mic, 'open');
});

test('page hidden → OFF and the turn is forgotten; visible again → still OFF until a NEW turn', () => {
  let { s, r } = run(base(), T(), { type: 'hidden' });
  assert.equal(r.mic, 'closed'); assert.equal(r.stopReason, 'page-hidden'); assert.equal(s.turn, null);
  ({ s, r } = run(s, { type: 'visible' }));
  assert.equal(r.mic, 'closed');
  ({ s, r } = run(s, T('t2')));
  assert.equal(r.mic, 'open');
});

test('turn arriving while hidden is rejected', () => {
  const { s, r } = run(base(), { type: 'hidden' }, T());
  assert.equal(r.rejected, 'hidden'); assert.equal(micWanted(s), false);
});

test('socket lost → OFF; reconnect → still OFF (no blind resume)', () => {
  let { s, r } = run(base(), T(), { type: 'disconnected' });
  assert.equal(r.stopReason, 'connection-lost'); assert.equal(s.turn, null);
  ({ s, r } = run(s, { type: 'connected' }));
  assert.equal(r.mic, 'closed');
  ({ r } = run(s, T('t1'))); // even the same id must come again from the server
  assert.equal(r.mic, 'open');
});

test('turn arriving while offline is rejected', () => {
  const { r } = run(initialState({ consent: true }), { type: 'ready' }, T());
  assert.equal(r.rejected, 'offline');
});

test('audio suspended (e.g. iOS interruption) → OFF and turn forgotten', () => {
  const { s, r } = run(base(), T(), { type: 'not-ready' });
  assert.equal(r.stopReason, 'audio-suspended'); assert.equal(s.turn, null);
});

test('unload → OFF; reload = fresh state → OFF until tap + new turn', () => {
  let { r } = run(base(), T(), { type: 'unload' });
  assert.equal(r.stopReason, 'page-unload');
  let s = initialState({ consent: true }); // after reload: consent remembered, audio NOT unlocked, no turn
  ({ s, r } = run(s, { type: 'connected' }));
  assert.equal(micWanted(s), false);
  ({ s, r } = run(s, T()));
  assert.equal(r.mic, 'closed'); assert.equal(needsTap(s), true);
});

test('a new turn replacing an open one reports the replacement', () => {
  const { r } = run(base(), T('a'), T('b'));
  assert.equal(r.mic, 'open'); assert.equal(r.stopReason, 'replaced');
});

test('not-ready before the first unlock does not drop a pending (needs-tap) turn', () => {
  let { s } = run(initialState({ consent: true }), { type: 'connected' }, T());
  assert.equal(needsTap(s), true);
  ({ s } = run(s, { type: 'not-ready' }));
  assert.equal(needsTap(s), true, 'turn kept');
});
