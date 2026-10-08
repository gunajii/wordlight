// Narration style through SSML, without losing the speech-mark → text mapping.
// Polly's word marks carry UTF-8 byte offsets into the INPUT, which with SSML includes the tags. pageSsml() builds
// the SSML from the display lines and returns a map back to byte offsets in the plain page text (lines joined by
// single spaces, exactly as stored in story.json), so markByteMismatches/timeTokens keep working unchanged.
import type { SpeechMark } from './speechmarks.ts';

export interface NarrationStyle {
  /** Polly prosody rate, e.g. "90%" (neural voices: 20–200 %) */ rate?: string;
  /** Polly prosody volume, e.g. "+6dB" or "loud" */ volume?: string;
  /** silence between display lines (ms) — a storyteller's pause; also keeps the next line out of echo stops */ lineBreakMs?: number;
}

const enc = new TextEncoder();
const blen = (s: string) => enc.encode(s).length;

export function hasStyle(s?: NarrationStyle | null): s is NarrationStyle {
  return !!s && (!!s.rate || !!s.volume || !!s.lineBreakMs);
}

export function pageSsml(lines: string[], style: NarrationStyle): { ssml: string; text: string; toTextByte: (ssmlByte: number) => number } {
  for (const l of lines) if (/[<>&]/.test(l)) throw new Error(`SSML narration: line contains < > or & (not supported): ${l}`);
  if (style.rate && !/^(\d{2,3}%|x-slow|slow|medium|fast|x-fast)$/.test(style.rate)) throw new Error(`bad rate ${style.rate}`);
  if (style.volume && !/^([+-]\d{1,2}dB|silent|x-soft|soft|medium|loud|x-loud)$/.test(style.volume)) throw new Error(`bad volume ${style.volume}`);
  const attrs = [style.rate ? `rate="${style.rate}"` : '', style.volume ? `volume="${style.volume}"` : ''].filter(Boolean).join(' ');
  const brk = style.lineBreakMs ? `<break time="${Math.round(style.lineBreakMs)}ms"/>` : '';
  let ssml = '<speak>' + (attrs ? `<prosody ${attrs}>` : '');
  const segs: { s: number; t: number; n: number }[] = []; // ssml byte start, text byte start, byte length
  let tb = 0;
  lines.forEach((l, i) => {
    if (i) { ssml += brk + ' '; segs.push({ s: blen(ssml) - 1, t: tb, n: 1 }); tb += 1; } // the joining space
    segs.push({ s: blen(ssml), t: tb, n: blen(l) });
    ssml += l; tb += blen(l);
  });
  ssml += (attrs ? '</prosody>' : '') + '</speak>';
  const toTextByte = (b: number) => {
    let best = segs[0];
    for (const g of segs) if (g.s <= b) best = g; else break;
    return best.t + Math.min(Math.max(0, b - best.s), best.n);
  };
  return { ssml, text: lines.join(' '), toTextByte };
}

/** Word/sentence marks with SSML offsets → offsets in the plain text. */
export function marksToText(marks: SpeechMark[], toTextByte: (b: number) => number): SpeechMark[] {
  return marks.map((m) => (m.type === 'word' || m.type === 'sentence' ? { ...m, start: toTextByte(m.start), end: toTextByte(m.end) } : m));
}

/** End of the last sound in [fromMs, toMs) of 16 kHz PCM16 (10 ms frames above 3 % of the page's peak). */
export function soundEndMs(pcm: Int16Array, fromMs: number, toMs: number): number {
  let peak = 0; for (let i = 0; i < pcm.length; i++) { const v = Math.abs(pcm[i]); if (v > peak) peak = v; }
  const thr = Math.max(300, 0.03 * peak), F = 160;
  const a = Math.max(0, Math.floor((fromMs * 16) / F)), b = Math.min(Math.floor(pcm.length / F), Math.ceil((toMs * 16) / F));
  for (let f = b - 1; f >= a; f--) {
    let e = 0; for (let i = f * F; i < (f + 1) * F; i++) e += pcm[i] * pcm[i];
    if (Math.sqrt(e / F) > thr) return ((f + 1) * F) / 16;
  }
  return toMs;
}
