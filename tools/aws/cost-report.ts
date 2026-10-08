// How much of the USD 100 project ceiling has been used? Two sources, both shown:
//   1. this machine's usage meter (.dev/usage.json): Polly characters, Transcribe seconds, Bedrock calls/tokens,
//      priced at list price → INFERRED, immediate;
//   2. AWS Cost Explorer (the file written by phase scripts from `aws ce get-cost-and-usage`), gross before credits →
//      MEASURED by AWS, but delayed up to ~24 h.
//   node tools/aws/cost-report.ts [.dev/aws/ce-*.json]
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRICE } from '../../server/src/usage.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const POLICY = [[60, 'normal development/testing'], [80, 'expanded validation and polish'], [90, 'only if it materially improves the submission'], [95, 'freeze nonessential spending'], [100, 'emergency only — never above']] as const;
export function band(usd: number) { const b = POLICY.find(([lim]) => usd < lim); return b ? b[1] : 'OVER THE CEILING — stop'; }

const u = existsSync(path.join(ROOT, '.dev/usage.json')) ? JSON.parse(readFileSync(path.join(ROOT, '.dev/usage.json'), 'utf8')).days ?? {} : {};
let polly = 0, tsec = 0, bcalls = 0;
for (const d of Object.values<any>(u)) { polly += d.pollyChars ?? 0; tsec += d.transcribeSeconds ?? 0; bcalls += d.bedrockCalls ?? 0; }
const local = (tsec / 60) * PRICE.transcribePerMin + (polly / 1e6) * PRICE.pollyNeuralPerMChars;
console.log(`local meter (this Mac's tools, INFERRED): Polly ${polly} chars · Transcribe ${(tsec / 60).toFixed(1)} min · Bedrock ${bcalls} calls → ≈ USD ${local.toFixed(2)} (+ Bedrock, a few cents)`);
const dir = path.join(ROOT, '.dev/aws');
const ce = process.argv[2] ?? (existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith('ce-')).sort().map((f) => path.join(dir, f)).at(-1) : undefined);
let j: any = null;
if (ce && existsSync(ce)) { try { j = JSON.parse(readFileSync(ce, 'utf8')); } catch { j = null; } }
if (j) {
  const total = (j.ResultsByTime ?? []).reduce((s: number, r: any) => s + Number(r.Total?.UnblendedCost?.Amount ?? 0), 0);
  console.log(`AWS Cost Explorer (gross, before credits; may lag ~24 h): USD ${total.toFixed(2)} → band: ${band(total)}`);
} else console.log("AWS Cost Explorer: no usable snapshot (empty file, no permission yet, or not enabled — normal for a new account)");
