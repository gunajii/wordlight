// Story playback plan: where narration must stop for a reading turn, where it resumes, and which audio span to
// replay to help with a word. Pure functions over the story package's word timings (ms from page audio start).
export interface PWord { w: string; t0: number; t1: number }
export interface PLine { text: string; words: PWord[]; turn: boolean }
export interface PPage { lines: PLine[]; durationMs: number }

/** Lead time: stop this many ms before a turn line's first word (the narrator must not start reading it). */
export const TURN_STOP_LEAD_MS = 120;

export function lineStart(l: PLine) { return l.words[0]?.t0 ?? 0; }
export function lineEnd(l: PLine) { return l.words[l.words.length - 1]?.t1 ?? lineStart(l); }

/** Next turn line at or after playback position `posMs` (only lines whose stop point is still ahead). */
export function nextTurn(page: PPage, posMs: number, done: Set<number>): { index: number; stopAtMs: number } | null {
  for (let i = 0; i < page.lines.length; i++) {
    const l = page.lines[i];
    if (!l.turn || done.has(i) || !l.words.length) continue;
    const stopAt = Math.max(0, lineStart(l) - TURN_STOP_LEAD_MS);
    if (stopAt >= posMs - 40) return { index: i, stopAtMs: stopAt };
  }
  return null;
}

/** Where narration resumes after a turn line: the start of the next line (or the end of the turn line). */
export function resumeAt(page: PPage, lineIndex: number): number {
  const next = page.lines[lineIndex + 1];
  return next && next.words.length ? Math.max(lineEnd(page.lines[lineIndex]), lineStart(next) - 60) : lineEnd(page.lines[lineIndex]);
}

/** Audio span to replay when the TV helps with word `i` of a line (small pads, never into the next word). */
export function helpSpan(line: PLine, i: number): { fromMs: number; toMs: number } {
  const w = line.words[i];
  const nextT0 = line.words[i + 1]?.t0 ?? w.t1 + 200;
  return { fromMs: Math.max(0, w.t0 - 30), toMs: Math.min(w.t1 + 80, nextT0) };
}

/** Session totals for the end card, from line.done results (real data only). */
export function totals(results: { read: number; helped: number; skipped: number }[]) {
  const read = results.reduce((s, r) => s + r.read, 0), helped = results.reduce((s, r) => s + r.helped, 0);
  return { words: read + helped, onOwn: read, withHelp: helped, turns: results.length };
}
