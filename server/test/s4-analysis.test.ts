import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureMarks } from '@wordlight/story-package';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('S4 analysis on SIMULATED fixture data reproduces the known reference errors exactly (3 of every 4 words within 50 ms)', () => {
  const gen = spawnSync(process.execPath, ['tools/s4/polly-s4.ts', '--fixture'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(gen.status, 0, gen.stderr);
  const rep = mkdtempSync(path.join(tmpdir(), 's4-'));
  const an = spawnSync('python3', ['tools/s4/analyze.py', 'content/build/s4-fixture', '--report', rep], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(an.status, 0, an.stderr);
  const out = JSON.parse(readFileSync(path.join(ROOT, 'content/build/s4-fixture/analysis.json'), 'utf8'));
  const { passages } = JSON.parse(readFileSync(path.join(ROOT, 'tools/s4/passages.json'), 'utf8'));
  let n = 0, within = 0;
  for (const p of passages) { const k = fixtureMarks(p.text).marks.length; n += k; for (let i = 0; i < k; i++) if (i % 4 !== 3) within++; }
  assert.equal(out.all.A.n, n);
  assert.equal(out.all.A.within50, within);
  assert.equal(out.all.A.worst, 70);
  assert.ok(out.all.B.pct >= 95 && out.all.B.worst <= 10, 'acoustic onsets find the fixture tones within 10 ms');
  assert.equal(out.simulated, true);
  assert.equal(out.verdict, 'FAIL', '75 % < 95 % target');
  assert.match(an.stdout, /SIMULATED verdict FAIL/);
});
