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

// ---- Hindi byte-offset regressions (S4) ----
import { displayTokens as dt, timeTokens as tt, markByteMismatches } from '../src/index.ts';
const enc8 = new TextEncoder();
/** Build Polly-style word marks for `words` at `times`, with byte offsets computed the way Polly reports them. */
function bytesMarks(text: string, words: string[], times: number[]) {
  let from = 0;
  return words.map((w, i) => {
    const ci = text.indexOf(w, from); from = ci + w.length;
    const start = enc8.encode(text.slice(0, ci)).length;
    return { time: times[i], type: 'word' as const, start, end: start + enc8.encode(w).length, value: w };
  });
}

test('Hindi: matras, conjuncts, nukta, chandrabindu, anusvara map by BYTES, not string index', () => {
  const text = 'चिड़िया ने ख़ज़ाना देखा, गाँव में हँसी। क्षमा त्रिकोण ज्ञान!';
  const words = ['चिड़िया', 'ने', 'ख़ज़ाना', 'देखा', 'गाँव', 'में', 'हँसी', 'क्षमा', 'त्रिकोण', 'ज्ञान'];
  const times = words.map((_, i) => 100 * (i + 1));
  const marks = bytesMarks(text, words, times);
  assert.deepEqual(markByteMismatches(text, marks), []);
  const toks = tt(text, marks, 2000);
  assert.deepEqual(toks.map((t) => t.t0), times);
  assert.deepEqual(toks.map((t) => t.w), ['चिड़िया', 'ने', 'ख़ज़ाना', 'देखा,', 'गाँव', 'में', 'हँसी।', 'क्षमा', 'त्रिकोण', 'ज्ञान!']);
  // the bug this prevents: using byte offsets as JS string indexes lands mid-word or past the end
  const m = marks[4];
  assert.notEqual(text.slice(m.start, m.end), 'गाँव');
});

test('Hindi: nukta as a separate combining mark (NFD) vs precomposed — the mapping follows the exact bytes sent', () => {
  const nfd = 'पेड़ पर चिड़िया'.normalize('NFD');
  const nfc = nfd.normalize('NFC');
  const words = ['पेड़', 'पर', 'चिड़िया'];
  const marksNfd = bytesMarks(nfd, words.map((w) => w.normalize('NFD')), [0, 300, 500]);
  assert.deepEqual(tt(nfd, marksNfd, 1000).map((t) => t.t0), [0, 300, 500]);
  // Re-normalising the text AFTER synthesis would silently desynchronise offsets whenever the forms differ:
  if (nfd !== nfc) assert.ok(markByteMismatches(nfc, marksNfd).length > 0, 'mismatch detected, not silently mis-mapped');
  assert.equal(dt(nfd).length, 3);
});

test('hyphenated Hindi word with two Polly marks stays one display token, timed by its first mark', () => {
  const text = 'बिल्ली धीरे-धीरे आई';
  const marks = bytesMarks(text, ['बिल्ली', 'धीरे', 'धीरे', 'आई'], [0, 400, 700, 1000]);
  const toks = tt(text, marks, 1500);
  assert.deepEqual(toks.map((t) => [t.w, t.t0]), [['बिल्ली', 0], ['धीरे-धीरे', 400], ['आई', 1000]]);
});

test('SSML narration: marks with SSML byte offsets map back onto the plain page text (Latin and Devanagari)', async () => {
  const { pageSsml, marksToText, markByteMismatches, timeTokens } = await import('../src/index.ts');
  for (const lines of [['Hello, I am the fourth one in the line.', 'Can you see me?'], ['चींटियाँ कतार में चलती हैं।', 'हम बात नहीं करतीं।']]) {
    const { ssml, text, toTextByte } = pageSsml(lines, { rate: '90%', volume: '+6dB', lineBreakMs: 600 });
    assert.equal(text, lines.join(' '));
    assert.match(ssml, /^<speak><prosody rate="90%" volume="\+6dB">.*<break time="600ms"\/> .*<\/prosody><\/speak>$/);
    // marks as Polly would return them for the SSML input: byte offsets into `ssml`
    const words = text.split(' ');
    const ssmlMarks = marksFor(ssml, words.map((w, i) => [w, i * 300] as [string, number]));
    // Polly hi-IN also emits a word mark for the <break/> tag; it must be dropped
    const bi = ssml.indexOf('<break'); const be = ssml.indexOf('/>', bi) + 2;
    const tagMark = { time: 1000, type: 'word' as const, start: enc.encode(ssml.slice(0, bi)).length, end: enc.encode(ssml.slice(0, be)).length, value: ssml.slice(bi, be) };
    const mapped = marksToText([...ssmlMarks, tagMark].sort((x, y) => x.start - y.start), toTextByte);
    assert.equal(mapped.length, ssmlMarks.length);
    assert.deepEqual(markByteMismatches(text, mapped), []);
    assert.deepEqual(timeTokens(text, mapped, 5000).map((t) => t.w), words);
  }
  assert.throws(() => pageSsml(['Tom & Jerry'], { rate: '90%' }), /not supported/);
  assert.throws(() => pageSsml(['x'], { rate: 'fast!' }), /bad rate/);
});

test('soundEndMs finds the last sound before the next word', async () => {
  const { soundEndMs } = await import('../src/index.ts');
  const pcm = new Int16Array(16 * 1000);
  for (let i = 16 * 100; i < 16 * 420; i++) pcm[i] = i % 2 ? 9000 : -9000;
  assert.equal(soundEndMs(pcm, 100, 900), 420);
});
