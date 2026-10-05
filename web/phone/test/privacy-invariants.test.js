// Privacy invariants: the microphone is ON only during a reading turn. One row per product state; any regression
// here fails the build. (Phone rules: mic-lifecycle.js; TV rules: tv-core micShouldBeOn.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, micWanted } from '../mic-lifecycle.js';
import { micShouldBeOn } from '../../../packages/tv-core/src/index.ts';

const run = (events, s = initialState()) => events.reduce((st, e) => reduce(st, e).state, s);
const ready = [{ type: 'consent' }, { type: 'connected' }, { type: 'ready' }, { type: 'session-start' }];
const turn = { type: 'turn-start', turnId: 'T1', tag: 1, chunkMs: 40 };

const ROWS = [
  ['home (page just opened, nothing agreed)', [], false],
  ['shelf (consent given, waiting for a story)', ready, false],
  ['narration (story playing, no turn)', [...ready, { type: 'visible' }], false],
  ['waiting for Your Turn', [...ready, { type: 'turn-end', turnId: 'T0' }], false],
  ['turn start', [...ready, turn], true],
  ['turn end (line done)', [...ready, turn, { type: 'turn-end', turnId: 'T1', reason: 'done' }], false],
  ['cancel (child chose to listen)', [...ready, turn, { type: 'turn-end', turnId: 'T1', reason: 'skipped' }], false],
  ['disconnect', [...ready, turn, { type: 'disconnected' }], false],
  ['reconnect after a disconnect does not resume the turn', [...ready, turn, { type: 'disconnected' }, { type: 'connected' }], false],
  ['page hidden', [...ready, turn, { type: 'hidden' }], false],
  ['visible again does not resume the turn', [...ready, turn, { type: 'hidden' }, { type: 'visible' }], false],
  ['page unload', [...ready, turn, { type: 'unload' }], false],
  ['session end', [...ready, turn, { type: 'session-end' }], false],
  ['turn without consent is refused', [{ type: 'connected' }, { type: 'ready' }, turn], false],
  ['turn while offline is refused', [{ type: 'consent' }, { type: 'ready' }, turn], false],
];

for (const [name, events, on] of ROWS) {
  test(`phone mic ${on ? 'ON ' : 'OFF'} — ${name}`, () => assert.equal(micWanted(run(events)), on));
}

test('phone mic OFF — reload: a new page starts with no turn, whatever the old page had', () => {
  const s = initialState({ consent: true });
  assert.equal(micWanted(s), false);
  assert.equal(micWanted(run([{ type: 'connected' }, { type: 'ready' }], s)), false);
});

test('TV: mic is wanted only in the Your Turn phases', () => {
  for (const p of ['LISTEN', 'DONE', 'CANCEL']) assert.equal(micShouldBeOn(p), false, p);
  for (const p of ['TURN_START', 'LISTENING', 'READING', 'HELP']) assert.equal(micShouldBeOn(p), true, p);
});
