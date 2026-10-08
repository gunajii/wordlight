// The reading turn state machine. Pure and deterministic: time comes in as arguments, events go
// out as return values. The model never decides whether a child "failed"; these rules do.
//
// cursor           index of the next expected word
// lastProgressMs   when the cursor last moved (read, helped or skipped)
// Stall rule       no progress AND no speech activity for `stallMs` → help the next word (TV says it, marks it
//                  amber). Speech activity (the server's voice-activity detector on the phone audio, or any
//                  recogniser update) means the child is trying — stuttering, sounding out — so the clock waits;
//                  but after `maxStallMs` without progress the child is helped anyway.
// Help pending     (awaitHelpDone) after a help the clock stops until the TV reports the help word has finished
//                  playing (helpDone); only then does the child's time start again. If the TV never reports,
//                  the clock restarts after `helpPendingMaxMs`. (Real loop 2026-10-08: the next word was helped
//                  while the child was still repeating the helped one.)
// Skip rule        a heard word that matches the word AFTER the cursor skips at most one word,
//                  and at most `maxSkipsPerLine` per line (omissions). A SUBSTITUTION — a different word was
//                  already heard in the cursor word's place, then the next word — skips without using that
//                  budget; after two different words heard in place, the word after next may match (two
//                  consecutive substitutions). Found by the S2 harness (multiple-wrong cases: after two misreads
//                  the engine lost the child and helped words the child had read correctly). Substituted words
//                  are never lit.
// Compound         a hyphenated book word read as two heard words (ice-cream / "ice cream") matches only if
//                  the two heard words joined are EXACTLY the expected word (S2 harness, english-edge).
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
  /** Help even during continuous speech after this long without progress. Default 8000. */
  maxStallMs?: number;
  /** After a help, wait for helpDone() before the stall clock runs again. Default false. */
  awaitHelpDone?: boolean;
  /** Longest wait for helpDone(). Default 4000. */
  helpPendingMaxMs?: number;
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
  private readonly maxStallMs: number;
  private readonly awaitHelpDone: boolean;
  private readonly helpPendingMaxMs: number;
  /** last speech activity (voice detector or recogniser update) */
  lastActivityMs: number;
  /** a help word is playing on the TV since this time (awaitHelpDone), else null */
  helpPendingSince: number | null = null;
  /** stable non-matching words heard at the current cursor since the last progress (substitutions) */
  private missCount = 0;
  /** Heard words consumed per segment (accepted or confirmed extra); never decreases. */
  private consumed = new Map<string, number>();

  constructor(o: TurnOptions) {
    this.display = o.words.slice();
    this.lang = o.lang;
    this.expected = o.words.map((w) => normalizeWord(w, o.lang));
    this.states = this.expected.map(() => 'pending');
    this.startMs = o.startMs;
    this.lastProgressMs = o.startMs;
    this.lastActivityMs = o.startMs;
    this.stallMs = o.stallMs ?? 3000;
    this.maxStallMs = o.maxStallMs ?? 8000;
    this.awaitHelpDone = o.awaitHelpDone ?? false;
    this.helpPendingMaxMs = o.helpPendingMaxMs ?? 4000;
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
    if (heard.length) this.activity(nowMs); // the recogniser heard something: the child is speaking
    let h = this.consumed.get(u.segmentId) ?? 0;
    while (h < heard.length && !this.done) {
      const { t, stable, conf } = heard[h];
      const s0 = wordScore(this.expected[this.cursor], t, this.lang, this.policy);
      if (s0 > 0) {
        out.push(this.accept(this.cursor, s0 * (conf ?? 1), t, nowMs));
        h++;
        continue;
      }
      if (h + 1 < heard.length && t + heard[h + 1].t === this.expected[this.cursor] && [...this.expected[this.cursor]].length > [...t].length) {
        const c2 = Math.min(conf ?? 1, heard[h + 1].conf ?? 1);
        out.push(this.accept(this.cursor, c2, `${t} ${heard[h + 1].t}`, nowMs));
        h += 2;
        continue;
      }
      // Look ahead one word (an omission, or a substitution if a different word was heard here), or two words
      // only after two different words were heard here (two consecutive substitutions). Never further.
      const next1 = this.nextPending(this.cursor + 1);
      const next2 = next1 >= 0 ? this.nextPending(next1 + 1) : -1;
      const sub = this.missCount;
      const s1 = next1 >= 0 && (sub >= 1 || this.skips < this.maxSkips) ? wordScore(this.expected[next1], t, this.lang, this.policy) : 0;
      const s2 = !s1 && next2 >= 0 && sub >= 2 ? wordScore(this.expected[next2], t, this.lang, this.policy) : 0;
      if (s1 > 0 || s2 > 0) {
        const target = s1 > 0 ? next1 : next2;
        if (sub === 0) this.skips++;
        for (let k = this.cursor; k < target; k++) {
          if (this.states[k] !== 'pending') continue;
          this.states[k] = 'skipped';
          out.push({ type: 'word.skipped', index: k, atMs: nowMs - this.startMs });
        }
        this.cursor = target;
        out.push(this.accept(this.cursor, (s1 || s2) * (conf ?? 1), t, nowMs));
        h++;
        continue;
      }
      // Not a match. An unstable word may still be revised by the ASR (e.g. "lit" → "little"):
      // stop here and look at it again on the next update. A stable one is an extra word.
      if (!stable) break;
      this.missCount++;
      h++;
    }
    this.consumed.set(u.segmentId, h);
    this.finishIfDone(out, nowMs);
    return out;
  }

  /** Speech activity now (voice detector on the phone audio). Ignored while a help word plays (the TV's own voice). */
  activity(nowMs: number) {
    if (this.helpPendingSince === null && nowMs > this.lastActivityMs) this.lastActivityMs = nowMs;
  }

  /** The TV finished playing the help word: the child's time starts now. */
  helpDone(nowMs: number) {
    if (this.helpPendingSince === null) return;
    this.helpPendingSince = null;
    this.lastProgressMs = nowMs;
    this.lastActivityMs = nowMs;
  }

  /** Advance time. Fires the stall rule at most once per call. */
  tick(nowMs: number): EngineEvent[] {
    if (this.done) return [];
    if (this.helpPendingSince !== null) {
      if (nowMs - this.helpPendingSince < this.helpPendingMaxMs) return [];
      this.helpDone(nowMs); // the TV never reported: give the child their time from now
      return [];
    }
    const limit = this.cursor === 0 && this.states.every((s) => s === 'pending' || s === 'skipped') ? this.firstStallMs : this.stallMs;
    const quietMs = nowMs - Math.max(this.lastProgressMs, this.lastActivityMs);
    if (quietMs < limit && nowMs - this.lastProgressMs < Math.max(limit, this.maxStallMs)) return [];
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
    this.missCount = 0;
    out.push({ type: 'word.helped', index: this.cursor, reason, atMs: nowMs - this.startMs });
    this.cursor++;
    this.lastProgressMs = nowMs;
    if (this.awaitHelpDone) this.helpPendingSince = nowMs;
    this.advancePastEmpty();
    this.finishIfDone(out, nowMs);
    return out;
  }

  private accept(index: number, confidence: number, heard: string, nowMs: number): EngineEvent {
    this.states[index] = 'read';
    this.missCount = 0;
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
