// The parent summary. The DATA (counts) is computed deterministically by the server from line.done results; a
// SummaryService only turns those counts into a sentence for the parent.
//   LocalSummaryService    deterministic template (default; always available)
//   BedrockSummaryService  optional: Amazon Bedrock rewords the same facts. Guarded: it must answer within the time
//                          limit, stay within a call budget, and its text must contain exactly the numbers it was
//                          given and no claims about reading ability/progress. Any failure → the local template.
// Bedrock can never break the demo and never changes the numbers.
export interface SummaryInput {
  name: string; lang: 'hi-IN' | 'en-IN';
  read: number; helped: number; skipped: number; lines: number;
  storiesCompleted: string[]; storyTitles: string[]; sessionMs: number;
}
export interface SummaryResult { text: string; source: 'template' | 'bedrock'; fallbackReason?: string }
export interface SummaryService { readonly name: string; summarize(i: SummaryInput): Promise<SummaryResult> }

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
export function minutes(ms: number) { const m = Math.round(ms / 60000); return m < 1 ? 'under a minute' : plural(m, 'minute'); }

/** Deterministic: only the counts, no judgement. */
export function templateSummary(i: SummaryInput): string {
  const story = i.storyTitles.length ? ` “${i.storyTitles.join('”, “')}”` : ' a story';
  if (i.lines === 0) return `${i.name} listened to${story} today. No reading turns yet.`;
  const help = i.helped === 0 ? 'without help' : `and needed help with ${plural(i.helped, 'word')}`;
  const read = `${i.name} read ${plural(i.read, 'word')} independently ${help}`;
  const done = i.storiesCompleted.length ? `, and finished${story}` : '';
  const skip = i.skipped ? ` ${plural(i.skipped, 'word')} ${i.skipped === 1 ? 'was' : 'were'} skipped.` : '';
  return `${read}${done} (${plural(i.lines, 'reading turn')}, ${minutes(i.sessionMs)}).${skip}`;
}

export class LocalSummaryService implements SummaryService {
  readonly name = 'template';
  async summarize(i: SummaryInput): Promise<SummaryResult> { return { text: templateSummary(i), source: 'template' }; }
}

/** Words that would turn a count into a claim about learning. The summary reports what happened, nothing more. */
const CLAIMS = /improv|progress|fluen|level|better|best|struggl|weak|behind|ahead|excellent|genius|percent|%|grade|reading age/i;

/** The model's text may only use the numbers it was given (digits). Returns a reason if it fails. */
export function checkGenerated(text: string, i: SummaryInput, minutesN: number): string | null {
  if (!text || text.length > 320) return 'length';
  if (CLAIMS.test(text)) return 'claim';
  const allowed = new Set([i.read, i.helped, i.skipped, i.lines, i.read + i.helped, minutesN, i.storiesCompleted.length].map(String));
  const nums: string[] = text.match(/\d+/g) ?? [];
  if (nums.some((n) => !allowed.has(n))) return 'numbers';
  if (!nums.includes(String(i.read))) return 'missing-count';
  if (i.helped > 0 && !nums.includes(String(i.helped))) return 'missing-count';
  if (!text.includes(i.name)) return 'name';
  return null;
}

type BedrockLike = { send(cmd: any, opts?: { abortSignal?: AbortSignal }): Promise<any> };

export class BedrockSummaryService implements SummaryService {
  readonly name = 'bedrock';
  private calls = 0;
  private readonly o: { client: BedrockLike; ConverseCommand: any; modelId: string; timeoutMs: number; maxCalls: number; fallback: SummaryService; log: (m: string) => void };
  constructor(o: { client: BedrockLike; ConverseCommand: any; modelId: string; timeoutMs?: number; maxCalls?: number; fallback?: SummaryService; log?: (m: string) => void }) {
    this.o = { timeoutMs: 2500, maxCalls: 30, fallback: new LocalSummaryService(), log: () => {}, ...o };
  }
  static async create(o: { region: string; modelId: string; log?: (m: string) => void }) {
    const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
    return new BedrockSummaryService({ client: new BedrockRuntimeClient({ region: o.region }), ConverseCommand, modelId: o.modelId, log: o.log });
  }
  private async fallback(i: SummaryInput, reason: string): Promise<SummaryResult> {
    this.o.log(`[summary] bedrock not used (${reason}); template instead`);
    return { ...(await this.o.fallback.summarize(i)), fallbackReason: reason };
  }
  async summarize(i: SummaryInput): Promise<SummaryResult> {
    if (i.lines === 0) return this.o.fallback.summarize(i); // nothing to reword
    if (this.calls >= this.o.maxCalls) return this.fallback(i, 'budget');
    this.calls++;
    const mins = Math.max(1, Math.round(i.sessionMs / 60000));
    const facts = { childFirstName: i.name, wordsReadIndependently: i.read, wordsHelped: i.helped, wordsSkipped: i.skipped, readingTurns: i.lines, storiesFinished: i.storiesCompleted.length, minutes: mins, storyTitles: i.storyTitles };
    const prompt = `Write one or two short, warm sentences for a parent about tonight's read-along session, in plain English. Use ONLY these facts and these exact numbers; do not add any other number, praise level, judgement, or claim about reading ability or progress. Facts: ${JSON.stringify(facts)}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs);
    try {
      const r = await this.o.client.send(new this.o.ConverseCommand({ modelId: this.o.modelId, messages: [{ role: 'user', content: [{ text: prompt }] }], inferenceConfig: { maxTokens: 120, temperature: 0.3 } }), { abortSignal: ctl.signal });
      const text = String(r?.output?.message?.content?.[0]?.text ?? '').trim().replace(/\s+/g, ' ');
      const bad = checkGenerated(text, i, mins);
      if (bad) return this.fallback(i, `rejected:${bad}`);
      return { text, source: 'bedrock' };
    } catch (e: any) {
      return this.fallback(i, ctl.signal.aborted ? 'timeout' : `error:${e?.name ?? 'unknown'}`);
    } finally { clearTimeout(timer); }
  }
}

/** SUMMARY=bedrock + BEDROCK_MODEL_ID → Bedrock with fallback; anything else → template. */
export async function summaryFromEnv(log: (m: string) => void = () => {}): Promise<SummaryService> {
  if (process.env.SUMMARY === 'bedrock' && process.env.BEDROCK_MODEL_ID) {
    try { return await BedrockSummaryService.create({ region: process.env.AWS_REGION || 'ap-south-1', modelId: process.env.BEDROCK_MODEL_ID, log }); }
    catch (e: any) { log(`[summary] bedrock unavailable (${e?.message ?? e}); template`); }
  }
  return new LocalSummaryService();
}
