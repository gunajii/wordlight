// NarrationService — the content pipeline's text-to-speech boundary.
//   PollyNarration    Amazon Polly (neural): mp3 for the TV, 16 kHz PCM for the exact duration, word speech marks.
//   FixtureNarration  deterministic stand-in while AWS is unavailable (tones, exact Polly-format marks). Test content.
// Both return the same shape, so build-story runs the same mapping/validation either way. Tests run PollyNarration
// against a fake Polly client (fakePollyClient) — no network.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Heard } from './align.ts';
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
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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
    return new PollyNarration({ client: cachedPolly(new PollyClient({ region: o.region })), SynthesizeSpeechCommand, voiceId: o.voiceId, style: o.style });
  }
  private async synth(input: string, billed: number, ssml: boolean, lang: string, format: 'mp3' | 'pcm' | 'json'): Promise<Uint8Array> {
    usage.check('pollyChars', billed); usage.add('pollyChars', billed); // cost guard (Polly bills characters, not SSML tags)
    const r = await this.client.send(new this.Cmd({ Engine: 'neural', VoiceId: this.voice.id, LanguageCode: lang, Text: input, TextType: ssml ? 'ssml' : 'text', OutputFormat: format, ...(format === 'pcm' ? { SampleRate: '16000' } : {}), ...(format === 'json' ? { SpeechMarkTypes: ['word'] } : {}) }));
    return await r.AudioStream!.transformToByteArray();
  }
  /** One word, alone and slow — the TV's help clip (clear pronunciation, no seeking in the page audio). */
  async wordClip(word: string, lang: 'hi-IN' | 'en-IN'): Promise<Uint8Array> {
    const bare = word.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '');
    if (!bare || /[<>&]/.test(bare)) throw new Error(`no help clip for ${JSON.stringify(word)}`);
    return this.synth(`<speak><prosody rate="80%">${bare}</prosody></speak>`, bare.length, true, lang, 'mp3');
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

/**
 * Polly GENERATIVE voice (more expressive; English only for Kajal) — Polly returns no speech marks for it, so word
 * times come from Amazon Transcribe aligned to the known text (tools/content/align.ts), shifted by a calibrated
 * offset measured on neural audio (tools/s4/align-check.ts). timingSource 'transcribe'.
 */
type GenerativeOptions = { client: PollyLike; SynthesizeSpeechCommand: any; voiceId: string; style?: NarrationStyle | null; transcribe: (pcm: Int16Array, lang: 'hi-IN' | 'en-IN') => Promise<Heard[]>; offsetMs?: number };
export class GenerativeNarration implements NarrationService {
  readonly voice: StoryPackage['voice'];
  readonly timingSource = 'transcribe' as const;
  readonly stats: { page: number; tokens: number; matched: number }[] = [];
  private page = 0;
  private readonly o: GenerativeOptions;
  constructor(o: GenerativeOptions) {
    this.o = o;
    this.voice = { engine: 'polly-generative', id: o.voiceId, ...(hasStyle(o.style) ? { style: o.style } : {}) };
  }
  static async create(o: { region: string; transcribeRegion: string; voiceId: string; style?: NarrationStyle | null; offsetMs?: number }) {
    const { PollyClient, SynthesizeSpeechCommand } = await import('@aws-sdk/client-polly');
    const { TranscribeSource } = await import('../../server/src/reading/speech.ts');
    const { transcribeWords } = await import('./align.ts');
    const src = new TranscribeSource({ region: o.transcribeRegion });
    return new GenerativeNarration({ client: cachedPolly(new PollyClient({ region: o.region })), SynthesizeSpeechCommand, voiceId: o.voiceId, style: o.style, offsetMs: o.offsetMs, transcribe: cachedTranscribe((pcm, lang) => transcribeWords(src, pcm, lang)) });
  }
  async synthesize(text: string, lang: 'hi-IN' | 'en-IN', lines?: string[]): Promise<Narrated> {
    if (lang !== 'en-IN') throw new Error('generative narration: no generative Polly voice for ' + lang);
    const style = hasStyle(this.o.style) ? this.o.style : {};
    const s = pageSsml(lines ?? [text], style);
    if (s.text !== text) throw new Error('lines must join (single spaces) to the page text');
    const get = async (format: 'mp3' | 'pcm') => {
      usage.check('pollyChars', text.length); usage.add('pollyChars', text.length);
      const r = await this.o.client.send(new this.o.SynthesizeSpeechCommand({ Engine: 'generative', VoiceId: this.o.voiceId, LanguageCode: lang, Text: s.ssml, TextType: 'ssml', OutputFormat: format, ...(format === 'pcm' ? { SampleRate: '16000' } : {}) }));
      return await r.AudioStream!.transformToByteArray();
    };
    const mp3 = await get('mp3'), pcm = await get('pcm');
    const pcm16k = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + (pcm.byteLength & ~1)));
    const durationMs = Math.round((pcm16k.length / 16000) * 1000);
    const { tokenStarts, marksFromStarts } = await import('./align.ts');
    const heard = await this.o.transcribe(pcm16k, lang);
    const toks = text.split(/\s+/).filter(Boolean);
    const { t0, matched } = tokenStarts(toks, heard, lang, { offsetMs: this.o.offsetMs ?? 0, endMs: durationMs });
    this.stats.push({ page: ++this.page, tokens: toks.length, matched });
    return { mp3, durationMs, marksNdjson: marksFromStarts(text, t0), pcm16k };
  }
}

/** Cache Polly SynthesizeSpeech responses on disk (.dev/cache/polly): the audio that was measured is the audio shipped. */
export function cachedPolly(client: PollyLike, dir = path.join(ROOT, '.dev/cache/polly')): PollyLike {
  return {
    async send(cmd: any) {
      const key = createHash('sha256').update(JSON.stringify(cmd.input)).digest('hex').slice(0, 32);
      const f = path.join(dir, `${key}.bin`);
      if (existsSync(f)) { const b = readFileSync(f); return { AudioStream: { transformToByteArray: async () => new Uint8Array(b) } }; }
      const r = await client.send(cmd); const b = await r.AudioStream!.transformToByteArray();
      mkdirSync(dir, { recursive: true }); writeFileSync(f, b);
      return { AudioStream: { transformToByteArray: async () => b } };
    },
  };
}
/** Cache Transcribe alignment input → words, keyed by the audio bytes (.dev/cache/transcribe). */
export function cachedTranscribe(fn: (pcm: Int16Array, lang: 'hi-IN' | 'en-IN') => Promise<Heard[]>, dir = path.join(ROOT, '.dev/cache/transcribe')) {
  return async (pcm: Int16Array, lang: 'hi-IN' | 'en-IN') => {
    const key = createHash('sha256').update(lang).update(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)).digest('hex').slice(0, 32);
    const f = path.join(dir, `${key}.json`);
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')) as Heard[];
    const h = await fn(pcm, lang); mkdirSync(dir, { recursive: true }); writeFileSync(f, JSON.stringify(h));
    return h;
  };
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
