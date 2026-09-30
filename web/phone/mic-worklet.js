// WordLight microphone AudioWorklet: mono input at the AudioContext rate → 16 kHz PCM16 chunks.
//
// Resampling: windowed-sinc low-pass (cutoff 7.2 kHz, Hann window) evaluated at the two input samples around
// each output position, linearly interpolated between them. Handles any input rate (48 000, 44 100, …);
// at 16 000 in it is a pass-through. Group delay ≈ half the filter length (≤ 0.7 ms at 44.1–48 kHz).
// Output: Int16 little-endian-agnostic (typed array), mono, 16 000 Hz; chunk = chunkMs × 16 samples.
// Each chunk is posted (transferred, not copied) to the page with its RMS level for the on-screen meter.
// Stereo input is averaged to mono. Nothing is kept after a chunk is posted.
// This file is an ES module: exports are for the Node tests; the worklet only uses registerProcessor.

export function makeTaps(inRate, outRate = 16000) {
  if (inRate <= outRate * 1.001) return new Float32Array([1]);
  const ratio = inRate / outRate;
  const half = Math.ceil(10 * ratio);
  const n = 2 * half + 1;
  const fc = (0.45 * outRate) / inRate; // 7.2 kHz for 16 kHz output, in cycles per input sample
  const taps = new Float32Array(n);
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const x = k - half;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1));
    taps[k] = sinc * w;
    sum += taps[k];
  }
  for (let k = 0; k < n; k++) taps[k] /= sum;
  return taps;
}

export class Resampler {
  constructor(inRate, outRate = 16000) {
    this.ratio = inRate / outRate;
    this.taps = makeTaps(inRate, outRate);
    this.half = (this.taps.length - 1) / 2;
    this.buf = new Float32Array(0);
    this.pos = this.half; // next output position, in buf coordinates
  }
  fir(i) {
    const t = this.taps, b = this.buf, o = i - this.half;
    let s = 0;
    for (let k = 0; k < t.length; k++) s += t[k] * b[o + k];
    return s;
  }
  /** @param {Float32Array} input @returns {Float32Array} */
  push(input) {
    const b = new Float32Array(this.buf.length + input.length);
    b.set(this.buf); b.set(input, this.buf.length);
    this.buf = b;
    const out = [];
    while (Math.floor(this.pos) + 1 + this.half < this.buf.length) {
      const i = Math.floor(this.pos), f = this.pos - i;
      const a = this.fir(i);
      out.push(f === 0 ? a : a + (this.fir(i + 1) - a) * f);
      this.pos += this.ratio;
    }
    const drop = Math.floor(this.pos) - this.half;
    if (drop > 0) { this.buf = this.buf.slice(drop); this.pos -= drop; }
    return Float32Array.from(out);
  }
}

const Base = globalThis.AudioWorkletProcessor ?? class {};

export class MicProcessor extends Base {
  constructor(options) {
    super();
    const o = options?.processorOptions ?? {};
    const outRate = o.targetRate ?? 16000;
    this.rs = new Resampler(globalThis.sampleRate ?? o.inRate ?? 48000, outRate);
    this.chunk = Math.round((outRate * (o.chunkMs ?? 40)) / 1000);
    this.acc = new Int16Array(this.chunk);
    this.n = 0;
    this.sumsq = 0;
    this.stopped = false;
    if (this.port) this.port.onmessage = (e) => { if (e.data?.cmd === "stop") this.stopped = true; };
  }
  process(inputs) {
    if (this.stopped) return false; // lets the node be collected; no further audio is touched
    const chans = inputs[0];
    if (!chans || chans.length === 0 || !chans[0]) return true;
    let mono = chans[0];
    if (chans.length > 1) {
      mono = new Float32Array(chans[0].length);
      for (let c = 0; c < chans.length; c++) for (let i = 0; i < mono.length; i++) mono[i] += chans[c][i] / chans.length;
    }
    const y = this.rs.push(mono);
    for (let i = 0; i < y.length; i++) {
      const v = Math.max(-1, Math.min(1, y[i]));
      this.acc[this.n++] = v < 0 ? v * 32768 : v * 32767;
      this.sumsq += v * v;
      if (this.n === this.chunk) {
        const buf = this.acc.buffer;
        this.port.postMessage({ pcm: buf, rms: Math.sqrt(this.sumsq / this.chunk) }, [buf]);
        this.acc = new Int16Array(this.chunk);
        this.n = 0;
        this.sumsq = 0;
      }
    }
    return true;
  }
}

if (typeof registerProcessor === 'function') registerProcessor('wl-mic', MicProcessor);
