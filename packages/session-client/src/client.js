// Copied from Earshot (@earshot/vega-sync, commit fe64ce9, packages/vega-sync/src/client.js; MIT, same author).
// Unchanged except for this header. See docs/REUSED.md.
// @ts-check
import { ClockPinger } from './pinger.js';

/**
 * SyncClient — one WebSocket connection to the session server, used by both
 * the TV (role 'tv') and phones (role 'viewer').
 *
 * Handles: hello/handshake, clock pings, automatic reconnect with backoff.
 * On every (re)connect the clock estimate is reset and re-measured with a
 * burst, because the network path (or the server itself) may have changed.
 *
 * Works with the browser / React Native global `WebSocket`, or any object
 * implementing onopen/onmessage/onclose/onerror + send/close (the simulator
 * passes one that runs over a virtual network).
 */
export class SyncClient {
  /**
   * @param {Object} o
   * @param {string} o.url              ws:// or wss:// URL of the server's /ws endpoint
   * @param {string} o.sessionId
   * @param {'tv' | 'viewer'} o.role
   * @param {string} o.clientId         stable per device/tab; reconnects reuse it
   * @param {string} [o.name]
   * @param {import('./clock.js').ClockSync} o.clock
   * @param {any} [o.WebSocketImpl]
   * @param {() => number} o.now
   * @param {(fn: () => void, ms: number) => any} [o.setTimeout]
   * @param {(h: any) => void} [o.clearTimeout]
   * @param {(msg: any) => void} [o.onMessage]
   * @param {(status: 'connecting' | 'open' | 'stale' | 'closed') => void} [o.onStatus]
   * @param {() => number} [o.random]
   * @param {number} [o.connectTimeoutMs] give up on a connection attempt that hasn't opened (default 2500).
   *   Without it, a connect over a dead route (e.g. Wi-Fi off, LAN IP tried over cellular) can hang
   *   for a minute or more until TCP gives up, and the retry schedule never runs.
   * @param {number} [o.staleMs] after this long without any message, report status 'stale' (default 3000).
   *   The server answers a ping every second, so silence means the link is in trouble even if the
   *   OS hasn't closed the socket. The socket is KEPT: after a short outage it often just resumes.
   * @param {number} [o.deadMs] after this long without any message, abandon the socket and reconnect
   *   (default 15000). Simulation showed killing a stale socket immediately turned a recoverable
   *   20 s outage into 16 s of silence.
   */
  constructor(o) {
    this.o = o;
    this.WS = o.WebSocketImpl ?? globalThis.WebSocket;
    this._setTimeout = o.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this._clearTimeout = o.clearTimeout ?? ((h) => clearTimeout(h));
    this.random = o.random ?? Math.random;
    this.ws = null;
    this.status = 'closed';
    this.backoffMs = 250;
    this.reconnectTimer = null;
    this.stopped = true;
    this.connects = 0;
    this.connectTimeoutMs = o.connectTimeoutMs ?? 2500;
    this.staleMs = o.staleMs ?? 3000;
    this.deadMs = o.deadMs ?? 15000;
    this.lastRxAt = 0;
    this.watchdog = null;
    /** counters for diagnostics */
    this.drops = { connectTimeout: 0, stale: 0, dead: 0, closed: 0 };
    this.pinger = new ClockPinger({
      clock: o.clock,
      now: o.now,
      send: (m) => this.send(m),
      setTimeout: this._setTimeout,
      clearTimeout: this._clearTimeout,
    });
  }

  start() {
    this.stopped = false;
    this._connect();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer != null) this._clearTimeout(this.reconnectTimer);
    this.pinger.stop();
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {}
    this._setStatus('closed');
  }

  /** @param {any} msg */
  send(msg) {
    const ws = this.ws;
    if (!ws || (this.status !== 'open' && this.status !== 'stale')) return false;
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  _setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.o.onStatus?.(/** @type {any} */ (s));
  }

  _connect() {
    if (this.stopped) return;
    this._setStatus('connecting');
    let ws;
    try {
      // Identity in the URL too (the hello message stays authoritative): lets the server refuse a
      // connection before it opens, e.g. the test lab's emulated Wi-Fi outage.
      const u = this.o.url;
      ws = new this.WS(`${u}${u.includes('?') ? '&' : '?'}s=${encodeURIComponent(this.o.sessionId)}&c=${encodeURIComponent(this.o.clientId)}`);
    } catch {
      return this._scheduleReconnect();
    }
    this.ws = ws;
    const connectTimer = this._setTimeout(() => {
      if (this.ws !== ws || this.status === 'open') return;
      this.drops.connectTimeout++;
      this.backoffMs = 250; // the timeout already paced this attempt; retry promptly
      this._abandon(ws);
    }, this.connectTimeoutMs);
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this._clearTimeout(connectTimer);
      this.connects++;
      this.backoffMs = 250;
      this.lastRxAt = this.o.now();
      // hello goes out before listeners hear 'open': anything they send from their status
      // handler (e.g. queued telemetry) would otherwise reach the server unidentified and be dropped.
      try {
        ws.send(JSON.stringify({ t: 'hello', role: this.o.role, sessionId: this.o.sessionId, clientId: this.o.clientId, name: this.o.name, v: 1 }));
      } catch {}
      this.o.clock.reset();
      this._setStatus('open');
      this._armWatchdog(ws);
      this.pinger.start();
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.lastRxAt = this.o.now();
      if (this.status === 'stale') this._setStatus('open');
      let msg;
      try {
        msg = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
      } catch {
        return;
      }
      if (msg?.t === 'pong') this.pinger.onPong(msg);
      else this.o.onMessage?.(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this._clearTimeout(connectTimer);
      this.drops.closed++;
      this.ws = null;
      this.pinger.stop();
      this._scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  /** Drop a socket we no longer trust and reconnect. */
  _abandon(ws) {
    if (this.ws !== ws) return;
    this.ws = null;
    this.pinger.stop();
    try {
      ws.close();
    } catch {}
    this._scheduleReconnect();
  }

  _armWatchdog(ws) {
    if (this.watchdog != null) this._clearTimeout(this.watchdog);
    const check = () => {
      if (this.ws !== ws || (this.status !== 'open' && this.status !== 'stale')) return;
      const silent = this.o.now() - this.lastRxAt;
      if (silent > this.deadMs) {
        this.drops.dead++;
        this.backoffMs = 250;
        return this._abandon(ws);
      }
      if (silent > this.staleMs && this.status === 'open') {
        this.drops.stale++;
        this._setStatus('stale');
      }
      this.watchdog = this._setTimeout(check, 500);
    };
    this.watchdog = this._setTimeout(check, 1000);
  }

  _scheduleReconnect() {
    if (this.stopped) return;
    this._setStatus('connecting');
    const delay = this.backoffMs * (0.75 + this.random() * 0.5);
    this.backoffMs = Math.min(this.backoffMs * 2, 2000); // LAN: retrying every 2 s is cheap, and must beat the follower's offline grace
    this.reconnectTimer = this._setTimeout(() => this._connect(), delay);
  }
}
