// Compare S2 runs side by side and pick the Transcribe stability setting by a rule fixed BEFORE the results:
//   candidates = runs with the realistic lead silence (> 0 ms) whose misread acceptance is ≤ 10 % in every language;
//   best = highest share of correctly read words lit within 1 s of the word start (the S2 metric, unchanged);
//   ties → the more stable setting (high > medium > low > none: fewer revised partials).
//   node tools/s2/compare.ts --out docs/results/s2/experiment-<stamp>.md <run dir> <run dir> ...
// Prints the chosen stability on the last line ("best <stability> <dir>") for scripts.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface RunSummary { dir: string; stability: string; leadSilenceMs: number; cases: number; metrics: any }
const ORDER = ['high', 'medium', 'low', 'none'];

export function pickBest(runs: RunSummary[]): RunSummary | null {
  const langs = (m: any) => ['en-IN', 'hi-IN'].filter((l) => m[l]);
  const ok = runs.filter((r) => r.leadSilenceMs > 0 && langs(r.metrics).every((l) => (r.metrics[l].falseAcceptPct ?? 0) <= 10));
  return ok.sort((a, b) => (b.metrics.all.recallWithin1sPct ?? -1) - (a.metrics.all.recallWithin1sPct ?? -1) || ORDER.indexOf(a.stability) - ORDER.indexOf(b.stability))[0] ?? null;
}

export function table(runs: RunSummary[]): string[] {
  const f = (x: any) => (x === null || x === undefined ? '–' : x);
  return ['| run | stability | lead silence | cases | lit ≤ 1 s (en / hi) | misreads accepted (en / hi) | first word lit | latency from start median / p95 | from word END median (INFERRED) | verdict |', '|---|---|---|---|---|---|---|---|---|---|',
    ...runs.map((r) => { const m = r.metrics; const en = m['en-IN'] ?? {}, hi = m['hi-IN'] ?? {};
      return `| ${path.basename(r.dir)} | ${r.stability} | ${r.leadSilenceMs} ms | ${r.cases} | ${f(m.all.recallWithin1sPct)} % (${f(en.recallWithin1sPct)} / ${f(hi.recallWithin1sPct)}) | ${f(m.all.falseAcceptPct)} % (${f(en.falseAcceptPct)} / ${f(hi.falseAcceptPct)}) | ${f(m.all.firstWordLitPct)} % | ${f(m.all.latencyMs.median)} / ${f(m.all.latencyMs.p95)} | ${f(m.all.fromWordEnd?.median)} | ${m.verdict} |`; })];
}

export function load(dir: string): RunSummary {
  const j = JSON.parse(readFileSync(path.join(dir, 'results.json'), 'utf8'));
  return { dir, stability: j.meta.stability ?? 'high', leadSilenceMs: j.meta.leadSilenceMs ?? 0, cases: j.cases.length, metrics: j.metrics };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2); const oi = a.indexOf('--out'); const out = oi >= 0 ? a.splice(oi, 2)[1] : null;
  const runs = a.map(load);
  const best = pickBest(runs);
  const md = ['# S2 follow-up experiment — Transcribe stability and lead silence', '', `Date: ${new Date().toISOString()}`, '',
    'Same 40-case deterministic sample (`--sample 40`), same Polly audio (cached, byte-identical), same reading engine and the same S2 metric. Only two things vary: Transcribe partial-result stability and silence streamed before the speech. Rule for choosing (fixed before the runs): among runs with lead silence, misreads accepted ≤ 10 % per language; highest share lit within 1 s of the word start; ties → more stable setting. Sample results are indicative; the chosen setting is then re-measured on all 169 cases.', '',
    ...table(runs), '', `**Chosen:** ${best ? `stability \`${best.stability}\` (${path.basename(best.dir)})` : 'none qualified — keep `high`'}`, ''];
  if (out) writeFileSync(out, md.join('\n'));
  console.log(md.join('\n'));
  console.log(`best ${best?.stability ?? 'high'} ${best?.dir ?? '-'}`);
}
