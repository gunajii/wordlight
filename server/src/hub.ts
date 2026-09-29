// SessionHub — pairs one TV with the family's phones and routes live events.
// Transport-agnostic (the WebSocket server wires it up; tests use fake connections).
// Design adapted from Earshot's SessionHub (same author, commit fe64ce9): per-session state,
// hello/welcome, ping/pong for clock sync, a telemetry timeline, rejoin detection.
//
// Control messages use `t` (hello, ping, telemetry), app events use `type` (see shared-protocol).
import { validateEvent, mayClientSend, type Reader, type TurnStart, type WordLightEvent, type AudioFrame } from '@wordlight/shared-protocol';

export interface Conn { send: (msg: unknown) => void }
interface ConnInfo { role: 'tv' | 'phone'; sessionId: string; clientId: string }

export interface ActiveTurn { turn: TurnStart; phoneClientId: string; startedAtServerMs: number }

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

  createSession(): string {
    const rnd = this.o.random ?? Math.random;
    let id: string;
    do {
      id = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(rnd() * CODE_ALPHABET.length)]).join('');
    } while (this.sessions.has(id));
    this.sessions.set(id, { id, createdAt: this.o.now(), tv: null, phones: new Map(), readers: new Map(), turn: null, seen: new Set(), telemetry: [] });
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
        if (s.turn) this.endTurn(s, 'error'); // a new turn replaces a stuck one
        s.turn = { turn: e, phoneClientId: r.phoneClientId, startedAtServerMs: e.serverMs! };
        phone.send(e);
        this.driver?.start(s, s.turn);
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
        if (!s.turn || s.turn.turn.turnId !== e.turnId) return;
        this.toTv(s, e);
        return;
      }
    }
  }

  /** Binary audio from a phone. Only the phone of the active turn's reader is listened to. */
  audio(conn: Conn, frame: AudioFrame): void {
    const info = this.info.get(conn);
    const s = info && this.get(info.sessionId);
    if (!s?.turn || info!.clientId !== s.turn.phoneClientId) return;
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
      s.turn = null;
      this.driver?.stop(s, active, 'done');
    }
  }

  disconnect(conn: Conn, reason: 'closed' | 'timeout' = 'closed'): void {
    const info = this.info.get(conn);
    if (!info) return;
    this.info.delete(conn);
    const s = this.get(info.sessionId);
    if (!s) return;
    if (info.role === 'tv') {
      if (s.tv === conn) { s.tv = null; this.log(s, { kind: 'tv-leave', reason }); }
      return;
    }
    if (s.phones.get(info.clientId) !== conn) return; // an old socket closing late
    s.phones.delete(info.clientId);
    this.log(s, { kind: 'leave', clientId: info.clientId, reason });
    for (const r of s.readers.values()) {
      if (r.phoneClientId === info.clientId) this.toTv(s, { type: 'reader.status', sessionId: s.id, readerId: r.readerId, state: 'disconnected', serverMs: this.o.now() });
    }
    // Never leave the TV stuck in a reading turn whose microphone just vanished.
    if (s.turn?.phoneClientId === info.clientId) this.endTurn(s, 'phone-lost');
  }

  private endTurn(s: Session, reason: 'skipped' | 'exit' | 'phone-lost' | 'error' | 'timeout') {
    const t = s.turn!;
    s.turn = null;
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
      s.phones.set(clientId, conn);
      this.log(s, { kind: rejoin ? 'rejoin' : 'join', clientId });
      for (const r of s.readers.values()) {
        if (r.phoneClientId === clientId) this.toTv(s, { type: 'reader.status', sessionId: s.id, readerId: r.readerId, state: 'connected', serverMs: this.o.now() });
      }
    }
    conn.send({ t: 'welcome', sessionId: s.id, role, readers: this.readerList(s), serverMs: this.o.now() });
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
