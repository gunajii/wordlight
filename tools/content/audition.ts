// Narration audition: the same story pages in a few narration styles, to choose by LISTENING (not by numbers).
//   AWS_REGION=ap-south-1 node tools/content/audition.ts [--story busy-ants] [--pages 3]
// Writes .dev/audition/<story>/<n>-<style>.mp3 (+ list.txt). Cost: ≈ 6 variants × ~400 characters per language,
// well under USD 0.10. Neural variants go through the production PollyNarration (so SSML mark mapping is exercised).
// The generative variant (Kajal, en-IN only, ap-southeast-1) is for comparison: Polly generative voices return NO
// speech marks, so word highlighting would need another timing source.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageSsml, parseSpeechMarks, markByteMismatches, type NarrationStyle } from '@wordlight/story-package';
import { PollyNarration } from './narration.ts';
import { splitLines } from './build-story.ts';
import { usage } from '../../server/src/usage.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const a = process.argv.slice(2); const opt = (k: string) => (a.includes(`--${k}`) ? a[a.indexOf(`--${k}`) + 1] : null);
const region = process.env.AWS_REGION || 'ap-south-1';
const VARIANTS: [string, NarrationStyle | null][] = [
  ['1-current', null],
  ['2-rate95-loud-pause450', { rate: '95%', volume: '+6dB', lineBreakMs: 450 }],
  ['3-rate90-loud-pause650', { rate: '90%', volume: '+6dB', lineBreakMs: 650 }],
  ['4-rate85-loud-pause800', { rate: '85%', volume: '+6dB', lineBreakMs: 800 }],
  ['5-rate90-xloud-pause650', { rate: '90%', volume: 'x-loud', lineBreakMs: 650 }],
];
for (const id of (opt('story') ?? 'busy-ants,busy-ants-hi').split(',')) {
  const src = JSON.parse(readFileSync(path.join(ROOT, 'content/sources', id, 'source.json'), 'utf8'));
  const lines = (src.pages as any[]).slice(0, Number(opt('pages') ?? 3)).flatMap((p) => splitLines(p.text.normalize('NFC')));
  const text = lines.join(' ');
  const out = path.join(ROOT, '.dev/audition', id); mkdirSync(out, { recursive: true });
  const list: string[] = [`${src.title} (${src.lang}) — first pages, ${text.length} characters`, ''];
  for (const [name, style] of VARIANTS) {
    const n = await (await PollyNarration.create({ region, voiceId: 'Kajal', style })).synthesize(text, src.lang, lines);
    const bad = markByteMismatches(text, parseSpeechMarks(n.marksNdjson)).length;
    writeFileSync(path.join(out, `${name}.mp3`), n.mp3);
    list.push(`${name}.mp3  ${(n.durationMs / 1000).toFixed(1)} s  style ${JSON.stringify(style ?? 'none')}  speech marks ${bad ? `MISMATCH ${bad}` : 'OK'}`);
    console.log(id, list.at(-1));
  }
  if (src.lang === 'en-IN') { // generative comparison, en-IN only
    try {
      const { PollyClient, SynthesizeSpeechCommand } = await import('@aws-sdk/client-polly');
      const g = new PollyClient({ region: 'ap-southeast-1' });
      const { ssml } = pageSsml(lines, { volume: '+6dB', lineBreakMs: 650 });
      usage.check('pollyChars', text.length); usage.add('pollyChars', text.length);
      const r = await g.send(new SynthesizeSpeechCommand({ Engine: 'generative', VoiceId: 'Kajal', LanguageCode: 'en-IN', Text: ssml, TextType: 'ssml', OutputFormat: 'mp3' }));
      writeFileSync(path.join(out, '6-generative-NO-WORD-TIMING.mp3'), await r.AudioStream!.transformToByteArray());
      list.push('6-generative-NO-WORD-TIMING.mp3  Polly generative Kajal (Singapore region): more expressive, but no speech marks');
    } catch (e: any) { list.push(`6-generative: not available (${e?.name}: ${e?.message})`); }
    console.log(id, list.at(-1));
  }
  writeFileSync(path.join(out, 'list.txt'), list.join('\n') + '\n');
}
console.log('\nListen: a Finder window opens on .dev/audition/ — select a file and press Space. Then tell Claude which number per language.');
if (process.platform === 'darwin') { const { execFile } = await import('node:child_process'); execFile('open', [path.join(ROOT, '.dev/audition')]); }
