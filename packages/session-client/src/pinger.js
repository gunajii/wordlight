// Copied from Earshot (@earshot/vega-sync, commit fe64ce9, packages/vega-sync/src/pinger.js; MIT, same author).
// Unchanged except for this header. See docs/REUSED.md.
// @ts-check
/**
 * ClockPinger — schedules NTP-style pings and feeds replies into a ClockSync.
 * Transport-agnostic: you give it `send` and call `onPong` when replies arrive.
 * Timers are injectable so the simulator can run it in virtual time.
 *
 * Schedule: a burst of `burstCount` pings on start (fast convergence after a
 * connect/reconnect), then one ping every `intervalMs` (tracks clock drift).
 */
export class ClockPinger {
  /**
   * @param {Object} o
   * @param {import('./clock.js').ClockSync} o.clock
   * @param {(msg: { t: 'ping', id: number, c0: number }) => void} o.send
   * @param {() => number} o.now
   * @param {(fn: () => void, ms: number) => any} [o.setTimeout]
   * @param {(h: any) => void} [o.clearTimeout]
   * @param {number} [o.burstCount]
   * @param {number} [o.burstSpacingMs]
   * @param {number} [o.intervalMs]
   * @param {number} [o.timeoutMs] replies older than this are discarded
   */
  constructor(o) {
    this.clock = o.clock;
    this.send = o.send;
    this.now = o.now;
    this._setTimeout = o.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this._clearTimeout = o.clearTimeout ?? ((h) => clearTimeout(h));
    this.burstCount = o.burstCount ?? 20;
    this.burstSpacingMs = o.burstSpacingMs ?? 40;
    this.intervalMs = o.intervalMs ?? 1000;
    this.timeoutMs = o.timeoutMs ?? 3000;
    this.nextId = 1;
    /** @type {Map<number, number>} id -> c0 */
    this.pending = new Map();
    this.timer = null;
    this.running = false;
  }

  start() {
    this.stop();
    this.running = true;
    let sent = 0;
    const burst = () => {
      if (!this.running) return;
      this._ping();
      sent++;
      this.timer = this._setTimeout(sent < this.burstCount ? burst : steady, sent < this.burstCount ? this.burstSpacingMs : this.intervalMs);
    };
    const steady = () => {
      if (!this.running) return;
      this._ping();
      this.timer = this._setTimeout(steady, this.intervalMs);
    };
    burst();
  }

  stop() {
    this.running = false;
    if (this.timer != null) this._clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
  }

  _ping() {
    const id = this.nextId++;
    const c0 = this.now();
    this.pending.set(id, c0);
    // Drop stale pendings so the map can't grow without bound.
    for (const [pid, t] of this.pending) if (c0 - t > this.timeoutMs) this.pending.delete(pid);
    this.send({ t: 'ping', id, c0 });
  }

  /**
   * @param {{ id: number, c0: number, s: number }} msg
   * @returns {boolean} accepted
   */
  onPong(msg) {
    const c0 = this.pending.get(msg.id);
    if (c0 === undefined || c0 !== msg.c0) return false; // unknown, duplicate or stale
    this.pending.delete(msg.id);
    const c1 = this.now();
    if (c1 - c0 > this.timeoutMs) return false;
    return this.clock.addSample(c0, msg.s, c1);
  }
}
