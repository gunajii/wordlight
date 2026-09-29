// Copied from Earshot (@earshot/vega-sync, commit fe64ce9, packages/vega-sync/src/clock.js; MIT, same author).
// Unchanged except for this header. See docs/REUSED.md.
// @ts-check
/**
 * ClockSync — estimates the mapping from a local monotonic clock to the
 * session server's clock using NTP-style round trips.
 *
 *   client sends at c0 ──► server stamps s ──► client receives at c1
 *   rtt    = c1 - c0
 *   offset = s - (c0 + c1) / 2          (serverTime ≈ localTime + offset)
 *
 * Two error sources and how we handle them:
 *  - Queueing jitter: only the lowest-RTT half of samples is trusted.
 *  - Clock drift (crystals differ by tens to hundreds of ppm): with enough
 *    samples spread over time, we fit offset(t) = a + b·t by least squares,
 *    so the estimate doesn't lag behind a drifting clock.
 *
 * Known limit: the estimate assumes symmetric network paths. Asymmetric paths
 * bias the offset by (up - down) / 2, which round trips alone cannot detect.
 * Earshot handles that with a per-listener calibration offset.
 */
export class ClockSync {
  /**
   * @param {{ window?: number, best?: number, minSamples?: number, minFitSpanMs?: number, maxDriftPpm?: number }} [opts]
   *   window       – how many recent samples to keep
   *   best         – minimum number of lowest-RTT samples used
   *   minSamples   – samples required before `ready` is true
   *   minFitSpanMs – time span needed before fitting drift
   *   maxDriftPpm  – clamp for the fitted drift
   */
  constructor(opts = {}) {
    this.window = opts.window ?? 32;
    this.best = opts.best ?? 5;
    this.minSamples = opts.minSamples ?? 3;
    this.minFitSpanMs = opts.minFitSpanMs ?? 10000;
    this.maxDrift = (opts.maxDriftPpm ?? 500) * 1e-6;
    /** @type {{ rtt: number, offset: number, at: number }[]} */
    this.samples = [];
    /** offset(local) = a + b * (local - tRef) */
    this.fit = { a: 0, b: 0, tRef: 0 };
  }

  /**
   * Record one round trip. Times are in milliseconds.
   * @param {number} c0 local send time
   * @param {number} s  server time stamped in the reply
   * @param {number} c1 local receive time
   * @returns {boolean} whether the sample was accepted
   */
  addSample(c0, s, c1) {
    const rtt = c1 - c0;
    if (!Number.isFinite(rtt) || rtt < 0 || !Number.isFinite(s)) return false;
    this.samples.push({ rtt, offset: s - (c0 + c1) / 2, at: (c0 + c1) / 2 });
    if (this.samples.length > this.window) this.samples.shift();
    this._recompute();
    return true;
  }

  _recompute() {
    const n = this.samples.length;
    const k = Math.min(n, Math.max(this.best, Math.ceil(n / 2)));
    const chosen = [...this.samples].sort((x, y) => x.rtt - y.rtt).slice(0, k);
    const tRef = this.samples[n - 1].at;
    const times = chosen.map((x) => x.at);
    const span = Math.max(...times) - Math.min(...times);
    if (chosen.length >= 6 && span >= this.minFitSpanMs) {
      // least squares: offset = a + b (t - tRef)
      let st = 0, so = 0;
      for (const x of chosen) { st += x.at - tRef; so += x.offset; }
      const mt = st / k, mo = so / k;
      let num = 0, den = 0;
      for (const x of chosen) { const dt = x.at - tRef - mt; num += dt * (x.offset - mo); den += dt * dt; }
      const b = Math.max(-this.maxDrift, Math.min(this.maxDrift, den > 0 ? num / den : 0));
      this.fit = { a: mo - b * mt, b, tRef };
    } else {
      const offsets = chosen.map((x) => x.offset).sort((x, y) => x - y);
      this.fit = { a: offsets[Math.floor((offsets.length - 1) / 2)] ?? 0, b: 0, tRef };
    }
  }

  /** True once enough samples exist to trust the offset. */
  get ready() {
    return this.samples.length >= this.minSamples;
  }

  /** Offset (ms) at local time `localMs` (defaults to the latest sample). */
  offsetAt(localMs = this.fit.tRef) {
    return this.fit.a + this.fit.b * (localMs - this.fit.tRef);
  }

  /** Offset at the latest sample (ms): serverTime ≈ localTime + offset. */
  get offset() {
    return this.offsetAt();
  }

  /** Fitted relative drift of the two clocks, in ppm. */
  get driftPpm() {
    return this.fit.b * 1e6;
  }

  /** Lowest RTT in the window (ms); the offset error is bounded by ~rtt/2 for symmetric paths. */
  get minRtt() {
    return this.samples.reduce((m, x) => Math.min(m, x.rtt), Infinity);
  }

  /** @param {number} localMs */
  toServer(localMs) {
    return localMs + this.offsetAt(localMs);
  }

  /** @param {number} serverMs */
  toLocal(serverMs) {
    const { a, b, tRef } = this.fit;
    return (serverMs - a + b * tRef) / (1 + b);
  }

  /** Forget all samples (e.g. after reconnecting, when the path may have changed). */
  reset() {
    this.samples = [];
    this.fit = { a: 0, b: 0, tRef: 0 };
  }
}
