// Bedrock access check for WordLight: one real Converse call per candidate, cheapest first, stopping at the first
// success or at an account-level / permission error (retrying those only spends time). Synthetic data only.
//   AWS_REGION=ap-south-1 node tools/bedrock/verify.ts [modelId ...]
// Prints: model, outcome class, HTTP status, request ID, latency, tokens, the reply and whether the product's
// output check (checkGenerated) would accept it. Never prints credentials.
import { checkGenerated, templateSummary, type SummaryInput } from '../../server/src/summary.ts';

export type BedrockOutcome = 'ok' | 'account-not-authorized' | 'model-access-denied' | 'iam-denied' | 'not-in-region-or-invalid-id'
  | 'needs-inference-profile' | 'throttled-or-quota' | 'credentials-or-config' | 'network' | 'service-error' | 'unknown';

/** Which of the brief's failure classes an SDK error belongs to; `stop` = the same cause would deny every model. */
export function classifyBedrockError(e: { name?: string; message?: string; code?: string }): { outcome: BedrockOutcome; stop: boolean } {
  const n = String(e?.name ?? e?.code ?? ''); const m = String(e?.message ?? '');
  if (/Operation not allowed/i.test(m)) return { outcome: 'account-not-authorized', stop: true };
  if (/not authorized to perform|no identity-based policy|explicit deny/i.test(m)) return { outcome: 'iam-denied', stop: true };
  if (n === 'AccessDeniedException') return { outcome: 'model-access-denied', stop: true };
  if (/on-demand throughput isn.?t supported|inference profile/i.test(m)) return { outcome: 'needs-inference-profile', stop: false };
  if (n === 'ResourceNotFoundException' || /model identifier is invalid|not found|isn.?t available in this region|not supported in this region/i.test(m)) return { outcome: 'not-in-region-or-invalid-id', stop: false };
  if (/Throttling|ServiceQuotaExceeded|TooManyRequests/i.test(n)) return { outcome: 'throttled-or-quota', stop: true };
  if (/Credential|ExpiredToken|UnrecognizedClient|InvalidSignature|InvalidClientTokenId|SSO/i.test(n + ' ' + m)) return { outcome: 'credentials-or-config', stop: true };
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|TimeoutError|NetworkingError|socket/i.test(n + ' ' + m)) return { outcome: 'network', stop: true };
  if (/InternalServer|ServiceUnavailable|ModelNotReady|ModelError|ModelTimeout/i.test(n)) return { outcome: 'service-error', stop: false };
  if (n === 'ValidationException') return { outcome: 'not-in-region-or-invalid-id', stop: false };
  return { outcome: 'unknown', stop: true };
}

/** A synthetic session (no child data). */
export const SAMPLE: SummaryInput = { name: 'Asha', lang: 'en-IN', read: 14, helped: 2, skipped: 0, lines: 3, storiesCompleted: ['busy-ants'], storyTitles: ['Busy Ants'], sessionMs: 180_000 };

async function main() {
  const region = process.env.AWS_REGION || 'ap-south-1';
  const models = process.argv.slice(2).length ? process.argv.slice(2) : ['apac.amazon.nova-micro-v1:0', 'amazon.nova-micro-v1:0', 'apac.amazon.nova-lite-v1:0'];
  const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
  const client = new BedrockRuntimeClient({ region, maxAttempts: 1 });
  const facts = { wordsReadIndependently: SAMPLE.read, wordsHelped: SAMPLE.helped, wordsSkipped: SAMPLE.skipped, readingTurns: SAMPLE.lines, storyFinished: true, minutes: 3, language: 'English' };
  const prompt = `Write one short sentence for a parent about a read-along session. Refer to the child only as [CHILD]. Use only these facts: ${JSON.stringify(facts)}`;
  console.log(`region ${region} · synthetic facts only · at most ${models.length} calls, no retries`);
  for (const modelId of models) {
    const t0 = performance.now();
    try {
      const r: any = await client.send(new ConverseCommand({ modelId, messages: [{ role: 'user', content: [{ text: prompt }] }], inferenceConfig: { maxTokens: 80, temperature: 0.2 } }), { abortSignal: AbortSignal.timeout(15000) });
      const ms = Math.round(performance.now() - t0);
      const text = String(r?.output?.message?.content?.[0]?.text ?? '').trim().replace(/\s+/g, ' ');
      const asChild = text.replaceAll('[CHILD]', SAMPLE.name);
      console.log(`RESULT ${modelId}: ok · HTTP ${r?.$metadata?.httpStatusCode} · request ${r?.$metadata?.requestId} · ${ms} ms (incl. connection setup) · tokens in ${r?.usage?.inputTokens} out ${r?.usage?.outputTokens} · stop ${r?.stopReason}`);
      console.log(`  reply: “${text}”`);
      console.log(`  current product check on it: ${checkGenerated(asChild, SAMPLE, 3) ?? 'accepted'} (template: “${templateSummary(SAMPLE)}”)`);
      return;
    } catch (e: any) {
      const ms = Math.round(performance.now() - t0); const c = classifyBedrockError(e);
      console.log(`RESULT ${modelId}: ${c.outcome} · ${e?.name}: ${String(e?.message ?? e).slice(0, 300)} · HTTP ${e?.$metadata?.httpStatusCode ?? '–'} · request ${e?.$metadata?.requestId ?? '–'} · ${ms} ms`);
      if (c.stop) { console.log('  stopping: this cause would deny the other models too'); return; }
    }
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error('verify failed:', e?.name ?? '', e?.message ?? e); process.exit(1); });
