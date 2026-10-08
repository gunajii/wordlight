import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UsageMeter, UsageCapError } from '../src/usage.ts';
import { TranscribeSource } from '../src/reading/speech.ts';

test('usage meter: hard cap refuses new work; counters persist per UTC day and roll over', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'usage-')), 'u.json');
  let day = '2026-10-08';
  const m = new UsageMeter({ file, caps: { transcribeSeconds: 60, pollyChars: 100, bedrockCalls: 2 }, today: () => day });
  m.add('transcribeSeconds', 59); m.check('transcribeSeconds');
  m.add('transcribeSeconds', 2);
  assert.throws(() => m.check('transcribeSeconds'), UsageCapError);
  assert.throws(() => m.check('pollyChars', 101), /pollyChars/);
  const again = new UsageMeter({ file, caps: { transcribeSeconds: 60, pollyChars: 100, bedrockCalls: 2 }, today: () => day });
  assert.equal(again.snapshot().transcribeSeconds, 61, 'persisted across a restart');
  day = '2026-10-09';
  again.check('transcribeSeconds');
  assert.equal(again.snapshot().transcribeSeconds, 0, 'new day, new budget');
  assert.ok(JSON.parse(readFileSync(file, 'utf8')).days['2026-10-08']);
});

test('Transcribe refuses to open a stream past the daily cap (turn ends with an error), and meters audio seconds', async () => {
  const meter = new UsageMeter({ file: null, caps: { transcribeSeconds: 1, pollyChars: 1, bedrockCalls: 1 } });
  const calls: any[] = [];
  const client = { async send(cmd: any) { calls.push(cmd); for await (const _ of cmd.input.AudioStream) {} return { TranscriptResultStream: [] }; } };
  const src = new TranscribeSource({ client, usage: meter });
  const s1 = src.open({ lang: 'en-IN' }, { onUpdate: () => {}, onError: () => {}, onClose: () => {} });
  s1.push(new Int16Array(16000 * 2)); s1.end();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(meter.snapshot().transcribeSeconds, 2);
  let err: any = null;
  src.open({ lang: 'en-IN' }, { onUpdate: () => {}, onError: (e) => (err = e), onClose: () => {} });
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(err instanceof UsageCapError);
  assert.equal(calls.length, 1, 'no second stream was started');
});
