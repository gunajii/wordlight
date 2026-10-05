// S2 harness, synthetic-speech mode (automated, repeatable). For each test line and variant (correct, misread,
// omit, repeat, hesitate 1.2 s, pause 4.5 s) Polly speaks what a reader would say; the audio is streamed IN REAL
// TIME through the real reading pipeline (SessionHub → ReadingDriver → Amazon Transcribe Streaming → reading
// engine), exactly as phone chunks would arrive (40 ms, 16 kHz PCM16). Ground truth is exact: Polly's speech
// marks give when each spoken word starts. Scores:
//   recall@1s     correctly spoken words lit (word.read) within 1.0 s of being spoken
//   false accept  deliberately misread words that were lit as read
//   latency       word.read emit − spoken word start (server pipeline only; add phone→server from S3 for E2E)
// Synthetic adult TTS voices are NOT children: results characterise the pipeline, not child reading.
//   AWS_REGION=ap-south-1 node tools/s2/run-synth.ts [--only en-01] [--lang hi-IN] [--variants correct,misread] [--voices Kajal,Aditi]
import { PollyClient, SynthesizeSpeechCommand, DescribeVoicesCommand } from '@aws-sdk/client-polly';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionHub } from '../../server/src/hub.ts';
import { ReadingDriver, type TurnTrace } from '../../server/src/reading/driver.ts';
import { TranscribeSource } from '../../server/src/reading/speech.ts';
import { normalizeWord } from '@wordlight/reading-engine';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const region = process.env.AWS_REGION || 'ap-south-1';
const args = process.argv.slice(2);
const opt = (k: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : null);
const ONLY = opt('only'), LANG = opt('lang');
const VARIANTS = (opt('variants') ?? 'correct,misread,omit,repeat,hesitate,pause').split(',');
const VOICES = (opt('voices') ?? 'Kajal').split(',');
const polly = new PollyClient({ region });
const now = () => performance.timeOrigin + performance.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Label = 'correct' | 'misread' | 'omitted' | 'after-pause';
interface Spoken { text: string; exp: number | null; pauseBeforeMs: number }

function variant(line: any, v: string): { spoken: Spoken[]; labels: Label[] } {
  const words: string[] = line.text.split(/\s+/);
  const labels: Label[] = words.map(() => 'correct');
  const spoken: Spoken[] = [];
  words.forEach((w, i) => {
    let pause = 0;
    if (v === 'hesitate' && i === line.hesitate) pause = 1200;
    if (v === 'pause' && i === line.pause) { pause = 4500; labels[i] = 'after-pause'; }
    if (v === 'omit' && i === line.omit) { labels[i] = 'omitted'; return; }
    if (v === 'misread' && line.misread[String(i)]) { labels[i] = 'misread'; spoken.push({ text: line.misread[String(i)], exp: i, pauseBeforeMs: pause }); return; }
    spoken.push({ text: w, exp: i, pauseBeforeMs: pause });
    if (v === 'repeat' && i === line.repeat) spoken.push({ text: w.replace(/[.,!?।]+$/u, ''), exp: null, pauseBeforeMs: 150 });
  });
  return { spoken, labels };
}

async function synth(ssml: string, lang: string, voice: string, engine: string, format: 'pcm' | 'json') {
  const r = await polly.send(new SynthesizeSpeechCommand({ Engine: engine as any, VoiceId: voice as any, LanguageCode: lang as any, Text: ssml, TextType: 'ssml', OutputFormat: format, ...(format === 'pcm' ? { SampleRate: '16000' } : { SpeechMarkTypes: ['word'] }) }));
  return Buffer.from(await r.AudioStream!.transformToByteArray());
}

async function runTurn(hub: SessionHub, traces: TurnTrace[], tv: any, phone: any, sid: string, line: any, turnId: string, pcm: Int16Array) {
  hub.handle(tv, { type: 'turn.start', turnId, readerId: 'r1', storyId: 's2', page: 0, line: 0, words: line.text.split(/\s+/), lang: line.lang });
  const s = hub.get(sid)!;
  const tag = s.turn!.audioTag;
  const CH = 640; // 40 ms
  const T0 = now();
  const frames = Math.ceil(pcm.length / CH);
  for (let i = 0; ; i++) {
    const due = T0 + (i + 1) * 40;
    const wait = due - now(); if (wait > 0) await sleep(wait);
    if (!s.turn || s.turn.turn.turnId !== turnId) break; // line done
    const chunk = i < frames ? pcm.subarray(i * CH, (i + 1) * CH) : new Int16Array(CH); // after the audio: room silence
    const f = new Int16Array(CH); f.set(chunk);
    hub.audio(phone, { seq: i, tag, last: false, capturedAtMs: T0 + i * 40, pcm: f });
    if (i > frames + 250) { hub.endActiveTurn(s, 'exit'); break; } // 10 s after the audio: give up
  }
  await sleep(50);
  return { T0, trace: traces.find((t) => t.turnId === turnId)! };
}

async function main() {
  const { lines } = JSON.parse(readFileSync(path.join(ROOT, 'tools/s2/lines.json'), 'utf8'));
  const voiceInfo: Record<string, any> = {};
  for (const lang of ['hi-IN', 'en-IN']) {
    const v = await polly.send(new DescribeVoicesCommand({ LanguageCode: lang as any }));
    for (const x of v.Voices ?? []) voiceInfo[`${lang}:${x.Id}`] = x.SupportedEngines;
  }
  const traces: TurnTrace[] = [];
  const hub = new SessionHub({ now });
  hub.driver = new ReadingDriver({ hub, source: new TranscribeSource({ region }), now, onTrace: (t) => traces.push(t), devTranscripts: true });
  const sid = hub.createSession();
  const tv = { send: () => {} }, phone = { send: () => {} };
  hub.handle(tv, { t: 'hello', role: 'tv', sessionId: sid, clientId: 'tv' });
  hub.handle(phone, { t: 'hello', role: 'phone', sessionId: sid, clientId: 'p' });
  hub.handle(phone, { t: 'clock.report', offsetMs: 0, minRttMs: 0 }); // same process: phone clock = server clock
  const rows: any[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.join(ROOT, 'bench/runs/s2', `synth-${stamp}`);
  mkdirSync(out, { recursive: true });
  let n = 0;
  for (const line of lines) {
    if (ONLY && line.id !== ONLY) continue;
    if (LANG && line.lang !== LANG) continue;
    hub.handle(phone, { type: 'reader.save', reader: { readerId: 'r1', firstName: 'Test', age: 8, lang: line.lang }, consent: { microphone: true, atMs: 1 } });
    for (const voice of VOICES) {
      const engines = voiceInfo[`${line.lang}:${voice}`];
      if (!engines) { console.log(`skip ${voice} for ${line.lang}: not offered`); continue; }
      const engine = engines.includes('neural') ? 'neural' : 'standard';
      for (const v of VARIANTS) {
        const { spoken, labels } = variant(line, v);
        const ssml = `<speak>${spoken.map((w) => (w.pauseBeforeMs ? `<break time="${w.pauseBeforeMs}ms"/>` : '') + esc(w.text)).join(' ')}</speak>`;
        const pcmBuf = await synth(ssml, line.lang, voice, engine, 'pcm');
        const marks = (await synth(ssml, line.lang, voice, engine, 'json')).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.type === 'word');
        const pcm = new Int16Array(pcmBuf.buffer, pcmBuf.byteOffset, pcmBuf.byteLength >> 1);
        // spoken token j ↔ mark j (Polly marks every word it speaks, in order)
        const spokenAt = spoken.map((_, j) => (marks[j] ? marks[j].time : null));
        const turnId = `${line.id}-${voice}-${v}-${++n}`;
        const { T0, trace } = await runTurn(hub, traces, tv, phone, sid, line, turnId, new Int16Array(pcm));
        const words = line.text.split(/\s+/);
        const perWord = words.map((w: string, i: number) => {
          const j = spoken.findIndex((sp) => sp.exp === i);
          const spokenMs = j >= 0 && spokenAt[j] !== null ? T0 + (spokenAt[j] as number) : null;
          const ev = trace?.events.find((e) => e.index === i) ?? null;
          return { i, word: w, label: labels[i], said: j >= 0 ? spoken[j].text : null, outcome: ev?.kind ?? 'none', heard: ev?.heard ?? null, confidence: ev?.confidence ?? null,
            latencyMs: ev && ev.kind === 'read' && spokenMs !== null ? Math.round(ev.emitServerMs - spokenMs) : null,
            asrSpokenErrMs: ev?.spokenServerMs && spokenMs !== null ? Math.round(ev.spokenServerMs - spokenMs) : null };
        });
        const row = { line: line.id, lang: line.lang, voice, engine, variant: v, marks: marks.length, spokenTokens: spoken.length, endReason: trace?.endReason, error: trace?.error, result: trace?.result, perWord };
        rows.push(row);
        const lit = perWord.map((p: any) => (p.outcome === 'read' ? (p.label === 'misread' ? '✗' : '●') : p.outcome === 'helped' ? '○' : p.outcome === 'skipped' ? '-' : '·')).join('');
        console.log(`${turnId.padEnd(28)} ${lit}  ${perWord.filter((p: any) => p.latencyMs !== null).map((p: any) => p.latencyMs).join(' ')}${trace?.error ? '  ERROR ' + trace.error : ''}`);
      }
    }
  }
  writeFileSync(path.join(out, 'rows.json'), JSON.stringify(rows, null, 1));
  const m = score(rows);
  writeFileSync(path.join(out, 'metrics.json'), JSON.stringify(m, null, 1));
  console.log('\n' + JSON.stringify(m, null, 1));
  console.log(`\nwrote ${path.relative(ROOT, out)}`);
  process.exit(0);
}

export function score(rows: any[]) {
  const pick = (f: (r: any) => boolean) => rows.filter(f);
  const one = (rs: any[]) => {
    const words = rs.flatMap((r) => r.perWord);
    const correct = words.filter((w) => w.label === 'correct');
    const lit1s = correct.filter((w) => w.outcome === 'read' && w.latencyMs !== null && w.latencyMs <= 1000).length;
    const litAny = correct.filter((w) => w.outcome === 'read').length;
    const mis = words.filter((w) => w.label === 'misread');
    const misAcc = mis.filter((w) => w.outcome === 'read').length;
    const om = words.filter((w) => w.label === 'omitted');
    const omAcc = om.filter((w) => w.outcome === 'read').length;
    const ap = words.filter((w) => w.label === 'after-pause');
    const lat = correct.map((w) => w.latencyMs).filter((x: any) => x !== null).sort((a: number, b: number) => a - b);
    const q = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.ceil(p * lat.length) - 1)] : null);
    return {
      turns: rs.length, correctWords: correct.length, recall1s: correct.length ? Math.round((1000 * lit1s) / correct.length) / 10 : null, litEventually: correct.length ? Math.round((1000 * litAny) / correct.length) / 10 : null,
      misreadWords: mis.length, falseAccept: mis.length ? Math.round((1000 * misAcc) / mis.length) / 10 : null,
      omittedWords: om.length, omittedAccepted: omAcc, afterPauseHelped: ap.filter((w) => w.outcome === 'helped').length + '/' + ap.length,
      latencyMs: { n: lat.length, median: q(0.5), p95: q(0.95), max: lat.length ? lat[lat.length - 1] : null },
      errors: rs.filter((r) => r.error).length,
    };
  };
  const out: any = { all: one(rows) };
  for (const lang of ['en-IN', 'hi-IN']) out[lang] = one(pick((r) => r.lang === lang));
  for (const v of ['correct', 'misread', 'omit', 'repeat', 'hesitate', 'pause']) out[`variant:${v}`] = one(pick((r) => r.variant === v));
  out.pass = { recall1s: (out.all.recall1s ?? 0) >= 90, falseAccept: out.all.falseAccept !== null && out.all.falseAccept <= 10 };
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e?.name ?? '', e?.message ?? e); process.exit(1); });
