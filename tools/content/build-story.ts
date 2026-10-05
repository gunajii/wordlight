// Build a WordLight story package from a source folder.
//   content/sources/<id>/source.json   { id, lang, level, title, credits{...}, pages: [{ image: "p1.jpg", text: "…" }] }
//   content/sources/<id>/<images>
// → content/stories/<id>/story.json + p<n>.mp3 + images   (validated; turn lines chosen deterministically)
//
//   AWS_REGION=ap-south-1 node tools/content/build-story.ts <id> [--voice Kajal] [--verified]     Amazon Polly (production)
//   node tools/content/build-story.ts <id> --narration fixture                                    tones, no AWS (test content)
//
// Each page's text is sent to the narrator EXACTLY as written to story.json (lines joined by single spaces), so the
// speech marks' UTF-8 byte offsets map onto it (packages/story-package: timeTokens, markByteMismatches).
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSpeechMarks, timeTokens, markByteMismatches, chooseTurns, validateStory, PACKAGE_VERSION, type StoryPackage, type Line, type Issue } from '@wordlight/story-package';
import { PollyNarration, FixtureNarration, type NarrationService } from './narration.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

export async function buildStory(o: { src: any; srcDir: string; outDir: string; narration: NarrationService; verified?: boolean; log?: (m: string) => void }): Promise<{ story: StoryPackage; issues: Issue[] }> {
  const { src, narration } = o;
  const log = o.log ?? (() => {});
  mkdirSync(o.outDir, { recursive: true });
  const pages: StoryPackage['pages'] = [];
  for (let pi = 0; pi < src.pages.length; pi++) {
    const sp = src.pages[pi];
    const lines = splitLines(sp.text.normalize('NFC'));
    const pageText = lines.join(' '); // EXACTLY what the narrator gets
    const n = await narration.synthesize(pageText, src.lang);
    const marks = parseSpeechMarks(n.marksNdjson);
    const bad = markByteMismatches(pageText, marks);
    if (bad.length) throw new Error(`page ${pi + 1}: ${bad.length} speech marks do not match the text bytes (first: ${JSON.stringify(bad[0])})`);
    const toks = timeTokens(pageText, marks, n.durationMs);
    const unmarked = toks.filter((t) => !t.marked).length;
    if (unmarked) log(`page ${pi + 1}: ${unmarked} token(s) without their own speech mark (timed with the previous word)`);
    let k = 0;
    const outLines: Line[] = lines.map((l) => {
      const c = l.split(/\s+/).length;
      const words = toks.slice(k, k + c).map((t) => ({ w: t.w, t0: Math.round(t.t0), t1: Math.round(t.t1) }));
      k += c;
      return { text: l, words, turn: false };
    });
    const audio = `p${pi + 1}.mp3`;
    writeFileSync(path.join(o.outDir, audio), n.mp3);
    const image = `p${pi + 1}${path.extname(sp.image).toLowerCase()}`;
    copyFileSync(path.join(o.srcDir, sp.image), path.join(o.outDir, image));
    pages.push({ image, audio, durationMs: n.durationMs, lines: outLines });
    log(`page ${pi + 1}: ${outLines.length} lines, ${toks.length} words, ${n.durationMs} ms`);
  }
  const flat = pages.flatMap((p, pi) => p.lines.map((l, li) => ({ page: pi, line: li, words: l.words.map((w) => w.w) })));
  for (const i of chooseTurns(flat)) pages[flat[i].page].lines[flat[i].line].turn = true;
  const story: StoryPackage = {
    packageVersion: PACKAGE_VERSION, id: src.id, lang: src.lang, level: src.level ?? 1, title: src.title, credits: src.credits,
    voice: narration.voice as StoryPackage['voice'], timing: { source: narration.timingSource, verified: !!o.verified }, pages,
  };
  const issues = validateStory(story);
  if (!issues.some((i) => i.level === 'error')) writeFileSync(path.join(o.outDir, 'story.json'), JSON.stringify(story, null, 1));
  return { story, issues };
}

async function main() {
  const args = process.argv.slice(2);
  const id = args[0] ?? '';
  const opt = (k: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : null);
  if (!id || id.startsWith('--')) { console.error('usage: node tools/content/build-story.ts <id> [--narration polly|fixture] [--voice Kajal] [--verified]'); process.exit(2); }
  const kind = opt('narration') ?? 'polly';
  const narration = kind === 'fixture' ? new FixtureNarration() : await PollyNarration.create({ region: process.env.AWS_REGION || 'ap-south-1', voiceId: opt('voice') ?? 'Kajal' });
  const srcDir = path.join(ROOT, 'content/sources', id);
  const src = JSON.parse(readFileSync(path.join(srcDir, 'source.json'), 'utf8'));
  if (JSON.stringify(src.credits ?? {}).includes('CHECK')) { console.error('source.json credits still contain CHECK markers: verify author/illustrator/licence/URL against the StoryWeaver page first'); process.exit(1); }
  const { story, issues } = await buildStory({ src, srcDir, outDir: path.join(ROOT, 'content/stories', id), narration, verified: args.includes('--verified'), log: console.log });
  for (const i of issues) console.log(`${i.level}: ${i.path} — ${i.message}`);
  if (issues.some((i) => i.level === 'error')) process.exit(1);
  console.log(`wrote content/stories/${id} · ${story.pages.length} pages · ${story.pages.flatMap((p) => p.lines).filter((l) => l.turn).length} Your Turn lines · narration ${narration.voice.engine}/${narration.voice.id}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e?.name ?? '', e?.message ?? e); process.exit(1); });
