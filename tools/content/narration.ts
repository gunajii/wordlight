// NarrationService — the content pipeline's text-to-speech boundary.
//   PollyNarration    Amazon Polly (neural): mp3 for the TV, 16 kHz PCM for the exact duration, word speech marks.
//   FixtureNarration  deterministic stand-in while AWS is unavailable (tones, exact Polly-format marks). Test content.
// Both return the same shape, so build-story runs the same mapping/validation either way. Tests run PollyNarration
// against a fake Polly client (fakePollyClient) — no network.
import { execFileSync } from 'node:child_process';
import { fixtureMarks, fixturePcm, toNdjson, pageSsml, marksToText, parseSpeechMarks, hasStyle, type StoryPackage, type NarrationStyle } from '@wordlight/story-package';
import { usage } from '../../server/src/usage.ts';

export interface Narrated { mp3: Uint8Array; durationMs: number; marksNdjson: string; /** 16 kHz mono PCM16 of the same speech */ pcm16k?: Int16Array }
export interface NarrationService {
  readonly voice: StoryPackage['voice'];
  readonly timingSource: StoryPackage['timing']['source'];
  /** `lines` (joined by single spaces = text) lets a styled narrator pause between lines. */
  synthesize(text: string, lang: 'hi-IN' | 'en-IN', lines?: string[]): Promise<Narrated>;
}

type PollyLike = { send(cmd: any): Promise<any> };

export class PollyNarration implements NarrationService {
  readonly voice: StoryPackage['voice'];
  readonly timingSource = 'polly-speech-marks' as const;
  private readonly client: PollyLike; private readonly Cmd: any; private readonly style: NarrationStyle | null;
  constructor(o: { client: PollyLike; SynthesizeSpeechCommand: any; voiceId: string; style?: NarrationStyle | null }) {
    this.client = o.client; this.Cmd = o.SynthesizeSpeechCommand; this.style = hasStyle(o.style) ? o.style : null;
    this.voice = { engine: 'polly-neural', id: o.voiceId, ...(this.style ? { style: this.style } : {}) };
  }
  static async create(o: { region: string; voiceId: string; style?: NarrationStyle | null }) {
    const { PollyClient, SynthesizeSpeechCommand } = await import('@aws-sdk/client-polly');
    return new PollyNarration({ client: new PollyClient({ region: o.region }), SynthesizeSpeechCommand, voiceId: o.voiceId, style: o.style });
  }
  private async synth(input: string, billed: number, ssml: boolean, lang: string, format: 'mp3' | 'pcm' | 'json'): Promise<Uint8Array> {
    usage.check('pollyChars', billed); usage.add('pollyChars', billed); // cost guard (Polly bills characters, not SSML tags)
    const r = await this.client.send(new this.Cmd({ Engine: 'neural', VoiceId: this.voice.id, LanguageCode: lang, Text: input, TextType: ssml ? 'ssml' : 'text', OutputFormat: format, ...(format === 'pcm' ? { SampleRate: '16000' } : {}), ...(format === 'json' ? { SpeechMarkTypes: ['word'] } : {}) }));
    return await r.AudioStream!.transformToByteArray();
  }
  async synthesize(text: string, lang: 'hi-IN' | 'en-IN', lines?: string[]): Promise<Narrated> {
    const s = this.style ? pageSsml(lines ?? [text], this.style) : null;
    if (s && s.text !== text) throw new Error('lines must join (single spaces) to the page text');
    const input = s ? s.ssml : text;
    const get = (f: 'mp3' | 'pcm' | 'json') => this.synth(input, text.length, !!s, lang, f);
    const [mp3, pcm, marks] = [await get('mp3'), await get('pcm'), await get('json')];
    let marksNdjson = new TextDecoder().decode(marks);
    if (s) marksNdjson = toNdjson(marksToText(parseSpeechMarks(marksNdjson), s.toTextByte)); // SSML offsets → text offsets
    const pcm16k = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + (pcm.byteLength & ~1)));
    return { mp3, durationMs: Math.round((pcm.length / 2 / 16000) * 1000), marksNdjson, pcm16k };
  }
}

/** Tones + exact marks. mp3 via ffmpeg (as Polly's mp3 would be). */
export class FixtureNarration implements NarrationService {
  readonly voice = { engine: 'synthetic-clicks', id: 'fixture-tones' } as const;
  readonly timingSource = 'synthetic' as const;
  async synthesize(text: string): Promise<Narrated> {
    const { marks, durationMs, spans } = fixtureMarks(text);
    const pcm = fixturePcm(spans, durationMs);
    const mp3 = execFileSync('ffmpeg', ['-v', 'error', '-f', 's16le', '-ar', '16000', '-ac', '1', '-i', '-', '-b:a', '64k', '-f', 'mp3', '-'], { input: Buffer.from(pcm.buffer), maxBuffer: 64 << 20 });
    return { mp3: new Uint8Array(mp3), durationMs, marksNdjson: toNdjson(marks), pcm16k: pcm };
  }
}

/** A fake Polly client for tests: answers SynthesizeSpeech like Polly would (marks with UTF-8 byte offsets). */
export function fakePollyClient(log: any[] = []): { client: PollyLike; SynthesizeSpeechCommand: any } {
  class SynthesizeSpeechCommand { input: any; constructor(i: any) { this.input = i; } }
  const client = {
    async send(cmd: any) {
      const i = cmd.input; log.push(i);
      // SSML: mask the (ASCII) tags with spaces so offsets stay SSML byte offsets, as Polly's are
      const text = i.TextType === 'ssml' ? String(i.Text).replace(/<[^>]*>/g, (t: string) => ' '.repeat(t.length)) : i.Text;
      const { marks, durationMs, spans } = fixtureMarks(text);
      const body = i.OutputFormat === 'json' ? new TextEncoder().encode(toNdjson(marks))
        : i.OutputFormat === 'pcm' ? new Uint8Array(fixturePcm(spans, durationMs).buffer)
        : new Uint8Array([0xff, 0xfb, 0x90, 0x00]); // an mp3 frame header is enough for the pipeline
      return { AudioStream: { transformToByteArray: async () => body } };
    },
  };
  return { client, SynthesizeSpeechCommand };
}
