// Screen wake lock for an active reading session (Screen Wake Lock API: navigator.wakeLock.request('screen')).
// Wanted only between "session start" (the Get ready tap) and "session end"; never on the bare home page.
// The browser drops the lock whenever the page is hidden; we re-request it when the page is visible again.
// States: 'unsupported' | 'off' | 'requesting' | 'on' | 'lost' (released by the browser while wanted) | 'error'.
// Injectable navigator/document for tests. Support on a given browser is a MEASURED fact, not assumed.
export class WakeLockKeeper {
  constructor({ nav = globalThis.navigator, doc = globalThis.document, onChange = () => {}, log = () => {} } = {}) {
    this.nav = nav; this.doc = doc; this.onChange = onChange; this.log = log;
    this.wanted = false; this.sentinel = null; this.error = null;
    this.state = this.supported ? 'off' : 'unsupported';
    this.onVisibility = () => { if (this.wanted && this.doc.visibilityState === 'visible' && !this.sentinel) this.acquire('visible-again'); };
    doc?.addEventListener?.('visibilitychange', this.onVisibility);
  }
  get supported() { return !!this.nav?.wakeLock?.request; }
  set(state, detail) { this.state = state; this.log(`wakelock-${state}`, detail); this.onChange(state, detail); }
  async enable() { this.wanted = true; if (!this.sentinel) await this.acquire('enable'); }
  async disable() {
    this.wanted = false;
    const s = this.sentinel; this.sentinel = null;
    if (s) { try { await s.release(); } catch {} }
    if (this.supported) this.set('off', 'disable');
  }
  async acquire(why) {
    if (!this.supported) { this.set('unsupported', why); return; }
    if (this.doc?.visibilityState && this.doc.visibilityState !== 'visible') return; // only a visible page may hold it
    this.set('requesting', why);
    try {
      const s = await this.nav.wakeLock.request('screen');
      if (!this.wanted) { try { await s.release(); } catch {} return; }
      this.sentinel = s;
      s.addEventListener?.('release', () => {
        if (this.sentinel !== s) return;
        this.sentinel = null;
        this.set(this.wanted ? 'lost' : 'off', 'released-by-browser');
      });
      this.set('on', why);
    } catch (e) {
      this.error = `${e?.name ?? 'Error'}: ${e?.message ?? e}`;
      this.set('error', this.error);
    }
  }
}
