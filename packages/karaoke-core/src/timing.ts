// Word timing lookup: which word is being spoken at a given media position.

export interface TimedWord {
  w: string;
  /** start, ms from the start of the audio */
  t0: number;
  /** end, ms (exclusive) */
  t1: number;
}

export type WordPhase = 'spoken' | 'current' | 'upcoming';

/**
 * Index of the word being spoken at positionMs: the last word with t0 <= position, or -1
 * before the first word. Words are sorted by t0. Binary search: O(log n).
 */
export function wordIndexAt(words: readonly TimedWord[], positionMs: number): number {
  let lo = 0, hi = words.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].t0 <= positionMs) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * Phase of each word at positionMs. `leadMs` shifts the text relative to the audio: positive
 * lights words earlier (use it to cancel measured output latency, e.g. the TV's audio path).
 */
export function phasesAt(words: readonly TimedWord[], positionMs: number, leadMs = 0): WordPhase[] {
  const p = positionMs + leadMs;
  const cur = wordIndexAt(words, p);
  return words.map((w, i) => (i < cur ? 'spoken' : i === cur ? (p < w.t1 ? 'current' : 'spoken') : 'upcoming'));
}

export interface TimedLine {
  text: string;
  words: TimedWord[];
}

/** Index of the line to show at positionMs: the last line whose first word has started (or 0). */
export function lineIndexAt(lines: readonly TimedLine[], positionMs: number): number {
  let idx = 0;
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i].words[0];
    if (first && first.t0 <= positionMs) idx = i;
  }
  return idx;
}

/** Throws if words overlap, run backwards or have negative length: bad timing data fails loudly. */
export function assertMonotonic(words: readonly TimedWord[]): void {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!(w.t0 >= 0 && w.t1 > w.t0)) throw new Error(`word ${i} "${w.w}": bad span ${w.t0}..${w.t1}`);
    if (i > 0 && w.t0 < words[i - 1].t0) throw new Error(`word ${i} "${w.w}": starts before word ${i - 1}`);
  }
}
