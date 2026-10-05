// S2 evaluation harness — one runner for every speech engine, the real reading pipeline in between.
//
//   node tools/s2/eval.ts --engine scripted            LOCAL SIMULATION (no AWS). Checks the harness, the engine's
//                                                      strictness and normalisation. Never an S2 result.
//   AWS_REGION=ap-south-1 node tools/s2/eval.ts --engine polly-transcribe [--voices Kajal] [--sample 40]
//                                                      Polly speaks each case (adult synthetic voice), streamed in real
//                                                      time as 40 ms / 16 kHz PCM16 frames → Amazon Transcribe Streaming.
//   AWS_REGION=ap-south-1 node tools/s2/eval.ts --engine wav --audio-dir <dir outside the repo>
//                                                      Adult control recordings <caseId>.wav (any format ffmpeg reads),
//                                                      or consented child recordings (docs/CHILD_TESTING.md).
// Options: --only <id-prefix> --lang en-IN|hi-IN --category <c,...> --sample N (deterministic) --concurrency N --out <dir>
//
// Every case runs through SessionHub → ReadingDriver → SpeechSource → ReadingTurn (the production code). Per expected
// word it records: label (what should happen), outcome (read/helped/skipped/none), what the recogniser returned,
// when the word was spoken, when the recogniser's update arrived, when word.read was emitted. The phone→server hop is
// NOT in these numbers (audio is injected at the server); end-to-end on the TV is measured separately.
// Real-engine results go to docs/results/s2/<engine>-<stamp>/ (results.json + report.md); simulated runs go to
// bench/runs/s2/ (not committed) unless --out is given.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionHub } from '../../server/src/hub.ts';
import { ReadingDriver, type TurnTrace } from '../../server/src/reading/driver.ts';
import type { SpeechSource, SpeechUpdate } from '../../server/src/reading/speech.ts';
import { ScriptedSource, DEFAULT_TIMING, type ScriptStep } from '../../server/src/reading/scripted.ts';
import { tokenize } from '@wordlight/reading-engine';
import type { Case, SpokenItem } from './make-cases.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const now = () => performance.timeOrigin + performance.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FRAME = 640; // 40 ms at 16 kHz

export type Label = 'correct' | 'slip' | 'corrected' | 'after-pause' | 'misread' | 'omitted';
export const SHOULD_LIGHT: Label[] = ['correct', 'slip', 'corrected'];

/** What should happen to each expected word, derived from the case (never from results). */
export function labelsFor(c: Case): Label[] {
  const words = c.expected.split(/\s+/);
  const key = (s: string) => tokenize(s, c.lang).join('');
  return words.map((w, i) => {
    const tries = c.spoken.filter((s) => s.for === i);
    if (!tries.length) return 'omitted';
    const last = tries[tries.length - 1];
    if (key(last.w) !== key(w)) return 'misread';
    if (tries.length > 1) return 'corrected';
    if ((last.pauseBeforeMs ?? 0) >= 3000) return 'after-pause';
    if (c.category === 'slip' && last.asr) return 'slip';
    return 'correct';
  });
}

interface Prepared { pcm: Int16Array | null; spokenAtMs: (number | null)[]; spokenSource: 'script' | 'polly-marks' | 'asr' }
interface Engine { name: string; simulated: boolean; source(c: Case): SpeechSource; prepare(c: Case): Promise<Prepared>; concurrency: number; note: string }

// ---------- engines ----------
function scriptedEngine(): Engine {
  const T = DEFAULT_TIMING;
  const stepsFor = (c: Case): ScriptStep[] => c.spoken.map((s, k) => ({ say: s.w, asr: s.asr ?? s.w, gapMs: (k ? T.paceMs : 0) + (s.pauseBeforeMs ?? 0), expectIndex: s.for }));
  return {
    name: 'scripted', simulated: true, concurrency: 12,
    note: 'LOCAL SIMULATION: transcripts come from the case script with fixed simulated timing. Exercises the harness and the reading engine only. NOT speech recognition, NOT an S2 result.',
    source: (c) => new ScriptedSource({ script: () => stepsFor(c) }),
    async prepare(c) {
      // spoken times of the script (same arithmetic as ScriptedSource): lead, then gap per item
      let at = T.leadMs; const times = c.spoken.map((s, k) => (at += k ? T.paceMs + (s.pauseBeforeMs ?? 0) : (s.pauseBeforeMs ?? 0)));
      return { pcm: null, spokenAtMs: times, spokenSource: 'script' };
    },
  };
}

async function pollyEngine(region: string, voices: string[]): Promise<Engine> {
  const { PollyClient, SynthesizeSpeechCommand } = await import('@aws-sdk/client-polly');
  const { TranscribeSource } = await import('../../server/src/reading/speech.ts');
  const polly = new PollyClient({ region });
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const voice = (lang: string) => voices.find((v) => v.includes(':') ? v.startsWith(lang) : true)?.replace(/^.*:/, '') ?? 'Kajal';
  const synth = async (ssml: string, lang: string, format: 'pcm' | 'json') => {
    const r = await polly.send(new SynthesizeSpeechCommand({ Engine: 'neural', VoiceId: voice(lang) as any, LanguageCode: lang as any, Text: ssml, TextType: 'ssml', OutputFormat: format, ...(format === 'pcm' ? { SampleRate: '16000' } : { SpeechMarkTypes: ['word'] }) }));
    return Buffer.from(await r.AudioStream!.transformToByteArray());
  };
  return {
    name: 'polly-transcribe', simulated: false, concurrency: 2,
    note: 'Amazon Polly (neural, adult synthetic voice) speaks each case; audio streamed in real time to Amazon Transcribe Streaming. Synthetic adult speech characterises the pipeline, not child reading.',
    source: () => new TranscribeSource({ region }),
    async prepare(c) {
      const ssml = `<speak>${c.spoken.map((s) => (s.pauseBeforeMs ? `<break time="${Math.min(s.pauseBeforeMs, 10000)}ms"/>` : '') + esc(s.w)).join(' ')}</speak>`;
      const buf = await synth(ssml, c.lang, 'pcm');
      const marks = (await synth(ssml, c.lang, 'json')).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m: any) => m.type === 'word');
      // item k starts at the mark of its first token (items may hold two tokens, e.g. "ice cream")
      let m = 0; const spokenAtMs = c.spoken.map((s) => { const t = marks[m]?.time ?? null; m += s.w.split(/\s+/).length; return t; });
      return { pcm: new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength >> 1).slice(), spokenAtMs, spokenSource: 'polly-marks' };
    },
  };
}

async function wavEngine(region: string, dir: string): Promise<Engine> {
  const abs = path.resolve(dir);
  if (abs.startsWith(ROOT + path.sep)) throw new Error(`--audio-dir must be OUTSIDE the repository (${ROOT}); recordings never go into Git`);
  const { TranscribeSource } = await import('../../server/src/reading/speech.ts');
  return {
    name: 'wav', simulated: false, concurrency: 2,
    note: `Recorded audio from ${abs} (outside the repo), streamed in real time to Amazon Transcribe Streaming. Spoken times come from Transcribe's own word timestamps.`,
    source: () => new TranscribeSource({ region }),
    async prepare(c) {
      const f = ['wav', 'm4a', 'mp3', 'webm', 'ogg'].map((x) => path.join(abs, `${c.id}.${x}`)).find(existsSync);
      if (!f) return { pcm: null, spokenAtMs: [], spokenSource: 'asr' };
      const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { maxBuffer: 64 << 20 });
      return { pcm: new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength >> 1).slice(), spokenAtMs: c.spoken.map(() => null), spokenSource: 'asr' };
    },
  };
}

// ---------- one case ----------
export interface WordResult {
  i: number; word: string; label: Label; said: string | null; outcome: 'read' | 'helped' | 'skipped' | 'none'; ok: boolean;
  recognized: string | null; spokenMs: number | null; recognizedMs: number | null; litMs: number | null;
  /** word.read emitted − word spoken (server pipeline) */ latencyMs: number | null;
  /** recogniser update arrival − word spoken */ recognitionMs: number | null;
}
export interface CaseResult { id: string; lang: string; category: string; expected: string; spokenText: string; transcript: string; endReason: string | null; error?: string; pass: boolean; words: WordResult[]; result: TurnTrace['result']; skipped?: string }

export async function runCase(eng: Engine, c: Case): Promise<CaseResult> {
  const words = c.expected.split(/\s+/);
  const labels = labelsFor(c);
  const base = { id: c.id, lang: c.lang, category: c.category, expected: c.expected, spokenText: c.spoken.map((s) => s.w).join(' ') };
  const prep = await eng.prepare(c);
  if (eng.name === 'wav' && !prep.pcm) return { ...base, transcript: '', endReason: null, pass: false, words: [], result: null, skipped: 'no recording' };
  const traces: TurnTrace[] = [];
  const updates: SpeechUpdate[] = [];
  const inner = eng.source(c);
  const source: SpeechSource = { name: inner.name, simulated: inner.simulated, open: (o, h) => inner.open(o, { ...h, onUpdate: (u) => { updates.push(u); h.onUpdate(u); } }) };
  const hub = new SessionHub({ now });
  hub.driver = new ReadingDriver({ hub, source, now, onTrace: (t) => traces.push(t), devTranscripts: true });
  const sid = hub.createSession();
  const tv = { send: () => {} }, phone = { send: () => {} };
  hub.handle(tv, { t: 'hello', role: 'tv', sessionId: sid, clientId: 'tv' });
  hub.handle(phone, { t: 'hello', role: 'phone', sessionId: sid, clientId: 'p' });
  hub.handle(phone, { t: 'clock.report', offsetMs: 0, minRttMs: 0 }); // same process: phone clock = server clock
  hub.handle(phone, { type: 'reader.save', reader: { readerId: 'r1', firstName: 'Test', age: 10, lang: c.lang } /* protocol allows reader ages 3–18 only */, consent: { microphone: true, atMs: 1 } });
  hub.handle(tv, { type: 'turn.start', turnId: c.id, readerId: 'r1', storyId: 's2', page: 0, line: 0, words, lang: c.lang });
  const s = hub.get(sid)!;
  if (!s.turn) throw new Error('turn did not start (reader/turn rejected by protocol validation)');
  const tag = s.turn.audioTag;
  const pcm = prep.pcm ?? new Int16Array(0);
  const frames = Math.ceil(pcm.length / FRAME);
  const T0 = now();
  for (let i = 0; ; i++) {
    const wait = T0 + i * 40 - now(); if (wait > 0) await sleep(wait);
    if (!s.turn || s.turn.turn.turnId !== c.id) break;
    const f = new Int16Array(FRAME); if (i < frames) f.set(pcm.subarray(i * FRAME, (i + 1) * FRAME));
    hub.audio(phone, { seq: i, tag, last: false, capturedAtMs: T0 + i * 40, pcm: f });
    if (i > frames + 300) { hub.endActiveTurn(s, 'exit'); break; } // 12 s after the audio: give up
  }
  await sleep(30);
  const tr = traces.find((t) => t.turnId === c.id)!;
  const lastU = updates.at(-1);
  const transcript = lastU ? lastU.words.map((w) => w.text).join(' ') : '';
  // ground truth: the spoken time of the attempt that should light each word = its LAST spoken item
  const res: WordResult[] = words.map((w, i) => {
    let k = -1; c.spoken.forEach((sp, j) => { if (sp.for === i) k = j; });
    const ev = tr?.events.find((e) => e.index === i) ?? null;
    const outcome = (ev?.kind ?? 'none') as WordResult['outcome'];
    let spoken = k >= 0 && prep.spokenAtMs[k] != null ? T0 + (prep.spokenAtMs[k] as number) : null;
    if (prep.spokenSource === 'asr') spoken = ev?.spokenServerMs ?? null;
    const label = labels[i];
    const ok = SHOULD_LIGHT.includes(label) ? outcome === 'read' : label === 'after-pause' ? outcome === 'read' || outcome === 'helped' : outcome !== 'read';
    const lit = ev && ev.kind === 'read' ? ev.emitServerMs : null;
    const rec = ev && ev.kind === 'read' ? ev.updateReceivedMs : null;
    return { i, word: w, label, said: k >= 0 ? c.spoken[k].w : null, outcome, ok, recognized: ev?.heard ?? null, spokenMs: spoken !== null ? Math.round(spoken - T0) : null,
      recognizedMs: rec !== null ? Math.round(rec - T0) : null, litMs: lit !== null ? Math.round(lit - T0) : null,
      latencyMs: lit !== null && spoken !== null ? Math.round(lit - spoken) : null, recognitionMs: rec !== null && spoken !== null ? Math.round(rec - spoken) : null };
  });
  return { ...base, transcript, endReason: tr?.endReason ?? null, ...(tr?.error ? { error: tr.error } : {}), pass: res.every((r) => r.ok) && !tr?.error, words: res, result: tr?.result ?? null };
}

// ---------- metrics ----------
const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);
export function quant(xs: number[], p: number) { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] : null; }
export function metrics(rows: CaseResult[]) {
  const one = (rs: CaseResult[]) => {
    const ws = rs.flatMap((r) => r.words);
    const should = ws.filter((w) => SHOULD_LIGHT.includes(w.label));
    const lit1s = should.filter((w) => w.outcome === 'read' && w.latencyMs !== null && w.latencyMs <= 1000).length;
    const mis = ws.filter((w) => w.label === 'misread');
    const om = ws.filter((w) => w.label === 'omitted');
    const lat = should.map((w) => w.latencyMs).filter((x): x is number => x !== null);
    const rec = should.map((w) => w.recognitionMs).filter((x): x is number => x !== null);
    return {
      cases: rs.length, casesPassed: rs.filter((r) => r.pass).length, errors: rs.filter((r) => r.error).length,
      wordsShouldLight: should.length, litWithin1s: lit1s, recallWithin1sPct: pct(lit1s, should.length), litEventuallyPct: pct(should.filter((w) => w.outcome === 'read').length, should.length),
      misreadWords: mis.length, misreadAccepted: mis.filter((w) => w.outcome === 'read').length, falseAcceptPct: pct(mis.filter((w) => w.outcome === 'read').length, mis.length),
      omittedWords: om.length, omittedAccepted: om.filter((w) => w.outcome === 'read').length,
      latencyMs: { n: lat.length, median: quant(lat, 0.5), p95: quant(lat, 0.95), max: lat.length ? Math.max(...lat) : null },
      recognitionMs: { n: rec.length, median: quant(rec, 0.5), p95: quant(rec, 0.95) },
    };
  };
  const out: Record<string, any> = { all: one(rows) };
  for (const l of ['en-IN', 'hi-IN']) { const rs = rows.filter((r) => r.lang === l); if (rs.length) out[l] = one(rs); }
  const cats: Record<string, any> = {};
  for (const c of [...new Set(rows.map((r) => r.category))]) cats[c] = one(rows.filter((r) => r.category === c));
  out.byCategory = cats;
  const passes = (m: any) => m && m.recallWithin1sPct !== null && m.recallWithin1sPct >= 90 && (m.falseAcceptPct === null || m.falseAcceptPct <= 10);
  const langs = ['en-IN', 'hi-IN'].filter((l) => out[l]);
  const ok = langs.filter((l) => passes(out[l]));
  out.verdict = ok.length === langs.length && langs.length ? 'PASS' : ok.length || passes(out.all) ? 'PARTIAL' : 'FAIL';
  out.verdictBasis = '≥ 90 % of correctly read words lit within 1 s AND ≤ 10 % of deliberately misread words accepted, per language';
  return out;
}

export function report(meta: any, m: any, rows: CaseResult[]): string {
  const L: string[] = [];
  const sim = meta.simulated;
  L.push(`# S2 evaluation — ${meta.engine}${sim ? ' (SIMULATED)' : ''}`, '');
  if (sim) L.push('> **LOCAL SIMULATION — not real speech recognition.** Transcripts came from the case scripts with fixed simulated timing. This run checks the harness and the reading engine (strictness, normalisation). Its numbers are NOT S2 results and must not be quoted as such.', '');
  L.push(`- Date: ${meta.date}`, `- Git: ${meta.git}`, `- Engine: ${meta.note}`, `- Cases: ${rows.length}${meta.filter ? ` (filter: ${meta.filter})` : ''}`, `- Speaker: ${meta.speaker}`, '');
  L.push(`## Verdict: ${sim ? 'n/a (simulation) — ' + m.verdict + ' on the scripted set' : m.verdict}`, '', `Basis: ${m.verdictBasis}. Latency = word.read emitted by the server − word spoken (audio injected at the server; the phone→server hop, measured in S3, and server→TV are not included).`, '');
  const row = (name: string, x: any) => `| ${name} | ${x.cases} | ${x.casesPassed} | ${x.recallWithin1sPct ?? '–'} % (${x.litWithin1s}/${x.wordsShouldLight}) | ${x.falseAcceptPct ?? '–'} % (${x.misreadAccepted}/${x.misreadWords}) | ${x.omittedAccepted}/${x.omittedWords} | ${x.latencyMs.median ?? '–'} / ${x.latencyMs.p95 ?? '–'} / ${x.latencyMs.max ?? '–'} | ${x.errors} |`;
  const head = ['| set | cases | passed | lit ≤ 1 s | misreads accepted | omitted accepted | latency ms median / p95 / max | errors |', '|---|---|---|---|---|---|---|---|'];
  L.push('## By language', '', ...head, row('all', m.all), ...['en-IN', 'hi-IN'].filter((l) => m[l]).map((l) => row(l, m[l])), '');
  L.push('## By category', '', ...head, ...Object.entries(m.byCategory).map(([k, v]) => row(k, v)), '');
  const bad = rows.filter((r) => !r.pass && !r.skipped);
  L.push(`## Cases not as expected (${bad.length})`, '');
  if (!bad.length) L.push('None.');
  for (const r of bad.slice(0, 80)) {
    L.push(`- **${r.id}** (${r.category}) expected “${r.expected}”, said “${r.spokenText}”, recogniser: “${r.transcript}”${r.error ? ` — ERROR ${r.error}` : ''}`);
    for (const w of r.words.filter((w) => !w.ok)) L.push(`  - word ${w.i} “${w.word}” label=${w.label} outcome=${w.outcome}${w.recognized ? ` heard=“${w.recognized}”` : ''}`);
  }
  const skipped = rows.filter((r) => r.skipped);
  if (skipped.length) L.push('', `Skipped (no recording): ${skipped.map((r) => r.id).join(', ')}`);
  L.push('', 'Legend: label = what should happen (correct/slip/corrected → should light; after-pause → light or help; misread/omitted → must not light as read). Outcome = what the reading engine did.');
  return L.join('\n') + '\n';
}

// ---------- main ----------
async function main() {
  const args = process.argv.slice(2);
  const opt = (k: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : null);
  const engineName = opt('engine') ?? 'scripted';
  const region = process.env.AWS_REGION || 'ap-south-1';
  let { cases } = JSON.parse(readFileSync(path.join(ROOT, 'tools/s2/cases.json'), 'utf8')) as { cases: Case[] };
  const filters: string[] = [];
  if (opt('only')) { cases = cases.filter((c) => c.id.startsWith(opt('only')!)); filters.push(`only=${opt('only')}`); }
  if (opt('lang')) { cases = cases.filter((c) => c.lang === opt('lang')); filters.push(`lang=${opt('lang')}`); }
  if (opt('category')) { const cs = opt('category')!.split(','); cases = cases.filter((c) => cs.includes(c.category)); filters.push(`category=${opt('category')}`); }
  if (opt('sample')) { const n = Number(opt('sample')); const step = Math.max(1, cases.length / n); cases = cases.filter((_, i) => Math.floor(i % step) === 0).slice(0, n); filters.push(`sample=${n}`); }
  const eng = engineName === 'scripted' ? scriptedEngine()
    : engineName === 'polly-transcribe' ? await pollyEngine(region, (opt('voices') ?? 'Kajal').split(','))
    : engineName === 'wav' ? await wavEngine(region, opt('audio-dir') ?? (() => { throw new Error('--audio-dir required'); })())
    : (() => { throw new Error(`unknown --engine ${engineName}`); })();
  const conc = Number(opt('concurrency') ?? eng.concurrency);
  console.log(`${eng.name}${eng.simulated ? ' (SIMULATED)' : ''}: ${cases.length} cases, concurrency ${conc}`);
  const rows: CaseResult[] = new Array(cases.length);
  let next = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (next < cases.length) {
      const k = next++; const c = cases[k];
      try { rows[k] = await runCase(eng, c); }
      catch (e: any) { rows[k] = { id: c.id, lang: c.lang, category: c.category, expected: c.expected, spokenText: '', transcript: '', endReason: null, error: `${e?.name}: ${e?.message}`.slice(0, 300), pass: false, words: [], result: null }; }
      const r = rows[k];
      const marks = r.words.map((w) => (w.outcome === 'read' ? (SHOULD_LIGHT.includes(w.label) || w.label === 'after-pause' ? '●' : '✗') : w.outcome === 'helped' ? '○' : w.outcome === 'skipped' ? '-' : '·')).join('');
      console.log(`${r.pass ? 'ok  ' : 'MISS'} ${c.id.padEnd(22)} ${marks.padEnd(9)} ${r.words.filter((w) => w.latencyMs !== null).map((w) => w.latencyMs).join(' ')}${r.error ? '  ERROR ' + r.error : ''}`);
    }
  }));
  const m = metrics(rows.filter((r) => !r.skipped));
  let git = 'unknown'; try { git = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD']).toString().trim(); } catch {}
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const meta = { engine: eng.name, simulated: eng.simulated, note: eng.note, date: new Date().toISOString(), git, region: eng.simulated ? null : region, node: process.version, filter: filters.join(' '), speaker: engineName === 'scripted' ? 'none (script)' : engineName === 'polly-transcribe' ? `Amazon Polly ${opt('voices') ?? 'Kajal'} (adult synthetic)` : (opt('speaker') ?? 'UNKNOWN — pass --speaker "adult control" or "child (consented)"') };
  const out = opt('out') ?? path.join(ROOT, eng.simulated ? 'bench/runs/s2' : 'docs/results/s2', `${eng.name}-${stamp}`);
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ meta, metrics: m, cases: rows }, null, 1));
  writeFileSync(path.join(out, 'report.md'), report(meta, m, rows));
  console.log(`\n${eng.simulated ? 'SIMULATED ' : ''}verdict ${m.verdict}: recall≤1s ${m.all.recallWithin1sPct}% · misreads accepted ${m.all.falseAcceptPct}% · latency median ${m.all.latencyMs.median} ms`);
  console.log(`wrote ${path.relative(ROOT, out)}/report.md`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e?.name ?? '', e?.message ?? e); process.exit(1); });
