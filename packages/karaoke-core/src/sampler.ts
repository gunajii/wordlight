// PlayheadSampler — an accurate (position, time) pair from a player whose currentTime may be
// quantised (updated only every N ms).
//
// Adapted from Earshot's @earshot/vega-sync PlayheadSampler (github: earshot repo, commit fe64ce9,
// packages/vega-sync/src/sampler.js, MIT, same author). Changes: TypeScript, plus positionAt().
//
// Reading a stale value at an arbitrary moment is up to N ms behind. Instead, poll often (e.g.
// every 20 ms) and remember when the value last CHANGED; for a quantised player the change
// happened between the previous poll and this one, so it is timestamped at the midpoint (error
// ±half the poll interval, unbiased). It also measures the player's update period, a key fact
// on a new platform ("Vega AudioPlayer.currentTime updates every X ms").

export interface Reading {
  positionMs: number;
  atLocalMs: number;
}

export class PlayheadSampler {
  readonly historySize: number;
  private lastChange: Reading | null = null;
  private lastValue: number | null = null;
  private lastPollAt: number | null = null;
  private intervals: number[] = [];
  private pollGaps: number[] = [];
  /** value changes observed since the last reset */
  changes = 0;

  constructor(o: { historySize?: number } = {}) {
    this.historySize = o.historySize ?? 64;
  }

  /** Feed one poll of the player: reported position, local time of the poll, playing? */
  sample(positionMs: number, localMs: number, playing: boolean): void {
    const prevPoll = this.lastPollAt;
    this.lastPollAt = localMs;
    if (!playing || this.lastValue === null) {
      // Paused: the value is exact whenever read. First reading after a reset: taken as-is.
      this.lastValue = positionMs;
      this.lastChange = { positionMs, atLocalMs: localMs };
      return;
    }
    if (positionMs === this.lastValue) return;
    const gap = prevPoll != null ? localMs - prevPoll : 0;
    if (gap > 0) push(this.pollGaps, gap, this.historySize);
    const period = this.updatePeriodMs;
    const pollGap = median(this.pollGaps);
    const quantised = period != null && pollGap != null && period > 1.5 * pollGap;
    const at = quantised && prevPoll != null ? (prevPoll + localMs) / 2 : localMs;
    if (this.lastChange && positionMs > this.lastValue) push(this.intervals, at - this.lastChange.atLocalMs, this.historySize);
    this.lastValue = positionMs;
    this.lastChange = { positionMs, atLocalMs: at };
    this.changes++;
  }

  /** Feed an exact (position, time) pair when the platform provides one. */
  exact(positionMs: number, atLocalMs: number): void {
    if (this.lastChange && positionMs > (this.lastValue ?? -Infinity)) push(this.intervals, atLocalMs - this.lastChange.atLocalMs, this.historySize);
    this.lastValue = positionMs;
    this.lastChange = { positionMs, atLocalMs };
    this.changes++;
  }

  /** Forget state after a discontinuity (seek, play, pause, source change). */
  reset(): void {
    this.lastChange = null;
    this.lastValue = null;
    this.lastPollAt = null;
    this.changes = 0;
  }

  get reading(): Reading | null {
    return this.lastChange;
  }

  /** Median observed update period of the player's currentTime (ms), or null before 3 changes. */
  get updatePeriodMs(): number | null {
    return this.intervals.length < 3 ? null : median(this.intervals);
  }

  /** Estimated position now: the last change extrapolated at `rate` while playing. */
  positionAt(localMs: number, playing: boolean, rate = 1): number | null {
    const r = this.lastChange;
    if (!r) return null;
    return playing ? r.positionMs + (localMs - r.atLocalMs) * rate : r.positionMs;
  }
}

function push(xs: number[], v: number, max: number) {
  xs.push(v);
  if (xs.length > max) xs.shift();
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
