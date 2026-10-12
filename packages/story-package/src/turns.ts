// Deterministic choice of "your turn" lines (MVP). No model: the same story always gets the same
// turns. Bedrock refinement by reading level is a later, optional layer on top.

export interface TurnCandidate { page: number; line: number; words: string[] }

export interface TurnRules {
  minWords: number;
  maxWords: number;
  /** longest word allowed, in code points after stripping punctuation */
  maxWordLength: number;
  /** roughly one turn per this many lines */
  linesPerTurn: number;
  /** never the story's first line: the child first hears how the story sounds */
  skipFirstLine: boolean;
}

export const DEFAULT_TURN_RULES: TurnRules = { minWords: 3, maxWords: 8, maxWordLength: 7, linesPerTurn: 4, skipFirstLine: true };

const bare = (w: string) => [...w.replace(/[\p{P}\p{S}]/gu, '')].length;

/** Lines that MAY be turns (word count, word length, no digits, not the first line). Any chooser — rules or a
 *  model — must pick from these. */
export function eligibleTurnLines(lines: TurnCandidate[], r: TurnRules = DEFAULT_TURN_RULES): number[] {
  return lines
    .map((l, i) => ({ i, l }))
    .filter(({ i }) => !(r.skipFirstLine && i === 0))
    .filter(({ l }) => l.words.length >= r.minWords && l.words.length <= r.maxWords)
    .filter(({ l }) => l.words.every((w) => bare(w) <= r.maxWordLength && !/\d/.test(w)))
    .map(({ i }) => i);
}
export const turnCount = (lines: TurnCandidate[], r: TurnRules = DEFAULT_TURN_RULES) => Math.max(1, Math.round(lines.length / r.linesPerTurn));

/** Indexes (into `lines`) of the lines to mark as turns, spread across the story. */
export function chooseTurns(lines: TurnCandidate[], r: TurnRules = DEFAULT_TURN_RULES): number[] {
  const ok = new Set(eligibleTurnLines(lines, r));
  const eligible = lines.map((l, i) => ({ i, l })).filter(({ i }) => ok.has(i));
  const want = turnCount(lines, r);
  if (eligible.length <= want) return eligible.map((e) => e.i);
  // Spread: split the story into `want` equal windows, take the simplest eligible line in each
  // (fewest long words, then shortest), earliest on ties. Deterministic.
  const chosen: number[] = [];
  for (let k = 0; k < want; k++) {
    const lo = Math.floor((k * lines.length) / want), hi = Math.floor(((k + 1) * lines.length) / want);
    const inWin = eligible.filter((e) => e.i >= lo && e.i < hi);
    if (!inWin.length) continue;
    const score = (e: { l: TurnCandidate }) => e.l.words.reduce((s, w) => s + bare(w), 0) / e.l.words.length;
    inWin.sort((a, b) => score(a) - score(b) || a.i - b.i);
    chosen.push(inWin[0].i);
  }
  return chosen;
}

/** Lines a reader MAY get as a turn when the number of turns follows the reader's age (5 at age 5, one more per year).
 *  Wider than the default rules so older readers also get longer lines; up to the validator's 12 words. */
export const POOL_RULES: TurnRules = { minWords: 3, maxWords: 12, maxWordLength: 10, linesPerTurn: 1, skipFirstLine: true };

const plain = (w: string) => w.normalize('NFC').toLowerCase().replace(/['’]s$/u, '').replace(/[\p{P}\p{S}]/gu, '');

/** Indexes (into `lines`) of the age-turn pool: POOL_RULES, minus lines with a word from `avoid` (source.json
 *  "turnAvoid": names and rare words a recogniser is likely to mishear; "Chinku" also covers "Chinku’s"). */
export function turnPoolLines(lines: TurnCandidate[], avoid: readonly string[] = []): number[] {
  const bad = new Set(avoid.map(plain).filter(Boolean));
  return eligibleTurnLines(lines, POOL_RULES).filter((i) => !lines[i].words.some((w) => bad.has(plain(w))));
}
