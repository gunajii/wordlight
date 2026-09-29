// Binary audio frames (phone → server) during a reading turn.
// Layout (little-endian): u8 version=1 · u8 flags (bit0 = last frame) · u16 reserved ·
// u32 seq · f64 phone clock ms at the first sample · PCM16 mono 16 kHz samples.
// Binary rather than JSON/base64: a 100 ms chunk is 3.2 kB raw vs ~4.3 kB as base64 text.

export const AUDIO_SAMPLE_RATE = 16000;
export const AUDIO_HEADER_BYTES = 16;

export interface AudioFrame {
  seq: number;
  last: boolean;
  capturedAtMs: number;
  pcm: Int16Array;
}

export function encodeAudioFrame(f: AudioFrame): Uint8Array {
  const out = new Uint8Array(AUDIO_HEADER_BYTES + f.pcm.length * 2);
  const dv = new DataView(out.buffer);
  dv.setUint8(0, 1);
  dv.setUint8(1, f.last ? 1 : 0);
  dv.setUint32(4, f.seq >>> 0, true);
  dv.setFloat64(8, f.capturedAtMs, true);
  for (let i = 0; i < f.pcm.length; i++) dv.setInt16(AUDIO_HEADER_BYTES + i * 2, f.pcm[i], true);
  return out;
}

export function decodeAudioFrame(buf: Uint8Array): AudioFrame | null {
  if (buf.byteLength < AUDIO_HEADER_BYTES || (buf.byteLength - AUDIO_HEADER_BYTES) % 2 !== 0) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint8(0) !== 1) return null;
  const n = (buf.byteLength - AUDIO_HEADER_BYTES) / 2;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = dv.getInt16(AUDIO_HEADER_BYTES + i * 2, true);
  return { seq: dv.getUint32(4, true), last: (dv.getUint8(1) & 1) === 1, capturedAtMs: dv.getFloat64(8, true), pcm };
}
