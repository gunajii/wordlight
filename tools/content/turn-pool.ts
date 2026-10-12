// Add the age-turn pool (and the help clips its words need) to an already built story. The narration, word timings
// and default turns are not touched — only story.json gains "turnPool" and some words gain "clip".
//   node tools/content/turn-pool.ts <id> --dry        what would change, and the turns per age (no AWS)
//   AWS_REGION=ap-south-1 node tools/content/turn-pool.ts <id>     make the missing clips (Polly neural) and write
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { turnPoolLines, validateStory, type StoryPackage } from '@wordlight/story-package';
import { chooseAgeTurns, turnsForAge, maxWordsForAge } from '../../packages/tv-core/src/index.ts';
import { addHelpClips, clipKey } from './help-clips.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function planPool(story: StoryPackage, avoid: string[]) {
  const flat = story.pages.flatMap((p, pi) => p.lines.map((l, li) => ({ page: pi, line: li, words: l.words.map((w) => w.w), turn: l.turn })));
  const own = flat.map((f, i) => (f.turn ? i : -1)).filter((i) => i >= 0);
  const idx = [...new Set([...turnPoolLines(flat, avoid), ...own])].sort((a, b) => a - b);
  const pool = idx.map((i) => flat[i]);
  const have = new Set(story.pages.flatMap((p) => p.lines.flatMap((l) => l.words.filter((w) => w.clip).map((w) => clipKey(w.w)))));
  const missing = [...new Set(pool.flatMap((l) => l.words.map(clipKey)).filter((k) => k && !have.has(k)))];
  return { pool, refs: pool.map(({ page, line }) => ({ page, line })), missing };
}

async function main() {
  const id = process.argv[2]; const dry = process.argv.includes('--dry');
  if (!id || id.startsWith('--')) { console.error('usage: node tools/content/turn-pool.ts <id> [--dry]'); process.exit(2); }
  const dir = path.join(ROOT, 'content/stories', id);
  const story: StoryPackage = JSON.parse(readFileSync(path.join(dir, 'story.json'), 'utf8'));
  const srcFile = path.join(ROOT, 'content/sources', id, 'source.json');
  const avoid: string[] = existsSync(srcFile) ? JSON.parse(readFileSync(srcFile, 'utf8')).turnAvoid ?? [] : [];
  const { pool, refs, missing } = planPool(story, avoid);
  console.log(`${id}: pool ${pool.length} lines (avoid: ${avoid.join(', ') || '—'}) · help clips to make: ${missing.length}`);
  for (const age of [5, 6, 7, 8, 9, 10, 11, 12]) {
    const fit = pool.filter((l) => l.words.length <= maxWordsForAge(age));
    const c = chooseAgeTurns(fit, turnsForAge(age, fit.length));
    console.log(`  age ${String(age).padStart(2)}: ${String(c.length).padStart(2)} turns (≤ ${maxWordsForAge(age)} words) · ${c.map((l) => `p${l.page + 1}.${l.line + 1}(${l.words.length})`).join(' ')}`);
  }
  if (dry) return;
  const { PollyNarration } = await import('./narration.ts');
  const voice = await PollyNarration.create({ region: process.env.AWS_REGION || 'ap-south-1', voiceId: 'Kajal' });
  const made = await addHelpClips(story.pages, refs, voice, dir, story.lang);
  story.turnPool = refs;
  const errors = validateStory(story).filter((i) => i.level === 'error');
  if (errors.length) { for (const e of errors) console.error(`error: ${e.path} — ${e.message}`); process.exit(1); }
  writeFileSync(path.join(dir, 'story.json'), JSON.stringify(story, null, 1));
  console.log(`wrote ${id}/story.json · ${made} new help clips · pool ${refs.length} lines`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e?.name ?? '', e?.message ?? e); process.exit(1); });
