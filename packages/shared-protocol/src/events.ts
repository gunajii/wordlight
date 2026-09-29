// WordLight live protocol: JSON messages over the session WebSocket, plus binary audio frames.
//
// Every event carries sessionId and readerId (where a reader is involved); the server stamps
// serverMs on everything it relays, so each hop (phone → server → TV) can be timed.

export const LANGS = ['hi-IN', 'en-IN'] as const;
export type Lang = (typeof LANGS)[number];

export type Role = 'tv' | 'phone';

/** Fields every relayed event has. `serverMs` is set by the server, never trusted from clients. */
export interface Envelope {
  sessionId: string;
  readerId?: string;
  serverMs?: number;
  /** Sender's own clock at send time (for latency measurement with the clock offset). */
  sentAtMs?: number;
}

export interface Reader {
  readerId: string;
  firstName: string;
  age: number;
  lang: Lang;
}

// ---- TV → server → phone ----
export interface TurnStart extends Envelope {
  type: 'turn.start';
  turnId: string;
  readerId: string;
  storyId: string;
  page: number;
  line: number;
  words: string[];
  lang: Lang;
}
export interface TurnHelp extends Envelope {
  type: 'turn.help';
  turnId: string;
  /** 'next-word' = help with the next word; 'line' = read the whole line. */
  kind: 'next-word' | 'line';
}
export interface TurnCancel extends Envelope {
  type: 'turn.cancel';
  turnId: string;
  reason: 'skipped' | 'exit' | 'phone-lost' | 'error' | 'timeout';
}

// ---- phone → server ----
export interface ReaderSave extends Envelope {
  type: 'reader.save';
  reader: Reader;
  consent: { microphone: true; atMs: number };
}
export interface MicState extends Envelope {
  type: 'mic.state';
  turnId: string;
  state: 'opening' | 'open' | 'denied' | 'closed' | 'error';
  detail?: string;
}

// ---- server → TV (+ phone) ----
export interface WordRead extends Envelope {
  type: 'word.read';
  turnId: string;
  index: number;
  confidence: number;
  /** ms since the turn started, when the matcher accepted the word */
  atMs: number;
}
export interface WordHelped extends Envelope {
  type: 'word.helped';
  turnId: string;
  index: number;
  reason: 'stall' | 'asked';
}
export interface WordSkipped extends Envelope {
  type: 'word.skipped';
  turnId: string;
  index: number;
}
export interface LineDone extends Envelope {
  type: 'line.done';
  turnId: string;
  read: number;
  helped: number;
  skipped: number;
  durationMs: number;
}
export interface ReaderStatus extends Envelope {
  type: 'reader.status';
  state: 'connected' | 'disconnected';
}
export interface SessionSummary extends Envelope {
  type: 'session.summary';
  readerId: string;
  wordsReadAlone: number;
  wordsHelped: number;
  storiesCompleted: number;
  sessionMs: number;
  text: string;
  source: 'template' | 'bedrock';
}

export type WordLightEvent =
  | TurnStart | TurnHelp | TurnCancel
  | ReaderSave | MicState
  | WordRead | WordHelped | WordSkipped | LineDone | ReaderStatus | SessionSummary;

export type EventType = WordLightEvent['type'];

/** Who may send each event type to the server. The server rejects anything else. */
export const SENDERS: Record<EventType, Role | 'server'> = {
  'turn.start': 'tv',
  'turn.help': 'tv',
  'turn.cancel': 'tv',
  'reader.save': 'phone',
  'mic.state': 'phone',
  'word.read': 'server',
  'word.helped': 'server',
  'word.skipped': 'server',
  'line.done': 'server',
  'reader.status': 'server',
  'session.summary': 'server',
};
