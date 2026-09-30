// S3 test sink: stands where the Transcribe adapter will stand (TurnDriver). It MEASURES the stream and
// discards the audio: no PCM is stored, logged or forwarded. Only per-turn summaries (numbers) are kept,
// in memory and — if a results directory is given — as JSON files (bench/runs/s3/, gitignored).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ActiveTurn, Session, TurnDriver } from '../hub.ts';
import type { AudioFrame } from '@wordlight/shared-protocol';
import { TurnStats, type TurnSummary } from './stats.ts';

export class S3Sink implements TurnDriver {
  private live = new Map<string, TurnStats>(); // sessionId → stats of the active turn
  private lastAck = new Map<string, number>();
  readonly results = new Map<string, TurnSummary[]>(); // sessionId → finished turns
  private readonly o: { now: () => number; resultsDir?: string; log?: (m: string) => void };
  constructor(o: { now: () => number; resultsDir?: string; log?: (m: string) => void }) { this.o = o; }

  start(s: Session, t: ActiveTurn) {
    this.live.set(s.id, new TurnStats({ turnId: t.turn.turnId, chunkMs: t.chunkMs, startedAtServerMs: t.startedAtServerMs, detectClicks: t.detectClicks }));
  }

  audio(s: Session, t: ActiveTurn, frame: AudioFrame) {
    const st = this.live.get(s.id);
    if (!st || st.turnId !== t.turn.turnId) return;
    const now = this.o.now();
    st.frame(frame, now, s.clocks.get(t.phoneClientId));
    // frame.pcm goes out of scope here: nothing retains it
    // once a second: tell the phone what arrived (for its on-screen counters; numbers only)
    if (now - (this.lastAck.get(s.id) ?? 0) >= 1000) {
      this.lastAck.set(s.id, now);
      s.phones.get(t.phoneClientId)?.send({ t: 's3.ack', turnId: t.turn.turnId, ...st.recent() });
    }
  }

  help() {}

  stop(s: Session, t: ActiveTurn, reason: string) {
    const st = this.live.get(s.id);
    if (!st || st.turnId !== t.turn.turnId) return;
    this.live.delete(s.id);
    st.staleTag = t.staleFrames;
    const sum = st.summary(this.o.now(), reason);
    const list = this.results.get(s.id) ?? [];
    list.push(sum);
    this.results.set(s.id, list);
    const l = sum.latencyFirstSampleMs;
    this.o.log?.(`[s3] ${s.id} ${sum.turnId} ${reason} ${Math.round(sum.durationMs / 1000)} s · chunk ${sum.chunkMs} ms · frames ${sum.frames} · missing ${sum.missing} dup ${sum.duplicates} ooo ${sum.outOfOrder} stale ${sum.staleTag} · latency median ${l?.median ?? '—'} p95 ${l?.p95 ?? '—'} max ${l?.max ?? '—'} ms`);
    if (this.o.resultsDir) {
      const dir = path.join(this.o.resultsDir, s.id);
      mkdir(dir, { recursive: true }).then(() => writeFile(path.join(dir, `${sum.turnId}.json`), JSON.stringify(sum, null, 1))).catch((e) => this.o.log?.(`[s3] could not write result: ${e}`));
    }
  }

  liveSummary(sessionId: string): TurnSummary | null {
    const st = this.live.get(sessionId);
    return st ? st.summary(this.o.now(), 'running') : null;
  }
}
