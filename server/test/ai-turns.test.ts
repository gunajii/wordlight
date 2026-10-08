import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAiTurns, chooseTurnsWithModel } from '../../tools/content/ai-turns.ts';
import { chooseTurns, eligibleTurnLines } from '@wordlight/story-package';
import { priceRank } from '../../tools/bedrock/bench.ts';

const L = ['Hello, I am the fourth one in the line.', 'Can you see me?', 'We walk in a line, quietly.', 'We do not talk.', 'We leave a smell for the others to follow.', 'Follow me for food!', 'We love sweet things.', 'We are very strong.', 'Hundreds of us live together in a colony.']
  .map((t, i) => ({ page: 0, line: i, words: t.split(' ') }));

test('AI turn choice: only eligible lines, right count, strict JSON — anything else falls back to the rules', async () => {
  const ok = eligibleTurnLines(L);
  assert.ok(!ok.includes(0), 'never the first line');
  const good = JSON.stringify({ turns: [ok[0], ok[ok.length - 1]], reason: 'short common words' });
  assert.deepEqual((validateAiTurns(good, L, 1) as any).indexes, [ok[0], ok[ok.length - 1]]);
  assert.equal(validateAiTurns('sure! lines 1 and 3', L, 1), 'not-json');
  assert.equal(validateAiTurns(JSON.stringify({ turns: [0, 3] }), L, 1), 'ineligible-line');
  assert.equal(validateAiTurns(JSON.stringify({ turns: [3, 3] }), L, 1), 'duplicates');
  assert.equal(validateAiTurns(JSON.stringify({ turns: [1, 2, 3, 5, 6] }), L, 1), 'wrong-count');
  const viaModel = await chooseTurnsWithModel(L, 1, async () => good, 'm');
  assert.equal(viaModel.source, 'bedrock');
  const bad = await chooseTurnsWithModel(L, 1, async () => '{"turns":[0]}', 'm');
  assert.deepEqual([bad.source, bad.indexes], ['rules', chooseTurns(L)]);
  const err = await chooseTurnsWithModel(L, 1, async () => { throw Object.assign(new Error('x'), { name: 'AccessDeniedException' }); }, 'm');
  assert.equal(err.fallback, 'error:AccessDeniedException');
  assert.equal((await chooseTurnsWithModel(L, 1, null)).source, 'rules');
});

test('model candidates are ordered cheapest first (Nova Micro before Haiku before large models)', () => {
  const ids = ['anthropic.claude-3-5-sonnet', 'apac.anthropic.claude-haiku-4-5', 'apac.amazon.nova-lite-v1:0', 'apac.amazon.nova-micro-v1:0'];
  assert.deepEqual(ids.sort((a, b) => priceRank(a) - priceRank(b)), ['apac.amazon.nova-micro-v1:0', 'apac.amazon.nova-lite-v1:0', 'apac.anthropic.claude-haiku-4-5', 'anthropic.claude-3-5-sonnet']);
});
