import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idle, turnReduce, micShouldBeOn, nextTurn, resumeAt, helpSpan, totals, turnStopAt, echoStopAt, ECHO_STOP_AFTER_MS, formatDuration, turnProgress, playableStoryProblem, type TurnEvent, type PPage } from '../src/index.ts';

const run = (...evs: TurnEvent[]) => { let s = idle(); const rej: string[] = []; for (const e of evs) { const r = turnReduce(s, e); s = r.state; if (r.rejected) rej.push(r.rejected); } return { s, rej }; };
const begin: TurnEvent = { type: 'begin', turnId: 't', readerName: 'Riya', words: ['The', 'little', 'cat'] };

test('happy path: LISTEN → TURN_START → LISTENING → READING → HELP → READING → DONE → LISTEN', () => {
  let { s } = run(begin); assert.equal(s.phase, 'TURN_START'); assert.equal(micShouldBeOn(s.phase), true);
  ({ s } = run(begin, { type: 'mic-open' })); assert.equal(s.phase, 'LISTENING');
  ({ s } = run(begin, { type: 'mic-open' }, { type: 'word-read', index: 0 })); assert.equal(s.phase, 'READING');
  ({ s } = run(begin, { type: 'mic-open' }, { type: 'word-read', index: 0 }, { type: 'word-helped', index: 1 }));
  assert.equal(s.phase, 'HELP'); assert.equal(s.helpIndex, 1); assert.deepEqual(s.marks, ['read', 'helped', 'pending']);
  const r = run(begin, { type: 'mic-open' }, { type: 'word-read', index: 0 }, { type: 'word-helped', index: 1 }, { type: 'help-done' }, { type: 'word-read', index: 2 }, { type: 'line-done', read: 2, helped: 1, skipped: 0, durationMs: 4000 });
  assert.equal(r.s.phase, 'DONE'); assert.equal(micShouldBeOn(r.s.phase), false); assert.deepEqual(r.s.result, { read: 2, helped: 1, skipped: 0, durationMs: 4000 });
  assert.deepEqual(r.rej, []);
  assert.equal(turnReduce(r.s, { type: 'finish' }).state.phase, 'LISTEN');
});

test('cancel from any active state → CANCEL (mic off) → LISTEN', () => {
  for (const pre of [[begin], [begin, { type: 'mic-open' } as TurnEvent], [begin, { type: 'mic-open' } as TurnEvent, { type: 'word-helped', index: 0 } as TurnEvent]]) {
    const { s } = run(...pre, { type: 'cancel', reason: 'phone-lost' });
    assert.equal(s.phase, 'CANCEL'); assert.equal(micShouldBeOn(s.phase), false); assert.equal(s.cancelReason, 'phone-lost');
  }
});

test('impossible transitions are rejected and leave the state unchanged', () => {
  assert.deepEqual(run({ type: 'mic-open' }).rej, ['mic-open not allowed in LISTEN']);
  assert.deepEqual(run({ type: 'word-read', index: 0 }).rej, ['word-read not allowed in LISTEN']);
  assert.deepEqual(run(begin, begin).rej, ['begin not allowed in TURN_START']);
  const done = run(begin, { type: 'line-done', read: 3, helped: 0, skipped: 0, durationMs: 1 });
  assert.deepEqual(turnReduce(done.s, { type: 'word-read', index: 0 }).rejected, 'word-read not allowed in DONE');
  assert.deepEqual(run({ type: 'finish' }).rej, ['finish not allowed in LISTEN']);
});

test('a word already read is never downgraded (never backwards)', () => {
  const { s } = run(begin, { type: 'word-read', index: 0 }, { type: 'word-helped', index: 0 });
  assert.equal(s.marks[0], 'read');
});

const page: PPage = { durationMs: 9000, lines: [
  { text: 'a b', turn: false, words: [{ w: 'a', t0: 0, t1: 400 }, { w: 'b', t0: 450, t1: 900 }] },
  { text: 'c d', turn: true, words: [{ w: 'c', t0: 1500, t1: 1900 }, { w: 'd', t0: 2000, t1: 2600 }] },
  { text: 'e', turn: false, words: [{ w: 'e', t0: 3200, t1: 3800 }] },
] };

test('plan: stop before the turn line, resume at the next line, help span stays inside the word', () => {
  assert.deepEqual(nextTurn(page, 0, new Set()), { index: 1, stopAtMs: 1380 });
  assert.equal(nextTurn(page, 1600, new Set()), null, 'already past the stop point');
  assert.equal(nextTurn(page, 0, new Set([1])), null, 'done turns are not repeated');
  assert.equal(resumeAt(page, 1), 3140);
  assert.deepEqual(helpSpan(page.lines[1], 0), { fromMs: 1470, toMs: 1980 });
  assert.deepEqual(helpSpan(page.lines[1], 1), { fromMs: 1970, toMs: 2680 });
});

test('end-card totals come only from line.done results', () => {
  assert.deepEqual(totals([{ read: 5, helped: 1, skipped: 0 }, { read: 3, helped: 0, skipped: 1 }]), { words: 9, onOwn: 8, withHelp: 1, skipped: 1, turns: 2 });
  assert.deepEqual(totals([]), { words: 0, onOwn: 0, withHelp: 0, skipped: 0, turns: 0 });
});

test('echo mode: narration stops AFTER the turn line (TV reads it, child repeats); free mode stops before it', () => {
  const page: PPage = { durationMs: 5000, lines: [
    { text: 'Once upon a time', turn: false, words: [{ w: 'Once', t0: 0, t1: 300 }, { w: 'upon', t0: 300, t1: 600 }, { w: 'a', t0: 600, t1: 700 }, { w: 'time', t0: 700, t1: 1200 }] },
    { text: 'the cat sat', turn: true, words: [{ w: 'the', t0: 1500, t1: 1700 }, { w: 'cat', t0: 1700, t1: 2100 }, { w: 'sat', t0: 2100, t1: 2600 }] },
    { text: 'and slept', turn: false, words: [{ w: 'and', t0: 3000, t1: 3200 }, { w: 'slept', t0: 3200, t1: 3800 }] },
  ] };
  assert.equal(turnStopAt(page.lines[1], 'free'), 1380);
  assert.equal(turnStopAt(page.lines[1], 'echo'), 2600 + ECHO_STOP_AFTER_MS);
  assert.deepEqual(nextTurn(page, 1500, new Set(), 'echo'), { index: 1, stopAtMs: 2750 }, 'in echo mode the narrator is allowed into the line');
  assert.equal(nextTurn(page, 1500, new Set(), 'free'), null, 'in free mode that position is already too late');
  assert.equal(resumeAt(page, 1), 2940, 'both modes resume just before the next line');
});

test('end card and turn progress come from real counts only', () => {
  assert.deepEqual(totals([{ read: 4, helped: 1, skipped: 0 }, { read: 3, helped: 0, skipped: 1 }]), { words: 8, onOwn: 7, withHelp: 1, skipped: 1, turns: 2 });
  assert.deepEqual(totals([]), { words: 0, onOwn: 0, withHelp: 0, skipped: 0, turns: 0 });
  assert.equal(formatDuration(185_400), '3:05');
  assert.deepEqual(turnProgress(['read', 'helped', 'pending', 'skipped', 'pending']), { done: 3, total: 5, read: 1, helped: 1, skipped: 1 });
});

test('TV refuses a corrupt story package instead of crashing', () => {
  const ok = { id: 'x', credits: { attribution: 'A' }, pages: [{ audio: 'p1.mp3', image: 'p1.png', durationMs: 1000, lines: [{ words: [{ w: 'a', t0: 0, t1: 100 }, { w: 'b', t0: 100, t1: 300 }] }] }] };
  assert.equal(playableStoryProblem(ok), null);
  assert.equal(playableStoryProblem(null), 'not a story');
  assert.equal(playableStoryProblem({ ...ok, pages: [] }), 'no pages');
  assert.match(playableStoryProblem({ ...ok, pages: [{ ...ok.pages[0], lines: [{ words: [{ w: 'a', t0: 50, t1: 40 }] }] }] })!, /bad word timing/);
  assert.equal(playableStoryProblem({ ...ok, credits: {} }), 'no attribution');
});

test('echo stop: heard to the end of the line, never into the next line', () => {
  const pg = (gap: number): PPage => ({ durationMs: 9000, lines: [
    { text: 'a b', turn: true, words: [{ w: 'a', t0: 0, t1: 500 }, { w: 'b', t0: 500, t1: 1000 }] },
    { text: 'c', turn: false, words: [{ w: 'c', t0: 1000 + gap, t1: 1500 + gap }] }] });
  assert.equal(echoStopAt(pg(1200), 0, 392), 1000 + ECHO_STOP_AFTER_MS + 392, 'long pause: full output latency');
  assert.equal(echoStopAt(pg(400), 0, 392), 1000 + 400 - 120, 'short pause: capped before the next line');
  assert.equal(echoStopAt(pg(100), 0, 392), 1000 + ECHO_STOP_AFTER_MS, 'no room: plain echo stop');
  assert.equal(echoStopAt(pg(1200), 1, 392), Math.min(1500 + 1200 + ECHO_STOP_AFTER_MS + 392, 9000 - 120), 'last line: page end');
});

test('child-facing text: Hindi for Hindi stories, English otherwise, same keys, never "wrong"', async () => {
  const { childText } = await import('../src/index.ts');
  const en = childText('en-IN'), hi = childText('hi-IN');
  assert.equal(en.yourTurn('Riya', 'echo'), 'Riya, now you say it');
  assert.equal(hi.yourTurn('रिया', 'echo'), 'रिया, अब तुम बोलो');
  assert.equal(hi.lineDone(3, 1), '3 ख़ुद पढ़े · 1 थोड़ी मदद से');
  assert.equal(childText(undefined), en);
  const all = (t: any): string[] => Object.values(t).flatMap((v: any) => (typeof v === 'string' ? [v] : typeof v === 'function' ? [String(v('x', 'echo'))] : all(v)));
  for (const s of [...all(en), ...all(hi)]) assert.ok(!/wrong|incorrect|ग़लत|गलत/i.test(s), s);
  for (const s of all(hi)) assert.equal(s, s.normalize('NFC'));
});

test('turn state: after a help the TV waits for the child to say the word back (shown ✓ when said)', () => {
  let s = turnReduce(idle(), { type: 'begin', turnId: 't', readerName: 'Riya', words: ['Can', 'you', 'see', 'me?'] }).state;
  for (const e of [{ type: 'mic-open' }, { type: 'word-read', index: 0 }, { type: 'word-helped', index: 1 }] as TurnEvent[]) s = turnReduce(s, e).state;
  assert.equal(s.repeatIndex, 1); assert.equal(s.phase, 'HELP');
  s = turnReduce(s, { type: 'help-done' }).state;
  assert.equal(s.repeatIndex, 1, 'still waiting after the help word');
  s = turnReduce(s, { type: 'word-repeated', index: 1, said: true }).state;
  assert.equal(s.repeatIndex, null); assert.deepEqual(s.repeated, [false, true, false, false]);
  assert.equal(s.marks[1], 'helped', 'the count stays honest: helped');
  s = turnReduce(s, { type: 'word-helped', index: 2 }).state; s = turnReduce(s, { type: 'help-done' }).state;
  s = turnReduce(s, { type: 'word-read', index: 3 }).state;
  assert.equal(s.repeatIndex, null, 'going on to a later word ends the wait');
  assert.equal(s.repeated[2], false);
});
