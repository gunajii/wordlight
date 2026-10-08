// Reading progress: one small record per reader per session, counts only. No audio, no transcripts, no names
// (the reader id is random; the first name stays in the live session only).
//   MemoryProgressStore  default (local development, tests)
//   DynamoProgressStore  Amazon DynamoDB, on-demand table, items expire after PROGRESS_TTL_DAYS (default 30)
// PROGRESS=dynamodb PROGRESS_TABLE=wordlight-progress selects DynamoDB. A failing store never breaks a session.
export interface SessionRecord {
  readerId: string; sessionId: string; endedAt: string; lang: string; age: number;
  storyIds: string[]; storiesCompleted: string[];
  turns: number; read: number; helped: number; skipped: number; durationMs: number;
  /** story words the TV helped with (book text, not the child's speech) */
  helpedWords: string[];
  mode: 'free' | 'echo'; speech: string;
}
export interface ProgressStore { readonly name: string; save(r: SessionRecord): Promise<void>; recent(readerId: string, limit?: number): Promise<SessionRecord[]> }

export class MemoryProgressStore implements ProgressStore {
  readonly name = 'memory';
  readonly rows: SessionRecord[] = [];
  async save(r: SessionRecord) { this.rows.push(structuredClone(r)); if (this.rows.length > 1000) this.rows.shift(); }
  async recent(readerId: string, limit = 10) { return this.rows.filter((r) => r.readerId === readerId).sort((a, b) => b.endedAt.localeCompare(a.endedAt)).slice(0, limit); }
}

type DdbLike = { send(cmd: any): Promise<any> };
const S = (v: string) => ({ S: v }), N = (v: number) => ({ N: String(v) }), L = (xs: string[]) => ({ L: xs.map(S) });

export class DynamoProgressStore implements ProgressStore {
  readonly name = 'dynamodb';
  private readonly o: { client: DdbLike; PutItemCommand: any; QueryCommand: any; table: string; ttlDays: number };
  constructor(o: { client: DdbLike; PutItemCommand: any; QueryCommand: any; table: string; ttlDays?: number }) { this.o = { ttlDays: 30, ...o }; }
  static async create(o: { region: string; table: string; ttlDays?: number }) {
    const { DynamoDBClient, PutItemCommand, QueryCommand } = await import('@aws-sdk/client-dynamodb');
    return new DynamoProgressStore({ client: new DynamoDBClient({ region: o.region }), PutItemCommand, QueryCommand, table: o.table, ttlDays: o.ttlDays });
  }
  /** pk = reader, sk = endedAt#session (sorted by time); ttl in epoch seconds. */
  static toItem(r: SessionRecord, ttlDays: number) {
    return {
      pk: S(`reader#${r.readerId}`), sk: S(`${r.endedAt}#${r.sessionId}`),
      sessionId: S(r.sessionId), endedAt: S(r.endedAt), lang: S(r.lang), age: N(r.age),
      storyIds: L(r.storyIds), storiesCompleted: L(r.storiesCompleted),
      turns: N(r.turns), read: N(r.read), helped: N(r.helped), skipped: N(r.skipped), durationMs: N(r.durationMs),
      helpedWords: L(r.helpedWords.slice(0, 50)), mode: S(r.mode), speech: S(r.speech),
      ttl: N(Math.floor(Date.parse(r.endedAt) / 1000) + ttlDays * 86400),
    };
  }
  static fromItem(it: any): SessionRecord {
    const n = (k: string) => Number(it[k]?.N ?? 0), s = (k: string) => it[k]?.S ?? '', l = (k: string) => (it[k]?.L ?? []).map((x: any) => x.S);
    return { readerId: s('pk').replace(/^reader#/, ''), sessionId: s('sessionId'), endedAt: s('endedAt'), lang: s('lang'), age: n('age'), storyIds: l('storyIds'), storiesCompleted: l('storiesCompleted'),
      turns: n('turns'), read: n('read'), helped: n('helped'), skipped: n('skipped'), durationMs: n('durationMs'), helpedWords: l('helpedWords'), mode: s('mode') === 'echo' ? 'echo' : 'free', speech: s('speech') };
  }
  async save(r: SessionRecord) { await this.o.client.send(new this.o.PutItemCommand({ TableName: this.o.table, Item: DynamoProgressStore.toItem(r, this.o.ttlDays) })); }
  async recent(readerId: string, limit = 10) {
    const out = await this.o.client.send(new this.o.QueryCommand({ TableName: this.o.table, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': S(`reader#${readerId}`) }, ScanIndexForward: false, Limit: limit }));
    return (out.Items ?? []).map(DynamoProgressStore.fromItem);
  }
}

export async function progressFromEnv(log: (m: string) => void = () => {}): Promise<ProgressStore> {
  if (process.env.PROGRESS === 'dynamodb' && process.env.PROGRESS_TABLE) {
    try { return await DynamoProgressStore.create({ region: process.env.AWS_REGION || 'ap-south-1', table: process.env.PROGRESS_TABLE, ttlDays: Number(process.env.PROGRESS_TTL_DAYS) || 30 }); }
    catch (e: any) { log(`[progress] dynamodb unavailable (${e?.message ?? e}); memory`); }
  }
  return new MemoryProgressStore();
}
