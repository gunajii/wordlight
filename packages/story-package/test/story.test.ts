import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayTokens, timeTokens, parseSpeechMarks, chooseTurns, validateStory, type SpeechMark, type StoryPackage } from '../src/index.ts';

const enc = new TextEncoder();
/** Build word marks the way Polly does: byte offsets of each bare word in the UTF-8 text. */
function marksFor(text: string, words: [string, number][]): SpeechMark[] {
  let from = 0;
  return words.map(([value, time]) => {
    const ci = text.indexOf(value, from);
    from = ci + value.length;
    const start = enc.encode(text.slice(0, ci)).length;
    return { time, type: 'word', start, end: start + enc.encode(value).length, value };
  });
}

test('Devanagari: byte offsets (3 bytes per character) map to the right words', () => {
  const text = 'एक छोटा चूहा था।';
  const toks = displayTokens(text);
  assert.deepEqual(toks.map((t) => t.w), ['एक', 'छोटा', 'चूहा', 'था।']);
  assert.equal(toks[1].b0, 7); // "एक " = 2×3 + 1 bytes
  const marks = marksFor(text, [['एक', 120], ['छोटा', 380], ['चूहा', 760], ['था', 1100]]);
  const timed = timeTokens(text, marks, 1500);
  assert.deepEqual(timed.map((t) => [t.w, t.t0, t.t1]), [['एक', 120, 380], ['छोटा', 380, 760], ['चूहा', 760, 1100], ['था।', 1100, 1500]]);
  // Treating byte offsets as string indexes would have been wrong:
  assert.notEqual(text.slice(marks[1].start, marks[1].end), 'छोटा');
});

test('English with punctuation and a stand-alone dash', () => {
  const text = 'The cat — "ran home!"';
  const marks = marksFor(text, [['The', 0], ['cat', 300], ['ran', 900], ['home', 1200]]);
  const timed = timeTokens(text, marks, 1700);
  assert.deepEqual(timed.map((t) => [t.w, t.t0, t.marked]), [['The', 0, true], ['cat', 300, true], ['—', 300, false], ['"ran', 900, true], ['home!"', 1200, true]]);
  assert.equal(timed.at(-1)!.t1, 1700);
});

test('Polly NDJSON output parses', () => {
  const nd = '{"time":6,"type":"sentence","start":0,"end":23,"value":"Mary had a little lamb."}\n{"time":6,"type":"word","start":0,"end":4,"value":"Mary"}\n{"time":373,"type":"word","start":5,"end":8,"value":"had"}\n';
  const m = parseSpeechMarks(nd);
  assert.equal(m.length, 3);
  assert.equal(m[2].time, 373);
});

test('turn selection is deterministic, spread out, and respects word count/length rules', () => {
  const lines = [
    'Once upon a time there lived a mouse',  // 0: first line, never a turn
    'The mouse was small',                  // 1
    'Everyone laughed at the extraordinary mouse', // 2: word too long
    'He ran',                               // 3: too short
    'She had a red hat',                    // 4
    'They sat by the tree and ate lunch together on the grass', // 5: too long a line
    'The sun was hot',                      // 6
    'It was 5 o clock',                     // 7: digits
  ].map((t, i) => ({ page: 0, line: i, words: t.split(' ') }));
  const a = chooseTurns(lines);
  assert.deepEqual(a, chooseTurns(lines));
  assert.ok(!a.includes(0) && !a.includes(2) && !a.includes(3) && !a.includes(5) && !a.includes(7));
  assert.equal(a.length, 2);
  assert.ok(a[0] < a[1]);
});

const good = (): StoryPackage => ({
  packageVersion: 1, id: 'test-story', lang: 'en-IN', level: 1, title: 'Test',
  credits: { source: 'WordLight test content', license: 'original', title: 'Test', author: 'WordLight', attribution: 'Test content by the WordLight team.' },
  voice: { engine: 'synthetic-clicks', id: 'clicks' }, timing: { source: 'synthetic', verified: true },
  pages: [{ image: 'p1.webp', audio: 'p1.mp3', durationMs: 2000, lines: [{ text: 'The cat ran', turn: true, words: [{ w: 'The', t0: 0, t1: 300 }, { w: 'cat', t0: 300, t1: 800 }, { w: 'ran', t0: 800, t1: 1200 }] }] }],
});

test('validator: good package passes; missing attribution, bad timings and bad file names fail', () => {
  assert.deepEqual(validateStory(good()).filter((i) => i.level === 'error'), []);
  const s1 = good(); (s1.credits as any).attribution = ''; s1.credits.source = 'StoryWeaver';
  const e1 = validateStory(s1).filter((i) => i.level === 'error').map((i) => i.path);
  assert.ok(e1.includes('credits.attribution') && e1.includes('credits.url'));
  const s2 = good(); s2.pages[0].lines[0].words[1].t0 = 100; s2.pages[0].lines[0].words[0].t0 = 200;
  assert.ok(validateStory(s2).some((i) => i.level === 'error' && /before the previous/.test(i.message)));
  const s3 = good(); s3.pages[0].audio = '../etc/passwd.mp3';
  assert.ok(validateStory(s3).some((i) => i.path === 'pages[0].audio'));
  const s4 = good(); s4.pages[0].lines[0].text = 'The dog ran';
  assert.ok(validateStory(s4).some((i) => /spell the text/.test(i.message)));
});
