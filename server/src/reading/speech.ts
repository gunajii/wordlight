// Speech sources for a reading turn. The reading engine consumes TranscriptUpdate; a SpeechSource turns a
// stream of 16 kHz PCM16 chunks into those updates.
//   • TranscribeSource — Amazon Transcribe Streaming (the real path).
//   • SimSource        — DEV ONLY: ignores the audio and "reads" the expected words on a timer (optionally
//                        stalling), so the TV loop can be developed without AWS. Never used for measurements
//                        or the demo; the server logs loudly when it is active.
import { StartStreamTranscriptionCommand, TranscribeStreamingClient } from '@aws-sdk/client-transcribe-streaming';
import type { TranscriptUpdate } from '@wordlight/reading-engine';

export interface SpeechWord { text: string; stable?: boolean; confidence?: number; startMs?: number; endMs?: number }
/** An update plus timing: startMs/endMs of words are relative to the first audio sent in this session. */
export interface SpeechUpdate extends TranscriptUpdate { words: SpeechWord[]; receivedAtMs: number }
export interface SpeechHandlers { onUpdate: (u: SpeechUpdate) => void; onError: (e: Error) => void; onClose: () => void }
export interface SpeechSession { push(pcm: Int16Array): void; end(): void; readonly stats: { chunks: number; bytes: number; updates: number } }
export interface SpeechSource { readonly name: string; open(o: { lang: 'hi-IN' | 'en-IN'; expected?: string[] }, h: SpeechHandlers): SpeechSession }

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

// ---------------- DEV ONLY: simulated reader ----------------
/** Reads `expected` words one by one every `paceMs`, after `leadMs`; stalls (says nothing) at word `stallAt`. */
export class SimSource implements SpeechSource {
  readonly name = 'sim';
  private readonly o: { paceMs: number; leadMs: number; stallAt: number | null; now: () => number };
  constructor(o: Partial<{ paceMs: number; leadMs: number; stallAt: number | null; now: () => number }> = {}) {
    this.o = { paceMs: o.paceMs ?? 550, leadMs: o.leadMs ?? 800, stallAt: o.stallAt ?? null, now: o.now ?? (() => performance.timeOrigin + performance.now()) };
  }
  open(o: { lang: 'hi-IN' | 'en-IN'; expected?: string[] }, h: SpeechHandlers): SpeechSession {
    const words = o.expected ?? [];
    const stats = { chunks: 0, bytes: 0, updates: 0 };
    let i = 0, stopped = false;
    const said: SpeechWord[] = [];
    const step = () => {
      if (stopped) return;
      if (i >= words.length) return;
      if (this.o.stallAt === i) { i++; timer = setTimeout(step, 3500 + this.o.paceMs); return; } // stall: let help fire, then go on
      said.push({ text: words[i], stable: true, confidence: 0.9 });
      i++;
      stats.updates++;
      h.onUpdate({ segmentId: 'sim', final: i >= words.length, words: said.slice(), receivedAtMs: this.o.now() });
      timer = setTimeout(step, this.o.paceMs);
    };
    let timer: ReturnType<typeof setTimeout> = setTimeout(step, this.o.leadMs);
    return {
      stats,
      push(pcm: Int16Array) { stats.chunks++; stats.bytes += pcm.byteLength; },
      end() { stopped = true; clearTimeout(timer); h.onClose(); },
    };
  }
}
