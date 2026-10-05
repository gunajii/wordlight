// The speech-recognition service boundary. The reading engine consumes TranscriptUpdate; a SpeechSource
// (= SpeechRecognitionService) turns a stream of 16 kHz PCM16 chunks (40 ms) into those updates.
//   • TranscribeSource — Amazon Transcribe Streaming (production; the only path any S2 result may come from).
//   • ScriptedSource   — ./scripted.ts, LOCAL SIMULATION for development: plays a deterministic script of
//                        partial/stable transcripts (correct, slip, hesitation, misread, correction, stall,
//                        silence). It never reads the audio. Results from it are labelled SIMULATED everywhere.
import { StartStreamTranscriptionCommand, TranscribeStreamingClient } from '@aws-sdk/client-transcribe-streaming';
import type { TranscriptUpdate } from '@wordlight/reading-engine';

export interface SpeechWord { text: string; stable?: boolean; confidence?: number; startMs?: number; endMs?: number }
/** An update plus timing: startMs/endMs of words are relative to the first audio sent in this session. */
export interface SpeechUpdate extends TranscriptUpdate { words: SpeechWord[]; receivedAtMs: number }
export interface SpeechHandlers { onUpdate: (u: SpeechUpdate) => void; onError: (e: Error) => void; onClose: () => void }
export interface SpeechSession { push(pcm: Int16Array): void; end(): void; readonly stats: { chunks: number; bytes: number; updates: number } }
export interface SpeechSource {
  /** 'transcribe' for the real service; anything else is not real recognition */
  readonly name: string;
  /** true for a local simulation — callers must label every result SIMULATED */
  readonly simulated?: boolean;
  open(o: { lang: 'hi-IN' | 'en-IN'; expected?: string[] }, h: SpeechHandlers): SpeechSession;
}
export type SpeechRecognitionService = SpeechSource;

// ---------------- Amazon Transcribe Streaming ----------------
type ClientLike = { send(cmd: any): Promise<any> };

export class TranscribeSource implements SpeechSource {
  readonly name = 'transcribe';
  private readonly client: ClientLike;
  private readonly now: () => number;
  private readonly stability: 'high' | 'medium' | 'low' | null;
  constructor(o: { region?: string; client?: ClientLike; now?: () => number; stability?: 'high' | 'medium' | 'low' | null } = {}) {
    this.client = o.client ?? new TranscribeStreamingClient({ region: o.region ?? process.env.AWS_REGION ?? 'ap-south-1' });
    this.now = o.now ?? (() => performance.timeOrigin + performance.now());
    this.stability = o.stability === undefined ? 'high' : o.stability;
  }

  open(o: { lang: 'hi-IN' | 'en-IN' }, h: SpeechHandlers): SpeechSession {
    const queue: Uint8Array[] = [];
    let wake: (() => void) | null = null;
    let ended = false, closed = false;
    const stats = { chunks: 0, bytes: 0, updates: 0 };
    const notify = () => { const w = wake; wake = null; w?.(); };
    async function* audio() {
      for (;;) {
        while (queue.length) yield { AudioEvent: { AudioChunk: queue.shift()! } };
        if (ended) return; // ends the input stream: Transcribe flushes final results, then closes
        await new Promise<void>((r) => (wake = r));
      }
    }
    const close = () => { if (!closed) { closed = true; h.onClose(); } };
    const run = async (stability: 'high' | 'medium' | 'low' | null) => {
      const res = await this.client.send(new StartStreamTranscriptionCommand({
        LanguageCode: o.lang, MediaEncoding: 'pcm', MediaSampleRateHertz: 16000, AudioStream: audio(),
        ...(stability ? { EnablePartialResultsStabilization: true, PartialResultsStability: stability } : {}),
      }));
      for await (const ev of res.TranscriptResultStream ?? []) {
        if (ev.BadRequestException || ev.LimitExceededException || ev.InternalFailureException || ev.ServiceUnavailableException || ev.ConflictException) {
          const ex = ev.BadRequestException ?? ev.LimitExceededException ?? ev.InternalFailureException ?? ev.ServiceUnavailableException ?? ev.ConflictException;
          throw Object.assign(new Error(ex?.Message ?? 'transcribe stream error'), { name: Object.keys(ev)[0] });
        }
        for (const r of ev.TranscriptEvent?.Transcript?.Results ?? []) {
          const items = (r.Alternatives?.[0]?.Items ?? []).filter((it: any) => it.Type === 'pronunciation');
          stats.updates++;
          h.onUpdate({
            segmentId: r.ResultId ?? 'r', final: !r.IsPartial, receivedAtMs: this.now(),
            words: items.map((it: any) => ({ text: it.Content ?? '', stable: it.Stable ?? !r.IsPartial, confidence: it.Confidence ?? undefined, startMs: Math.round((it.StartTime ?? 0) * 1000), endMs: Math.round((it.EndTime ?? 0) * 1000) })),
          });
        }
      }
    };
    run(this.stability).catch(async (e: any) => {
      // If this language rejects partial-result stabilisation, retry once without it (only before any audio was consumed).
      if (this.stability && /stabili[sz]ation/i.test(String(e?.message)) && stats.updates === 0) {
        try { await run(null); return; } catch (e2: any) { e = e2; }
      }
      if (!closed) h.onError(e instanceof Error ? e : new Error(String(e)));
    }).finally(close);
    return {
      stats,
      push(pcm: Int16Array) {
        if (ended) return;
        stats.chunks++; stats.bytes += pcm.byteLength;
        queue.push(new Uint8Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength))); // little-endian PCM16 as Transcribe expects
        notify();
      },
      end() { ended = true; notify(); },
    };
  }
}

// The local development adapter (ScriptedSource) lives in ./scripted.ts.
