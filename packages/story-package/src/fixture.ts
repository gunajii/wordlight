// Deterministic FIXTURE narration — a stand-in for Amazon Polly while AWS is unavailable, and the fake Polly used
// by tests. It produces exactly what Polly produces for a text (word speech marks with UTF-8 BYTE offsets, plus
// 16 kHz PCM16 audio), so the rest of the pipeline (byte mapping, story.json, TV playback) runs unchanged.
// The audio is a soft tone per word, not speech. Timings are exact by construction. It is test content: a story
// built with it says voice.engine 'synthetic-clicks' and timing.source 'synthetic' and is hidden from the shelf.
import type { SpeechMark } from './speechmarks.ts';

const enc = new TextEncoder();
export interface FixtureOptions { leadMs: number; msPerChar: number; minWordMs: number; gapMs: number; sentencePauseMs: number; tailMs: number }
export const FIXTURE_DEFAULTS: FixtureOptions = { leadMs: 300, msPerChar: 55, minWordMs: 220, gapMs: 90, sentencePauseMs: 450, tailMs: 400 };

/** Polly-format word marks for `text` (start/end are UTF-8 byte offsets), and the audio duration. */
export function fixtureMarks(text: string, o: FixtureOptions = FIXTURE_DEFAULTS): { marks: SpeechMark[]; durationMs: number; spans: { t0: number; t1: number }[] } {
  const marks: SpeechMark[] = [];
  const spans: { t0: number; t1: number }[] = [];
  let t = o.leadMs;
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0];
    // Polly marks the word without surrounding punctuation; a token that is only punctuation gets no mark.
    const lead = raw.match(/^[\p{P}\p{S}]*/u)![0], trail = raw.match(/[\p{P}\p{S}]*$/u)![0];
    const core = raw.slice(lead.length, raw.length - trail.length || undefined);
    if (!core) continue;
    const b0 = enc.encode(text.slice(0, m.index + lead.length)).length;
    const b1 = b0 + enc.encode(core).length;
    const dur = Math.max(o.minWordMs, [...core].length * o.msPerChar);
    marks.push({ time: t, type: 'word', start: b0, end: b1, value: core });
    spans.push({ t0: t, t1: t + dur });
    t += dur + o.gapMs + (/[.!?।]/u.test(trail) ? o.sentencePauseMs : 0);
  }
  return { marks, durationMs: t + o.tailMs, spans };
}

/** 16 kHz mono PCM16: a soft tone (with fade in/out) during each word span, silence elsewhere. */
export function fixturePcm(spans: { t0: number; t1: number }[], durationMs: number, sampleRate = 16000): Int16Array {
  const pcm = new Int16Array(Math.ceil((durationMs / 1000) * sampleRate));
  spans.forEach((s, k) => {
    const f = 330 + 55 * (k % 4); // a little melody so words are distinguishable
    const a = Math.floor((s.t0 / 1000) * sampleRate), b = Math.min(pcm.length, Math.floor((s.t1 / 1000) * sampleRate));
    const fade = Math.min(400, (b - a) >> 2);
    for (let i = a; i < b; i++) {
      const env = Math.min(1, (i - a) / fade, (b - i) / fade);
      pcm[i] = Math.round(6000 * env * Math.sin((2 * Math.PI * f * (i - a)) / sampleRate));
    }
  });
  return pcm;
}

/** Polly's NDJSON speech-mark output for marks (what SynthesizeSpeech returns with OutputFormat json). */
export const toNdjson = (marks: SpeechMark[]) => marks.map((m) => JSON.stringify(m)).join('\n') + '\n';
