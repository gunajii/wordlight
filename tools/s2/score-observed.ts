// S2 with a live reader and NO recording: score the reading engine's decisions against what a supervising adult
// observed. Privacy-preferred path for consented child sessions (docs/CHILD_TESTING.md): the child reads in the
// normal product (phone → AWS endpoint → Transcribe); nothing is recorded; the server keeps only per-word numbers.
//
//   1. During the session the observer fills a sheet, one line per reading turn, in order:
//        R R M R O        (R = read correctly, M = misread / different word, O = omitted, P = long pause)
//   2. After the session:  curl -s https://<host>/api/reading/traces?session=<CODE> > traces.json
//   3. node tools/s2/score-observed.ts --traces traces.json --sheet sheet.txt [--out <dir>] [--speaker "child, consented"]
// Output: same metrics as tools/s2/eval.ts (recall within 1 s uses Transcribe's word timestamps for "spoken").
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { metrics, report, type CaseResult, type Label, type WordResult, SHOULD_LIGHT } from './eval.ts';
import type { TurnTrace } from '../../server/src/reading/driver.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAP: Record<string, Label> = { R: 'correct', M: 'misread', O: 'omitted', P: 'after-pause' };

export function scoreObserved(traces: TurnTrace[], sheet: string): CaseResult[] {
  const rows = sheet.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean).map((l) => l.split(/\s+/));
  const turns = traces.filter((t) => t.endReason !== 'skipped' && t.endReason !== 'exit').sort((a, b) => a.startedAtServerMs - b.startedAtServerMs);
  if (rows.length !== turns.length) throw new Error(`sheet has ${rows.length} lines but the session has ${turns.length} completed turns`);
  return turns.map((t, k) => {
    const marks = rows[k];
    if (marks.length !== t.words.length) throw new Error(`sheet line ${k + 1}: ${marks.length} marks for ${t.words.length} words (“${t.words.join(' ')}”)`);
    const words: WordResult[] = t.words.map((w, i) => {
      const label = MAP[marks[i].toUpperCase()];
      if (!label) throw new Error(`sheet line ${k + 1}: unknown mark ${marks[i]}`);
      const ev = t.events.find((e) => e.index === i) ?? null;
      const outcome = (ev?.kind ?? 'none') as WordResult['outcome'];
      const ok = SHOULD_LIGHT.includes(label) ? outcome === 'read' : label === 'after-pause' ? outcome !== 'skipped' : outcome !== 'read';
      const spoken = ev?.spokenServerMs ?? null, lit = ev?.kind === 'read' ? ev.emitServerMs : null;
      return { i, word: w, label, said: null, outcome, ok, recognized: null, spokenMs: null, recognizedMs: null, litMs: null,
        latencyMs: lit !== null && spoken !== null ? Math.round(lit - spoken) : null, recognitionMs: ev?.updateReceivedMs && spoken !== null ? Math.round(ev.updateReceivedMs - spoken) : null };
    });
    return { id: t.turnId, lang: t.lang, category: 'observed', expected: t.words.join(' '), spokenText: '(not recorded)', transcript: '(not stored)', endReason: t.endReason, pass: words.every((w) => w.ok), words, result: t.result };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2); const opt = (k: string) => (a.includes(`--${k}`) ? a[a.indexOf(`--${k}`) + 1] : null);
  const traces: TurnTrace[] = JSON.parse(readFileSync(opt('traces')!, 'utf8'));
  if (traces.some((t) => t.simulated)) { console.error('these traces come from a SIMULATED speech source — not scoring them as S2'); process.exit(2); }
  const rows = scoreObserved(traces, readFileSync(opt('sheet')!, 'utf8'));
  const m = metrics(rows);
  const meta = { engine: 'live-observed', simulated: false, note: 'Live reading through the product (phone → server → Amazon Transcribe); ground truth from a supervising adult’s sheet; no audio recorded.', date: new Date().toISOString(), git: '', filter: '', speaker: opt('speaker') ?? 'UNKNOWN' };
  const out = opt('out') ?? path.join(ROOT, 'docs/results/s2', `observed-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ meta, metrics: m, cases: rows }, null, 1));
  writeFileSync(path.join(out, 'report.md'), report(meta, m, rows));
  console.log(`verdict ${m.verdict} · wrote ${path.relative(ROOT, out)}/report.md`);
}
