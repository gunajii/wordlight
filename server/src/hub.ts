// SessionHub — pairs one TV with the family's phones and routes live events.
// Transport-agnostic (the WebSocket server wires it up; tests use fake connections).
// Design adapted from Earshot's SessionHub (same author, commit fe64ce9): per-session state,
// hello/welcome, ping/pong for clock sync, a telemetry timeline, rejoin detection.
//
// Control messages use `t` (hello, ping, telemetry), app events use `type` (see shared-protocol).
import { validateEvent, mayClientSend, type Reader, type TurnStart, type WordLightEvent, type AudioFrame } from '@wordlight/shared-protocol';

export interface Conn { send: (msg: unknown) => void }
interface ConnInfo { role: 'tv' | 'phone'; sessionId: string; clientId: string }

export interface ActiveTurn {
  turn: TurnStart; phoneClientId: string; startedAtServerMs: number;
  /** 'tv' = started by the TV; 'test' = server-originated S3 test turn */
  origin: 'tv' | 'test';
  audioTag: number; chunkMs: number; detectClicks: boolean;
  staleFrames: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Hard cap on how long any microphone turn may run (privacy): a turn nobody ends still closes the mic. */
export const TURN_MAX_MS = { tv: 90_000, test: 11 * 60_000 };
/** A phone reporting a live microphone track outside its turn for longer than this is a privacy violation. */
export const MIC_GRACE_MS = 2000;
export const CHUNK_MS_ALLOWED = [20, 40, 60, 100];

export interface PhoneStatus { micLive: number; turnId: string | null; ctx: string | null; visible: string | null; atServerMs: number }
export interface MicViolation { clientId: string; atServerMs: number; micLive: number; turnId: string | null; sinceTurnEndMs: number | null }

/** The reading pipeline plugs in here (Transcribe + reading engine). */
export interface TurnDriver {
  start(session: Session, t: ActiveTurn): void;
  audio(session: Session, t: ActiveTurn, frame: AudioFrame): void;
  help(session: Session, t: ActiveTurn, kind: 'next-word' | 'line'): void;
  stop(session: Session, t: ActiveTurn, reason: string): void;
}

export interface Session {
  id: string;
  createdAt: number;
  tv: Conn | null;
  phones: Map<string, Conn>;
  readers: Map<string, Reader & { phoneClientId: string }>;
  turn: ActiveTurn | null;
  seen: Set<string>;
  telemetry: Record<string, unknown>[];
  /** S3 test session: phones may request test turns */
  testMode: boolean;
  nextAudioTag: number;
  /** latest clock estimate each phone reported (server ≈ phone + offsetMs) */
  clocks: Map<string, { offsetMs: number; minRttMs: number; atServerMs: number }>;
  phoneStatus: Map<string, PhoneStatus>;
  lastTurnEnd: { clientId: string; atServerMs: number; offSeen?: boolean } | null;
  micAudit: { statusReports: number; violations: MicViolation[]; liveDuringTurnReports: number; offDuringTurnReports: number;
    /** per ended turn: ms from the server ending it to the phone's first report of 0 live mic tracks */
    offAfterEndMs: number[] };
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export class SessionHub {
  readonly sessions = new Map<string, Session>();
  readonly info = new WeakMap<Conn, ConnInfo>();
  driver: TurnDriver | null = null;
  private readonly o: { now: () => number; random?: () => number; telemetryLimit?: number };
  constructor(o: { now: () => number; random?: () => number; telemetryLimit?: number }) {
    this.o = o;
  }

  createSession(o: { testMode?: boolean } = {}): string {
    const rnd = this.o.random ?? Math.random;
    let id: string;
    do {
      id = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(rnd() * CODE_ALPHABET.length)]).join('');
    } while (this.sessions.has(id));
    this.sessions.set(id, {
      id, createdAt: this.o.now(), tv: null, phones: new Map(), readers: new Map(), turn: null, seen: new Set(), telemetry: [],
      testMode: !!o.testMode, nextAudioTag: 1, clocks: new Map(), phoneStatus: new Map(), lastTurnEnd: null,
      micAudit: { statusReports: 0, violations: [], liveDuringTurnReports: 0, offDuringTurnReports: 0, offAfterEndMs: [] },
    });
    return id;
  }

  get(id: unknown): Session | undefined {
    return this.sessions.get(String(id ?? '').toUpperCase());
  }

  handle(conn: Conn, msg: any): void {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'ping') return conn.send({ t: 'pong', id: msg.id, c0: msg.c0, s: this.o.now() });
    if (msg.t === 'hello') return this.hello(conn, msg);
    const info = this.info.get(conn);
    const s = info && this.get(info.sessionId);
    if (!info || !s) return conn.send({ t: 'error', code: 'no-hello', message: 'send hello first' });
    if (msg.t === 'telemetry') return this.log(s, { ...msg, t: undefined, kind: msg.kind ?? 'telemetry', clientId: info.clientId, role: info.role });
    if (info.role === 'phone' && msg.t === 'clock.report') return this.clockReport(s, info.clientId, msg);
    if (info.role === 'phone' && msg.t === 'phone.status') return this.phoneStatus(s, info.clientId, msg);
    if (info.role === 'phone' && msg.t === 's3.turn') return this.s3TurnRequest(s, conn, info.clientId, msg);
    if (info.role === 'phone' && msg.t === 'phone.events') return this.phoneEvents(s, info.clientId, msg);
    const v = validateEvent({ ...msg, sessionId: s.id });
    if (!v.ok) return conn.send({ t: 'error', code: 'invalid', message: v.error });
    if (!mayClientSend(info.role, v.event.type)) return conn.send({ t: 'error', code: 'not-allowed', message: `${info.role} may not send ${v.event.type}` });
    const e = { ...v.event, sessionId: s.id, serverMs: this.o.now() } as WordLightEvent;
    this.log(s, { kind: 'event', type: e.type, from: info.role, clientId: info.clientId, turnId: (e as any).turnId, sentAtMs: (e as any).sentAtMs });
    switch (e.type) {
      case 'reader.save': {
        s.readers.set(e.reader.readerId, { ...e.reader, phoneClientId: info.clientId });
        this.toTv(s, { t: 'readers', readers: this.readerList(s), serverMs: this.o.now() });
        conn.send({ t: 'reader.saved', readerId: e.reader.readerId });
        return;
      }
      case 'turn.start': {
        if (s.turn?.turn.turnId === e.turnId) return; // duplicate: idempotent
        const r = s.readers.get(e.readerId);
        if (!r) return conn.send({ t: 'error', code: 'unknown-reader', message: `no reader ${e.readerId} in this session`, turnId: e.turnId });
        const phone = s.phones.get(r.phoneClientId);
        if (!phone) return conn.send({ t: 'error', code: 'reader-offline', message: `${r.firstName}'s phone is not connected`, turnId: e.turnId });
        this.beginTurn(s, e, r.phoneClientId, phone, { origin: 'tv', chunkMs: 40, detectClicks: false, maxMs: TURN_MAX_MS.tv });
        return;
      }
      case 'turn.help': {
        if (!s.turn || s.turn.turn.turnId !== e.turnId) return conn.send({ t: 'error', code: 'stale-turn', message: 'no such active turn', turnId: e.turnId });
        this.driver?.help(s, s.turn, e.kind);
        return;
      }
      case 'turn.cancel': {
        if (!s.turn || s.turn.turn.turnId !== e.turnId) return; // already over: nothing to do
        this.endTurn(s, e.reason);
        return;
      }
      case 'mic.state': {
        this.log(s, { kind: 'mic-state', clientId: info.clientId, turnId: e.turnId, state: e.state, detail: typeof e.detail === 'string' ? e.detail.slice(0, 500) : undefined });
        if (!s.turn || s.turn.turn.turnId !== e.turnId) return;
        this.toTv(s, e);
        // The phone gave up the microphone for this turn (hidden, stale socket, denied…): the turn cannot go on.
        if (s.turn.phoneClientId === info.clientId && (e.state === 'closed' || e.state === 'denied' || e.state === 'error')) this.endTurn(s, e.state === 'closed' ? 'phone-lost' : 'error');
        return;
      }
    }
  }

  /** Binary audio from a phone. Only the phone of the active turn's reader is listened to. */
  audio(conn: Conn, frame: AudioFrame): void {
    const info = this.info.get(conn);
    const s = info && this.get(info.sessionId);
    if (!s?.turn || info!.clientId !== s.turn.phoneClientId) return;
    if ((frame.tag ?? 0) !== s.turn.audioTag) { s.turn.staleFrames++; return; } // late frame of an earlier turn
    this.driver?.audio(s, s.turn, frame);
  }

  /** Called by the turn driver: send a matcher event to the TV (and phone where useful). */
  emit(s: Session, e: WordLightEvent, alsoPhone = false): void {
    const ev = { ...e, sessionId: s.id, serverMs: this.o.now() };
    this.log(s, { kind: 'event', type: ev.type, from: 'server', turnId: (ev as any).turnId, index: (ev as any).index });
    this.toTv(s, ev);
    if (alsoPhone && s.turn) s.phones.get(s.turn.phoneClientId)?.send(ev);
    const active = s.turn;
    if (ev.type === 'line.done' && active && active.turn.turnId === (ev as any).turnId) {
      s.phones.get(active.phoneClientId)?.send(ev);
      this.clearTurn(s, active);
      this.driver?.stop(s, active, 'done');
    }
  }

  disconnect(conn: Conn, reason: 'closed' | 'timeout' = 'closed', detail: { code?: number } = {}): void {
    const info = this.info.get(conn);
    if (!info) return;
    this.info.delete(conn);
    const s = this.get(info.sessionId);
    if (!s) return;
    if (info.role === 'tv') {
      if (s.tv === conn) { s.tv = null; this.log(s, { kind: 'tv-leave', reason }); }
      return;
    }
    if (s.phones.get(info.clientId) !== conn) { this.log(s, { kind: 'old-socket-closed', clientId: info.clientId, reason, code: detail.code }); return; } // an old socket closing late
    s.phones.delete(info.clientId);
    this.log(s, { kind: 'leave', clientId: info.clientId, reason, code: detail.code, inTurn: s.turn?.phoneClientId === info.clientId });
    for (const r of s.readers.values()) {
      if (r.phoneClientId === info.clientId) this.toTv(s, { type: 'reader.status', sessionId: s.id, readerId: r.readerId, state: 'disconnected', serverMs: this.o.now() });
    }
    // Never leave the TV stuck in a reading turn whose microphone just vanished.
    if (s.turn?.phoneClientId === info.clientId) this.endTurn(s, 'phone-lost');
  }

  /** Start a turn (TV- or server-originated): assign its audio tag, forward it to the phone, arm the cap. */
  beginTurn(s: Session, e: TurnStart, phoneClientId: string, phone: Conn, o: { origin: 'tv' | 'test'; chunkMs: number; detectClicks: boolean; maxMs: number }): ActiveTurn {
    if (s.turn) this.endTurn(s, 'error'); // a new turn replaces a stuck one
    const audioTag = s.nextAudioTag;
    s.nextAudioTag = (s.nextAudioTag % 0xffff) + 1;
    const turn: TurnStart = { ...e, audioTag, chunkMs: o.chunkMs };
    const t: ActiveTurn = { turn, phoneClientId, startedAtServerMs: e.serverMs ?? this.o.now(), origin: o.origin, audioTag, chunkMs: o.chunkMs, detectClicks: o.detectClicks, staleFrames: 0, timer: null };
    t.timer = setTimeout(() => { if (s.turn === t) this.endTurn(s, 'timeout'); }, o.maxMs);
    (t.timer as any).unref?.();
    s.turn = t;
    phone.send(turn);
    this.log(s, { kind: 'turn-start', turnId: turn.turnId, origin: o.origin, audioTag, chunkMs: o.chunkMs, clientId: phoneClientId });
    this.driver?.start(s, t);
    return t;
  }

  /** S3: a server-originated test turn for the phone `clientId` (its saved, consented reader). */
  startTestTurn(s: Session, clientId: string, o: { chunkMs?: number; durationMs?: number; detectClicks?: boolean } = {}): { ok: true; turnId: string } | { ok: false; error: string } {
    if (!s.testMode) return { ok: false, error: 'not-a-test-session' };
    const phone = s.phones.get(clientId);
    if (!phone) return { ok: false, error: 'phone-offline' };
    const reader = [...s.readers.values()].find((r) => r.phoneClientId === clientId);
    if (!reader) return { ok: false, error: 'no-consented-reader' };
    const chunkMs = CHUNK_MS_ALLOWED.includes(o.chunkMs ?? 40) ? (o.chunkMs ?? 40) : 40;
    const maxMs = Math.max(1000, Math.min(TURN_MAX_MS.test, o.durationMs ?? 60_000));
    const turnId = `s3-${s.id}-${s.nextAudioTag}-${Math.round(this.o.now()).toString(36)}`;
    const e: TurnStart = { type: 'turn.start', sessionId: s.id, turnId, readerId: reader.readerId, storyId: 's3-mic-test', page: 0, line: 0, words: ['microphone', 'test'], lang: reader.lang, serverMs: this.o.now() };
    this.beginTurn(s, e, clientId, phone, { origin: 'test', chunkMs, detectClicks: !!o.detectClicks, maxMs });
    return { ok: true, turnId };
  }

  /** End the active turn (any origin). Public for the S3 test controller. */
  endActiveTurn(s: Session, reason: 'skipped' | 'exit' | 'error' | 'timeout'): boolean {
    if (!s.turn) return false;
    this.endTurn(s, reason);
    return true;
  }

  firstPhoneWithReader(s: Session): string | null {
    for (const r of s.readers.values()) if (s.phones.has(r.phoneClientId)) return r.phoneClientId;
    return null;
  }

  private clearTurn(s: Session, t: ActiveTurn) {
    if (t.timer) clearTimeout(t.timer);
    if (s.turn === t) s.turn = null;
    s.lastTurnEnd = { clientId: t.phoneClientId, atServerMs: this.o.now() };
  }

  private clockReport(s: Session, clientId: string, m: any) {
    if (typeof m.offsetMs !== 'number' || !Number.isFinite(m.offsetMs) || typeof m.minRttMs !== 'number' || !Number.isFinite(m.minRttMs)) return;
    s.clocks.set(clientId, { offsetMs: m.offsetMs, minRttMs: m.minRttMs, atServerMs: this.o.now() });
  }

  /** Privacy audit: the phone reports how many of its microphone tracks are live (MediaStreamTrack.readyState). */
  private phoneStatus(s: Session, clientId: string, m: any) {
    const now = this.o.now();
    const micLive = Number.isInteger(m.micLive) && m.micLive >= 0 ? m.micLive : 0;
    const st: PhoneStatus = { micLive, turnId: typeof m.turnId === 'string' ? m.turnId.slice(0, 64) : null, ctx: typeof m.ctx === 'string' ? m.ctx.slice(0, 16) : null, visible: typeof m.visible === 'string' ? m.visible.slice(0, 16) : null, atServerMs: now };
    s.phoneStatus.set(clientId, st);
    s.micAudit.statusReports++;
    const inTurn = s.turn?.phoneClientId === clientId;
    if (inTurn) { if (micLive > 0) s.micAudit.liveDuringTurnReports++; else s.micAudit.offDuringTurnReports++; return; }
    if (micLive === 0 && s.lastTurnEnd?.clientId === clientId && !s.lastTurnEnd.offSeen) {
      s.lastTurnEnd.offSeen = true;
      if (s.micAudit.offAfterEndMs.length < 1000) s.micAudit.offAfterEndMs.push(Math.round(now - s.lastTurnEnd.atServerMs));
    }
    if (micLive > 0) {
      const since = s.lastTurnEnd?.clientId === clientId ? now - s.lastTurnEnd.atServerMs : null;
      if (since === null || since > MIC_GRACE_MS) {
        const v: MicViolation = { clientId, atServerMs: now, micLive, turnId: st.turnId, sinceTurnEndMs: since };
        if (s.micAudit.violations.length < 200) s.micAudit.violations.push(v);
        this.log(s, { kind: 'mic-violation', ...v });
      }
    }
  }

  /** Page lifecycle diagnostics from a phone (visibility, freeze/resume, online/offline, socket close codes, mic and
   *  wake-lock changes). Events recorded while offline arrive late with their own phone timestamps. Primitive
   *  fields only, length-capped: never audio, never free text beyond short reasons. */
  private phoneEvents(s: Session, clientId: string, m: any) {
    if (!Array.isArray(m.events)) return;
    for (const e of m.events.slice(0, 100)) {
      if (!e || typeof e !== 'object' || typeof e.k !== 'string') continue;
      const row: Record<string, unknown> = { kind: 'phone-event', clientId };
      for (const [k, v] of Object.entries(e).slice(0, 12)) {
        if (typeof v === 'number' && Number.isFinite(v)) row[`p_${k}`] = v;
        else if (typeof v === 'boolean') row[`p_${k}`] = v;
        else if (typeof v === 'string') row[`p_${k}`] = v.slice(0, 120);
      }
      this.log(s, row);
    }
  }

  private s3TurnRequest(s: Session, conn: Conn, clientId: string, m: any) {
    if (m.action === 'start') {
      const r = this.startTestTurn(s, clientId, { chunkMs: m.chunkMs, durationMs: m.durationMs, detectClicks: false });
      if (!r.ok) conn.send({ t: 'error', code: r.error, message: `test turn refused: ${r.error}` });
    } else if (m.action === 'end' && s.turn?.phoneClientId === clientId) this.endTurn(s, 'exit');
  }

  private endTurn(s: Session, reason: 'skipped' | 'exit' | 'phone-lost' | 'error' | 'timeout') {
    const t = s.turn!;
    this.clearTurn(s, t);
    this.driver?.stop(s, t, reason);
    const ev = { type: 'turn.cancel', sessionId: s.id, turnId: t.turn.turnId, readerId: t.turn.readerId, reason, serverMs: this.o.now() };
    this.toTv(s, ev);
    s.phones.get(t.phoneClientId)?.send(ev);
    this.log(s, { kind: 'turn-end', turnId: t.turn.turnId, reason });
  }

  private hello(conn: Conn, msg: any) {
    const s = this.get(msg.sessionId);
    if (!s) return conn.send({ t: 'error', code: 'no-session', message: `session ${msg.sessionId} not found` });
    const role: 'tv' | 'phone' = msg.role === 'tv' ? 'tv' : 'phone';
    const clientId = String(msg.clientId || '').slice(0, 64);
    this.info.set(conn, { role, sessionId: s.id, clientId });
    if (role === 'tv') {
      s.tv = conn;
    } else {
      const rejoin = s.seen.has(clientId);
      s.seen.add(clientId);
      // A new socket may be a new page (reload: performance.now() restarts at 0), so the old clock estimate is void.
      // Without this, run 2 measured one chunk after an Android reload at 168 s "latency".
      s.clocks.delete(clientId);
      s.phones.set(clientId, conn);
      this.log(s, { kind: rejoin ? 'rejoin' : 'join', clientId });
      for (const r of s.readers.values()) {
        if (r.phoneClientId === clientId) this.toTv(s, { type: 'reader.status', sessionId: s.id, readerId: r.readerId, state: 'connected', serverMs: this.o.now() });
      }
    }
    conn.send({ t: 'welcome', sessionId: s.id, role, readers: this.readerList(s), serverMs: this.o.now() });
    // A phone that reconnects while it owns the active turn lost its stream (the page stops the microphone when
    // its socket drops). Never resume that turn blindly: end it, so the TV decides whether to start a new one.
    if (role === 'phone' && s.turn?.phoneClientId === clientId) { this.log(s, { kind: 'turn-lost-by-rejoin', clientId, turnId: s.turn.turn.turnId }); this.endTurn(s, 'phone-lost'); }
  }

  private readerList(s: Session) {
    return [...s.readers.values()].map(({ phoneClientId, ...r }) => ({ ...r, online: s.phones.has(phoneClientId) }));
  }

  private toTv(s: Session, msg: unknown) {
    s.tv?.send(msg);
  }

  log(s: Session, row: Record<string, unknown>) {
    s.telemetry.push({ ...row, serverMs: this.o.now() });
    const limit = this.o.telemetryLimit ?? 50_000;
    if (s.telemetry.length > limit) s.telemetry.splice(0, s.telemetry.length - limit);
  }
}
