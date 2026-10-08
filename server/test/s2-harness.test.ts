import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { labelsFor, metrics, report, soundEndMs, withLeadSilence, type CaseResult } from '../../tools/s2/eval.ts';
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

test('end-to-end latency joins spoken (recogniser), emitted (server) and lit (TV telemetry) per word', async () => {
  const { e2eRows } = await import('../../tools/e2e/word-lit-latency.ts');
  const traces = [{ turnId: 'T', events: [{ index: 0, kind: 'read', emitServerMs: 1600, spokenServerMs: 1000 }, { index: 1, kind: 'helped', emitServerMs: 5000, spokenServerMs: null }, { index: 2, kind: 'read', emitServerMs: 2700, spokenServerMs: 2000 }] }];
  const tel = [{ kind: 'word-lit', turnId: 'T', index: 0, tvServerMs: 1650 }, { kind: 'word-lit', turnId: 'T', index: 2, tvServerMs: 2790 }];
  const r = e2eRows(traces, tel);
  assert.deepEqual(r.rows.map((x) => x.e2eMs), [650, 790]);
  assert.deepEqual(r.rows.map((x) => x.serverToTvMs), [50, 90]);
  assert.equal(r.summary.within1s, 2);
});

test('S2 word end (INFERRED) is the last sound before the next word; lead silence shifts audio and times together', async () => {
  const pcm = new Int16Array(16 * 1000); // 1 s
  for (let i = 16 * 100; i < 16 * 340; i++) pcm[i] = i % 2 ? 8000 : -8000; // a "word" from 100 to 340 ms
  for (let i = 16 * 600; i < 16 * 800; i++) pcm[i] = i % 2 ? 8000 : -8000;  // next word from 600 ms
  assert.equal(soundEndMs(pcm, 100, 600), 340);
  assert.equal(soundEndMs(pcm, 600, 1000), 800);
  assert.equal(soundEndMs(new Int16Array(16000), 100, 500), 500, 'no sound → falls back to the window end');
  const eng: any = { name: 'x', simulated: false, concurrency: 1, note: '', source: () => null, prepare: async () => ({ pcm, spokenAtMs: [100, 600], spokenEndMs: [340, 800], spokenSource: 'polly-marks' }) };
  const p = await withLeadSilence(eng, 600).prepare({} as any);
  assert.equal(p.pcm!.length, pcm.length + 600 * 16);
  assert.equal(p.pcm![600 * 16 + 16 * 100 + 1], pcm[16 * 100 + 1]);
  assert.deepEqual(p.spokenAtMs, [700, 1200]);
  assert.deepEqual(p.spokenEndMs, [940, 1400]);
  assert.equal(withLeadSilence(eng, 0), eng);
});

test('S2 follow-up: the stability pick uses the fixed rule (lead silence, ≤ 10 % misreads per language, best recall, ties → more stable)', async () => {
  const { pickBest } = await import('../../tools/s2/compare.ts');
  const M = (all: number, faEn: number, faHi = 0) => ({ all: { recallWithin1sPct: all, latencyMs: {} }, 'en-IN': { falseAcceptPct: faEn }, 'hi-IN': { falseAcceptPct: faHi } });
  const R = (stability: string, lead: number, m: any) => ({ dir: stability + lead, stability, leadSilenceMs: lead, cases: 40, metrics: m });
  assert.equal(pickBest([R('high', 0, M(99, 0)), R('high', 600, M(60, 5)), R('low', 600, M(70, 5))])!.stability, 'low', 'lead-0 baseline is never chosen');
  assert.equal(pickBest([R('high', 600, M(60, 5)), R('none', 600, M(80, 12))])!.stability, 'high', 'too many misreads accepted → excluded');
  assert.equal(pickBest([R('none', 600, M(70, 5)), R('medium', 600, M(70, 5))])!.stability, 'medium', 'tie → more stable');
  assert.equal(pickBest([R('none', 600, M(70, 11))]), null);
});
