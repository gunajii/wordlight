// End-to-end word-light latency from a real session: child speaks a word → the TV lights it.
//   node tools/e2e/word-lit-latency.ts https://<host> <SESSION_CODE> [--out docs/results/e2e/<name>.json]
// Joins three clocks the server already keeps (numbers only — no audio, no text):
//   spoken   word start from the recogniser, mapped to the server clock via the phone's capture timestamps + clock sync
//   emitted  server sent word.read
//   lit      TV's word-lit telemetry, in server-clock ms (TV clock sync)
// e2e = lit − spoken (includes phone capture → network → recognition → engine → TV). Refuses SIMULATED traces.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export function e2eRows(traces: any[], telemetry: any[]) {
  const lit = new Map<string, number>();
  for (const r of telemetry) if (r.kind === 'word-lit' && typeof r.tvServerMs === 'number') lit.set(`${r.turnId}:${r.index}`, r.tvServerMs);
  const rows: { turnId: string; index: number; recognitionMs: number | null; serverToTvMs: number | null; e2eMs: number | null }[] = [];
  for (const t of traces) for (const e of t.events) {
    if (e.kind !== 'read') continue;
    const l = lit.get(`${t.turnId}:${e.index}`) ?? null;
    rows.push({ turnId: t.turnId, index: e.index, recognitionMs: e.spokenServerMs != null ? Math.round(e.emitServerMs - e.spokenServerMs) : null, serverToTvMs: l != null ? Math.round(l - e.emitServerMs) : null, e2eMs: l != null && e.spokenServerMs != null ? Math.round(l - e.spokenServerMs) : null });
  }
  const q = (xs: number[], p: number) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
  const col = (k: 'recognitionMs' | 'serverToTvMs' | 'e2eMs') => { const xs = rows.map((r) => r[k]).filter((x): x is number => x !== null); return { n: xs.length, median: q(xs, 0.5), p95: q(xs, 0.95), max: xs.length ? Math.max(...xs) : null }; };
  return { rows, summary: { words: rows.length, spokenToEmit: col('recognitionMs'), serverToTv: col('serverToTvMs'), e2e: col('e2eMs'), within1s: rows.filter((r) => r.e2eMs !== null && r.e2eMs <= 1000).length } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [base, code] = process.argv.slice(2);
  const a = process.argv.slice(2); const out = a.includes('--out') ? a[a.indexOf('--out') + 1] : null;
  const H = { headers: { 'x-wordlight-admin': process.env.ADMIN_TOKEN ?? '' } };
  const traces = await (await fetch(`${base}/api/reading/traces?session=${code}`, H)).json();
  if (traces.some((t: any) => t.simulated)) { console.error('SIMULATED speech source — not an end-to-end measurement'); process.exit(2); }
  const telemetry = await (await fetch(`${base}/api/sessions/${code}/telemetry.json`, H)).json();
  const r = e2eRows(traces, telemetry);
  console.log(JSON.stringify(r.summary, null, 1));
  if (out) { mkdirSync(path.dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify({ measuredAt: new Date().toISOString(), base, session: code, ...r }, null, 1)); console.log('wrote', out); }
}
