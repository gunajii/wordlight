import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BedrockSummaryService, LocalSummaryService, templateSummary, checkGenerated, type SummaryInput } from '../src/summary.ts';

const I: SummaryInput = { name: 'Riya', lang: 'en-IN', read: 38, helped: 4, skipped: 0, lines: 6, storiesCompleted: ['wl-test-kite'], storyTitles: ['Mina’s Red Kite'], sessionMs: 252_000 };
class Converse { input: any; constructor(i: any) { this.input = i; } }
const client = (reply: string | (() => Promise<any>)) => ({ calls: 0, async send(cmd: any, o?: any) { this.calls++; if (typeof reply === 'function') return reply(); return { output: { message: { content: [{ text: reply }] } } }; } });

test('template summary: counts only, no judgement', () => {
  assert.equal(templateSummary(I), 'Riya read 38 words independently and needed help with 4 words, and finished “Mina’s Red Kite” (6 reading turns, 4 minutes).');
  assert.equal(templateSummary({ ...I, lines: 0, read: 0, helped: 0 }), 'Riya listened to “Mina’s Red Kite” today. No reading turns yet.');
});

test('bedrock wording is used only when it keeps exactly the given numbers and makes no claims', async () => {
  const ok = new BedrockSummaryService({ client: client('Riya read 38 words on her own tonight and got help with 4 while finishing Mina’s Red Kite.'), ConverseCommand: Converse, modelId: 'm' });
  assert.equal((await ok.summarize(I)).source, 'bedrock');
  for (const [reply, why] of [['Riya read 40 words!', 'numbers'], ['Riya read 38 words and 4 with help — her reading level is improving.', 'claim'], ['She read 38 words with 4 helped.', 'name'], ['', 'length']]) {
    const svc = new BedrockSummaryService({ client: client(reply), ConverseCommand: Converse, modelId: 'm' });
    const r = await svc.summarize(I);
    assert.equal(r.source, 'template', reply);
    assert.match(r.fallbackReason!, new RegExp(why));
    assert.equal(r.text, templateSummary(I));
  }
});

test('bedrock: timeout, error and call budget all fall back to the template; never throws', async () => {
  const slow = new BedrockSummaryService({ client: client(() => new Promise((r) => setTimeout(() => r({ output: { message: { content: [{ text: 'Riya read 38 words with 4 helped.' }] } } }), 300))), ConverseCommand: Converse, modelId: 'm', timeoutMs: 50 });
  const t0 = Date.now(); const r = await slow.summarize(I);
  // the SDK honours abortSignal; this fake does not, so only the result is checked, plus that we did not wait for nothing
  assert.equal(r.source === 'template' || r.source === 'bedrock', true);
  const err = new BedrockSummaryService({ client: client(() => Promise.reject(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }))), ConverseCommand: Converse, modelId: 'm' });
  const e = await err.summarize(I);
  assert.equal(e.source, 'template'); assert.match(e.fallbackReason!, /AccessDenied/);
  const c = client('Riya read 38 words with 4 helped.');
  const budget = new BedrockSummaryService({ client: c, ConverseCommand: Converse, modelId: 'm', maxCalls: 1 });
  assert.equal((await budget.summarize(I)).source, 'bedrock');
  const b2 = await budget.summarize(I);
  assert.equal(b2.source, 'template'); assert.equal(b2.fallbackReason, 'budget'); assert.equal(c.calls, 1);
  assert.equal((await new LocalSummaryService().summarize(I)).source, 'template');
  assert.ok(Date.now() - t0 < 2000);
});

test('bedrock timeout with an abortable client falls back within the limit', async () => {
  const abortable = { async send(_c: any, o: any) { return new Promise((_r, rej) => { o?.abortSignal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }); } };
  const svc = new BedrockSummaryService({ client: abortable, ConverseCommand: Converse, modelId: 'm', timeoutMs: 40 });
  const t0 = Date.now(); const r = await svc.summarize(I);
  assert.equal(r.source, 'template'); assert.equal(r.fallbackReason, 'timeout'); assert.ok(Date.now() - t0 < 500);
});

test('checkGenerated allows the total and the minutes, nothing else', () => {
  assert.equal(checkGenerated('Riya read 42 words in 4 minutes: 38 alone, 4 with help.', I, 4), null);
  assert.equal(checkGenerated('Riya read 38 words and needed help with 4 in 5 minutes.', I, 4), 'numbers');
});
