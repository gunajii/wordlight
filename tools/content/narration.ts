// NarrationService — the content pipeline's text-to-speech boundary.
//   PollyNarration    Amazon Polly (neural): mp3 for the TV, 16 kHz PCM for the exact duration, word speech marks.
//   FixtureNarration  deterministic stand-in while AWS is unavailable (tones, exact Polly-format marks). Test content.
// Both return the same shape, so build-story runs the same mapping/validation either way. Tests run PollyNarration
// against a fake Polly client (fakePollyClient) — no network.
import { execFileSync } from 'node:child_process';
import { fixtureMarks, fixturePcm, toNdjson, type StoryPackage } from '@wordlight/story-package';

export interface Narrated { mp3: Uint8Array; durationMs: number; marksNdjson: string }
export interface NarrationService {
  readonly voice: StoryPackage['voice'];
  readonly timingSource: StoryPackage['timing']['source'];
  synthesize(text: string, lang: 'hi-IN' | 'en-IN'): Promise<Narrated>;
}

type PollyLike = { send(cmd: any): Promise<any> };

export class PollyNarration implements NarrationService {
  readonly voice: StoryPackage['voice'];
  readonly timingSource = 'polly-speech-marks' as const;
  private readonly client: PollyLike; private readonly Cmd: any;
  constructor(o: { client: PollyLike; SynthesizeSpeechCommand: any; voiceId: string }) {
    this.client = o.client; this.Cmd = o.SynthesizeSpeechCommand; this.voice = { engine: 'polly-neural', id: o.voiceId };
  }
  static async create(o: { region: string; voiceId: string }) {
    const { PollyClient, SynthesizeSpeechCommand } = await import('@aws-sdk/client-polly');
    return new PollyNarration({ client: new PollyClient({ region: o.region }), SynthesizeSpeechCommand, voiceId: o.voiceId });
  }
  private async synth(text: string, lang: string, format: 'mp3' | 'pcm' | 'json'): Promise<Uint8Array> {
    const r = await this.client.send(new this.Cmd({ Engine: 'neural', VoiceId: this.voice.id, LanguageCode: lang, Text: text, TextType: 'text', OutputFormat: format, ...(format === 'pcm' ? { SampleRate: '16000' } : {}), ...(format === 'json' ? { SpeechMarkTypes: ['word'] } : {}) }));
    return await r.AudioStream!.transformToByteArray();
  }
  async synthesize(text: string, lang: 'hi-IN' | 'en-IN'): Promise<Narrated> {
    const [mp3, pcm, marks] = [await this.synth(text, lang, 'mp3'), await this.synth(text, lang, 'pcm'), await this.synth(text, lang, 'json')];
    return { mp3, durationMs: Math.round((pcm.length / 2 / 16000) * 1000), marksNdjson: new TextDecoder().decode(marks) };
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
    return { mp3: new Uint8Array(mp3), durationMs, marksNdjson: toNdjson(marks) };
  }
}

/** A fake Polly client for tests: answers SynthesizeSpeech like Polly would (marks with UTF-8 byte offsets). */
export function fakePollyClient(log: any[] = []): { client: PollyLike; SynthesizeSpeechCommand: any } {
  class SynthesizeSpeechCommand { input: any; constructor(i: any) { this.input = i; } }
  const client = {
    async send(cmd: any) {
      const i = cmd.input; log.push(i);
      const { marks, durationMs, spans } = fixtureMarks(i.Text);
      const body = i.OutputFormat === 'json' ? new TextEncoder().encode(toNdjson(marks))
        : i.OutputFormat === 'pcm' ? new Uint8Array(fixturePcm(spans, durationMs).buffer)
        : new Uint8Array([0xff, 0xfb, 0x90, 0x00]); // an mp3 frame header is enough for the pipeline
      return { AudioStream: { transformToByteArray: async () => body } };
    },
  };
  return { client, SynthesizeSpeechCommand };
}
