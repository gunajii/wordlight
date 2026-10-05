import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReadingTurn, wordScore, normalizeWord, type EngineEvent } from '../src/index.ts';

const en = (words: string, startMs = 0, extra = {}) => new ReadingTurn({ words: words.split(' '), lang: 'en-IN', startMs, ...extra });
const say = (t: ReadingTurn, text: string, now: number, seg = 's1', final = true) =>
  t.feed({ segmentId: seg, words: text.split(' ').map((w) => ({ text: w })), final }, now);
const kinds = (ev: EngineEvent[]) => ev.map((e) => ('index' in e ? `${e.type}:${e.index}` : e.type));

test('exact reading lights every word in order and finishes the line', () => {
  const t = en('The little cat ran home.', 1000);
  const ev = say(t, 'the little cat ran home', 3000);
  assert.deepEqual(kinds(ev), ['word.read:0', 'word.read:1', 'word.read:2', 'word.read:3', 'word.read:4', 'line.done']);
  const done = ev.at(-1) as Extract<EngineEvent, { type: 'line.done' }>;
  assert.deepEqual({ read: done.read, helped: done.helped, skipped: done.skipped, durationMs: done.durationMs }, { read: 5, helped: 0, skipped: 0, durationMs: 2000 });
  assert.deepEqual(say(t, 'more words', 4000), []); // nothing after done
});

test('partial transcripts: a word still growing is not consumed or lost', () => {
  const t = en('the little cat');
  assert.deepEqual(kinds(t.feed({ segmentId: 'a', words: [{ text: 'the' }, { text: 'lit' }], final: false }, 100)), ['word.read:0']);
  assert.deepEqual(kinds(t.feed({ segmentId: 'a', words: [{ text: 'the' }, { text: 'little' }], final: false }, 200)), ['word.read:1']);
  assert.deepEqual(kinds(t.feed({ segmentId: 'a', words: [{ text: 'the' }, { text: 'little' }, { text: 'cat' }], final: true }, 300)), ['word.read:2', 'line.done']);
});

test('fuzzy: ASR spelling noise on longer words still counts', () => {
  const t = en('elephant rabbit');
  assert.deepEqual(kinds(say(t, 'elefant rabit', 100)), ['word.read:0', 'word.read:1', 'line.done']);
});

test('misreads do NOT light the word: cat/hat, house/horse, big/bag, ran/run', () => {
  for (const [exp, heard] of [['cat', 'hat'], ['house', 'horse'], ['big', 'bag'], ['ran', 'run'], ['the', 'a'], ['went', 'want'], ['lived', 'loved'], ['garden', 'gardens'], ['little', 'litter'], ['rabbit', 'robot']]) {
    assert.equal(wordScore(exp, heard, 'en-IN'), 0, `${heard} must not count as ${exp}`);
  }
  const t = en('the cat sat');
  assert.deepEqual(kinds(say(t, 'the hat', 100)), ['word.read:0']);
  assert.equal(t.states[1], 'pending');
});

test('Hindi: exact, danda and variant spellings match; different words do not', () => {
  const t = new ReadingTurn({ words: 'एक छोटा चूहा था।'.split(' '), lang: 'hi-IN', startMs: 0 });
  assert.deepEqual(kinds(t.feed({ segmentId: 'x', words: [{ text: 'एक' }, { text: 'छोटा' }, { text: 'चूहा' }, { text: 'था' }], final: true }, 500)),
    ['word.read:0', 'word.read:1', 'word.read:2', 'word.read:3', 'line.done']);
  const n = (w: string) => normalizeWord(w, 'hi-IN');
  assert.equal(wordScore(n('हिंदी'), n('हिन्दी'), 'hi-IN'), 1);
  assert.equal(wordScore(n('गये'), n('गए'), 'hi-IN'), 1);
  assert.equal(wordScore(n('घर'), n('कर'), 'hi-IN'), 0);
  assert.equal(wordScore(n('कल'), n('काल'), 'hi-IN'), 0); // short words must be exact
  assert.equal(wordScore(n('किताबें'), n('किताबों'), 'hi-IN'), 0); // vowel-sign swap on a long word
  assert.equal(wordScore(n('बिल्ली'), n('बल्ली'), 'hi-IN'), 0);
});

test('one skipped word is allowed; the skipped word is marked, not read', () => {
  const t = en('the big red ball');
  assert.deepEqual(kinds(say(t, 'the red ball', 100)), ['word.read:0', 'word.skipped:1', 'word.read:2', 'word.read:3', 'line.done']);
  assert.deepEqual(t.counts(), { read: 3, helped: 0, skipped: 1 });
});

test('skips are capped per line; beyond the cap the stall rule takes over', () => {
  const t = en('a b1 c1 d1', 0, { maxSkipsPerLine: 1 });
  // cannot skip two words at once
  assert.deepEqual(kinds(say(t, 'd1', 100)), []);
});

test('repeated and extra words are ignored, not counted', () => {
  const t = en('the dog ran');
  assert.deepEqual(kinds(say(t, 'the the um dog dog ran', 100)), ['word.read:0', 'word.read:1', 'word.read:2', 'line.done']);
  assert.deepEqual(t.counts(), { read: 3, helped: 0, skipped: 0 });
});

test('out of order: reading a later word first skips the earlier one (never goes back)', () => {
  const t = en('the cat');
  assert.deepEqual(kinds(say(t, 'cat the', 100)), ['word.skipped:0', 'word.read:1', 'line.done']);
});

test('stall: 3 s without progress helps the next word, deterministically', () => {
  const t = en('the little cat', 0);
  assert.deepEqual(t.tick(2999), []);
  assert.deepEqual(kinds(t.tick(3000)), ['word.helped:0']);
  assert.deepEqual(t.tick(5999), []); // timer restarts after help
  assert.deepEqual(kinds(say(t, 'little', 4000)), ['word.read:1']);
  assert.deepEqual(t.tick(6999), []);
  assert.deepEqual(kinds(t.tick(7000)), ['word.helped:2', 'line.done']);
  assert.deepEqual(t.counts(), { read: 1, helped: 2, skipped: 0 });
});

test('first-word grace can be longer than the stall time', () => {
  const t = en('the cat', 0, { firstStallMs: 5000 });
  assert.deepEqual(t.tick(3000), []);
  assert.deepEqual(kinds(t.tick(5000)), ['word.helped:0']);
});

test('asked help: Select helps the next word immediately', () => {
  const t = en('one more', 0);
  const ev = t.askHelp(700);
  assert.deepEqual(kinds(ev), ['word.helped:0']);
  assert.equal((ev[0] as any).reason, 'asked');
});

test('confidence combines match similarity and ASR confidence', () => {
  const t = en('elephant');
  const ev = t.feed({ segmentId: 's', words: [{ text: 'elefant', confidence: 0.5 }], final: true }, 10);
  assert.equal((ev[0] as any).confidence, 0.38); // similarity 0.75 (2 edits of 8) × ASR 0.5
});

// ---- found by the S2 harness (scripted set): substitutions and compounds ----
test('two misreads in one line: each misread word is NOT lit, and the correctly read words after them still light', () => {
  const t = en('She found a shell by the sea.');
  const ev = say(t, 'she fond a bell by the sea', 100);
  assert.deepEqual(kinds(ev), ['word.read:0', 'word.skipped:1', 'word.read:2', 'word.skipped:3', 'word.read:4', 'word.read:5', 'word.read:6', 'line.done']);
  assert.deepEqual(t.counts(), { read: 5, helped: 0, skipped: 2 });
});

test('omissions still use the per-line skip budget (no different word was heard in their place)', () => {
  const t = en('a b1 c1 d1 e1', 0, { maxSkipsPerLine: 1 });
  assert.deepEqual(kinds(say(t, 'a c1', 100)), ['word.read:0', 'word.skipped:1', 'word.read:2']);
  assert.deepEqual(kinds(say(t, 'a c1 e1', 200)), [], 'second omission refused: budget used');
});

test('a misread word followed by silence is helped, never lit', () => {
  const t = en('the big dog', 0);
  assert.deepEqual(kinds(say(t, 'the bag', 100)), ['word.read:0']);
  assert.deepEqual(kinds(t.tick(3100)), ['word.helped:1']);
});

test('hyphenated word read as two words lights only when the two words join to exactly that word', () => {
  const t = en('We ate ice-cream today.');
  assert.deepEqual(kinds(say(t, 'we ate ice cream today', 100)), ['word.read:0', 'word.read:1', 'word.read:2', 'word.read:3', 'line.done']);
  const t2 = en('We ate ice-cream today.');
  assert.deepEqual(kinds(say(t2, 'we ate ice cold today', 100)), ['word.read:0', 'word.read:1', 'word.skipped:2', 'word.read:3', 'line.done'], 'ice + cold ≠ ice-cream');
});

test('two consecutive misreads: both stay unlit, the engine re-finds the child at the word after', () => {
  const t = en('The bus stopped near the school.');
  assert.deepEqual(kinds(say(t, 'the bat shopped near the school', 100)), ['word.read:0', 'word.skipped:1', 'word.skipped:2', 'word.read:3', 'word.read:4', 'word.read:5', 'line.done']);
});

test('lookahead is never more than two words, and two only after two different words were heard', () => {
  const t = en('one two three four five');
  assert.deepEqual(kinds(say(t, 'one four', 100)), ['word.read:0'], 'jumping two ahead with nothing heard in between is refused');
  const t2 = en('one two three four five');
  assert.deepEqual(kinds(say(t2, 'one x y z five', 100)), ['word.read:0'], 'three misses never jump three ahead');
});
