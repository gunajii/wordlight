// Builds tools/s2/cases.json — the S2 evaluation set — from the base lines (tools/s2/lines.json) plus hand-written
// Unicode/English edge cases. Deterministic; re-run after editing lines.json:  node tools/s2/make-cases.ts
//
// A case = what the line says (expected) + what the reader says (spoken, in order). Each spoken item names the
// expected word it is an attempt at (`for`, null = not an attempt at any word, e.g. a repeat). `asr` = how a
// recogniser might SPELL the item; used only by the scripted (simulated) engine to exercise normalisation.
// Labels (what SHOULD happen to each expected word) are derived by the harness, never hand-tuned to results:
//   correct / slip / corrected / after-pause → should light (after-pause may be helped instead)
//   misread / omitted                        → must NOT light as read
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slipOf } from '../../server/src/reading/scripted.ts';

export type Category = 'correct' | 'slip' | 'missing' | 'repeated' | 'hesitation' | 'long-pause' | 'wrong-word' | 'multiple-wrong' | 'correction' | 'hindi-unicode' | 'english-edge';
export interface SpokenItem { w: string; for: number | null; pauseBeforeMs?: number; asr?: string }
export interface Case { id: string; lang: 'en-IN' | 'hi-IN'; category: Category; expected: string; spoken: SpokenItem[]; note?: string }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bare = (w: string) => w.replace(/[\p{P}\p{S}]+/gu, '');

export function buildCases(lines: any[]): Case[] {
  const out: Case[] = [];
  for (const l of lines) {
    const words: string[] = l.text.split(/\s+/);
    const say = (i: number, extra: Partial<SpokenItem> = {}): SpokenItem => ({ w: bare(words[i]), for: i, ...extra });
    const mk = (category: Category, spoken: SpokenItem[], note?: string) => out.push({ id: `${l.id}-${category}`, lang: l.lang, category, expected: l.text, spoken, ...(note ? { note } : {}) });
    const mis = Object.entries(l.misread as Record<string, string>).map(([k, v]) => [Number(k), v] as [number, string]).sort((a, b) => a[0] - b[0]);
    mk('correct', words.map((_, i) => say(i)));
    mk('wrong-word', words.map((_, i) => (i === mis[0][0] ? { w: mis[0][1], for: i } : say(i))), `“${bare(words[mis[0][0]])}” read as “${mis[0][1]}”`);
    if (mis.length >= 2) mk('multiple-wrong', words.map((_, i) => { const m = mis.find(([k]) => k === i); return m ? { w: m[1], for: i } : say(i); }));
    mk('correction', words.flatMap((_, i) => (i === mis[0][0] ? [{ w: mis[0][1], for: i }, say(i, { pauseBeforeMs: 500 })] : [say(i)])), 'misread, then corrected');
    mk('missing', words.map((_, i) => i).filter((i) => i !== l.omit).map((i) => say(i)));
    mk('repeated', words.flatMap((_, i) => (i === l.repeat ? [say(i), { w: bare(words[i]), for: null, pauseBeforeMs: 150 }] : [say(i)])));
    mk('hesitation', words.map((_, i) => (i === l.hesitate ? say(i, { pauseBeforeMs: 1200 }) : say(i))));
    mk('long-pause', words.map((_, i) => (i === l.pause ? say(i, { pauseBeforeMs: 4500 }) : say(i))), 'pause longer than the 3 s help time: help may come first');
    const slipAt = words.findIndex((w) => slipOf(w));
    if (slipAt >= 0) mk('slip', words.map((_, i) => (i === slipAt ? say(i, { asr: slipOf(words[i])! }) : say(i))), `recogniser spells “${bare(words[slipAt])}” as “${slipOf(words[slipAt])}”`);
  }
  // ---- hand-written edge cases ----
  const edge = (id: string, lang: Case['lang'], category: Category, expected: string, spoken: SpokenItem[], note: string) => out.push({ id, lang, category, expected, spoken, note });
  const each = (text: string, asr: Record<number, string> = {}) => text.split(/\s+/).map((w, i) => ({ w: bare(w), for: i, ...(asr[i] ? { asr: asr[i] } : {}) }));
  edge('hi-u01', 'hi-IN', 'hindi-unicode', 'ज़मीन पर फूल खिले।', each('ज़मीन पर फूल खिले।', { 0: 'जमीन' }), 'nukta: ASR may drop it (ज़ → ज)');
  edge('hi-u02', 'hi-IN', 'hindi-unicode', 'बच्चे हँसते हुए आए।', each('बच्चे हँसते हुए आए।', { 1: 'हंसते' }), 'chandrabindu written as anusvara');
  edge('hi-u03', 'hi-IN', 'hindi-unicode', 'हम हिन्दी में गाते हैं।', each('हम हिन्दी में गाते हैं।', { 1: 'हिंदी' }), 'nasal + virama vs anusvara');
  edge('hi-u04', 'hi-IN', 'hindi-unicode', 'वे घर चले गये।', each('वे घर चले गये।', { 3: 'गए' }), 'final ये vs ए spelling');
  edge('hi-u05', 'hi-IN', 'hindi-unicode', 'पेड़ पर ५ चिड़ियाँ थीं।', each('पेड़ पर ५ चिड़ियाँ थीं।', { 2: 'पांच' }), 'Devanagari digit read as a number word');
  edge('hi-u06', 'hi-IN', 'hindi-unicode', 'मेरी बिल्ली काली है।', [{ w: 'मेरी', for: 0 }, { w: 'बल्ली', for: 1 }, { w: 'काली', for: 2 }, { w: 'है', for: 3 }], 'one vowel sign dropped (बिल्ली → बल्ली) is a different word: must not light');
  edge('hi-u07', 'hi-IN', 'hindi-unicode', 'कल हम मेला जाएँगे।', [{ w: 'काल', for: 0 }, { w: 'हम', for: 1 }, { w: 'मेला', for: 2 }, { w: 'जाएंगे', for: 3, asr: 'जाएंगे' }], 'कल → काल (vowel) must not light; chandrabindu spelling must');
  edge('en-e01', 'en-IN', 'english-edge', '“Come here,” said Mom.', each('“Come here,” said Mom.'), 'curly quotes and comma attached to words');
  edge('en-e02', 'en-IN', 'english-edge', 'Tara didn’t see the cat.', each('Tara didn’t see the cat.', { 1: "didn't" }), 'curly vs straight apostrophe in a contraction');
  edge('en-e03', 'en-IN', 'english-edge', 'We ate ice-cream today.', [{ w: 'We', for: 0 }, { w: 'ate', for: 1 }, { w: 'ice cream', for: 2 }, { w: 'today', for: 3 }], 'hyphenated word; recognisers usually write it as two words');
  edge('en-e04', 'en-IN', 'english-edge', 'I saw 3 big ducks.', each('I saw 3 big ducks.', { 2: 'three' }), 'digit in the book, number word from the recogniser');
  edge('en-e05', 'en-IN', 'english-edge', 'Mr. Rao has a dog.', each('Mr. Rao has a dog.', { 0: 'Mister' }), 'abbreviation in the book, full word from the recogniser: rejected today (known limitation; avoid abbreviations in turn lines)');
  edge('en-e06', 'en-IN', 'english-edge', 'The cat sat on the mat.', [{ w: 'The', for: 0 }, { w: 'cat', for: 1 }, { w: 'sat', for: 2 }, { w: 'on', for: 3 }, { w: 'the', for: 4 }, { w: 'hat', for: 5 }], 'rhyming substitution on the last word must not light');
  edge('en-e05b', 'en-IN', 'english-edge', 'The colour is red.', each('The colour is red.', { 1: 'color' }), 'British vs US spelling: the strict matcher rejects it today (known limitation; prefer turn lines without such words)');
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { lines } = JSON.parse(readFileSync(path.join(ROOT, 'tools/s2/lines.json'), 'utf8'));
  const cases = buildCases(lines);
  writeFileSync(path.join(ROOT, 'tools/s2/cases.json'), JSON.stringify({ _note: 'Generated by tools/s2/make-cases.ts. Original text (no third-party content). Adult/control and synthetic speech only — no child data.', cases }, null, 1) + '\n');
  const by: Record<string, number> = {};
  for (const c of cases) by[c.category] = (by[c.category] ?? 0) + 1;
  console.log(`${cases.length} cases`, by);
}
