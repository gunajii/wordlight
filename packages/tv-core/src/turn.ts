// The TV's Your Turn state machine. Pure: events in, state out; impossible transitions are rejected (state
// unchanged, `rejected` set) rather than silently applied.
//
//   LISTEN ──begin──▶ TURN_START ──mic-open──▶ LISTENING ──word──▶ READING ⇄ HELP ──line-done──▶ DONE ──finish──▶ LISTEN
//      any active state ──cancel──▶ CANCEL ──finish──▶ LISTEN          (mic is off in LISTEN, DONE and CANCEL)
// Word states shown on screen: pending · read · helped (amber) · skipped (dim). Never "wrong".
export type TurnPhase = 'LISTEN' | 'TURN_START' | 'LISTENING' | 'READING' | 'HELP' | 'DONE' | 'CANCEL';
export type WordMark = 'pending' | 'read' | 'helped' | 'skipped';

export interface TurnState {
  phase: TurnPhase;
  turnId: string | null;
  readerName: string | null;
  words: string[];
  marks: WordMark[];
  helpIndex: number | null;
  result: { read: number; helped: number; skipped: number; durationMs: number } | null;
  cancelReason: string | null;
}

export type TurnEvent =
  | { type: 'begin'; turnId: string; readerName: string; words: string[] }
  | { type: 'mic-open' }
  | { type: 'word-read'; index: number }
  | { type: 'word-helped'; index: number }
  | { type: 'word-skipped'; index: number }
  | { type: 'help-done' }
  | { type: 'line-done'; read: number; helped: number; skipped: number; durationMs: number }
  | { type: 'cancel'; reason: string }
  | { type: 'finish' };

export const idle = (): TurnState => ({ phase: 'LISTEN', turnId: null, readerName: null, words: [], marks: [], helpIndex: null, result: null, cancelReason: null });

const ACTIVE: TurnPhase[] = ['TURN_START', 'LISTENING', 'READING', 'HELP'];
const ALLOWED: Record<TurnEvent['type'], TurnPhase[]> = {
  begin: ['LISTEN'],
  'mic-open': ['TURN_START'],
  'word-read': ['TURN_START', 'LISTENING', 'READING', 'HELP'],   // words may beat the mic.state message
  'word-helped': ['TURN_START', 'LISTENING', 'READING', 'HELP'],
  'word-skipped': ['TURN_START', 'LISTENING', 'READING', 'HELP'],
  'help-done': ['HELP', 'READING', 'LISTENING'],
  'line-done': ACTIVE,
  cancel: ACTIVE,
  finish: ['DONE', 'CANCEL'],
};

export function turnReduce(s: TurnState, e: TurnEvent): { state: TurnState; rejected: string | null } {
  if (!ALLOWED[e.type].includes(s.phase)) return { state: s, rejected: `${e.type} not allowed in ${s.phase}` };
  const n: TurnState = { ...s, marks: s.marks.slice() };
  const mark = (i: number, m: WordMark) => { if (i >= 0 && i < n.marks.length && n.marks[i] === 'pending') n.marks[i] = m; };
  switch (e.type) {
    case 'begin': return { state: { ...idle(), phase: 'TURN_START', turnId: e.turnId, readerName: e.readerName, words: e.words.slice(), marks: e.words.map(() => 'pending') }, rejected: null };
    case 'mic-open': n.phase = 'LISTENING'; break;
    case 'word-read': mark(e.index, 'read'); if (n.phase !== 'HELP') n.phase = 'READING'; break;
    case 'word-skipped': mark(e.index, 'skipped'); if (n.phase !== 'HELP') n.phase = 'READING'; break;
    case 'word-helped': mark(e.index, 'helped'); n.phase = 'HELP'; n.helpIndex = e.index; break;
    case 'help-done': n.phase = 'READING'; n.helpIndex = null; break;
    case 'line-done': n.phase = 'DONE'; n.helpIndex = null; n.result = { read: e.read, helped: e.helped, skipped: e.skipped, durationMs: e.durationMs }; break;
    case 'cancel': n.phase = 'CANCEL'; n.helpIndex = null; n.cancelReason = e.reason; break;
    case 'finish': return { state: idle(), rejected: null };
  }
  return { state: n, rejected: null };
}

export const micShouldBeOn = (p: TurnPhase) => ACTIVE.includes(p);
