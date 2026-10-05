// Validate story packages before they reach the TV:  node tools/content/validate-story.ts [<id> ...]
// Checks: JSON + schema, credits/licence, language, Hindi text, word timings (order, overlap, inside the audio),
// turn-line word counts, and that every image/audio file exists. Exit 1 on any error.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStoryDir, checkAllStories } from '../../server/src/content.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(ROOT, 'content/stories');
const ids = process.argv.slice(2);
const results = ids.length ? await Promise.all(ids.map((id) => checkStoryDir(path.join(dir, id)))) : await checkAllStories(dir);
let bad = 0;
for (const r of results) {
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.id}${r.test ? ' (test content)' : ''}`);
  for (const i of r.issues) console.log(`   ${i.level === 'error' ? 'error  ' : 'warning'} ${i.path}: ${i.message}`);
  if (!r.ok) bad++;
}
process.exit(bad ? 1 : 0);
