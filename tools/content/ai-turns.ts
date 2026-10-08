// Bedrock-assisted choice of Your Turn lines (build time, optional). The model sees the story's lines, the reader
// level and which lines are ELIGIBLE under the deterministic rules; it may only pick from those. Its answer must be
// strict JSON with the right number of distinct eligible indexes, else the deterministic rules decide. The app never
// depends on this: story.json records which chooser was used.
import { chooseTurns, eligibleTurnLines, turnCount, DEFAULT_TURN_RULES, type TurnCandidate } from '@wordlight/story-package';
import { usage } from '../../server/src/usage.ts';

export interface TurnChoice { indexes: number[]; source: 'rules' | 'bedrock'; model?: string; reason?: string; fallback?: string }
type Converse = (prompt: string) => Promise<string>;

export function validateAiTurns(raw: string, lines: TurnCandidate[], level: number): { indexes: number[]; reason: string } | string {
  let j: any;
  try { j = JSON.parse(raw.trim().replace(/^```(json)?|```$/g, '')); } catch { return 'not-json'; }
  const want = turnCount(lines);
  const ok = new Set(eligibleTurnLines(lines));
  const ix = Array.isArray(j?.turns) ? j.turns : null;
  if (!ix || !ix.every((n: any) => Number.isInteger(n))) return 'bad-shape';
  if (new Set(ix).size !== ix.length) return 'duplicates';
  if (ix.some((n: number) => !ok.has(n))) return 'ineligible-line';
  if (ix.length < Math.max(1, want - 1) || ix.length > want + 1) return 'wrong-count';
  return { indexes: [...ix].sort((a, b) => a - b), reason: String(j.reason ?? '').slice(0, 200) };
}

export async function chooseTurnsWithModel(lines: TurnCandidate[], level: number, converse: Converse | null, model?: string): Promise<TurnChoice> {
  const rules = (fallback?: string): TurnChoice => ({ indexes: chooseTurns(lines, DEFAULT_TURN_RULES), source: 'rules', ...(fallback ? { fallback } : {}) });
  if (!converse) return rules();
  const eligible = eligibleTurnLines(lines);
  if (eligible.length <= turnCount(lines)) return rules('few-eligible');
  const prompt = `You choose which lines of a children's picture book a beginning reader (reading level ${level} of 4, age about ${4 + level * 2}) should read aloud themselves. ` +
    `Pick exactly ${turnCount(lines)} lines from the ELIGIBLE list, spread through the story, preferring short lines with common, decodable words and avoiding names that are hard to read. ` +
    `Reply with JSON only: {"turns":[line numbers],"reason":"one short sentence"}.\nLines:\n` +
    lines.map((l, i) => `${i}${eligible.includes(i) ? ' (ELIGIBLE)' : ''}: ${l.words.join(' ')}`).join('\n');
  try {
    usage.check('bedrockCalls', 1); usage.add('bedrockCalls', 1);
    const v = validateAiTurns(await converse(prompt), lines, level);
    if (typeof v === 'string') return rules(`rejected:${v}`);
    return { indexes: v.indexes, source: 'bedrock', model, reason: v.reason };
  } catch (e: any) { return rules(`error:${e?.name ?? 'unknown'}`); }
}

/** A Converse function for build-time use (no streaming; small output; timeout). */
export async function bedrockConverse(region: string, modelId: string, timeoutMs = 8000): Promise<Converse> {
  const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
  const client = new BedrockRuntimeClient({ region });
  return async (prompt: string) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r: any = await client.send(new ConverseCommand({ modelId, messages: [{ role: 'user', content: [{ text: prompt.slice(0, 12000) }] }], inferenceConfig: { maxTokens: 200, temperature: 0 } }), { abortSignal: ctl.signal });
      if (r?.usage) { usage.add('bedrockTokensIn', r.usage.inputTokens ?? 0); usage.add('bedrockTokensOut', r.usage.outputTokens ?? 0); }
      return String(r?.output?.message?.content?.[0]?.text ?? '');
    } finally { clearTimeout(t); }
  };
}
