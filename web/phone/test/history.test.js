import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyView, dayLabel } from '../history.js';

const NOW = new Date(2026, 9, 14, 20, 0).getTime(); // 14 Oct 2026, 8 pm local
const at = (d, h = 19) => new Date(2026, 9, d, h, 0).toISOString();

test('day labels: today, yesterday, then the date', () => {
  assert.equal(dayLabel(at(14, 7), NOW), 'Today');
  assert.equal(dayLabel(at(13, 23), NOW), 'Yesterday');
  assert.match(dayLabel(at(11), NOW), /11 Oct/);
});

test('diary rows: counts only, titles from the shelf, bars scaled to the busiest session; sessions without turns left out', () => {
  const v = historyView([
    { endedAt: at(14), read: 29, helped: 2, turns: 6, storyIds: ['busy-ants'] },
    { endedAt: at(13), read: 10, helped: 0, turns: 3, storyIds: ['clean-cat'] },
    { endedAt: at(13, 8), read: 0, helped: 0, turns: 0, storyIds: ['noisy-crows'] },
    { endedAt: at(11), read: 5, helped: 1, turns: 2, storyIds: ['unknown-id'] },
  ], { 'busy-ants': 'Busy Ants', 'clean-cat': 'Clean Cat' }, NOW);
  assert.deepEqual(v.rows.map((r) => [r.day, r.title, r.read, r.helped, r.pct]), [
    ['Today', 'Busy Ants', 29, 2, 100], ['Yesterday', 'Clean Cat', 10, 0, 32], [v.rows[2].day, 'unknown-id', 5, 1, 19],
  ]);
  assert.deepEqual(v.totals, { sessions: 3, read: 44, helped: 3, days: 3 });
});

test('bad input gives an empty diary, not an error', () => {
  for (const x of [undefined, null, 'x', [null, { turns: 2 }]]) assert.deepEqual(historyView(x, {}, NOW).rows, []);
});
