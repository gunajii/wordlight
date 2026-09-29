// Map Amazon Polly word speech marks to display words.
//
// Polly's `start`/`end` are BYTE offsets into the UTF-8 input text, not JavaScript string
// indexes. Devanagari characters are 3 bytes each in UTF-8, so using them as string indexes
// would be wrong by a factor of ~3. We convert each display word's character range to a byte
// range and assign each mark to the word whose byte range it overlaps.

export interface SpeechMark {
  time: number;
  type: 'word' | 'sentence' | 'viseme' | 'ssml';
  start: number;
  end: number;
  value: string;
}

export interface DisplayToken {
  w: string;
  /** byte range in the UTF-8 text */
  b0: number;
  b1: number;
}

const enc = new TextEncoder();
const byteLen = (s: string) => enc.encode(s).length;

/** Split text into whitespace-separated display tokens with their UTF-8 byte ranges. */
export function displayTokens(text: string): DisplayToken[] {
  const out: DisplayToken[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const b0 = byteLen(text.slice(0, m.index));
    out.push({ w: m[0], b0, b1: b0 + byteLen(m[0]) });
  }
  return out;
}

/** Parse Polly's speech-mark output (one JSON object per line). */
export function parseSpeechMarks(ndjson: string): SpeechMark[] {
  return ndjson.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as SpeechMark);
}

export interface TimedToken { w: string; t0: number; t1: number; marked: boolean }

/**
 * Word start times for each display token of `text`. A token with no mark of its own (e.g. a
 * stand-alone dash) starts with the previous word. t1 = next token's t0; the last runs to endMs.
 */
export function timeTokens(text: string, marks: SpeechMark[], endMs: number): TimedToken[] {
  const toks = displayTokens(text);
  const words = marks.filter((m) => m.type === 'word');
  const t0s: (number | null)[] = toks.map((t) => {
    const hit = words.find((m) => m.start < t.b1 && m.end > t.b0);
    return hit ? hit.time : null;
  });
  const out: TimedToken[] = [];
  let last = 0;
  toks.forEach((t, i) => {
    const t0 = t0s[i] ?? last;
    last = t0;
    out.push({ w: t.w, t0, t1: 0, marked: t0s[i] != null });
  });
  out.forEach((t, i) => {
    t.t1 = i + 1 < out.length ? Math.max(out[i + 1].t0, t.t0 + 1) : Math.max(endMs, t.t0 + 1);
  });
  return out;
}
