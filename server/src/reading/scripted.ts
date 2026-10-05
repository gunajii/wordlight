// ScriptedSource — LOCAL SIMULATION of a speech recogniser, for developing the UI and the turn state machine
// without AWS. It is NOT speech recognition: it never looks at the audio. What it does instead:
//   • waits for the first audio chunk (like the real service, nothing happens without a microphone stream);
//   • plays a deterministic script of what a reader "says" (a scenario), emitting transcript updates the way
//     Amazon Transcribe Streaming does: an unstable partial of each word first, then the stable word, all in
//     one result segment, and a final result at the end;
//   • feeds those updates to the REAL reading engine, which decides what lights. A scripted misread is
//     rejected by the engine exactly as a recognised one would be — the mock does not make turns succeed.
// Word timings are simulated (a fixed pace plus a fixed recogniser delay). They describe the script, not
// Amazon Transcribe, and must never be reported as measurements.
import type { SpeechHandlers, SpeechSession, SpeechSource, SpeechUpdate, SpeechWord } from './speech.ts';

export type Scenario = 'correct' | 'slip' | 'hesitation' | 'misread' | 'misread2' | 'correction' | 'repeat' | 'omit' | 'stall' | 'silence' | 'demo';
export const SCENARIOS: Scenario[] = ['correct', 'slip', 'hesitation', 'misread', 'misread2', 'correction', 'repeat', 'omit', 'stall', 'silence', 'demo'];

/** One thing the simulated reader does. `say` = a spoken word; `asr` = how the recogniser spells it (default: the word). */
export type ScriptStep = { say: string; asr?: string; gapMs?: number; expectIndex?: number | null } | { silenceMs: number };

export interface ScriptTiming {
  /** gap between spoken words (ms) */ paceMs: number;
  /** delay before the first word, after the first audio chunk */ leadMs: number;
  /** spoken word → unstable partial appears */ partialDelayMs: number;
  /** spoken word → stable word appears */ stableDelayMs: number;
  /** last word → final result */ finalDelayMs: number;
  /** extra gap before a hesitated word (below the 3 s help time) */ hesitationMs: number;
  /** gap between a misread word and its correction */ correctionGapMs: number;
  /** silence of a stall (above the 3 s help time, below two of them) */ stallSilenceMs: number;
}
export const DEFAULT_TIMING: ScriptTiming = { paceMs: 520, leadMs: 700, partialDelayMs: 280, stableDelayMs: 650, finalDelayMs: 900, hesitationMs: 1500, correctionGapMs: 600, stallSilenceMs: 3600 };

const strip = (w: string) => w.replace(/[\p{P}\p{S}]+/gu, '');
const isDeva = (w: string) => /[ऀ-ॿ]/.test(w);

/** A different, real-looking word: change the first vowel (big → bag, बिल्ली → बल्ली). The engine must reject it. */
export function misreadOf(word: string): string {
  const w = strip(word);
  if (isDeva(w)) {
    const signs = ['ि', 'ी', 'ु', 'ू', 'े', 'ै', 'ो', 'ौ', 'ा'];
    const chars = [...w];
    const k = chars.findIndex((c) => signs.includes(c));
    if (k >= 0) { chars[k] = chars[k] === 'ा' ? 'ो' : 'ा'; return chars.join(''); }
    return chars.length > 1 ? chars[0] + 'ा' + chars.slice(1).join('') : w + 'ा';
  }
  const m = w.match(/[aeiou]/i);
  if (!m || m.index === undefined) return w + 'o';
  const swap: Record<string, string> = { a: 'o', e: 'a', i: 'a', o: 'a', u: 'a' };
  const c = w[m.index];
  const r = swap[c.toLowerCase()] ?? 'a';
  return w.slice(0, m.index) + (c === c.toUpperCase() ? r.toUpperCase() : r) + w.slice(m.index + 1);
}

/** An ASR spelling slip of a long word that still sounds the same (rabbit → rabit, elephant → elefant). */
export function slipOf(word: string): string | null {
  const w = strip(word);
  if ([...w].length < 5 || isDeva(w)) return null;
  if (/ph/.test(w)) return w.replace('ph', 'f');
  const dbl = w.match(/([b-df-hj-np-tv-z])\1/i);
  if (dbl && dbl.index !== undefined) return w.slice(0, dbl.index) + w.slice(dbl.index + 1);
  return null;
}

const pickLong = (words: string[]) => {
  let best = Math.min(1, words.length - 1);
  const last = words.length > 2 ? words.length - 2 : words.length - 1; // not the final word: the line should end on the child's voice
  words.forEach((w, i) => { if (i > 0 && i <= last && [...strip(w)].length >= [...strip(words[best])].length) best = i; });
  return best;
};

/** Build the script for a scenario. Deterministic: same words → same script. */
export function scriptFor(scenario: Scenario, words: string[], t: ScriptTiming = DEFAULT_TIMING): ScriptStep[] {
  const n = words.length;
  const mid = Math.min(Math.max(1, Math.floor(n / 2)), n - 1);
  const plain = (i: number, gapMs = t.paceMs): ScriptStep => ({ say: strip(words[i]) || words[i], gapMs, expectIndex: i });
  const all = () => words.map((_, i) => plain(i));
  switch (scenario) {
    case 'correct': return all();
    case 'slip': {
      const i = words.findIndex((w) => slipOf(w)) ;
      return words.map((_, k) => (k === i ? { ...plain(k), asr: slipOf(words[k])! } : plain(k)));
    }
    case 'hesitation': return words.map((_, k) => (k === mid ? plain(k, t.hesitationMs) : plain(k)));
    case 'misread': return words.map((_, k) => (k === mid ? { say: misreadOf(words[k]), gapMs: t.paceMs, expectIndex: k } : plain(k)));
    case 'misread2': {
      const j = n > 3 ? n - 1 : -1;
      return words.map((_, k) => (k === mid || k === j ? { say: misreadOf(words[k]), gapMs: t.paceMs, expectIndex: k } : plain(k)));
    }
    case 'correction': {
      const out: ScriptStep[] = [];
      words.forEach((_, k) => {
        if (k === mid) { out.push({ say: misreadOf(words[k]), gapMs: t.paceMs, expectIndex: null }); out.push(plain(k, t.correctionGapMs)); }
        else out.push(plain(k));
      });
      return out;
    }
    case 'repeat': {
      const out: ScriptStep[] = [];
      words.forEach((_, k) => { out.push(plain(k)); if (k === mid - 1) out.push({ say: strip(words[k]), gapMs: 250, expectIndex: null }); });
      return out;
    }
    case 'omit': return words.map((_, k) => k).filter((k) => k !== mid).map((k) => plain(k));
    case 'stall': // reads up to the middle word, stays silent long enough for help (3 s), then goes on after it
      return [...words.slice(0, mid).map((_, k) => plain(k)), { silenceMs: t.stallSilenceMs }, ...words.slice(mid + 1).map((_, k) => plain(mid + 1 + k))];
    case 'demo': { // the rehearsable demo turn: smooth reading, one stall on the longest word, then finish
      const k = pickLong(words);
      return [...words.slice(0, k).map((_, i) => plain(i)), { silenceMs: t.stallSilenceMs }, ...words.slice(k + 1).map((_, i) => plain(k + 1 + i))];
    }
    case 'silence': return [];
  }
}

export interface ScriptedOptions {
  scenario?: Scenario;
  /** choose a scenario per turn (e.g. rotate); overrides `scenario` */
  pick?: (expected: string[], turnNo: number) => Scenario;
  /** an explicit script per turn (the S2 harness's scripted engine); overrides scenario/pick */
  script?: (expected: string[], turnNo: number) => ScriptStep[];
  timing?: Partial<ScriptTiming>;
  now?: () => number;
}

/** Simulated word onset times of the last opened session (ms after the first audio chunk), for harness ground truth. */
export interface ScriptedTrace { scenario: Scenario; steps: ScriptStep[]; spokenAtMs: (number | null)[] }

export class ScriptedSource implements SpeechSource {
  readonly name = 'scripted';
  readonly simulated = true;
  private readonly o: { scenario: Scenario; pick?: ScriptedOptions['pick']; script?: ScriptedOptions['script']; timing: ScriptTiming; now: () => number };
  private turnNo = 0;
  lastTrace: ScriptedTrace | null = null;
  constructor(o: ScriptedOptions = {}) {
    this.o = { scenario: o.scenario ?? 'demo', pick: o.pick, script: o.script, timing: { ...DEFAULT_TIMING, ...o.timing }, now: o.now ?? (() => performance.timeOrigin + performance.now()) };
  }

  open(o: { lang: 'hi-IN' | 'en-IN'; expected?: string[] }, h: SpeechHandlers): SpeechSession {
    const words = o.expected ?? [];
    const scenario = this.o.pick ? this.o.pick(words, this.turnNo) : this.o.scenario;
    const T = this.o.timing;
    const steps = this.o.script ? this.o.script(words, this.turnNo) : scriptFor(scenario, words, T);
    this.turnNo++;
    const stats = { chunks: 0, bytes: 0, updates: 0 };
    const timers: ReturnType<typeof setTimeout>[] = [];
    let started = false, closed = false;
    const spokenAtMs: (number | null)[] = steps.map(() => null);
    this.lastTrace = { scenario, steps, spokenAtMs };
    // Precompute the timeline: when each spoken step starts (ms after the first audio chunk).
    let at = T.leadMs;
    const spoken: { step: number; atMs: number; asr: string }[] = [];
    steps.forEach((st, i) => {
      if ('silenceMs' in st) { at += st.silenceMs; return; }
      if (spoken.length) at += st.gapMs ?? T.paceMs;
      spoken.push({ step: i, atMs: at, asr: st.asr ?? st.say });
      spokenAtMs[i] = at;
    });
    const emit = (upto: number, partial: boolean, final: boolean) => {
      if (closed) return;
      const ws: SpeechWord[] = spoken.slice(0, upto + 1).map((s, k) => {
        const unstable = partial && k === upto;
        const txt = unstable ? [...s.asr].slice(0, Math.max(1, Math.ceil([...s.asr].length * 0.6))).join('') : s.asr;
        return { text: txt, stable: !unstable, confidence: unstable ? 0.6 : 0.92, startMs: s.atMs, endMs: s.atMs + 320 };
      });
      stats.updates++;
      const u: SpeechUpdate = { segmentId: 'scripted-1', final, receivedAtMs: this.o.now(), words: ws };
      h.onUpdate(u);
    };
    const start = () => {
      spoken.forEach((s, k) => {
        timers.push(setTimeout(() => emit(k, true, false), s.atMs + T.partialDelayMs));
        // the stable word appears unless the next word's partial already carries it
        timers.push(setTimeout(() => emit(k, false, false), s.atMs + T.stableDelayMs));
      });
      if (spoken.length) timers.push(setTimeout(() => emit(spoken.length - 1, false, true), spoken.at(-1)!.atMs + T.finalDelayMs));
    };
    return {
      stats,
      push(pcm: Int16Array) {
        stats.chunks++; stats.bytes += pcm.byteLength;
        if (!started) { started = true; start(); }
      },
      end() { if (closed) return; closed = true; timers.forEach(clearTimeout); h.onClose(); },
    };
  }
}

/** Server/harness helper: SPEECH_SCRIPT=demo|correct|…|rotate. 'rotate' cycles demo → misread → correction → correct. */
export function scriptedFromEnv(v: string | undefined): ScriptedSource {
  if (v === 'rotate') {
    const order: Scenario[] = ['demo', 'misread', 'correction', 'correct'];
    return new ScriptedSource({ pick: (_w, n) => order[n % order.length] });
  }
  const sc = (SCENARIOS as string[]).includes(v ?? '') ? (v as Scenario) : 'demo';
  return new ScriptedSource({ scenario: sc });
}
