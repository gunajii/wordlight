// Is "generative voice + Transcribe alignment" timing good enough to replace Polly speech marks for English?
//   AWS_REGION=ap-south-1 node tools/s4/align-check.ts [--story busy-ants]
// Same pages, two narrations: (N) neural Kajal in the chosen style, with Polly speech marks; (G) generative Kajal.
// Reference = acoustic onsets after pauses (S4 reference B: exact, but only for words that follow a silence).
// Measured per narration: Polly marks (N), Transcribe-aligned (N), Transcribe-aligned (G).
// Calibration: offset = −median(aligned N − onset N), measured on the NEURAL audio, then applied to G.
// DECISION RULE (fixed before the run): use G for English iff ≥ 90 % of G's words match a recognised word AND the
// calibrated G median |error| ≤ the Polly-marks median |error| on N + 20 ms. Otherwise English stays neural.
// Writes docs/results/s4/align-<stamp>/{report.md,results.json} and .dev/aws/align-decision.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSpeechMarks, timeTokens } from '@wordlight/story-package';
import { PollyNarration, GenerativeNarration, cachedTranscribe } from '../content/narration.ts';
import { splitLines, DEFAULT_STYLE } from '../content/build-story.ts';
import { tokenStarts, transcribeWords } from '../content/align.ts';
import { TranscribeSource } from '../../server/src/reading/speech.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Onsets: first 5 ms frame above threshold after ≥ 150 ms below it (and the very first sound). */
export function onsets(pcm: Int16Array): number[] {
  let peak = 0; for (let i = 0; i < pcm.length; i++) { const v = Math.abs(pcm[i]); if (v > peak) peak = v; }
  const thr = Math.max(300, 0.03 * peak), F = 80; // 5 ms
  const out: number[] = []; let quiet = 1000;
  for (let f = 0; f < Math.floor(pcm.length / F); f++) {
    let e = 0; for (let i = f * F; i < (f + 1) * F; i++) e += pcm[i] * pcm[i];
    const loud = Math.sqrt(e / F) > thr;
    if (loud && quiet >= 30) out.push((f * F) / 16);
    quiet = loud ? 0 : quiet + 1;
  }
  return out;
}
/** Pair each onset with the nearest predicted word start within 250 ms → signed errors (pred − onset). */
export function errorsVsOnsets(on: number[], pred: number[]): number[] {
  const e: number[] = [];
  for (const o of on) { let best: number | null = null; for (const p of pred) if (Math.abs(p - o) <= 250 && (best === null || Math.abs(p - o) < Math.abs(best - o))) best = p; if (best !== null) e.push(best - o); }
  return e;
}
const q = (xs: number[], p: number) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] : NaN; };
export const summary = (e: number[]) => ({ n: e.length, within50: e.length ? Math.round((1000 * e.filter((x) => Math.abs(x) <= 50).length) / e.length) / 10 : null, medianAbs: q(e.map(Math.abs), 0.5), p95Abs: q(e.map(Math.abs), 0.95), bias: q(e, 0.5) });

async function main() {
  const a = process.argv.slice(2); const opt = (k: string) => (a.includes(`--${k}`) ? a[a.indexOf(`--${k}`) + 1] : null);
  const id = opt('story') ?? 'busy-ants';
  const region = process.env.AWS_REGION || 'ap-south-1';
  const src = JSON.parse(readFileSync(path.join(ROOT, 'content/sources', id, 'source.json'), 'utf8'));
  if (src.lang !== 'en-IN') throw new Error('generative Kajal is English only');
  const ts = new TranscribeSource({ region });
  const transcribe = cachedTranscribe((pcm, lang) => transcribeWords(ts, pcm, lang));
  const N = await PollyNarration.create({ region, voiceId: 'Kajal', style: DEFAULT_STYLE });
  const G = await GenerativeNarration.create({ region: process.env.GENERATIVE_REGION || 'ap-southeast-1', transcribeRegion: region, voiceId: 'Kajal', style: { volume: DEFAULT_STYLE.volume, lineBreakMs: DEFAULT_STYLE.lineBreakMs }, offsetMs: 0 });
  const eMarks: number[] = [], eAlignN: number[] = [], eAlignG: number[] = []; const pages: any[] = [];
  for (const [pi, p] of (src.pages as any[]).entries()) {
    const lines = splitLines(p.text.normalize('NFC')); const text = lines.join(' '); const toks = text.split(' ');
    const n = await N.synthesize(text, 'en-IN', lines);
    const marksT0 = timeTokens(text, parseSpeechMarks(n.marksNdjson), n.durationMs).map((t) => t.t0);
    const alignN = tokenStarts(toks, await transcribe(n.pcm16k!, 'en-IN'), 'en-IN', { endMs: n.durationMs });
    const g = await G.synthesize(text, 'en-IN', lines);
    const alignG = timeTokens(text, parseSpeechMarks(g.marksNdjson), g.durationMs).map((t) => t.t0);
    const onN = onsets(n.pcm16k!), onG = onsets(g.pcm16k!);
    const em = errorsVsOnsets(onN, marksT0), ean = errorsVsOnsets(onN, alignN.t0), eag = errorsVsOnsets(onG, alignG);
    eMarks.push(...em); eAlignN.push(...ean); eAlignG.push(...eag);
    pages.push({ page: pi + 1, words: toks.length, matchedN: alignN.matched, matchedG: G.stats.at(-1)!.matched, onsetsN: onN.length, onsetsG: onG.length, durN: n.durationMs, durG: g.durationMs });
    console.log(`page ${pi + 1}: ${toks.length} words · matched N ${alignN.matched} G ${G.stats.at(-1)!.matched} · onsets N ${onN.length} G ${onG.length}`);
  }
  const offsetMs = -Math.round(q(eAlignN, 0.5));
  const eAlignGcal = eAlignG.map((x) => x + offsetMs);
  const words = pages.reduce((s, p) => s + p.words, 0), matchedG = pages.reduce((s, p) => s + p.matchedG, 0);
  const R = { marksN: summary(eMarks), alignN: summary(eAlignN), alignG: summary(eAlignG), alignGcalibrated: summary(eAlignGcal) };
  const matchPct = Math.round((1000 * matchedG) / words) / 10;
  const adopt = matchPct >= 90 && R.alignGcalibrated.medianAbs <= R.marksN.medianAbs + 20;
  const stamp = new Date().toISOString().slice(0, 16).replace(/:/g, '-');
  const out = path.join(ROOT, 'docs/results/s4', `align-${stamp}`); mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ story: id, region, date: new Date().toISOString(), offsetMs, matchPct, adopt, R, pages }, null, 1));
  const row = (k: string, x: any) => `| ${k} | ${x.n} | ${x.within50} % | ${x.medianAbs} | ${x.p95Abs} | ${x.bias > 0 ? '+' : ''}${x.bias} |`;
  writeFileSync(path.join(out, 'report.md'), [`# Generative narration timing — Transcribe alignment vs Polly speech marks (${id})`, '',
    `- Date: ${new Date().toISOString()} · Transcribe ${region} · generative Polly ${process.env.GENERATIVE_REGION || 'ap-southeast-1'} · style ${JSON.stringify(DEFAULT_STYLE)}`,
    '- Reference: acoustic onsets after ≥ 150 ms of silence (5 ms frames, 3 % of peak), each paired with the nearest predicted word start within 250 ms. Only words after a pause have a reference.', '',
    '| timing | onsets paired | within 50 ms | median abs ms | p95 abs ms | bias ms |', '|---|---|---|---|---|---|',
    row('N: Polly speech marks (current)', R.marksN), row('N: Transcribe alignment', R.alignN), row('G: Transcribe alignment (raw)', R.alignG), row(`G: alignment + offset ${offsetMs} ms (from N)`, R.alignGcalibrated), '',
    `Generative words matched to a recognised word: **${matchPct} %** (${matchedG}/${words}); the rest interpolated.`, '',
    `**Decision (rule fixed before the run): ${adopt ? 'USE generative narration for English' : 'KEEP neural narration for English'}.** Rule: matched ≥ 90 % AND calibrated G median ≤ Polly-marks median + 20 ms.`, ''].join('\n'));
  mkdirSync(path.join(ROOT, '.dev/aws'), { recursive: true });
  writeFileSync(path.join(ROOT, '.dev/aws/align-decision.json'), JSON.stringify({ adopt, offsetMs, report: path.relative(ROOT, out) }) + '\n');
  console.log(readFileSync(path.join(out, 'report.md'), 'utf8'));
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e?.name ?? '', e?.message ?? e); process.exit(1); });
