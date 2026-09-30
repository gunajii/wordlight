import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Resampler, MicProcessor } from '../mic-worklet.js';

const tone = (rate, hz, secs, amp = 0.5) => Float32Array.from({ length: Math.round(rate * secs) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
const feed = (rs, x, block = 128) => { const out = []; for (let i = 0; i < x.length; i += block) out.push(...rs.push(x.subarray(i, i + block))); return Float32Array.from(out); };
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
// amplitude of frequency hz in x (rate 16k) by projection, ignoring the first 50 ms (filter warm-up)
const amp = (x, hz) => { let s = 0, c = 0; const y = x.subarray(800); for (let i = 0; i < y.length; i++) { s += y[i] * Math.sin((2 * Math.PI * hz * i) / 16000); c += y[i] * Math.cos((2 * Math.PI * hz * i) / 16000); } return (2 * Math.hypot(s, c)) / y.length; };

for (const inRate of [48000, 44100, 16000]) {
  test(`resampler ${inRate} → 16000: length, passband, stopband`, () => {
    const y1 = feed(new Resampler(inRate), tone(inRate, 1000, 2));
    assert.ok(Math.abs(y1.length - 32000) <= 64, `length ${y1.length}`);
    assert.ok(Math.abs(amp(y1, 1000) - 0.5) < 0.02, `1 kHz amplitude ${amp(y1, 1000)}`);
    const y6 = feed(new Resampler(inRate), tone(inRate, 6000, 2));
    assert.ok(amp(y6, 6000) > 0.4, `6 kHz (speech band) kept: ${amp(y6, 6000)}`);
    if (inRate > 16000) {
      const y12 = feed(new Resampler(inRate), tone(inRate, 12000, 2));
      assert.ok(rms(y12.subarray(800)) < 0.03, `12 kHz must not alias into the band: rms ${rms(y12)}`);
    }
  });
}

test('processor: emits chunkMs×16 Int16 samples per chunk with RMS; stop ends processing', () => {
  globalThis.sampleRate = 48000;
  const posted = [];
  const p = new MicProcessor({ processorOptions: { targetRate: 16000, chunkMs: 20 } });
  p.port = { postMessage: (m) => posted.push(m), onmessage: null };
  p.port.onmessage = null;
  const x = tone(48000, 1000, 1, 0.5);
  for (let i = 0; i < x.length; i += 128) p.process([[x.subarray(i, i + 128)]]);
  assert.ok(posted.length >= 48 && posted.length <= 50, `chunks ${posted.length}`);
  for (const m of posted) assert.equal(new Int16Array(m.pcm).length, 320);
  assert.ok(Math.abs(posted[10].rms - 0.3536) < 0.02, `rms ${posted[10].rms}`);
  p.stopped = true;
  assert.equal(p.process([[x.subarray(0, 128)]]), false);
  delete globalThis.sampleRate;
});
