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
import { parseSpeechMarks, timeTokens, markByteMismatches, validateStory, pauseStartMs, PACKAGE_VERSION, type StoryPackage, type Line, type Issue, type NarrationStyle } from '@wordlight/story-package';
import { PollyNarration, FixtureNarration, GenerativeNarration, type NarrationService } from './narration.ts';
import { existsSync } from 'node:fs';
import { chooseTurnsWithModel, bedrockConverse } from './ai-turns.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** Storyteller defaults (chosen by listening, tools/content/audition.ts); a story may override in source.json "narration". */
export const DEFAULT_STYLE: NarrationStyle = { rate: '90%', volume: '+6dB', lineBreakMs: 650 };

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

export async function buildStory(o: { src: any; srcDir: string; outDir: string; narration: NarrationService; verified?: boolean; log?: (m: string) => void; converse?: ((p: string) => Promise<string>) | null; turnModel?: string; helpVoice?: { wordClip(w: string, lang: 'hi-IN' | 'en-IN'): Promise<Uint8Array> } | null }): Promise<{ story: StoryPackage; issues: Issue[] }> {
  const { src, narration } = o;
  const log = o.log ?? (() => {});
  mkdirSync(o.outDir, { recursive: true });
  const pages: StoryPackage['pages'] = [];
  for (let pi = 0; pi < src.pages.length; pi++) {
    const sp = src.pages[pi];
    const lines = splitLines(sp.text.normalize('NFC'));
    const pageText = lines.join(' '); // EXACTLY what the narrator gets
    const n = await narration.synthesize(pageText, src.lang, lines);
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
    // A line's last word otherwise "lasts" until the next line starts (pause included). Its real end comes from the
    // audio, so an echo turn stops right after the narrator finishes the line, not at the next line's first sound.
    if (n.pcm16k) for (const l of outLines) {
      const w = l.words[l.words.length - 1];
      if (w) w.t1 = Math.max(w.t0 + 1, Math.min(w.t1, Math.round(pauseStartMs(n.pcm16k, w.t0 + 60, w.t1) + 40)));
    }
    const audio = `p${pi + 1}.mp3`;
    writeFileSync(path.join(o.outDir, audio), n.mp3);
    const image = `p${pi + 1}${path.extname(sp.image).toLowerCase()}`;
    copyFileSync(path.join(o.srcDir, sp.image), path.join(o.outDir, image));
    pages.push({ image, audio, durationMs: n.durationMs, lines: outLines });
    log(`page ${pi + 1}: ${outLines.length} lines, ${toks.length} words, ${n.durationMs} ms`);
  }
  const flat = pages.flatMap((p, pi) => p.lines.map((l, li) => ({ page: pi, line: li, words: l.words.map((w) => w.w) })));
  const choice = await chooseTurnsWithModel(flat, src.level ?? 1, o.converse ?? null, o.turnModel);
  if (choice.fallback) log(`turn lines: rules (model not used: ${choice.fallback})`);
  for (const i of choice.indexes) pages[flat[i].page].lines[flat[i].line].turn = true;
  // Help clips: every word of a turn line, spoken alone and slowly by the neural voice. The TV plays the clip when
  // it helps with a word, instead of seeking in the page audio (which on the VVD let the rest of the line play).
  if (o.helpVoice) {
    const done = new Map<string, string>();
    for (const pg of pages) for (const l of pg.lines) if (l.turn) for (const w of l.words) {
      const key = w.w.normalize('NFC').replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '').toLowerCase();
      if (!key) continue;
      if (!done.has(key)) {
        const file = `h${done.size + 1}.mp3`;
        writeFileSync(path.join(o.outDir, file), await o.helpVoice.wordClip(w.w, src.lang));
        done.set(key, file);
      }
      w.clip = done.get(key);
    }
    log(`help clips: ${done.size}`);
  }
  const story: StoryPackage = {
    packageVersion: PACKAGE_VERSION, id: src.id, lang: src.lang, level: src.level ?? 1, title: src.title, credits: src.credits,
    voice: narration.voice as StoryPackage['voice'], timing: { source: narration.timingSource, verified: !!o.verified }, pages,
    turnSelection: { source: choice.source, ...(choice.model ? { model: choice.model } : {}), level: src.level ?? 1, ...(choice.reason ? { reason: choice.reason } : {}) },
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
  const srcDir = path.join(ROOT, 'content/sources', id);
  const src = JSON.parse(readFileSync(path.join(srcDir, 'source.json'), 'utf8'));
  // narration style: --rate/--volume/--line-break-ms, else source.json "narration", else DEFAULT_STYLE
  const style: NarrationStyle = { ...DEFAULT_STYLE, ...(src.narration ?? {}), ...(opt('rate') ? { rate: opt('rate')! } : {}), ...(opt('volume') ? { volume: opt('volume')! } : {}), ...(opt('line-break-ms') ? { lineBreakMs: Number(opt('line-break-ms')) } : {}) };
  // engine: --narration fixture|polly|generative, else source.json narration.engine ('generative' → expressive English
  // voice, word times from Transcribe alignment with the offset measured by tools/s4/align-check.ts)
  const engine = opt('narration') ?? (src.narration?.engine === 'generative' ? 'generative' : 'polly');
  const decision = path.join(ROOT, '.dev/aws/align-decision.json');
  const offsetMs = opt('align-offset-ms') !== null ? Number(opt('align-offset-ms')) : existsSync(decision) ? JSON.parse(readFileSync(decision, 'utf8')).offsetMs : 0;
  const { engine: _e, ...styleOnly } = style as any;
  const narration = engine === 'fixture' ? new FixtureNarration()
    : engine === 'generative' ? await GenerativeNarration.create({ region: process.env.GENERATIVE_REGION || 'ap-southeast-1', transcribeRegion: process.env.AWS_REGION || 'ap-south-1', voiceId: opt('voice') ?? 'Kajal', style: { volume: styleOnly.volume, lineBreakMs: styleOnly.lineBreakMs }, offsetMs })
    : await PollyNarration.create({ region: process.env.AWS_REGION || 'ap-south-1', voiceId: opt('voice') ?? 'Kajal', style: args.includes('--plain') ? null : styleOnly });
  if (engine === 'generative') console.log(`generative narration: word times from Transcribe alignment, offset ${offsetMs} ms`);
  if (JSON.stringify(src.credits ?? {}).includes('CHECK')) { console.error('source.json credits still contain CHECK markers: verify author/illustrator/licence/URL against the StoryWeaver page first'); process.exit(1); }
  const turnModel = opt('turn-model') ?? undefined; // e.g. the model chosen by tools/bedrock/bench.ts
  const converse = turnModel ? await bedrockConverse(process.env.AWS_REGION || 'ap-south-1', turnModel) : null;
  const helpVoice = engine === 'fixture' ? null : await PollyNarration.create({ region: process.env.AWS_REGION || 'ap-south-1', voiceId: opt('voice') ?? 'Kajal' });
  const { story, issues } = await buildStory({ src, srcDir, outDir: path.join(ROOT, 'content/stories', id), narration, verified: args.includes('--verified'), log: console.log, converse, turnModel, helpVoice });
  for (const i of issues) console.log(`${i.level}: ${i.path} — ${i.message}`);
  if (issues.some((i) => i.level === 'error')) process.exit(1);
  if (narration instanceof GenerativeNarration) { const st = narration.stats; const m = st.reduce((a, x) => a + x.matched, 0), t = st.reduce((a, x) => a + x.tokens, 0); console.log(`alignment: ${m}/${t} words matched to the recogniser (${Math.round((100 * m) / t)} %), rest interpolated`); }
  console.log(`wrote content/stories/${id} · ${story.pages.length} pages · ${story.pages.flatMap((p) => p.lines).filter((l) => l.turn).length} Your Turn lines · narration ${narration.voice.engine}/${narration.voice.id}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e?.name ?? '', e?.message ?? e); process.exit(1); });
