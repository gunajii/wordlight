import { LANGS, SENDERS, type EventType, type WordLightEvent } from './events.ts';

export type Result = { ok: true; event: WordLightEvent } | { ok: false; error: string };

const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isInt = (v: unknown, min = 0, max = 1e9): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Structural validation of an inbound message. Pure: no I/O, no clock.
 * Unknown fields are allowed (forward compatibility) but required ones are checked strictly,
 * because the TV and matcher act on indexes and ids from these messages.
 */
export function validateEvent(msg: unknown): Result {
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'not an object' };
  const m = msg as Record<string, unknown>;
  const type = m.type as EventType;
  if (!(type in SENDERS)) return { ok: false, error: `unknown type ${String(m.type)}` };
  if (!isStr(m.sessionId, 16)) return { ok: false, error: 'sessionId required' };
  const fail = (f: string) => ({ ok: false as const, error: `${type}: bad ${f}` });
  switch (type) {
    case 'turn.start':
      if (!isStr(m.turnId, 64)) return fail('turnId');
      if (!isStr(m.readerId, 64)) return fail('readerId');
      if (!isStr(m.storyId, 128)) return fail('storyId');
      if (!isInt(m.page, 0, 10_000) || !isInt(m.line, 0, 10_000)) return fail('page/line');
      if (!Array.isArray(m.words) || m.words.length === 0 || m.words.length > 40 || !m.words.every((w) => isStr(w, 64))) return fail('words');
      if (!LANGS.includes(m.lang as never)) return fail('lang');
      if (m.mode !== undefined && m.mode !== 'free' && m.mode !== 'echo') return fail('mode');
      break;
    case 'turn.help':
      if (!isStr(m.turnId, 64)) return fail('turnId');
      if (m.kind !== 'next-word' && m.kind !== 'line') return fail('kind');
      break;
    case 'turn.help.done':
      if (!isStr(m.turnId, 64)) return fail('turnId');
      if (!isInt(m.index, 0, 40)) return fail('index');
      break;
    case 'turn.cancel':
      if (!isStr(m.turnId, 64)) return fail('turnId');
      if (!['skipped', 'exit', 'phone-lost', 'error', 'timeout'].includes(m.reason as string)) return fail('reason');
      break;
    case 'reader.save': {
      const r = m.reader as Record<string, unknown> | undefined;
      if (!r || !isStr(r.readerId, 64) || !isStr(r.firstName, 40) || !isInt(r.age, 3, 18) || !LANGS.includes(r.lang as never)) return fail('reader');
      const c = m.consent as Record<string, unknown> | undefined;
      if (!c || c.microphone !== true || !isNum(c.atMs)) return fail('consent');
      break;
    }
    case 'mic.state':
      if (!isStr(m.turnId, 64)) return fail('turnId');
      if (!['opening', 'open', 'denied', 'closed', 'error'].includes(m.state as string)) return fail('state');
      break;
    case 'word.read':
      if (!isStr(m.turnId, 64) || !isInt(m.index, 0, 40) || !isNum(m.confidence) || !isNum(m.atMs)) return fail('fields');
      break;
    case 'word.helped':
    case 'word.skipped':
      if (!isStr(m.turnId, 64) || !isInt(m.index, 0, 40)) return fail('fields');
      break;
    case 'line.done':
      if (!isStr(m.turnId, 64) || !isInt(m.read, 0, 40) || !isInt(m.helped, 0, 40) || !isInt(m.skipped, 0, 40) || !isNum(m.durationMs)) return fail('fields');
      break;
    case 'reader.status':
      if (m.state !== 'connected' && m.state !== 'disconnected') return fail('state');
      break;
    case 'session.summary':
      if (!isStr(m.readerId, 64) || !isStr(m.text, 1000)) return fail('fields');
      break;
  }
  return { ok: true, event: m as unknown as WordLightEvent };
}

/** Can a client with this role send this event? (Server-originated events never come from clients.) */
export function mayClientSend(role: 'tv' | 'phone', type: EventType): boolean {
  return SENDERS[type] === role;
}
