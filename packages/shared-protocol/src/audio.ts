// Binary audio frames (phone → server) during a reading turn.
// Layout (little-endian), 16-byte header then samples:
//   u8  version = 1
//   u8  flags   (bit0 = last frame of the turn)
//   u16 tag     audio tag of the turn (server-assigned in turn.start; 0 = none). Frames whose tag is not the
//               active turn's are dropped, so a late frame from an ended turn can never be counted in the next.
//   u32 seq     0,1,2… per turn; the server detects gaps, duplicates and reordering from it
//   f64 capturedAtMs  PHONE clock (performance.now) at the chunk's first sample — never a server time
//   …   PCM16 signed, mono, 16 000 Hz; sampleCount = (bytes − 16) / 2
// Binary rather than JSON/base64: a 100 ms chunk is 3.2 kB raw vs ~4.3 kB as base64 text.
// (The u16 was 'reserved' and always 0 before the S3 spike, so earlier encoders remain decodable.)

export const AUDIO_SAMPLE_RATE = 16000;
export const AUDIO_HEADER_BYTES = 16;

export interface AudioFrame {
  seq: number;
  /** turn audio tag (u16); 0 when absent */
  tag?: number;
  last: boolean;
  capturedAtMs: number;
  pcm: Int16Array;
}

export function encodeAudioFrame(f: AudioFrame): Uint8Array {
  const out = new Uint8Array(AUDIO_HEADER_BYTES + f.pcm.length * 2);
  const dv = new DataView(out.buffer);
  dv.setUint8(0, 1);
  dv.setUint8(1, f.last ? 1 : 0);
  dv.setUint16(2, (f.tag ?? 0) & 0xffff, true);
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
  return { seq: dv.getUint32(4, true), tag: dv.getUint16(2, true), last: (dv.getUint8(1) & 1) === 1, capturedAtMs: dv.getFloat64(8, true), pcm };
}
