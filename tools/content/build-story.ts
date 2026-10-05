// Build a WordLight story package from a source folder, with Amazon Polly narration and word speech marks.
//   content/sources/<id>/source.json   { id, lang, level, title, credits{...}, pages: [{ image: "p1.jpg", text: "…" }] }
//   content/sources/<id>/<images>
// → content/stories/<id>/story.json + p<n>.mp3 + images   (validated; turn lines chosen deterministically)
//   AWS_REGION=ap-south-1 node tools/content/build-story.ts <id> [--voice Kajal] [--verified]
// Each page's text is sent to Polly EXACTLY as written to story.json (lines joined by single spaces), so the
// speech marks' UTF-8 byte offsets map onto it (packages/story-package: timeTokens, markByteMismatches).
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSpeechMarks, timeTokens, markByteMismatches, chooseTurns, validateStory, PACKAGE_VERSION, type StoryPackage, type Line } from '@wordlight/story-package';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const id = args[0] ?? '';
const VOICE = args.includes('--voice') ? args[args.indexOf('--voice') + 1] : 'Kajal';
const VERIFIED = args.includes('--verified'); // set only after S4 measured the timings for this voice/language
const region = process.env.AWS_REGION || 'ap-south-1';
const polly = new PollyClient({ region });
const SRC = path.join(ROOT, 'content/sources', id), OUT = path.join(ROOT, 'content/stories', id);

/** Split page text into display lines at sentence ends (., !, ?, ।), keeping punctuation and closing quotes. */
export function splitLines(text: string): string[] {
  const t = text.replace(/\s+/g, ' ').trim();
  const parts = t.match(/[^.!?।]+[.!?।]+["'”’)]*|[^.!?।]+$/gu) ?? [t];
  const out: string[] = [];
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if (out.length && /^\p{Ll}/u.test(p)) out[out.length - 1] += ' ' + p; // “Come here!” said Ma. → one line
    else out.push(p);
  }
  return out;
}

async function synth(text: string, lang: string, format: 'mp3' | 'pcm' | 'json') {
  const r = await polly.send(new SynthesizeSpeechCommand({ Engine: 'neural', VoiceId: VOICE as any, LanguageCode: lang as any, Text: text, TextType: 'text', OutputFormat: format, ...(format === 'pcm' ? { SampleRate: '16000' } : {}), ...(format === 'json' ? { SpeechMarkTypes: ['word'] } : {}) }));
  return Buffer.from(await r.AudioStream!.transformToByteArray());
}

async function main() {
  if (!id) { console.error('usage: node tools/content/build-story.ts <id> [--voice Kajal] [--verified]'); process.exit(2); }
  const src = JSON.parse(readFileSync(path.join(SRC, 'source.json'), 'utf8'));
  mkdirSync(OUT, { recursive: true });
  const pages: StoryPackage['pages'] = [];
  for (let pi = 0; pi < src.pages.length; pi++) {
    const sp = src.pages[pi];
    const lines = splitLines(sp.text);
    const pageText = lines.join(' '); // EXACTLY what Polly gets
    const [mp3, pcm, marksRaw] = [await synth(pageText, src.lang, 'mp3'), await synth(pageText, src.lang, 'pcm'), (await synth(pageText, src.lang, 'json')).toString('utf8')];
    const durationMs = Math.round((pcm.length / 2 / 16000) * 1000);
    const marks = parseSpeechMarks(marksRaw);
    const bad = markByteMismatches(pageText, marks);
    if (bad.length) throw new Error(`page ${pi + 1}: ${bad.length} speech marks do not match the text bytes (first: ${JSON.stringify(bad[0])})`);
    const toks = timeTokens(pageText, marks, durationMs);
    let k = 0;
    const outLines: Line[] = lines.map((l) => {
      const n = l.split(/\s+/).length;
      const words = toks.slice(k, k + n).map((t) => ({ w: t.w, t0: Math.round(t.t0), t1: Math.round(t.t1) }));
      k += n;
      return { text: l, words, turn: false };
    });
    const audio = `p${pi + 1}.mp3`;
    writeFileSync(path.join(OUT, audio), mp3);
    const ext = path.extname(sp.image).toLowerCase();
    const image = `p${pi + 1}${ext}`;
    copyFileSync(path.join(SRC, sp.image), path.join(OUT, image));
    pages.push({ image, audio, durationMs, lines: outLines });
    console.log(`page ${pi + 1}: ${outLines.length} lines, ${toks.length} words, ${durationMs} ms`);
  }
  const flat = pages.flatMap((p, pi) => p.lines.map((l, li) => ({ page: pi, line: li, words: l.words.map((w) => w.w) })));
  for (const i of chooseTurns(flat)) pages[flat[i].page].lines[flat[i].line].turn = true;
  const story: StoryPackage = {
    packageVersion: PACKAGE_VERSION, id: src.id, lang: src.lang, level: src.level ?? 1, title: src.title, credits: src.credits,
    voice: { engine: 'polly-neural', id: VOICE }, timing: { source: 'polly-speech-marks', verified: VERIFIED }, pages,
  };
  const issues = validateStory(story);
  for (const i of issues) console.log(`${i.level}: ${i.path} — ${i.message}`);
  if (issues.some((i) => i.level === 'error')) process.exit(1);
  writeFileSync(path.join(OUT, 'story.json'), JSON.stringify(story, null, 1));
  console.log(`wrote content/stories/${id} · ${pages.length} pages · ${flat.length} lines · ${story.pages.flatMap((p) => p.lines).filter((l) => l.turn).length} Your Turn lines`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e?.name ?? '', e?.message ?? e); process.exit(1); });
