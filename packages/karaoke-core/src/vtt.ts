// WebVTT with per-word timestamps (the standard cue-text timestamp syntax used for karaoke):
//
//   WEBVTT
//
//   00:00:01.000 --> 00:00:03.200
//   <00:00:01.000>The <00:00:01.420>little <00:00:01.900>cat
//
// Each word runs until the next word's timestamp, the last until the cue end.
import type { TimedLine, TimedWord } from './timing.ts';

const TS = /(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})/;
export function parseTimestamp(s: string): number {
  const m = TS.exec(s.trim());
  if (!m) throw new Error(`bad timestamp "${s}"`);
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
}
export function formatTimestamp(ms: number): string {
  const t = Math.round(ms);
  const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000), s = Math.floor((t % 60000) / 1000), f = t % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(f, 3)}`;
}

export function parseKaraokeVtt(src: string): TimedLine[] {
  const text = src.replace(/\r\n?/g, '\n');
  if (!text.startsWith('WEBVTT')) throw new Error('not a WebVTT file');
  const lines: TimedLine[] = [];
  for (const block of text.split(/\n{2,}/).slice(1)) {
    const rows = block.split('\n').filter((r) => r.trim() !== '');
    const timingRow = rows.findIndex((r) => r.includes('-->'));
    if (timingRow < 0) continue; // NOTE / STYLE / REGION blocks
    const [a, b] = rows[timingRow].split('-->');
    const cueStart = parseTimestamp(a), cueEnd = parseTimestamp(b.trim().split(/\s+/)[0]);
    const payload = rows.slice(timingRow + 1).join(' ');
    const parts = payload.split(/<([0-9:.]+)>/); // [before, ts, text, ts, text, ...]
    const words: { w: string; t0: number }[] = [];
    let t = cueStart;
    const addWords = (chunk: string, at: number) => {
      for (const w of chunk.replace(/<[^>]+>/g, '').trim().split(/\s+/).filter(Boolean)) words.push({ w, t0: at });
    };
    addWords(parts[0], t);
    for (let i = 1; i < parts.length; i += 2) {
      t = parseTimestamp(parts[i]);
      addWords(parts[i + 1] ?? '', t);
    }
    const timed: TimedWord[] = words.map((w, i) => ({ w: w.w, t0: w.t0, t1: i + 1 < words.length ? words[i + 1].t0 : cueEnd }));
    lines.push({ text: timed.map((w) => w.w).join(' '), words: timed });
  }
  return lines;
}

export function toKaraokeVtt(lines: readonly TimedLine[]): string {
  const out = ['WEBVTT', ''];
  for (const l of lines) {
    if (!l.words.length) continue;
    out.push(`${formatTimestamp(l.words[0].t0)} --> ${formatTimestamp(l.words.at(-1)!.t1)}`);
    out.push(l.words.map((w) => `<${formatTimestamp(w.t0)}>${w.w}`).join(' '));
    out.push('');
  }
  return out.join('\n');
}
