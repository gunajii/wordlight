// S3 microphone spike: per-turn measurement of the phone → server audio stream.
//
// What is measured (all on the SERVER, from frame headers and receive times — never from audio content,
// except the opt-in click detector below, which only extracts onset times of a synthetic 1 kHz test tone):
//   • sequence: frames, missing (gaps never filled), duplicates, out-of-order arrivals, stale-tag frames
//   • latency of each chunk's FIRST sample:  recvServerMs − (capturedAtMs + clockOffsetMs)
//       capturedAtMs  = phone performance.now() when the worklet chunk reached the page, minus the chunk
//                       duration (so it includes the chunk's own buffering);
//       clockOffsetMs = phone's NTP-style estimate (server ≈ phone + offset), reported by the phone every 2 s;
//       uncertainty   = ± minRtt/2 of that estimate (reported alongside).
//     Not included: microphone hardware + OS input buffering before the AudioWorklet sees the samples
//     (not observable from JavaScript). The opt-in acoustic click test bounds the total from above.
//   • transport latency = first-sample latency − chunk duration (page → server only)
//   • capture continuity: gaps in the phone-clock timeline between consecutive chunks (audio lost on the phone)
//   • effective sample rate: samples received vs server-clock duration
export interface ClockReport { offsetMs: number; minRttMs: number; atServerMs: number }
export interface Dist { n: number; median: number; p95: number; max: number; min: number; mean: number; sd: number }
export interface ClickEvent { phoneCapturedMs: number; captureServerMs: number | null; recvServerMs: number; level: number }

export function dist(xs: number[]): Dist | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const q = (p: number) => a[Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1))];
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  const sd = a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / (a.length - 1)) : 0;
  const r = (x: number) => Math.round(x * 10) / 10;
  return { n: a.length, median: r(q(0.5)), p95: r(q(0.95)), max: r(a[a.length - 1]), min: r(a[0]), mean: r(mean), sd: r(sd) };
}

/** Streaming 1 kHz tone-onset detector (Goertzel, 10 ms windows, 5 ms hop). Test-signal only. */
export class ClickDetector {
  private buf: number[] = [];
  private bufStartIdx = 0; // stream index of buf[0]
  private floor = 1e-7;
  private lastOnsetIdx = -1e12;
  private readonly N = 160;
  private readonly hop = 80;
  private readonly coeff = 2 * Math.cos((2 * Math.PI * 1000) / 16000);
  /** Feed in-order samples starting at stream index `startIdx`; returns onset stream indexes and levels. */
  push(pcm: Int16Array, startIdx: number): { idx: number; level: number }[] {
    if (startIdx !== this.bufStartIdx + this.buf.length) { this.buf = []; this.bufStartIdx = startIdx; } // discontinuity
    for (let i = 0; i < pcm.length; i++) this.buf.push(pcm[i] / 32768);
    const out: { idx: number; level: number }[] = [];
    while (this.buf.length >= this.N) {
      let s1 = 0, s2 = 0;
      for (let i = 0; i < this.N; i++) { const s0 = this.buf[i] + this.coeff * s1 - s2; s2 = s1; s1 = s0; }
      const mag2 = s1 * s1 + s2 * s2 - this.coeff * s1 * s2;
      const amp2 = mag2 / (this.N / 2) ** 2; // ≈ A² for a tone of amplitude A
      const idx = this.bufStartIdx;
      if (amp2 > 16 * this.floor && amp2 > 1e-5 && idx - this.lastOnsetIdx > 8000) { // +12 dB over floor, > −50 dBFS, 0.5 s refractory
        out.push({ idx, level: Math.round(Math.sqrt(amp2) * 1000) / 1000 });
        this.lastOnsetIdx = idx;
      }
      if (idx - this.lastOnsetIdx > 1600) this.floor = 0.95 * this.floor + 0.05 * Math.max(amp2, 1e-9); // learn floor away from tones
      this.buf.splice(0, this.hop);
      this.bufStartIdx += this.hop;
    }
    return out;
  }
}

export interface TurnSummary {
  turnId: string; chunkMs: number; startedAtServerMs: number; endedAtServerMs: number; durationMs: number; reason: string;
  frames: number; samples: number; bytes: number;
  missing: number; duplicates: number; outOfOrder: number; staleTag: number; gaps: { fromSeq: number; toSeq: number; atServerMs: number }[];
  firstFrameAfterStartMs: number | null;
  latencyFirstSampleMs: Dist | null; latencyTransportMs: Dist | null;
  clock: { reports: number; minRttMs: Dist | null; offsetDriftMs: number | null } ;
  captureGaps: { count: number; maxMs: number; totalMs: number };
  effectiveSampleRate: number | null;
  clicks: ClickEvent[];
}

export class TurnStats {
  readonly turnId: string; readonly chunkMs: number; readonly startedAtServerMs: number;
  private seen = new Set<number>(); private maxSeq = -1;
  frames = 0; samples = 0; bytes = 0; duplicates = 0; outOfOrder = 0; staleTag = 0;
  private gaps: TurnSummary['gaps'] = [];
  private firstRecv: number | null = null; private lastRecv: number | null = null;
  private latFirst: number[] = []; private latTransport: number[] = [];
  private rtts: number[] = []; private offsets: number[] = [];
  private prevCapEnd: number | null = null; private capGaps: number[] = [];
  private detector: ClickDetector | null; private streamIdx = 0; private clicks: ClickEvent[] = [];
  private lastClock: ClockReport | undefined;

  constructor(o: { turnId: string; chunkMs: number; startedAtServerMs: number; detectClicks?: boolean }) {
    this.turnId = o.turnId; this.chunkMs = o.chunkMs; this.startedAtServerMs = o.startedAtServerMs;
    this.detector = o.detectClicks ? new ClickDetector() : null;
  }

  clock(c: ClockReport) {
    this.lastClock = c; this.rtts.push(c.minRttMs); this.offsets.push(c.offsetMs);
  }

  frame(f: { seq: number; capturedAtMs: number; pcm: Int16Array }, recvServerMs: number, clock?: ClockReport) {
    if (clock && clock !== this.lastClock) this.clock(clock);
    const c = this.lastClock;
    if (this.seen.has(f.seq)) { this.duplicates++; return; }
    this.seen.add(f.seq);
    this.frames++; this.samples += f.pcm.length; this.bytes += 16 + f.pcm.length * 2;
    this.firstRecv ??= recvServerMs; this.lastRecv = recvServerMs;
    const inOrder = f.seq > this.maxSeq;
    if (!inOrder) this.outOfOrder++;
    else {
      if (f.seq > this.maxSeq + 1 && this.gaps.length < 100) this.gaps.push({ fromSeq: this.maxSeq + 1, toSeq: f.seq - 1, atServerMs: recvServerMs });
      this.maxSeq = f.seq;
    }
    const durMs = f.pcm.length / 16;
    if (c) {
      const lat = recvServerMs - (f.capturedAtMs + c.offsetMs);
      this.latFirst.push(lat); this.latTransport.push(lat - durMs);
    }
    if (inOrder) {
      if (this.prevCapEnd !== null) { const g = f.capturedAtMs - this.prevCapEnd; if (g > durMs / 2) this.capGaps.push(g); }
      this.prevCapEnd = f.capturedAtMs + durMs;
      if (this.detector) {
        for (const on of this.detector.push(f.pcm, this.streamIdx)) {
          // onset index is in the stream; map to this frame's capture clock (onsets can only be in this or the
          // previous frame; clamp at this frame's start for the rare previous-frame case: ≤ 10 ms early)
          const offIdx = Math.max(0, on.idx - this.streamIdx);
          const phone = f.capturedAtMs + offIdx / 16;
          this.clicks.push({ phoneCapturedMs: phone, captureServerMs: c ? phone + c.offsetMs : null, recvServerMs, level: on.level });
        }
        this.streamIdx += f.pcm.length;
      }
    }
  }

  get missing() { return this.maxSeq + 1 - this.seen.size; }

  /** Small live snapshot for the phone's counters. */
  recent() {
    const last = this.latFirst.slice(-50).sort((x, y) => x - y);
    return { frames: this.frames, maxSeq: this.maxSeq, missing: this.missing, duplicates: this.duplicates, outOfOrder: this.outOfOrder,
      latencyMedianMs: last.length ? Math.round(last[last.length >> 1]) : null };
  }

  summary(endedAtServerMs: number, reason: string): TurnSummary {
    const span = this.firstRecv !== null && this.lastRecv !== null ? this.lastRecv - this.firstRecv : 0;
    const drift = this.offsets.length > 1 ? Math.round((this.offsets[this.offsets.length - 1] - this.offsets[0]) * 10) / 10 : null;
    return {
      turnId: this.turnId, chunkMs: this.chunkMs, startedAtServerMs: this.startedAtServerMs, endedAtServerMs,
      durationMs: Math.round(endedAtServerMs - this.startedAtServerMs), reason,
      frames: this.frames, samples: this.samples, bytes: this.bytes,
      missing: this.missing, duplicates: this.duplicates, outOfOrder: this.outOfOrder, staleTag: this.staleTag, gaps: this.gaps,
      firstFrameAfterStartMs: this.firstRecv === null ? null : Math.round(this.firstRecv - this.startedAtServerMs),
      latencyFirstSampleMs: dist(this.latFirst), latencyTransportMs: dist(this.latTransport),
      clock: { reports: this.offsets.length, minRttMs: dist(this.rtts), offsetDriftMs: drift },
      captureGaps: { count: this.capGaps.length, maxMs: Math.round(Math.max(0, ...this.capGaps)), totalMs: Math.round(this.capGaps.reduce((s, x) => s + x, 0)) },
      effectiveSampleRate: span > 5000 ? Math.round(((this.samples - this.samples / Math.max(1, this.frames)) / span) * 1000) : null,
      clicks: this.clicks,
    };
  }
}
