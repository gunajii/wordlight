// Voice activity on the phone audio, per 40 ms chunk: is the child making sound (talking, stuttering, sounding
// out)? Used only to keep the help clock waiting — never to accept a word. Numbers only; no audio is kept.
// Noise floor: tracks the quietest recent level (falls at once, rises slowly), so a noisy room raises the bar.
export class VoiceActivity {
  floorRms = Infinity;
  maxRms = 0;
  chunks = 0;
  speechChunks = 0;
  private readonly minRms: number;
  private readonly ratio: number;
  constructor(o: { minRms?: number; ratio?: number } = {}) {
    this.minRms = o.minRms ?? 300; // ≈ −41 dBFS
    this.ratio = o.ratio ?? 3;     // ≈ 10 dB above the room
  }
  push(pcm: Int16Array): boolean {
    if (!pcm.length) return false;
    let e = 0; for (let i = 0; i < pcm.length; i++) e += pcm[i] * pcm[i];
    const rms = Math.sqrt(e / pcm.length);
    this.chunks++;
    if (rms > this.maxRms) this.maxRms = rms;
    // start from an assumed quiet room (a child may start speaking in the very first chunk), fall at once to quieter
    // levels, rise slowly (≈ 0.5 % of the gap per chunk) so a steadily noisy room stops counting after a few seconds
    if (!Number.isFinite(this.floorRms)) this.floorRms = this.minRms / this.ratio;
    this.floorRms = rms < this.floorRms ? Math.max(rms, 10) : this.floorRms + (rms - this.floorRms) * 0.005;
    const speech = rms >= this.minRms && rms >= this.floorRms * this.ratio;
    if (speech) this.speechChunks++;
    return speech;
  }
  stats() { return { chunks: this.chunks, speechChunks: this.speechChunks, floorRms: Number.isFinite(this.floorRms) ? Math.round(this.floorRms) : null, maxRms: Math.round(this.maxRms) }; }
}
