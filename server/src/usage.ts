// Application-level cost guard. Counts what each paid AWS call consumes and REFUSES new work past a hard cap, so
// a bug (a turn that never ends, a reconnect loop, a retry storm) can never run up the bill. Counters persist to a
// small JSON file per UTC day (survive restarts). Caps come from env (defaults sized for a hackathon):
//   USAGE_TRANSCRIBE_MIN_PER_DAY=60  USAGE_POLLY_CHARS_PER_DAY=150000  USAGE_BEDROCK_CALLS_PER_DAY=300
//   USAGE_FILE=.dev/usage.json (EC2: /var/lib/wordlight/usage.json)
// Prices for the estimate (USD, ap-south-1 list prices as of 2026-10; INFERRED — the bill is the truth):
//   Transcribe streaming 0.024 / min · Polly neural 16 / 1M chars · Bedrock: per model, set by the caller.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export type Meter = 'transcribeSeconds' | 'pollyChars' | 'bedrockCalls' | 'bedrockTokensIn' | 'bedrockTokensOut';
export const PRICE = { transcribePerMin: 0.024, pollyNeuralPerMChars: 16 };

export class UsageCapError extends Error {
  constructor(meter: Meter, used: number, cap: number) { super(`usage cap reached: ${meter} ${Math.round(used)} / ${cap} today`); this.name = 'UsageCapError'; }
}

export interface UsageDay { day: string; transcribeSeconds: number; pollyChars: number; bedrockCalls: number; bedrockTokensIn: number; bedrockTokensOut: number; refused: number }

export class UsageMeter {
  private d: UsageDay;
  readonly caps: { transcribeSeconds: number; pollyChars: number; bedrockCalls: number };
  private readonly file: string | null;
  private readonly today: () => string;
  constructor(o: { file?: string | null; caps?: Partial<UsageMeter['caps']>; today?: () => string } = {}) {
    this.file = o.file === undefined ? (process.env.USAGE_FILE ?? null) : o.file;
    this.today = o.today ?? (() => new Date().toISOString().slice(0, 10));
    this.caps = {
      transcribeSeconds: (Number(process.env.USAGE_TRANSCRIBE_MIN_PER_DAY) || 60) * 60,
      pollyChars: Number(process.env.USAGE_POLLY_CHARS_PER_DAY) || 150_000,
      bedrockCalls: Number(process.env.USAGE_BEDROCK_CALLS_PER_DAY) || 300,
      ...o.caps,
    };
    this.d = this.load();
  }
  private blank(): UsageDay { return { day: this.today(), transcribeSeconds: 0, pollyChars: 0, bedrockCalls: 0, bedrockTokensIn: 0, bedrockTokensOut: 0, refused: 0 }; }
  private load(): UsageDay {
    if (!this.file) return this.blank();
    try { const all = JSON.parse(readFileSync(this.file, 'utf8')); const d = all?.days?.[this.today()]; return d ? { ...this.blank(), ...d } : this.blank(); } catch { return this.blank(); }
  }
  private save() {
    if (!this.file) return;
    try {
      let all: any = { days: {} };
      try { all = JSON.parse(readFileSync(this.file, 'utf8')); } catch {}
      all.days = all.days ?? {}; all.days[this.d.day] = this.d;
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(all, null, 1));
    } catch { /* best effort: the in-memory cap still holds */ }
  }
  private roll() { if (this.d.day !== this.today()) this.d = this.blank(); }
  /** Throws UsageCapError if `meter` (capped ones) cannot take `amount` more today. */
  check(meter: 'transcribeSeconds' | 'pollyChars' | 'bedrockCalls', amount = 0) {
    this.roll();
    if (this.d[meter] + amount > this.caps[meter]) { this.d.refused++; this.save(); throw new UsageCapError(meter, this.d[meter], this.caps[meter]); }
  }
  add(meter: Meter, amount: number) { this.roll(); this.d[meter] += amount; this.save(); }
  snapshot() {
    this.roll();
    const est = (this.d.transcribeSeconds / 60) * PRICE.transcribePerMin + (this.d.pollyChars / 1e6) * PRICE.pollyNeuralPerMChars;
    return { ...this.d, caps: this.caps, estimatedUsdToday: Math.round(est * 1000) / 1000, note: 'estimate from list prices (INFERRED); Bedrock cost not included; the AWS bill is authoritative' };
  }
}

/** One meter per process. */
export const usage = new UsageMeter();
