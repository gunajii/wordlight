// S4: Polly (Kajal, neural) narration + word speech marks, and an independent timing reference from
// Amazon Transcribe Streaming run on the SAME audio. Runs on the Mac with the developer's AWS credentials
// (~/.aws; never in the repo or chat). Output (gitignored): content/build/s4/<id>.{txt,pcm,mp3,marks.ndjson,tokens.json,transcribe.json}
//   AWS_REGION=ap-south-1 node tools/s4/polly-s4.ts [--only hi-1] [--no-transcribe]
//   node tools/s4/polly-s4.ts --fixture      SIMULATED: fixture narration (tones, exact marks) and a synthetic
//                                            "Transcribe" reference with known errors → content/build/s4-fixture.
//                                            Exercises the analysis/report code; it is not an S4 result.
// The analysis runs separately (tools/s4/analyze.py) so it can be re-run without AWS calls.
import { PollyClient, SynthesizeSpeechCommand, DescribeVoicesCommand } from '@aws-sdk/client-polly';
import { TranscribeStreamingClient, StartStreamTranscriptionCommand } from '@aws-sdk/client-transcribe-streaming';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSpeechMarks, timeTokens, displayTokens, markByteMismatches, fixtureMarks, fixturePcm } from '@wordlight/story-package';
import { usage } from '../../server/src/usage.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const region = process.env.AWS_REGION || 'ap-south-1';
const args = process.argv.slice(2);
const FIXTURE = args.includes('--fixture');
const OUT = path.join(ROOT, FIXTURE ? 'content/build/s4-fixture' : 'content/build/s4');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const doTranscribe = !args.includes('--no-transcribe');
const VOICE = 'Kajal';
const polly = new PollyClient({ region });
const transcribe = new TranscribeStreamingClient({ region });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function synth(text: string, lang: string, format: 'pcm' | 'mp3' | 'json') {
  usage.check('pollyChars', text.length); usage.add('pollyChars', text.length); // cost guard
  const r = await polly.send(new SynthesizeSpeechCommand({
    Engine: 'neural', VoiceId: VOICE, LanguageCode: lang as any, Text: text, TextType: 'text',
    OutputFormat: format, ...(format === 'pcm' ? { SampleRate: '16000' } : {}), ...(format === 'json' ? { SpeechMarkTypes: ['word', 'sentence'] } : {}),
  }));
  return Buffer.from(await r.AudioStream!.transformToByteArray());
}

async function transcribePcm(pcm: Buffer, lang: string) {
  const CHUNK = 3200; // 100 ms of 16 kHz PCM16
  async function* audio() {
    for (let i = 0; i < pcm.length; i += CHUNK) { yield { AudioEvent: { AudioChunk: pcm.subarray(i, i + CHUNK) } }; await sleep(100); } // real-time pacing
    for (let i = 0; i < 10; i++) { yield { AudioEvent: { AudioChunk: Buffer.alloc(CHUNK) } }; await sleep(100); } // 1 s of silence to flush
  }
  const res = await transcribe.send(new StartStreamTranscriptionCommand({ LanguageCode: lang as any, MediaEncoding: 'pcm', MediaSampleRateHertz: 16000, AudioStream: audio() }));
  const items: { content: string; start: number; end: number; confidence: number | null; type: string }[] = [];
  for await (const ev of res.TranscriptResultStream!) {
    for (const r of ev.TranscriptEvent?.Transcript?.Results ?? []) {
      if (r.IsPartial) continue;
      for (const it of r.Alternatives?.[0]?.Items ?? []) items.push({ content: it.Content ?? '', start: Math.round((it.StartTime ?? 0) * 1000), end: Math.round((it.EndTime ?? 0) * 1000), confidence: it.Confidence ?? null, type: it.Type ?? '' });
    }
  }
  return items;
}

/** Known reference errors (ms) for the fixture run: reference start = mark − error. 3 of 4 within 50 ms. */
export const FIXTURE_REF_ERRORS = [-20, 10, 35, 70];
async function fixtureRun() {
  mkdirSync(OUT, { recursive: true });
  const { passages } = JSON.parse(readFileSync(path.join(ROOT, 'tools/s4/passages.json'), 'utf8'));
  const summary: any = { simulated: true, voice: 'fixture-tones', at: new Date().toISOString(), passages: [] };
  for (const p of passages) {
    const { marks, durationMs, spans } = fixtureMarks(p.text);
    const pcm = Buffer.from(fixturePcm(spans, durationMs).buffer);
    const tokens = timeTokens(p.text, marks, durationMs);
    const tItems = marks.map((m, k) => ({ content: m.value, start: m.time - FIXTURE_REF_ERRORS[k % FIXTURE_REF_ERRORS.length], end: m.time + 200, confidence: 1, type: 'pronunciation' }));
    writeFileSync(path.join(OUT, `${p.id}.pcm`), pcm);
    writeFileSync(path.join(OUT, `${p.id}.tokens.json`), JSON.stringify(tokens, null, 1));
    writeFileSync(path.join(OUT, `${p.id}.transcribe.json`), JSON.stringify(tItems, null, 1));
    summary.passages.push({ id: p.id, lang: p.lang, durMs: durationMs, wordMarks: marks.length, byteMismatch: markByteMismatches(p.text, marks) });
  }
  writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  console.log(`SIMULATED fixture S4 data → ${path.relative(ROOT, OUT)} (python3 tools/s4/analyze.py ${path.relative(ROOT, OUT)})`);
}

async function main() {
  if (FIXTURE) return fixtureRun();
  mkdirSync(OUT, { recursive: true });
  const { passages } = JSON.parse(readFileSync(path.join(ROOT, 'tools/s4/passages.json'), 'utf8'));
  const summary: any = { simulated: false, region, voice: VOICE, at: new Date().toISOString(), voices: {}, passages: [] };
  for (const lang of ['hi-IN', 'en-IN']) {
    const v = await polly.send(new DescribeVoicesCommand({ LanguageCode: lang as any, Engine: 'neural', IncludeAdditionalLanguageCodes: true })); // Kajal: en-IN, with hi-IN as an additional language
    summary.voices[lang] = (v.Voices ?? []).map((x) => ({ id: x.Id, engines: x.SupportedEngines, lang: x.LanguageCode, extra: x.AdditionalLanguageCodes }));
    console.log(`${lang} neural voices in ${region}: ${summary.voices[lang].map((x: any) => x.id).join(', ') || 'NONE'}`);
    if (!summary.voices[lang].some((x: any) => x.id === VOICE)) throw new Error(`${VOICE} (neural, ${lang}) not offered in ${region}`);
  }
  for (const p of passages) {
    if (only && p.id !== only) continue;
    const text: string = p.text; // sent to Polly EXACTLY as stored; byte offsets refer to this exact string
    const pcm = await synth(text, p.lang, 'pcm');
    const pcm2 = await synth(text, p.lang, 'pcm');
    const mp3 = await synth(text, p.lang, 'mp3');
    const marksRaw = (await synth(text, p.lang, 'json')).toString('utf8');
    const marks = parseSpeechMarks(marksRaw);
    const durMs = Math.round((pcm.length / 2 / 16000) * 1000);
    const tokens = timeTokens(text, marks, durMs);
    // byte-offset sanity: each word mark's [start,end) bytes must decode to its value
    const words = marks.filter((m) => m.type === 'word');
    const byteMismatch = markByteMismatches(text, marks).map((m) => ({ value: m.value, start: m.start, end: m.end }));
    const h = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 16);
    writeFileSync(path.join(OUT, `${p.id}.txt`), text);
    writeFileSync(path.join(OUT, `${p.id}.pcm`), pcm);
    writeFileSync(path.join(OUT, `${p.id}.mp3`), mp3);
    writeFileSync(path.join(OUT, `${p.id}.marks.ndjson`), marksRaw);
    writeFileSync(path.join(OUT, `${p.id}.tokens.json`), JSON.stringify(tokens, null, 1));
    let tItems: any[] = [];
    if (doTranscribe) { tItems = await transcribePcm(pcm, p.lang); writeFileSync(path.join(OUT, `${p.id}.transcribe.json`), JSON.stringify(tItems, null, 1)); }
    const row = { id: p.id, lang: p.lang, durMs, displayTokens: displayTokens(text).length, wordMarks: words.length, unmarkedTokens: tokens.filter((t) => !t.marked).map((t) => t.w), byteMismatch, deterministicPcm: h(pcm) === h(pcm2), pcmBytes: pcm.length, transcribeWords: tItems.filter((i) => i.type === 'pronunciation').length };
    summary.passages.push(row);
    console.log(`${p.id}: ${durMs} ms · ${row.displayTokens} tokens · ${row.wordMarks} word marks · unmarked [${row.unmarkedTokens.join(' ')}] · byte mismatches ${byteMismatch.length} · same audio twice ${row.deterministicPcm} · transcribe words ${row.transcribeWords}`);
  }
  writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  console.log(`\nwrote ${OUT} — tell Claude "S4 synthesized" to run the analysis.`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e?.name ?? '', e?.message ?? e); process.exit(1); });
