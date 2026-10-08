// ReadingDriver: the real turn driver. Phone audio → SpeechSource (Transcribe) → ReadingTurn (pure engine)
// → word.read / word.helped / word.skipped / line.done → TV (and phone).
//
// Timing: the engine's clock starts at the FIRST audio chunk (not at turn.start), so microphone start-up
// (permission prompt, getUserMedia ~0.3–3 s on the S3 phones) never counts as a stall.
// Trace (numbers; heard text only with devTranscripts): per word, when it was spoken (Transcribe's word start,
// mapped to the server clock through the phone's capture timestamps and clock offset), when the update
// arrived, and when the event was emitted. Used by the S2 harness; no audio is kept.
import { ReadingTurn, tokenize, normalizeWord, type EngineEvent } from '@wordlight/reading-engine';
import type { AudioFrame } from '@wordlight/shared-protocol';
import type { ActiveTurn, Session, SessionHub, TurnDriver } from '../hub.ts';
import type { SpeechSource, SpeechSession, SpeechUpdate } from './speech.ts';
import { VoiceActivity } from './vad.ts';

export interface WordTrace {
  index: number; kind: 'read' | 'helped' | 'skipped'; emitServerMs: number;
  /** server-clock time the word was spoken (Transcribe word start → phone capture clock → server); null if unknown */
  spokenServerMs: number | null; updateReceivedMs: number | null; confidence: number | null; heard?: string; reason?: string;
  /** helped words: when the TV reported the help word finished playing (server clock) */
  helpDoneServerMs?: number;
}
export interface TurnTrace {
  sessionId: string; turnId: string; lang: string; words: string[]; startedAtServerMs: number; firstAudioServerMs: number | null;
  endedAtServerMs: number | null; endReason: string | null; source: string; simulated: boolean; mode: 'free' | 'echo'; updates: number; events: WordTrace[];
  result: { read: number; helped: number; skipped: number; durationMs: number } | null; error?: string;
  /** voice-activity numbers (no audio): 40 ms chunks seen / judged speech, noise floor and peak RMS */
  activity?: { chunks: number; speechChunks: number; floorRms: number | null; maxRms: number };
}

interface Live {
  t: ActiveTurn; speech: SpeechSession; engine: ReadingTurn | null; ticker: ReturnType<typeof setInterval> | null;
  firstCaptureServerMs: number | null; trace: TurnTrace; vad: VoiceActivity;
}

export class ReadingDriver implements TurnDriver {
  private live = new Map<string, Live>();
  readonly traces: TurnTrace[] = [];
  private readonly o: { hub: SessionHub; source: SpeechSource; now: () => number; stallMs: number; firstStallMs: number; maxStallMs: number; awaitHelpDone: boolean; helpPendingMaxMs: number; devTranscripts: boolean; log: (m: string) => void; onTrace?: (t: TurnTrace) => void };
  constructor(o: { hub: SessionHub; source: SpeechSource; now: () => number; stallMs?: number; firstStallMs?: number; maxStallMs?: number; awaitHelpDone?: boolean; helpPendingMaxMs?: number; devTranscripts?: boolean; log?: (m: string) => void; onTrace?: (t: TurnTrace) => void }) {
    // awaitHelpDone: the TV reports when the help word has finished (turn.help.done); older TV builds don't, and the
    // engine then restarts the clock after helpPendingMaxMs
    this.o = { stallMs: 3000, firstStallMs: 5000, maxStallMs: 8000, awaitHelpDone: true, helpPendingMaxMs: 4000, devTranscripts: false, log: () => {}, ...o };
  }

  start(s: Session, t: ActiveTurn) {
    const lang = t.turn.lang;
    const trace: TurnTrace = { sessionId: s.id, turnId: t.turn.turnId, lang, words: t.turn.words, startedAtServerMs: this.o.now(), firstAudioServerMs: null, endedAtServerMs: null, endReason: null, source: this.o.source.name, simulated: !!this.o.source.simulated, mode: t.turn.mode ?? 'free', updates: 0, events: [], result: null };
    const L: Live = { t, engine: null, ticker: null, firstCaptureServerMs: null, trace, speech: null as unknown as SpeechSession, vad: new VoiceActivity() };
    this.live.set(s.id, L);
    L.speech = this.o.source.open({ lang, expected: t.turn.words }, {
      onUpdate: (u) => this.onUpdate(s, L, u),
      onError: (e) => {
        trace.error = `${e.name}: ${e.message}`.slice(0, 300);
        this.o.log(`[reading] ${s.id} ${t.turn.turnId} speech error ${trace.error}`);
        if (this.live.get(s.id) === L) this.o.hub.endActiveTurn(s, 'error');
      },
      onClose: () => {},
    });
    if (this.o.source.simulated) this.o.log(`[reading] LOCAL SIMULATION (${this.o.source.name}) for ${t.turn.turnId} — not real speech recognition`);
  }

  audio(s: Session, t: ActiveTurn, frame: AudioFrame) {
    const L = this.live.get(s.id);
    if (!L || L.t.turn.turnId !== t.turn.turnId) return;
    if (L.firstCaptureServerMs === null) {
      const c = s.clocks.get(t.phoneClientId);
      L.firstCaptureServerMs = c ? frame.capturedAtMs + c.offsetMs : null;
      L.trace.firstAudioServerMs = this.o.now();
    }
    this.ensureEngine(s, L);
    if (L.vad.push(frame.pcm)) L.engine!.activity(this.o.now());
    L.speech.push(frame.pcm);
  }

  helpDone(s: Session, t: ActiveTurn, index: number) {
    const L = this.live.get(s.id);
    if (!L?.engine || L.t.turn.turnId !== t.turn.turnId) return;
    const now = this.o.now();
    L.engine.helpDone(now);
    const ev = [...L.trace.events].reverse().find((e) => e.kind === 'helped' && e.index === index && e.helpDoneServerMs === undefined);
    if (ev) ev.helpDoneServerMs = now;
  }

  help(s: Session, t: ActiveTurn) {
    const L = this.live.get(s.id);
    if (!L?.engine) return;
    this.emitAll(s, L, L.engine.askHelp(this.o.now()), null);
  }

  stop(s: Session, t: ActiveTurn, reason: string) {
    const L = this.live.get(s.id);
    if (!L || L.t.turn.turnId !== t.turn.turnId) return;
    this.live.delete(s.id);
    if (L.ticker) clearInterval(L.ticker);
    L.speech.end();
    L.trace.endedAtServerMs = this.o.now();
    L.trace.endReason = reason;
    L.trace.updates = L.speech.stats.updates;
    L.trace.activity = L.vad.stats();
    this.traces.push(L.trace);
    if (this.traces.length > 200) this.traces.shift();
    this.o.onTrace?.(L.trace);
  }

  private ensureEngine(s: Session, L: Live) {
    if (L.engine) return;
    L.engine = new ReadingTurn({ words: L.t.turn.words, lang: L.t.turn.lang, startMs: this.o.now(), stallMs: this.o.stallMs, firstStallMs: this.o.firstStallMs, maxStallMs: this.o.maxStallMs, awaitHelpDone: this.o.awaitHelpDone, helpPendingMaxMs: this.o.helpPendingMaxMs });
    L.ticker = setInterval(() => { if (L.engine) this.emitAll(s, L, L.engine.tick(this.o.now()), null); }, 100);
    (L.ticker as any).unref?.();
  }

  private onUpdate(s: Session, L: Live, u: SpeechUpdate) {
    if (this.live.get(s.id) !== L) return;
    this.ensureEngine(s, L);
    this.emitAll(s, L, L.engine!.feed(u, this.o.now()), u);
  }

  private emitAll(s: Session, L: Live, events: EngineEvent[], u: SpeechUpdate | null) {
    const used = new Set<number>();
    for (const e of events) {
      if (this.live.get(s.id) !== L && e.type !== 'line.done') return;
      const now = this.o.now();
      const turnId = L.t.turn.turnId;
      if (e.type === 'word.read') {
        // which recognised word produced this match → its start time in the audio stream
        let spoken: number | null = null;
        if (u && L.firstCaptureServerMs !== null) {
          const lang = L.t.turn.lang;
          const k = u.words.findIndex((w, i) => !used.has(i) && tokenize(w.text, lang).some((t) => normalizeWord(t, lang) === normalizeWord(e.heard, lang)));
          if (k >= 0 && u.words[k].startMs !== undefined) { used.add(k); spoken = L.firstCaptureServerMs + u.words[k].startMs!; }
        }
        L.trace.events.push({ index: e.index, kind: 'read', emitServerMs: now, spokenServerMs: spoken, updateReceivedMs: u?.receivedAtMs ?? null, confidence: e.confidence, ...(this.o.devTranscripts ? { heard: e.heard } : {}) });
        this.o.hub.emit(s, { type: 'word.read', sessionId: s.id, turnId, index: e.index, confidence: e.confidence, atMs: e.atMs }, true);
      } else if (e.type === 'word.helped') {
        L.trace.events.push({ index: e.index, kind: 'helped', emitServerMs: now, spokenServerMs: null, updateReceivedMs: null, confidence: null, reason: e.reason });
        this.o.hub.emit(s, { type: 'word.helped', sessionId: s.id, turnId, index: e.index, reason: e.reason }, true);
      } else if (e.type === 'word.skipped') {
        L.trace.events.push({ index: e.index, kind: 'skipped', emitServerMs: now, spokenServerMs: null, updateReceivedMs: null, confidence: null });
        this.o.hub.emit(s, { type: 'word.skipped', sessionId: s.id, turnId, index: e.index }, true);
      } else if (e.type === 'line.done') {
        L.trace.result = { read: e.read, helped: e.helped, skipped: e.skipped, durationMs: e.durationMs };
        this.o.hub.recordLine(s, L.t, { ...e, helpedWords: L.engine ? L.engine.display.filter((_, i) => L.engine!.states[i] === 'helped') : [] });
        this.o.hub.emit(s, { type: 'line.done', sessionId: s.id, turnId, read: e.read, helped: e.helped, skipped: e.skipped, durationMs: e.durationMs }); // ends the turn → stop()
      }
    }
  }
}

/** Routes S3 test turns to the measurement sink and real turns to the reading driver. */
export class RouterDriver implements TurnDriver {
  private readonly test: TurnDriver; private readonly reading: TurnDriver;
  constructor(o: { test: TurnDriver; reading: TurnDriver }) { this.test = o.test; this.reading = o.reading; }
  private pick(t: ActiveTurn) { return t.origin === 'test' ? this.test : this.reading; }
  start(s: Session, t: ActiveTurn) { this.pick(t).start(s, t); }
  audio(s: Session, t: ActiveTurn, f: AudioFrame) { this.pick(t).audio(s, t, f); }
  help(s: Session, t: ActiveTurn, k: 'next-word' | 'line') { this.pick(t).help(s, t, k); }
  helpDone(s: Session, t: ActiveTurn, i: number) { this.pick(t).helpDone?.(s, t, i); }
  stop(s: Session, t: ActiveTurn, r: string) { this.pick(t).stop(s, t, r); }
}
