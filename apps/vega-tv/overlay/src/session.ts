// The TV's live session: creates a session on the WordLight server, keeps the WebSocket (Earshot's SyncClient:
// hello, clock sync, reconnect), tracks paired readers, and fans incoming messages out to the screens.
import { SyncClient, ClockSync } from './vendor/session-client/index';
import { log, withTimeout } from './net';

declare const performance: { now(): number };
export type ReaderInfo = { readerId: string; firstName: string; age: number; lang: string; online: boolean };
type Listener = (m: any) => void;

export class TvSession {
  id = ''; joinUrl = ''; status = 'connecting'; base = '';
  readers: ReaderInfo[] = [];
  private client: any = null;
  private clock = new ClockSync();
  private listeners = new Set<Listener>();
  private onChange: () => void;
  constructor(onChange: () => void) { this.onChange = onChange; }

  async start(base: string) {
    this.base = base;
    const r = await (await withTimeout(fetch(`${base}/api/sessions`, { method: 'POST' }), 6000)).json();
    this.id = r.sessionId; this.joinUrl = r.joinUrl;
    log(`session ${this.id} join ${this.joinUrl}`);
    this.client = new SyncClient({
      url: base.replace(/^http/, 'ws') + '/ws', sessionId: this.id, role: 'tv', clientId: 'tv-' + this.id, clock: this.clock,
      now: () => performance.now(),
      onStatus: (st: string) => { this.status = st; this.onChange(); },
      onMessage: (m: any) => this.receive(m),
    });
    this.client.start();
    this.onChange();
  }

  private receive(m: any) {
    if (m?.t === 'welcome' || m?.t === 'readers') { this.readers = m.readers ?? []; this.onChange(); }
    if (m?.type === 'reader.status') { this.readers = this.readers.map((r) => (r.readerId === m.readerId ? { ...r, online: m.state === 'connected' } : r)); this.onChange(); }
    for (const l of this.listeners) l(m);
  }

  on(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  send(m: unknown) { return this.client?.send(m) ?? false; }
  /** this TV's performance.now() mapped to the server clock (null until the clock has samples) */
  serverNow(): number | null { return this.clock.ready ? this.clock.toServer(performance.now()) : null; }
  onlineReader(): ReaderInfo | null { return this.readers.find((r) => r.online) ?? null; }
}
