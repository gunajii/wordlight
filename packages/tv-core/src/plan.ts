// Story playback plan: where narration must stop for a reading turn, where it resumes, and which audio span to
// replay to help with a word. Pure functions over the story package's word timings (ms from page audio start).
export interface PWord { w: string; t0: number; t1: number }
export interface PLine { text: string; words: PWord[]; turn: boolean }
export interface PPage { lines: PLine[]; durationMs: number }

/** Lead time: stop this many ms before a turn line's first word (the narrator must not start reading it). */
export const TURN_STOP_LEAD_MS = 120;

export function lineStart(l: PLine) { return l.words[0]?.t0 ?? 0; }
export function lineEnd(l: PLine) { return l.words[l.words.length - 1]?.t1 ?? lineStart(l); }

/** Echo mode: stop this many ms after the narrator finished the line (the last word's sound must end). */
export const ECHO_STOP_AFTER_MS = 150;
export type ReadingMode = 'free' | 'echo';

/**
 * Where narration stops for a turn line.
 *   free: just before the line — the child reads it first (the narrator never says it before the child).
 *   echo: just after the line — the TV reads it, the child repeats it (fallback when free reading isn't reliable).
 */
export function turnStopAt(l: PLine, mode: ReadingMode = 'free'): number {
  return mode === 'echo' ? lineEnd(l) + ECHO_STOP_AFTER_MS : Math.max(0, lineStart(l) - TURN_STOP_LEAD_MS);
}

/**
 * Echo mode, on a device whose sound leaves the speaker `outLatencyMs` after the playhead: the playhead position at
 * which to stop so the line is heard to its end, but never reaching the next line's audio (the narrator must not
 * start the next line and jump back — seen on the VVD, 2026-10-08).
 */
export function echoStopAt(page: PPage, i: number, outLatencyMs: number): number {
  const l = page.lines[i];
  const base = turnStopAt(l, 'echo');
  const next = page.lines[i + 1]?.words[0]?.t0 ?? page.durationMs;
  return base + Math.max(0, Math.min(outLatencyMs, next - 120 - base));
}

/** Next turn line at or after playback position `posMs` (only lines whose stop point is still ahead). */
export function nextTurn(page: PPage, posMs: number, done: Set<number>, mode: ReadingMode = 'free'): { index: number; stopAtMs: number } | null {
  for (let i = 0; i < page.lines.length; i++) {
    const l = page.lines[i];
    if (!l.turn || done.has(i) || !l.words.length) continue;
    const stopAt = turnStopAt(l, mode);
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
  const skipped = results.reduce((s, r) => s + r.skipped, 0);
  return { words: read + helped, onOwn: read, withHelp: helped, skipped, turns: results.length };
}

/** "3:05" for the end card. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Progress shown during a turn: how many words are done (read + helped + skipped) of the line. */
export function turnProgress(marks: readonly string[]) {
  const read = marks.filter((m) => m === 'read').length, helped = marks.filter((m) => m === 'helped').length;
  const skipped = marks.filter((m) => m === 'skipped').length;
  return { done: read + helped + skipped, total: marks.length, read, helped, skipped };
}

/** The TV's own last check before playing a story it downloaded: refuse (don't crash) on a corrupt package. */
export function playableStoryProblem(st: any): string | null {
  if (!st || typeof st !== 'object' || typeof st.id !== 'string') return 'not a story';
  if (!Array.isArray(st.pages) || st.pages.length === 0) return 'no pages';
  for (let p = 0; p < st.pages.length; p++) {
    const pg = st.pages[p];
    if (typeof pg?.audio !== 'string' || typeof pg?.image !== 'string' || !(pg.durationMs > 0)) return `page ${p + 1}: audio/image/duration`;
    if (!Array.isArray(pg.lines) || pg.lines.length === 0) return `page ${p + 1}: no lines`;
    let prev = -1;
    for (const l of pg.lines) {
      if (!Array.isArray(l?.words) || l.words.length === 0) return `page ${p + 1}: a line without words`;
      for (const w of l.words) {
        if (typeof w?.w !== 'string' || !(w.t1 > w.t0) || w.t0 < prev) return `page ${p + 1}: bad word timing`;
        prev = w.t0;
      }
    }
  }
  if (typeof st.credits?.attribution !== 'string') return 'no attribution';
  return null;
}

// ---- reading turns by the reader's age ----
/** How many lines a reader of this age reads: 5 at age 5 and one more per year (12 at 12). Set on 2026-10-12 after
 *  a 6-year-old read the earlier 3–4 turns easily. Never more than the story's pool offers. */
export function turnsForAge(age: number, available: number): number {
  if (!Number.isFinite(age)) return 0;
  return Math.max(0, Math.min(available, Math.round(age)));
}

/** Longest line (in words) for this age: 7 at age 5, one more per year, 12 from age 10 (the package maximum). */
export function maxWordsForAge(age: number): number { return Math.min(12, Math.max(4, Math.round(age) + 2)); }

export interface PoolLine { page: number; line: number; words: string[] }
const bareLen = (w: string) => [...w.replace(/[\p{P}\p{S}]/gu, '')].length;

/** `n` pool lines spread through the story: the pool (story order) is cut into n equal windows and the simplest line
 *  of each window is taken (shortest words on average, then fewest words, then earliest). Deterministic. */
export function chooseAgeTurns(pool: PoolLine[], n: number): PoolLine[] {
  const k = Math.min(n, pool.length);
  const out: PoolLine[] = [];
  for (let j = 0; j < k; j++) {
    const win = pool.slice(Math.floor((j * pool.length) / k), Math.floor(((j + 1) * pool.length) / k));
    const score = (l: PoolLine) => l.words.reduce((s, w) => s + bareLen(w), 0) / Math.max(1, l.words.length);
    out.push(win.slice().sort((a, b) => score(a) - score(b) || a.words.length - b.words.length || a.page - b.page || a.line - b.line)[0]);
  }
  return out.sort((a, b) => a.page - b.page || a.line - b.line);
}

type AgeStory = { turnPool?: { page: number; line: number }[]; pages: { lines: { turn: boolean; words: { w: string }[] }[] }[] };
/** The story with its turn lines chosen for this reader's age. Unchanged (the story's own turns) when there is no
 *  reader age or the story has no pool (older packages). The story object itself is not modified. */
export function applyAgeTurns<S extends AgeStory>(story: S, age: number | null | undefined): { story: S; count: number; ageBased: boolean } {
  const own = story.pages.reduce((n, p) => n + p.lines.filter((l) => l.turn).length, 0);
  const pool: PoolLine[] = (story.turnPool ?? [])
    .map((r) => ({ ...r, words: story.pages[r.page]?.lines[r.line]?.words.map((w) => w.w) ?? [] }))
    .filter((l) => l.words.length > 0);
  const fit = age == null ? [] : pool.filter((l) => l.words.length <= maxWordsForAge(age));
  if (age == null || !fit.length) return { story, count: own, ageBased: false };
  const chosen = new Set(chooseAgeTurns(fit, turnsForAge(age, fit.length)).map((l) => `${l.page}.${l.line}`));
  const pages = story.pages.map((p, pi) => ({ ...p, lines: p.lines.map((l, li) => ({ ...l, turn: chosen.has(`${pi}.${li}`) })) }));
  return { story: { ...story, pages } as S, count: chosen.size, ageBased: true };
}
