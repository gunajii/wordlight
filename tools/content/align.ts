// Word timing for narration that has no speech marks (Polly generative voices): Amazon Transcribe listens to the
// narration, and its words are aligned to the KNOWN story text. Matched words take Transcribe's start time (+ a
// calibrated offset); the few unmatched words are interpolated between neighbours by length. The result is written
// as Polly-format word marks with byte offsets into the text, so the rest of the pipeline is unchanged.
import { displayTokens, toNdjson, type SpeechMark } from '@wordlight/story-package';
import { tokenize, wordScore, type Lang } from '@wordlight/reading-engine';
import type { SpeechSource } from '../../server/src/reading/speech.ts';

export interface Heard { text: string; startMs: number; endMs: number }

const norm = (s: string, lang: Lang) => tokenize(s, lang).join('');

/** Global alignment (edit-distance DP) of display tokens to recognised words. Returns, per token, the index of the
 *  heard word it matched (exactly or by the reading engine's lenient score), or -1. */
export function alignIndexes(tokens: string[], heard: string[], lang: Lang): number[] {
  const a = tokens.map((t) => norm(t, lang)), b = heard.map((h) => norm(h, lang));
  const cost = (i: number, j: number) => (a[i] && a[i] === b[j] ? 0 : a[i] && b[j] && wordScore(a[i], b[j], lang) > 0 ? 0.4 : 1.5); // a substitution costs more than a gap: prefer real matches
  const n = a.length, m = b.length;
  const D = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j - 1] + cost(i - 1, j - 1), D[i - 1][j] + 1, D[i][j - 1] + 1);
  const out = new Array(n).fill(-1);
  for (let i = n, j = m; i > 0 && j > 0;) {
    if (D[i][j] === D[i - 1][j - 1] + cost(i - 1, j - 1)) { if (cost(i - 1, j - 1) < 1) out[i - 1] = j - 1; i--; j--; }
    else if (D[i][j] === D[i - 1][j] + 1) i--;
    else j--;
  }
  return out;
}

/** Start time per token: matched → heard start + offset; unmatched → interpolated by character length. */
export function tokenStarts(tokens: string[], heard: Heard[], lang: Lang, o: { offsetMs?: number; endMs: number }): { t0: number[]; matched: number } {
  const idx = alignIndexes(tokens, heard.map((h) => h.text), lang);
  const t: (number | null)[] = idx.map((j) => (j >= 0 ? Math.max(0, heard[j].startMs + (o.offsetMs ?? 0)) : null));
  for (let i = 1; i < t.length; i++) if (t[i] !== null && t[i - 1] !== null && t[i]! <= t[i - 1]!) t[i] = t[i - 1]! + 1; // monotonic
  const len = tokens.map((w) => Math.max(1, [...w].length));
  let i = 0;
  while (i < t.length) {
    if (t[i] !== null) { i++; continue; }
    let k = i; while (k < t.length && t[k] === null) k++;
    const from = i > 0 ? t[i - 1]! : (heard[0]?.startMs ?? 0);
    const to = k < t.length ? t[k]! : Math.max(from + 200 * (k - i), o.endMs - 100);
    const span = i > 0 ? len.slice(i - 1, k).reduce((s, x) => s + x, 0) : len.slice(i, k).reduce((s, x) => s + x, 0) || 1;
    let acc = i > 0 ? len[i - 1] : 0;
    for (let q = i; q < k; q++) { t[q] = Math.round(from + ((to - from) * acc) / span); acc += len[q]; }
    i = k;
  }
  return { t0: t as number[], matched: idx.filter((j) => j >= 0).length };
}

/** Polly-format word marks for `text` from token start times. */
export function marksFromStarts(text: string, t0: number[]): string {
  const toks = displayTokens(text);
  const marks: SpeechMark[] = toks.map((tk, i) => ({ time: t0[i], type: 'word', start: tk.b0, end: tk.b1, value: tk.w }));
  return toNdjson(marks);
}

/** Stream PCM (16 kHz) through a SpeechSource in real time and collect the FINAL words with their times. */
export function transcribeWords(source: SpeechSource, pcm: Int16Array, lang: Lang): Promise<Heard[]> {
  return new Promise((resolve, reject) => {
    const finals = new Map<string, Heard[]>();
    const sess = source.open({ lang }, {
      onUpdate: (u) => { if (u.final) finals.set(u.segmentId, u.words.map((w) => ({ text: w.text, startMs: w.startMs ?? 0, endMs: w.endMs ?? 0 }))); },
      onError: reject,
      onClose: () => resolve([...finals.values()].flat().sort((x, y) => x.startMs - y.startMs)),
    });
    const FRAME = 640, total = Math.ceil(pcm.length / FRAME) + 25; // + 1 s of silence so the last word is finalised
    const t0 = performance.now();
    let i = 0;
    const tick = () => {
      while (i < total && performance.now() - t0 >= i * 40) {
        const f = new Int16Array(FRAME); if (i * FRAME < pcm.length) f.set(pcm.subarray(i * FRAME, (i + 1) * FRAME));
        sess.push(f); i++;
      }
      if (i >= total) sess.end(); else setTimeout(tick, 20);
    };
    tick();
  });
}
