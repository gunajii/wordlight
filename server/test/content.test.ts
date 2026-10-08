import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixtureMarks, markByteMismatches, validateStory, hindiTextProblems, timeTokens, type StoryPackage } from '@wordlight/story-package';
import { buildStory } from '../../tools/content/build-story.ts';
import { PollyNarration, fakePollyClient } from '../../tools/content/narration.ts';
import { checkStoryDir } from '../src/content.ts';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'wl-content-'));
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

test('fixture narration produces Polly-format marks whose UTF-8 byte ranges decode to their words (Hindi + English)', () => {
  for (const text of ['बिल्ली ने दूध पिया। “आओ!” माँ ने कहा।', 'Tara’s kite — red and “big”, flew high.']) {
    const { marks } = fixtureMarks(text);
    assert.deepEqual(markByteMismatches(text, marks), []);
    const toks = timeTokens(text, marks, 99999);
    assert.equal(toks.length, text.split(/\s+/).length);
  }
});

test('build-story runs the Polly pipeline end to end against a fake Polly client (no AWS): Hindi bytes → story.json', async () => {
  const dir = tmp(); const src = path.join(dir, 'src'); const out = path.join(dir, 'out');
  mkdirSync(src); writeFileSync(path.join(src, 'a.png'), PNG); writeFileSync(path.join(src, 'b.png'), PNG);
  const calls: any[] = [];
  const fake = fakePollyClient(calls);
  const narration = new PollyNarration({ ...fake, voiceId: 'Kajal' });
  const credits = { source: 'WordLight test content', license: 'original', title: 'T', author: 'A', attribution: 'Test.' };
  const { story, issues } = await buildStory({ src: { id: 'hi-test', lang: 'hi-IN', level: 1, title: 'परीक्षा', credits, pages: [{ image: 'a.png', text: 'एक छोटी चिड़िया पेड़ पर बैठी थी। वह गाना गाती थी।' }, { image: 'b.png', text: 'माँ ने गरम रोटी बनाई। सबने खाई।' }] }, srcDir: src, outDir: out, narration });
  assert.deepEqual(issues.filter((i) => i.level === 'error'), []);
  assert.equal(calls.length, 6, 'mp3 + pcm + marks per page');
  assert.ok(calls.every((c) => c.VoiceId === 'Kajal' && c.Engine === 'neural' && c.LanguageCode === 'hi-IN'));
  assert.equal(calls[0].Text, 'एक छोटी चिड़िया पेड़ पर बैठी थी। वह गाना गाती थी।', 'the exact page text is what Polly receives');
  const w = story.pages[0].lines[0].words;
  assert.deepEqual(w.map((x) => x.w), ['एक', 'छोटी', 'चिड़िया', 'पेड़', 'पर', 'बैठी', 'थी।']);
  assert.ok(w.every((x, i) => i === 0 || x.t0 > w[i - 1].t0), 'strictly increasing word starts');
  assert.equal(story.voice.engine, 'polly-neural'); assert.equal(story.timing.source, 'polly-speech-marks');
  assert.ok(existsSync(path.join(out, 'story.json')) && existsSync(path.join(out, 'p1.mp3')) && existsSync(path.join(out, 'p2.png')));
  rmSync(dir, { recursive: true });
});

test('build-story with a narration style: SSML to Polly, marks mapped back to the text, line ends from the audio', async () => {
  const dir = tmp(); const src = path.join(dir, 'src'); const out = path.join(dir, 'out');
  mkdirSync(src); writeFileSync(path.join(src, 'a.png'), PNG);
  const calls: any[] = [];
  const narration = new PollyNarration({ ...fakePollyClient(calls), voiceId: 'Kajal', style: { rate: '90%', volume: '+6dB', lineBreakMs: 650 } });
  const credits = { source: 'WordLight test content', license: 'original', title: 'T', author: 'A', attribution: 'Test.' };
  const helpCalls: any[] = [];
  const helpVoice = new PollyNarration({ ...fakePollyClient(helpCalls), voiceId: 'Kajal' });
  const { story, issues } = await buildStory({ src: { id: 'en-test', lang: 'en-IN', level: 1, title: 'T', credits, pages: [{ image: 'a.png', text: 'We walk in a line, quietly. We do not talk.' }] }, srcDir: src, outDir: out, narration, helpVoice });
  const turnWords = story.pages.flatMap((p) => p.lines).filter((l) => l.turn).flatMap((l) => l.words);
  assert.ok(turnWords.length > 0 && turnWords.every((w) => w.clip && existsSync(path.join(out, w.clip))), 'every turn-line word has a help clip');
  assert.ok(helpCalls.every((c) => c.TextType === 'ssml' && /^<speak><prosody rate="80%">[^<.,]+<\/prosody><\/speak>$/.test(c.Text)), 'clips: the bare word, slow');
  assert.deepEqual(issues.filter((i) => i.level === 'error'), []);
  assert.ok(calls.every((c) => c.TextType === 'ssml'));
  assert.equal(calls[0].Text, '<speak><prosody rate="90%" volume="+6dB">We walk in a line, quietly.<break time="650ms"/> We do not talk.</prosody></speak>');
  const [l1, l2] = story.pages[0].lines;
  assert.deepEqual(l1.words.map((w) => w.w), ['We', 'walk', 'in', 'a', 'line,', 'quietly.']);
  assert.deepEqual(l2.words.map((w) => w.w), ['We', 'do', 'not', 'talk.']);
  assert.ok(l1.words.at(-1)!.t1 <= l2.words[0].t0, 'the last word ends before the next line');
  assert.deepEqual(story.voice.style, { rate: '90%', volume: '+6dB', lineBreakMs: 650 });
  rmSync(dir, { recursive: true });
});

const good = (): StoryPackage => JSON.parse(JSON.stringify({
  packageVersion: 1, id: 'good-story', lang: 'en-IN', level: 1, title: 'Good',
  credits: { source: 'StoryWeaver', license: 'CC BY 4.0', title: 'Good', author: 'A', url: 'https://storyweaver.org.in/x', attribution: 'Good by A, CC BY 4.0' },
  voice: { engine: 'polly-neural', id: 'Kajal' }, timing: { source: 'polly-speech-marks', verified: true },
  pages: [{ image: 'p1.png', audio: 'p1.mp3', durationMs: 3000, lines: [{ text: 'The cat sat down.', turn: true, words: [{ w: 'The', t0: 0, t1: 300 }, { w: 'cat', t0: 300, t1: 700 }, { w: 'sat', t0: 700, t1: 1000 }, { w: 'down.', t0: 1000, t1: 1500 }] }] }],
}));
const errs = (s: any) => validateStory(s).filter((i) => i.level === 'error').map((i) => `${i.path}: ${i.message}`);

test('validator rejects: overlapping words, missing credits, unsupported language, bad turn word count, malformed Hindi, schema gaps', () => {
  assert.deepEqual(errs(good()), []);
  let s: any = good(); s.pages[0].lines[0].words[2].t0 = 600; assert.ok(errs(s).some((e) => /overlaps/.test(e)));
  s = good(); delete s.credits.author; assert.ok(errs(s).some((e) => /credits.author/.test(e)));
  s = good(); delete s.credits.url; assert.ok(errs(s).some((e) => /credits.url/.test(e)));
  s = good(); s.lang = 'mr-IN'; assert.ok(errs(s).some((e) => /unsupported language/.test(e)));
  s = good(); s.pages[0].lines[0] = { text: 'Cat.', turn: true, words: [{ w: 'Cat.', t0: 0, t1: 300 }] }; assert.ok(errs(s).some((e) => /turn line has 1 words/.test(e)));
  s = good(); s.voice = { engine: 'tts-x', id: '' }; assert.ok(errs(s).some((e) => /^voice/.test(e)));
  s = good(); s.pages[0].lines[0].words[3].t1 = 9000; assert.ok(errs(s).some((e) => /after the page audio/.test(e)));
  assert.deepEqual(hindiTextProblems('बिल्ली दूध पी गई।'), []);
  assert.ok(hindiTextProblems('ि बिल्ली').some((p) => /combining mark/.test(p)));
  assert.ok(hindiTextProblems('बिल्ली​दूध').some((p) => /zero-width/.test(p)));
  assert.ok(hindiTextProblems('\u095Bमीन').some((p) => /NFC/.test(p)), 'precomposed nukta letters (composition exclusions) are not NFC');
});

test('package check on disk: missing narration/image files and id mismatch fail before reaching the TV', async () => {
  const dir = path.join(tmp(), 'good-story'); mkdirSync(dir);
  writeFileSync(path.join(dir, 'story.json'), JSON.stringify(good()));
  let c = await checkStoryDir(dir);
  assert.equal(c.ok, false);
  assert.ok(c.issues.some((i) => i.path === 'p1.mp3' && /missing asset/.test(i.message)));
  writeFileSync(path.join(dir, 'p1.mp3'), Buffer.from([1])); writeFileSync(path.join(dir, 'p1.png'), PNG);
  c = await checkStoryDir(dir);
  assert.equal(c.ok, true, JSON.stringify(c.issues));
  const other = path.join(path.dirname(dir), 'other-name'); mkdirSync(other);
  writeFileSync(path.join(other, 'story.json'), readFileSync(path.join(dir, 'story.json')));
  assert.ok((await checkStoryDir(other)).issues.some((i) => /does not match its folder/.test(i.message)));
  writeFileSync(path.join(other, 'story.json'), '{ not json');
  assert.equal((await checkStoryDir(other)).ok, false);
});
