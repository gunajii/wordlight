// The TV overlay isn't part of the root tsc project (it compiles inside the Vega app). Catch syntax errors here,
// before a TV build fails on the Mac.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';

test('TV overlay sources parse', () => {
  const dir = new URL('../../apps/vega-tv/overlay/src/', import.meta.url);
  const errors: string[] = [];
  for (const f of readdirSync(dir).filter((f) => /\.tsx?$/.test(f))) {
    const r = ts.transpileModule(readFileSync(new URL(f, dir), 'utf8'), { reportDiagnostics: true, fileName: f, compilerOptions: { jsx: ts.JsxEmit.React } });
    for (const d of r.diagnostics ?? []) errors.push(`${f}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  }
  assert.deepEqual(errors, []);
});
