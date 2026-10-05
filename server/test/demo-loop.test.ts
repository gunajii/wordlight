import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoLoop } from '../../tools/demo/demo-loop.ts';

test('LOCAL SIMULATION end to end: story → turns → scripted speech → engine → words lit, one help per turn → mic closed → summary', { timeout: 60_000 }, async () => {
  const r = await demoLoop({ log: () => {} });
  assert.equal(r.simulated, true, 'every trace says SIMULATED');
  assert.equal(r.totals.turns, 2);
  assert.equal(r.totals.withHelp, 2, 'the demo script stalls once per turn');
  assert.ok(r.totals.onOwn >= 6);
  assert.equal(r.micClosedEveryTurn, true);
  assert.match(r.summary.text, new RegExp(`read ${r.totals.onOwn} words independently and needed help with 2 words`));
});
