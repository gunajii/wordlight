// The reading turn state machine. Pure and deterministic: time comes in as arguments, events go
// out as return values. The model never decides whether a child "failed"; these rules do.
//
// cursor           index of the next expected word
// lastProgressMs   when the cursor last moved (read, helped or skipped)
// Stall rule       no progress for `stallMs` → help the next word (TV says it, marks it amber)
// Skip rule        a heard word that matches the word AFTER the cursor skips at most one word,
//                  and at most `maxSkipsPerLine` per line
// Never backwards  a word once read/helped/skipped keeps that state

import { normalizeWord, tokenize, type Lang } from './normalize.ts';
import { wordScore, DEFAULT_MATCH_POLICY, type MatchPolicy } from './match.ts';

export type WordState = 'pending' | 'read' | 'helped' | 'skipped';

export type EngineEvent =
  | { type: 'word.read'; index: number; confidence: number; atMs: number; heard: string }
  | { type: 'word.helped'; index: number; reason: 'stall' | 'asked'; atMs: number }
  | { type: 'word.skipped'; index: number; atMs: number }
  | { type: 'line.done'; read: number; helped: number; skipped: number; durationMs: number };

export interface HeardWord {
  text: string;
  /** ASR says this word will not change any more (Transcribe partial-result stabilisation). */
  stable?: boolean;
  confidence?: number;
}

export interface TranscriptUpdate {
  /** Identifies one ASR result segment; partial updates of a segment share the id. */
  segmentId: string;
  words: HeardWord[];
  final: boolean;
}

export interface TurnOptions {
  words: string[];
  lang: Lang;
  startMs: number;
  stallMs?: number;
  /** Stall time before the FIRST word (mic warm-up, finding the line). Default = stallMs. */
  firstStallMs?: number;
  maxSkipsPerLine?: number;
  policy?: MatchPolicy;
}

export class ReadingTurn {
  readonly expected: string[];
  readonly display: string[];
  readonly lang: Lang;
  readonly states: WordState[];
  cursor = 0;
  lastProgressMs: number;
  done = false;
  private readonly startMs: number;
  private readonly stallMs: number;
  private readonly firstStallMs: number;
  private readonly maxSkips: number;
  private readonly policy: MatchPolicy;
  private skips = 0;
  /** Heard words consumed per segment (accepted or confirmed extra); never decreases. */
  private consumed = new Map<string, number>();

  constructor(o: TurnOptions) {
    this.display = o.words.slice();
    this.lang = o.lang;
    this.expected = o.words.map((w) => normalizeWord(w, o.lang));
    this.states = this.expected.map(() => 'pending');
    this.startMs = o.startMs;
    this.lastProgressMs = o.startMs;
    this.stallMs = o.stallMs ?? 3000;
    this.firstStallMs = o.firstStallMs ?? this.stallMs;
    this.maxSkips = o.maxSkipsPerLine ?? Math.max(1, Math.floor(o.words.length / 4));
    this.policy = o.policy ?? DEFAULT_MATCH_POLICY;
    // Words that normalise to nothing (pure punctuation) are never expected.
    this.expected.forEach((w, i) => { if (!w) this.states[i] = 'skipped'; });
    this.advancePastEmpty();
  }

  /** Feed one transcript update (partial or final). Returns the events it caused, in order. */
  feed(u: TranscriptUpdate, nowMs: number): EngineEvent[] {
    if (this.done) return [];
    const out: EngineEvent[] = [];
    const heard = u.words.flatMap((w) => tokenize(w.text, this.lang).map((t) => ({ t, stable: w.stable === true || u.final, conf: w.confidence })));
    let h = this.consumed.get(u.segmentId) ?? 0;
    while (h < heard.length && !this.done) {
      const { t, stable, conf } = heard[h];
      const s0 = wordScore(this.expected[this.cursor], t, this.lang, this.policy);
      if (s0 > 0) {
        out.push(this.accept(this.cursor, s0 * (conf ?? 1), t, nowMs));
        h++;
        continue;
      }
      const next = this.nextPending(this.cursor + 1);
      const s1 = next >= 0 && this.skips < this.maxSkips ? wordScore(this.expected[next], t, this.lang, this.policy) : 0;
      if (s1 > 0) {
        this.states[this.cursor] = 'skipped';
        this.skips++;
        out.push({ type: 'word.skipped', index: this.cursor, atMs: nowMs - this.startMs });
        this.cursor = next;
        out.push(this.accept(this.cursor, s1 * (conf ?? 1), t, nowMs));
        h++;
        continue;
      }
      // Not a match. An unstable word may still be revised by the ASR (e.g. "lit" → "little"):
      // stop here and look at it again on the next update. A stable one is an extra word.
      if (!stable) break;
      h++;
    }
    this.consumed.set(u.segmentId, h);
    this.finishIfDone(out, nowMs);
    return out;
  }

  /** Advance time. Fires the stall rule at most once per call. */
  tick(nowMs: number): EngineEvent[] {
    if (this.done) return [];
    const limit = this.cursor === 0 && this.states.every((s) => s === 'pending' || s === 'skipped') ? this.firstStallMs : this.stallMs;
    if (nowMs - this.lastProgressMs < limit) return [];
    return this.helpNext('stall', nowMs);
  }

  /** The child asked for help (Select on the remote). */
  askHelp(nowMs: number): EngineEvent[] {
    if (this.done) return [];
    return this.helpNext('asked', nowMs);
  }

  counts() {
    return {
      read: this.states.filter((s) => s === 'read').length,
      helped: this.states.filter((s) => s === 'helped').length,
      skipped: this.states.filter((s, i) => s === 'skipped' && this.expected[i] !== '').length,
    };
  }

  private helpNext(reason: 'stall' | 'asked', nowMs: number): EngineEvent[] {
    const out: EngineEvent[] = [];
    this.states[this.cursor] = 'helped';
    out.push({ type: 'word.helped', index: this.cursor, reason, atMs: nowMs - this.startMs });
    this.cursor++;
    this.lastProgressMs = nowMs;
    this.advancePastEmpty();
    this.finishIfDone(out, nowMs);
    return out;
  }

  private accept(index: number, confidence: number, heard: string, nowMs: number): EngineEvent {
    this.states[index] = 'read';
    this.cursor = index + 1;
    this.lastProgressMs = nowMs;
    this.advancePastEmpty();
    return { type: 'word.read', index, confidence: Math.round(confidence * 100) / 100, atMs: nowMs - this.startMs, heard };
  }

  private nextPending(from: number): number {
    for (let i = from; i < this.expected.length; i++) if (this.states[i] === 'pending') return i;
    return -1;
  }

  private advancePastEmpty() {
    while (this.cursor < this.expected.length && this.states[this.cursor] !== 'pending') this.cursor++;
  }

  private finishIfDone(out: EngineEvent[], nowMs: number) {
    if (this.done || this.cursor < this.expected.length) return;
    this.done = true;
    const c = this.counts();
    out.push({ type: 'line.done', ...c, durationMs: nowMs - this.startMs });
  }
}
