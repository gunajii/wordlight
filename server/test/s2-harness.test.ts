import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { labelsFor, metrics, report, type CaseResult } from '../../tools/s2/eval.ts';
import { buildCases, type Case } from '../../tools/s2/make-cases.ts';
import { scoreObserved } from '../../tools/s2/score-observed.ts';

const C = (expected: string, spoken: Case['spoken'], category: Case['category'] = 'correct', lang: Case['lang'] = 'en-IN'): Case => ({ id: 'x', lang, category, expected, spoken });

test('S2 labels come from the case, not from results', () => {
  assert.deepEqual(labelsFor(C('The big dog.', [{ w: 'The', for: 0 }, { w: 'bag', for: 1 }, { w: 'dog', for: 2 }])), ['correct', 'misread', 'correct']);
  assert.deepEqual(labelsFor(C('The big dog.', [{ w: 'The', for: 0 }, { w: 'dog', for: 2 }])), ['correct', 'omitted', 'correct']);
  assert.deepEqual(labelsFor(C('The big dog.', [{ w: 'The', for: 0 }, { w: 'bag', for: 1 }, { w: 'big', for: 1 }, { w: 'dog', for: 2 }])), ['correct', 'corrected', 'correct']);
  assert.deepEqual(labelsFor(C('The big dog.', [{ w: 'The', for: 0 }, { w: 'big', for: 1, pauseBeforeMs: 4500 }, { w: 'dog', for: 2 }])), ['correct', 'after-pause', 'correct']);
  assert.deepEqual(labelsFor(C('We ate ice-cream.', [{ w: 'We', for: 0 }, { w: 'ate', for: 1 }, { w: 'ice cream', for: 2 }])), ['correct', 'correct', 'correct']);
  assert.deepEqual(labelsFor(C('कल हम', [{ w: 'काल', for: 0 }, { w: 'हम', for: 1 }], 'hindi-unicode', 'hi-IN')), ['misread', 'correct']);
});

test('S2 cases.json is the deterministic output of make-cases.ts', () => {
  const { lines } = JSON.parse(readFileSync(new URL('../../tools/s2/lines.json', import.meta.url), 'utf8'));
  const { cases } = JSON.parse(readFileSync(new URL('../../tools/s2/cases.json', import.meta.url), 'utf8'));
  assert.deepEqual(cases, JSON.parse(JSON.stringify(buildCases(lines))));
  const cats = new Set(cases.map((c: Case) => c.category));
  for (const k of ['correct', 'slip', 'missing', 'repeated', 'hesitation', 'long-pause', 'wrong-word', 'multiple-wrong', 'correction', 'hindi-unicode', 'english-edge']) assert.ok(cats.has(k), k);
});

const row = (lang: string, words: [string, string, number | null][]): CaseResult => ({ id: 'r', lang, category: 'correct', expected: '', spokenText: '', transcript: '', endReason: null, pass: true, result: null,
  words: words.map(([label, outcome, lat], i) => ({ i, word: 'w', label: label as any, said: null, outcome: outcome as any, ok: true, recognized: null, spokenMs: 0, recognizedMs: null, litMs: null, latencyMs: lat, recognitionMs: null })) });

test('S2 metrics: recall counts only words lit within 1 s; false accepts are misread words lit; verdict per language', () => {
  const en = row('en-IN', [['correct', 'read', 400], ['correct', 'read', 900], ['correct', 'read', 1200], ['misread', 'skipped', null]]);
  const m = metrics([en]);
  assert.equal(m.all.recallWithin1sPct, 66.7);
  assert.equal(m.all.falseAcceptPct, 0);
  assert.equal(m.verdict, 'FAIL');
  const good = row('en-IN', Array.from({ length: 10 }, () => ['correct', 'read', 500] as [string, string, number]));
  const hiBad = row('hi-IN', [['misread', 'read', 300], ['correct', 'read', 300]]);
  const m2 = metrics([good, hiBad]);
  assert.equal(m2['hi-IN'].falseAcceptPct, 100);
  assert.equal(m2.verdict, 'PARTIAL');
  assert.match(report({ engine: 'scripted', simulated: true, note: '', date: '', git: '', speaker: '' }, m2, [good, hiBad]), /LOCAL SIMULATION — not real speech recognition/);
});

test('observed scoring refuses mismatched sheets and scores from the sheet', () => {
  const tr: any = { turnId: 't1', lang: 'en-IN', words: ['the', 'big', 'dog'], startedAtServerMs: 1, endReason: null, simulated: false, result: null,
    events: [{ index: 0, kind: 'read', emitServerMs: 1500, spokenServerMs: 1000, updateReceivedMs: 1400 }, { index: 1, kind: 'skipped', emitServerMs: 2000, spokenServerMs: null, updateReceivedMs: null }, { index: 2, kind: 'read', emitServerMs: 2600, spokenServerMs: 2000, updateReceivedMs: 2500 }] };
  const rows = scoreObserved([tr], 'R M R\n');
  assert.equal(rows[0].pass, true);
  assert.equal(rows[0].words[0].latencyMs, 500);
  assert.throws(() => scoreObserved([tr], 'R R\n'), /2 marks for 3 words/);
});
