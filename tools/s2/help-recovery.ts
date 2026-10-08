// Help-recovery measurement on the REAL recogniser: a reader gets stuck on a word, hesitates ("um… um…"), goes
// quiet, the TV helps (help clip plays — also leaking into the phone mic, as from a TV across the room), the reader
// repeats the helped word and carries on. Does the NEXT word get read, or is it helped too early?
//   AWS_REGION=ap-south-1 node tools/s2/help-recovery.ts [--configs before,after] [--pauses 600,1500]
// Speech: Amazon Polly Kajal (ADULT synthetic voice), streamed in real time to Amazon Transcribe Streaming through
// the production SessionHub → ReadingDriver → ReadingTurn. The reader REACTS to the TV: the rest of the line is
// streamed only after the TV stub reports the help word finished (turn.help.done) + a reaction time.
// Configs: "before" = the driver as it was on 2026-10-08 (no voice activity, clock restarts at the help event);
//          "after"  = voice activity + clock restarts when the help word has finished.
// INFERRED constants (stated in the report): TV help start latency 300 ms, mic pickup of the TV at 30 % amplitude,
// reader reaction 500 ms after the help word ends. Cost ≈ 40 runs × ~10 s of Transcribe ≈ USD 0.15.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionHub } from '../../server/src/hub.ts';
import { ReadingDriver, type TurnTrace } from '../../server/src/reading/driver.ts';
import { cachedPolly } from '../content/narration.ts';
import { usage } from '../../server/src/usage.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const now = () => performance.timeOrigin + performance.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TV_START_MS = 300, LEAK = 0.3, REACTION_MS = 500;

export interface HelpCase { id: string; lang: 'en-IN' | 'hi-IN'; words: string[]; stuck: number }
const bare = (w: string) => w.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '');

export function casesFromStories(ids = ['busy-ants', 'busy-ants-hi', 'wl-test-kite']): HelpCase[] {
  const out: HelpCase[] = [];
  for (const id of ids) {
    const s = JSON.parse(readFileSync(path.join(ROOT, 'content/stories', id, 'story.json'), 'utf8'));
    s.pages.forEach((p: any, pi: number) => p.lines.forEach((l: any, li: number) => {
      if (!l.turn || l.words.length < 3) return;
      out.push({ id: `${id}-${pi}-${li}`, lang: s.lang, words: l.words.map((w: any) => w.w), stuck: Math.floor((l.words.length - 1) / 2) });
    }));
  }
  return out;
}

async function main() {
  const a = process.argv.slice(2); const opt = (k: string) => (a.includes(`--${k}`) ? a[a.indexOf(`--${k}`) + 1] : null);
  const region = process.env.AWS_REGION || 'ap-south-1';
  const { PollyClient, SynthesizeSpeechCommand } = await import('@aws-sdk/client-polly');
  const { TranscribeSource } = await import('../../server/src/reading/speech.ts');
  const polly = cachedPolly(new PollyClient({ region }));
  const pcmOf = async (ssml: string, lang: string) => {
    const chars = ssml.replace(/<[^>]+>/g, '').length; usage.check('pollyChars', chars); usage.add('pollyChars', chars);
    const r = await polly.send(new SynthesizeSpeechCommand({ Engine: 'neural', VoiceId: 'Kajal', LanguageCode: lang as any, Text: ssml, TextType: 'ssml', OutputFormat: 'pcm', SampleRate: '16000' }));
    const b = await r.AudioStream!.transformToByteArray();
    return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.byteLength & ~1)));
  };
  const configs = (opt('configs') ?? 'before,after').split(',');
  const pauses = (opt('pauses') ?? '600,1500').split(',').map(Number);
  const cases = casesFromStories();
  const rows: any[] = [];
  for (const c of cases) for (const pause of pauses) for (const cfg of configs) {
    const hes = c.lang === 'hi-IN' ? 'अ' : 'um';
    const segA = await pcmOf(`<speak>${c.words.slice(0, c.stuck).map(bare).join(' ')} <break time="250ms"/> ${hes}, <break time="350ms"/> ${hes}…</speak>`, c.lang);
    const clip = await pcmOf(`<speak><prosody rate="80%">${bare(c.words[c.stuck])}</prosody></speak>`, c.lang);
    const segB = await pcmOf(`<speak>${bare(c.words[c.stuck])} <break time="${pause}ms"/> ${c.words.slice(c.stuck + 1).map(bare).join(' ')}</speak>`, c.lang);
    const r = await runOne(c, cfg, pause, { segA, clip, segB }, new TranscribeSource({ region }));
    rows.push(r);
    console.log(`${cfg.padEnd(6)} pause ${String(pause).padStart(4)} ${c.id.padEnd(20)} next word: ${r.nextOutcome.padEnd(7)} ${r.recoveryMs !== null ? `recovered ${r.recoveryMs} ms after the help word` : ''} helps ${r.helps.join(',')}`);
  }
  // summary
  const sum = (cfg: string, pause?: number) => {
    const rs = rows.filter((r) => r.config === cfg && (pause === undefined || r.pause === pause));
    const rec = rs.map((r) => r.recoveryMs).filter((x: any) => x !== null).sort((x: number, y: number) => x - y);
    return { runs: rs.length, nextRead: rs.filter((r) => r.nextOutcome === 'read').length, nextHelpedTooEarly: rs.filter((r) => r.nextOutcome === 'helped').length, lineCompleted: rs.filter((r) => r.completed).length,
      recoveryMedianMs: rec.length ? rec[rec.length >> 1] : null, helpAfterQuietMedianMs: median(rs.map((r) => r.helpAfterHesitationMs)) };
  };
  const median = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null).sort((p, q) => p - q); return v.length ? v[v.length >> 1] : null; };
  const S: any = {}; for (const cfg of configs) { S[cfg] = sum(cfg); for (const p of pauses) S[`${cfg} pause ${p}`] = sum(cfg, p); }
  const stamp = new Date().toISOString().slice(0, 16).replace(/:/g, '-');
  const out = path.join(ROOT, 'docs/results/help', `recovery-${stamp}`); mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ date: new Date().toISOString(), region, constants: { TV_START_MS, LEAK, REACTION_MS }, summary: S, rows }, null, 1));
  const L = ['# Help recovery on the real recogniser (adult synthetic voice)', '', `- ${new Date().toISOString()} · Amazon Transcribe Streaming ${region} · Polly Kajal neural (adult) · ${cases.length} turn lines from the shipped stories × pauses ${pauses.join('/')} ms × configs ${configs.join('/')}`,
    `- Reader: words before the stuck word, then "um… um…" (en) / "अ… अ…" (hi), then quiet until the TV helps. The help word plays (start latency ${TV_START_MS} ms INFERRED, also leaking into the mic at ${LEAK * 100} % amplitude), the reader reacts ${REACTION_MS} ms after it ends (INFERRED), repeats the helped word, pauses (600 ms normal / 1500 ms slow), then reads the rest.`,
    '- "before" = driver as deployed until 2026-10-09 (no voice activity; clock restarts at the help event). "after" = voice activity + clock restarts when the TV reports the help word finished.', '',
    '| config | runs | next word read | next word helped too early | line completed | recovery median (help word end → next word lit) | help after hesitation ended (median) |', '|---|---|---|---|---|---|---|',
    ...Object.entries(S).map(([k, v]: any) => `| ${k} | ${v.runs} | ${v.nextRead} | ${v.nextHelpedTooEarly} | ${v.lineCompleted} | ${v.recoveryMedianMs ?? '–'} ms | ${v.helpAfterQuietMedianMs ?? '–'} ms |`), '',
    'MEASURED with an adult synthetic voice and the constants above; a child\'s timing is UNKNOWN.'];
  writeFileSync(path.join(out, 'report.md'), L.join('\n') + '\n');
  console.log('\n' + L.join('\n'));
}

export async function runOne(c: HelpCase, cfg: string, pause: number, au: { segA: Int16Array; clip: Int16Array; segB: Int16Array }, source: any) {
  const after = cfg === 'after';
  const traces: TurnTrace[] = [];
  const hub = new SessionHub({ now });
  hub.driver = new ReadingDriver({ hub, source, now, onTrace: (t) => traces.push(t), voiceActivity: after, awaitHelpDone: after });
  const sid = hub.createSession();
  const tvOut: any[] = []; const tv = { send: (m: any) => tvOut.push(m) }, phone = { send: () => {} };
  hub.handle(tv, { t: 'hello', role: 'tv', sessionId: sid, clientId: 'tv' });
  hub.handle(phone, { t: 'hello', role: 'phone', sessionId: sid, clientId: 'p' });
  hub.handle(phone, { t: 'clock.report', offsetMs: 0, minRttMs: 0 });
  hub.handle(phone, { type: 'reader.save', reader: { readerId: 'r1', firstName: 'Test', age: 10, lang: c.lang }, consent: { microphone: true, atMs: 1 } });
  const turnId = `${c.id}-${cfg}-${pause}`.slice(0, 64);
  hub.handle(tv, { type: 'turn.start', turnId, readerId: 'r1', storyId: 'help', page: 0, line: 0, words: c.words, lang: c.lang, mode: 'echo' });
  const s = hub.get(sid)!; const tag = s.turn!.audioTag;
  const FRAME = 640; const T0 = now();
  let queue = Array.from(au.segA); // the reader's own speech still to stream
  let leak: number[] = []; // TV audio reaching the mic
  const segAEnd = au.segA.length / 16;
  let helpEmitMs: number | null = null, helpDoneMs: number | null = null, segBAt: number | null = null; const helps: number[] = [];
  for (let i = 0; i < 1000 && s.turn; i++) {
    const wait = T0 + i * 40 - now(); if (wait > 0) await sleep(wait);
    for (const m of tvOut.splice(0)) if (m.type === 'word.helped') {
      helps.push(m.index);
      if (m.index === c.stuck && helpEmitMs === null) {
        helpEmitMs = now() - T0;
        const clipMs = au.clip.length / 16;
        setTimeout(() => { leak = Array.from(au.clip, (v) => Math.round(v * LEAK)); }, TV_START_MS);
        setTimeout(() => {
          helpDoneMs = now() - T0;
          hub.handle(tv, { type: 'turn.help.done', turnId, index: m.index });
          setTimeout(() => { segBAt = now() - T0; queue = queue.concat(Array.from(au.segB)); }, REACTION_MS);
        }, TV_START_MS + clipMs);
      } else setTimeout(() => hub.handle(tv, { type: 'turn.help.done', turnId, index: m.index }), TV_START_MS + 600); // any other help: a ~0.6 s word
    }
    const f = new Int16Array(FRAME);
    for (let k = 0; k < FRAME; k++) { const v = (queue.length ? queue.shift()! : 0) + (leak.length ? leak.shift()! : 0); f[k] = Math.max(-32768, Math.min(32767, v)); }
    hub.audio(phone, { seq: i, tag, last: false, capturedAtMs: now(), pcm: f });
    if (segBAt !== null && !queue.length && now() - T0 > segBAt + 9000) { hub.endActiveTurn(s, 'exit'); break; }
  }
  await sleep(50);
  const tr = traces[0];
  const ev = (i: number) => tr?.events.find((e) => e.index === i);
  const next = ev(c.stuck + 1);
  const T = (x: number | null | undefined) => (x == null ? null : Math.round(x - T0));
  return {
    id: c.id, lang: c.lang, config: cfg, pause, words: c.words.join(' '), stuck: c.stuck,
    helps, helpAfterHesitationMs: helpEmitMs !== null ? Math.round(helpEmitMs - segAEnd) : null,
    helpEmitMs: helpEmitMs !== null ? Math.round(helpEmitMs) : null, helpDoneMs: helpDoneMs !== null ? Math.round(helpDoneMs) : null, segBStartMs: segBAt !== null ? Math.round(segBAt) : null,
    nextOutcome: next?.kind ?? 'none', nextAtMs: T(next?.emitServerMs),
    recoveryMs: next?.kind === 'read' && helpDoneMs !== null ? Math.round((next.emitServerMs - T0) - helpDoneMs) : null,
    completed: tr?.endReason === 'done', result: tr?.result ?? null, activity: tr?.activity ?? null,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e?.name ?? '', e?.message ?? e); process.exit(1); });
