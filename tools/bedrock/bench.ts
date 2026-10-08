// Pick the Bedrock model for the parent coach by measurement, cheapest first.
//   AWS_REGION=ap-south-1 node tools/bedrock/bench.ts --candidates .dev/aws/bedrock-candidates.json [--max 6]
//   AWS_REGION=ap-south-1 node tools/bedrock/bench.ts --models apac.amazon.nova-micro-v1:0,apac.amazon.nova-lite-v1:0
// For each model: 8 fixed, synthetic session scenarios (no child data) through the PRODUCTION BedrockSummaryService
// (same prompt, same guard). Records accepted/rejected (and why), latency, tokens. Recommends the first model in
// price order with ≥ 7/8 accepted and median latency ≤ 2.5 s. Also tries one turn-selection call per model.
// Writes docs/results/bedrock/bench-<date>.json + .md. Cost: a few cents at most (≈ 9 short calls per model).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BedrockSummaryService, templateSummary, type SummaryInput } from '../../server/src/summary.ts';
import { chooseTurnsWithModel } from '../content/ai-turns.ts';
import { usage } from '../../server/src/usage.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SCENARIOS: SummaryInput[] = [
  { name: 'Riya', lang: 'en-IN', read: 38, helped: 4, skipped: 0, lines: 6, storiesCompleted: ['busy-ants'], storyTitles: ['Busy Ants'], sessionMs: 420000, helpedWords: ['colony', 'strong', 'smell', 'sweet'] },
  { name: 'Aarav', lang: 'hi-IN', read: 21, helped: 0, skipped: 0, lines: 4, storiesCompleted: ['busy-ants-hi'], storyTitles: ['कामकाजी चींटियाँ'], sessionMs: 300000, helpedWords: [] },
  { name: 'Meera', lang: 'en-IN', read: 5, helped: 7, skipped: 2, lines: 3, storiesCompleted: [], storyTitles: ['Busy Ants'], sessionMs: 180000, helpedWords: ['fourth', 'line', 'walk', 'quietly', 'smell'] },
  { name: 'Kabir', lang: 'en-IN', read: 12, helped: 1, skipped: 0, lines: 2, storiesCompleted: ['wl-test-kite'], storyTitles: ["Mina's Red Kite"], sessionMs: 95000, helpedWords: ['bird'] },
  { name: 'Ananya', lang: 'hi-IN', read: 9, helped: 3, skipped: 1, lines: 3, storiesCompleted: [], storyTitles: ['कामकाजी चींटियाँ'], sessionMs: 240000, helpedWords: ['चींटियाँ', 'कतार', 'मीठा'] },
  { name: 'Ishaan', lang: 'en-IN', read: 52, helped: 2, skipped: 0, lines: 8, storiesCompleted: ['busy-ants', 'wl-test-kite'], storyTitles: ['Busy Ants', "Mina's Red Kite"], sessionMs: 900000, helpedWords: ['hundreds', 'colony'] },
  { name: 'Zoya', lang: 'en-IN', read: 3, helped: 3, skipped: 0, lines: 1, storiesCompleted: [], storyTitles: ['Busy Ants'], sessionMs: 60000, helpedWords: ['ants', 'walk', 'line'] },
  { name: 'Dev', lang: 'hi-IN', read: 30, helped: 5, skipped: 2, lines: 5, storiesCompleted: ['busy-ants-hi'], storyTitles: ['कामकाजी चींटियाँ'], sessionMs: 480000, helpedWords: ['ताकतवर', 'बस्ती'] },
];
const LINES = ['Hello, I am the fourth one in the line.', 'Can you see me?', 'We walk in a line, quietly.', 'We do not talk.', 'We leave a smell for the others to follow.', 'Follow me for food!', 'We love sweet things.', 'We are very strong.', 'Hundreds of us live together in a colony.']
  .map((t, i) => ({ page: 0, line: i, words: t.split(' ') }));

// Relative price rank (lower = cheaper) from public on-demand list prices; INFERRED, only used to order candidates.
export function priceRank(id: string): number {
  const s = id.toLowerCase();
  const table: [RegExp, number][] = [[/nova-micro/, 1], [/llama3-2-1b|llama3-2-3b/, 2], [/nova-lite/, 3], [/mistral.*(small|mini)|ministral/, 4], [/llama3-1-8b|llama3-8b|gemma/, 5], [/haiku/, 8], [/nova-pro/, 12], [/sonnet|opus|large|70b|405b/, 50]];
  for (const [re, r] of table) if (re.test(s)) return r;
  return 20;
}

async function main() {
  const a = process.argv.slice(2); const opt = (k: string) => (a.includes(`--${k}`) ? a[a.indexOf(`--${k}`) + 1] : null);
  const region = process.env.AWS_REGION || 'ap-south-1';
  let models: string[] = opt('models')?.split(',') ?? [];
  if (!models.length && opt('candidates') && existsSync(opt('candidates')!)) models = JSON.parse(readFileSync(opt('candidates')!, 'utf8'));
  models = [...new Set(models)].sort((x, y) => priceRank(x) - priceRank(y)).slice(0, Number(opt('max') ?? 6));
  if (!models.length) { console.error('no candidate models'); process.exit(2); }
  const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
  const client = new BedrockRuntimeClient({ region });
  const rows: any[] = [];
  for (const model of models) {
    const lat: number[] = []; const outs: any[] = []; let accepted = 0; const usage0 = usage.snapshot();
    const svc = new BedrockSummaryService({ client, ConverseCommand, modelId: model, timeoutMs: 6000, maxCalls: 20, log: () => {} });
    for (const sc of SCENARIOS) {
      const t0 = performance.now(); const r = await svc.summarize(sc); const ms = Math.round(performance.now() - t0);
      if (r.source === 'bedrock') { accepted++; lat.push(ms); }
      outs.push({ scenario: sc.name, source: r.source, fallback: r.fallbackReason ?? null, ms, text: r.text });
      if (r.fallbackReason?.startsWith('error:')) break; // model unusable (access, region): stop spending calls on it
    }
    // Record WHY a model is unusable (the service only keeps the error name): one bare call, message kept verbatim.
    let errorMessage: string | null = null;
    if (!accepted && outs.at(-1)?.fallback?.startsWith('error:')) {
      try { await client.send(new ConverseCommand({ modelId: model, messages: [{ role: 'user', content: [{ text: 'Say OK.' }] }], inferenceConfig: { maxTokens: 5 } })); errorMessage = 'bare call succeeded (the failure is specific to the summary request)'; }
      catch (e: any) { errorMessage = `${e?.name ?? 'Error'}: ${String(e?.message ?? e).slice(0, 400)}`; }
    }
    const raw = async (p: string) => { const r: any = await client.send(new ConverseCommand({ modelId: model, messages: [{ role: 'user', content: [{ text: p }] }], inferenceConfig: { maxTokens: 200, temperature: 0 } })); return String(r?.output?.message?.content?.[0]?.text ?? ''); };
    const turns = accepted ? await chooseTurnsWithModel(LINES, 1, raw, model) : null;
    lat.sort((x, y) => x - y);
    const u = usage.snapshot();
    rows.push({ model, priceRank: priceRank(model), accepted, of: SCENARIOS.length, medianMs: lat.length ? lat[lat.length >> 1] : null, maxMs: lat.length ? lat[lat.length - 1] : null,
      tokensIn: u.bedrockTokensIn - usage0.bedrockTokensIn, tokensOut: u.bedrockTokensOut - usage0.bedrockTokensOut, errorMessage, turnSelection: turns ? { source: turns.source, indexes: turns.indexes, fallback: turns.fallback ?? null, reason: turns.reason ?? null } : null, outputs: outs });
    console.log(`${model.padEnd(48)} accepted ${accepted}/${SCENARIOS.length} · median ${rows.at(-1).medianMs ?? '–'} ms · turns ${turns?.source ?? '–'}${turns?.fallback ? ` (${turns.fallback})` : ''}`);
    if (errorMessage) console.log(`  ↳ ${errorMessage}`);
  }
  const pick = rows.find((r) => r.accepted >= 7 && r.medianMs !== null && r.medianMs <= 2500) ?? null;
  const stamp = new Date().toISOString().slice(0, 16).replace(/:/g, '-');
  const dir = path.join(ROOT, 'docs/results/bedrock'); mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `bench-${stamp}.json`), JSON.stringify({ region, date: new Date().toISOString(), recommended: pick?.model ?? null, rows }, null, 1));
  const md = [`# Bedrock parent-coach benchmark (${region}, ${new Date().toISOString().slice(0, 10)})`, '',
    'Synthetic session data only (no child data). Production prompt and guard: a text is accepted only if it keeps exactly the given numbers, names the child and makes no claim about ability/progress; otherwise the deterministic template is used.', '',
    `**Recommended:** ${pick ? `\`${pick.model}\` (cheapest model with ≥ 7/8 accepted and median ≤ 2.5 s)` : 'none — keep the template'}`, '',
    '| model | accepted | median ms | max ms | tokens in/out | turn selection |', '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.model} | ${r.accepted}/${r.of} | ${r.medianMs ?? '–'} | ${r.maxMs ?? '–'} | ${r.tokensIn}/${r.tokensOut} | ${r.turnSelection ? `${r.turnSelection.source}${r.turnSelection.fallback ? ` (${r.turnSelection.fallback})` : ''} ${JSON.stringify(r.turnSelection.indexes)}` : '–'} |`),
    '', ...(rows.some((r) => r.errorMessage) ? ['## Errors (verbatim)', '', ...rows.filter((r) => r.errorMessage).map((r) => `- \`${r.model}\`: ${r.errorMessage}`), ''] : []),
    '## Sample outputs', '', ...rows.flatMap((r) => [`### ${r.model}`, ...r.outputs.slice(0, 3).map((o: any) => `- ${o.scenario}: ${o.source === 'bedrock' ? '“' + o.text + '”' : `template (${o.fallback})`}`), '']),
    `Template for comparison: “${templateSummary(SCENARIOS[0])}”`];
  writeFileSync(path.join(dir, `bench-${stamp}.md`), md.join('\n') + '\n');
  console.log(`recommended: ${pick?.model ?? 'none'} · wrote docs/results/bedrock/bench-${stamp}.md`);
  if (pick) { mkdirSync(path.join(ROOT, '.dev/aws'), { recursive: true }); writeFileSync(path.join(ROOT, '.dev/aws/bedrock-model'), pick.model + '\n'); }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e?.name ?? '', e?.message ?? e); process.exit(1); });
